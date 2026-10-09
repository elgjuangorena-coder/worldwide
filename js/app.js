import * as M from './map.js';
import * as UI from './ui.js';
import { childrenOf, indexFeatures, loadBoundaries, parentOf, peekBoundaries } from './boundaries.js';
import {
  allLandmarks, assignCountries, assignLevel, countBy, googleMapsUrl, isVisited,
  landmarkById, loadLandmarks, toggleVisited,
} from './landmarks.js';
import { applyAdmin1Names } from './names.js';
import { colorFor, labelPoint, mainBbox, normalize } from './utils.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

let countries;
let countriesFC = EMPTY;
const countryByIso = new Map();
const loaded = new Map();
const labelCache = new WeakMap();

let view = { level: 'world' };
let routeToken = 0;
let pendingLandmark = null;
let firstRoute = true;

init().catch((err) => {
  console.error(err);
  UI.toast('Algo salió mal al iniciar. Revisa la consola.', 8000);
});

async function init() {
  UI.setupSheet();
  M.initMap({
    container: 'map',
    getPadding,
    handlers: { onCountry, onRegion, onLabel, onLandmark },
  });

  const [fc] = await Promise.all([
    fetch('data/countries.geojson').then((r) => r.json()),
    loadLandmarks().catch((err) => {
      console.error(err);
      UI.toast('No se pudo leer data/landmarks.json. ¿Estás usando un servidor local?', 8000);
      return [];
    }),
  ]);

  for (const f of fc.features) f.properties.uid = f.properties.iso;
  countriesFC = fc;
  countries = indexFeatures(fc.features);
  buildCountryIndex(fc.features);
  assignCountries(countries);

  UI.setupSearch({ search, onSelect: onSearchSelect });
  document.getElementById('home-btn').addEventListener('click', () => go());
  document.getElementById('style-btn').addEventListener('click', () => M.toggleStyle());
  window.addEventListener('hashchange', route);
  route();
}

function buildCountryIndex(features) {
  for (const f of features) {
    const { iso, name, name_en: nameEn } = f.properties;
    const area = turf.area(f);
    const entry = countryByIso.get(iso);
    if (!entry || area > entry.area) {
      countryByIso.set(iso, { iso, name, nameEn, feature: f, area });
    }
  }
}

function getPadding() {
  if (!UI.isMobile()) return { top: 50, bottom: 50, left: 430, right: 90 };
  const h = window.innerHeight;
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 90) + 12;
  const bottom = Math.min(UI.sheetVisibleHeight() + 16, Math.max(16, h - top - 120));
  return { top, bottom, left: 24, right: 24 };
}

/* ---------- Routing: #/ISO/estado/municipio ---------- */

function parseHash() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

function go(...parts) {
  const hash = `#/${parts.map(encodeURIComponent).join('/')}`;
  if (location.hash === hash || (!parts.length && !parseHash().length)) route();
  else location.hash = hash;
}

async function load(iso, level, text) {
  const key = `${iso}-${level}`;
  const loader = peekBoundaries(iso, level) ? null : UI.showLoading(text);
  try {
    const b = await loadBoundaries(iso, level, (p) => loader?.progress(p));
    if (b && level === 'ADM1') await applyAdmin1Names(iso, b);
    if (b) loaded.set(key, b);
    return b;
  } finally {
    loader?.done();
  }
}

async function route() {
  const token = ++routeToken;
  const [iso, stateUid, muniUid] = parseHash();
  M.closePopup();

  const move = !firstRoute;
  firstRoute = false;
  if (!iso) return showWorld({}, { move });

  const country = countryByIso.get(iso);
  if (!country) return go();

  if (view.iso !== iso) previewFocus(country.feature, 'País', country.name);

  let adm1;
  try {
    adm1 = await load(iso, 'ADM1', `Descargando estados de ${country.name}…`);
  } catch (err) {
    console.error(err);
    if (token === routeToken) {
      UI.toast('No se pudieron descargar las fronteras. Revisa tu conexión.');
      showCountryNoData({ country });
    }
    return;
  }
  if (token !== routeToken) return;
  if (!adm1) return showCountryNoData({ country });
  assignLevel(iso, 'adm1', adm1);

  const state = stateUid ? adm1.byId.get(stateUid) : null;
  if (!state) return showCountry({ country, adm1 });

  if (view.stateUid !== stateUid) previewFocus(state, 'Estado / provincia', state.properties.name);

  let adm2 = null;
  try {
    adm2 = await load(iso, 'ADM2', `Descargando municipios de ${country.name}…`);
  } catch (err) {
    console.error(err);
    UI.toast('No se pudieron descargar los municipios.');
  }
  if (token !== routeToken) return;
  if (adm2) assignLevel(iso, 'adm2', adm2);

  const children = adm2 ? childrenOf(adm2, state) : [];
  const muni = muniUid ? children.find((f) => f.properties.uid === muniUid) : null;
  if (!muni) return showState({ country, adm1, adm2, state, children });
  showMuni({ country, adm1, adm2, state, children, muni });
}

/** Moves the camera right away while the (possibly large) boundary file downloads. */
function previewFocus(feature, kicker, title) {
  UI.setHeader({ kicker, title, onBack: () => history.back() });
  UI.setStats([]);
  UI.setBody(UI.hint('Cargando divisiones…'));
  M.fitBbox(mainBbox(feature), 12);
}

/* ---------- Vistas ---------- */

function setView(level, args) {
  view = {
    level,
    args,
    iso: args.country?.iso ?? null,
    stateUid: args.state?.properties.uid ?? null,
    muniUid: args.muni?.properties.uid ?? null,
    adm1: args.adm1 ?? null,
    adm2: args.adm2 ?? null,
  };
}

function refreshView() {
  const renderers = { world: showWorld, nodata: showCountryNoData, country: showCountry, state: showState, muni: showMuni };
  renderers[view.level](view.args ?? {}, { move: false });
}

function showWorld(args = {}, { move = true } = {}) {
  setView('world', args);
  const lms = allLandmarks();
  const counts = countBy(lms, 'country');

  for (const f of countriesFC.features) f.properties.count = counts.get(f.properties.iso) ?? 0;
  const labels = [...counts.keys()].map((iso) => {
    const c = countryByIso.get(iso);
    if (!c) return null;
    const { lx, ly } = c.feature.properties;
    return point([lx, ly], { uid: iso, name: c.name, count: counts.get(iso) });
  }).filter(Boolean);

  M.setMode('world');
  M.setSelectedRegion(null);
  M.setData({ countries: countriesFC, regions: EMPTY, focus: EMPTY, labels: fc(labels), landmarks: landmarksFC(lms) });
  if (move) M.flyToWorld();

  UI.setHeader({ kicker: 'Explora', title: 'Mundo' });
  UI.setStats([
    { value: lms.length, label: 'landmarks' },
    { value: counts.size, label: counts.size === 1 ? 'país' : 'países' },
    { value: lms.filter((l) => isVisited(l.id)).length, label: 'visitados' },
  ]);
  const items = [...counts.entries()]
    .map(([iso, count]) => ({ uid: iso, name: countryByIso.get(iso)?.name ?? iso, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  UI.setBody(
    UI.hint('Gira el globo y toca un país, o búscalo arriba. Los países en amarillo tienen landmarks guardados.'),
    items.length ? UI.sectionTitle('Tus países') : null,
    items.length ? UI.regionList(items, (iso) => go(iso)) : null,
  );
  UI.renderBreadcrumb([{ label: 'Mundo' }]);
}

function showCountryNoData(args, { move = true } = {}) {
  const { country } = args;
  setView('nodata', args);
  const lms = allLandmarks().filter((l) => l.country === country.iso);
  baseCountryLayers(country, lms, EMPTY, EMPTY, 'country');
  if (move) M.fitBbox(mainBbox(country.feature), 8);
  UI.setHeader({ kicker: 'País', title: country.name, onBack: () => go() });
  UI.setStats([{ value: lms.length, label: 'landmarks' }]);
  UI.setBody(
    UI.hint('No hay estados ni municipios disponibles para este país.'),
    ...landmarkList(lms),
  );
  UI.renderBreadcrumb([{ label: 'Mundo', onClick: () => go() }, { label: country.name }]);
  openPending(lms);
}

function showCountry(args, { move = true } = {}) {
  const { country, adm1 } = args;
  setView('country', args);
  const lms = allLandmarks().filter((l) => l.country === country.iso);
  const counts = countBy(lms, 'adm1');
  const regions = coloredRegions(adm1.features, counts);

  baseCountryLayers(country, lms, fc(regions), labelsFor(adm1.features, regions), 'country');
  M.setSelectedRegion(null);
  if (move) M.fitBbox(mainBbox(country.feature), 8);

  UI.setHeader({ kicker: 'País', title: country.name, onBack: () => go() });
  UI.setStats([
    { value: lms.length, label: 'landmarks' },
    { value: counts.size, label: 'con landmarks' },
    { value: adm1.features.length, label: 'estados' },
  ]);
  UI.setBody(
    lms.length ? null : UI.hint('Aún no tienes landmarks en este país.'),
    UI.sectionTitle('Estados / provincias'),
    UI.regionList(sortedItems(regions), (uid) => go(country.iso, uid)),
  );
  UI.renderBreadcrumb([{ label: 'Mundo', onClick: () => go() }, { label: country.name }]);
  openPending(lms);
}

function showState(args, { move = true } = {}) {
  const { country, state, children } = args;
  setView('state', args);
  const iso = country.iso;
  const stateUid = state.properties.uid;
  const hasMunis = children.length >= 2;
  const childIds = new Set(children.map((f) => f.properties.uid));
  const lms = allLandmarks().filter((l) => l.country === iso && (l.adm1 === stateUid || childIds.has(l.adm2)));
  const counts = countBy(lms.filter((l) => childIds.has(l.adm2)), 'adm2');
  const source = hasMunis ? children : [state];
  const regions = coloredRegions(source, hasMunis ? counts : new Map([[stateUid, lms.length]]));

  baseCountryLayers(country, lms, fc(regions), hasMunis ? labelsFor(source, regions) : EMPTY, 'state');
  M.setData({ focus: fc([state]) });
  M.setSelectedRegion(null);
  if (move) M.fitBbox(mainBbox(state), 12);

  UI.setHeader({ kicker: 'Estado / provincia', title: state.properties.name, onBack: () => go(iso) });
  if (hasMunis) {
    UI.setStats([
      { value: lms.length, label: 'landmarks' },
      { value: counts.size, label: 'con landmarks' },
      { value: children.length, label: 'municipios' },
    ]);
    UI.setBody(
      lms.length ? null : UI.hint('Aún no tienes landmarks en este estado.'),
      UI.sectionTitle('Municipios / distritos'),
      UI.regionList(sortedItems(regions), (uid) => go(iso, stateUid, uid)),
    );
  } else {
    UI.setStats([{ value: lms.length, label: 'landmarks' }]);
    UI.setBody(
      UI.hint('No hay municipios disponibles para este estado; aquí están todos sus landmarks.'),
      ...landmarkList(lms),
    );
  }
  UI.renderBreadcrumb([
    { label: 'Mundo', onClick: () => go() },
    { label: country.name, onClick: () => go(iso) },
    { label: state.properties.name },
  ]);
  openPending(lms);
}

function showMuni(args, { move = true } = {}) {
  const { country, state, children, muni } = args;
  setView('muni', args);
  const iso = country.iso;
  const stateUid = state.properties.uid;
  const muniUid = muni.properties.uid;
  const childIds = new Set(children.map((f) => f.properties.uid));
  const stateLms = allLandmarks().filter((l) => l.country === iso && childIds.has(l.adm2));
  const lms = stateLms.filter((l) => l.adm2 === muniUid);
  const regions = coloredRegions(children, countBy(stateLms, 'adm2'));

  baseCountryLayers(country, lms, fc(regions), labelsFor(children, regions), 'muni');
  M.setData({ focus: fc([state]) });
  M.setSelectedRegion(muniUid);
  if (move) M.fitBbox(mainBbox(muni), 15);

  const visitedCount = lms.filter((l) => isVisited(l.id)).length;
  UI.setHeader({ kicker: 'Municipio / distrito', title: muni.properties.name, onBack: () => go(iso, stateUid) });
  UI.setStats([
    { value: lms.length, label: 'landmarks' },
    { value: `${visitedCount}/${lms.length}`, label: 'visitados' },
  ]);
  UI.setBody(
    lms.length ? null : UI.hint('Aún no tienes landmarks en este municipio.'),
    ...landmarkList(lms),
  );
  UI.renderBreadcrumb([
    { label: 'Mundo', onClick: () => go() },
    { label: country.name, onClick: () => go(iso) },
    { label: state.properties.name, onClick: () => go(iso, stateUid) },
    { label: muni.properties.name },
  ]);
  if (move && UI.isMobile() && UI.getSnap() === 'full') UI.setSnap('half');
  openPending(lms);
}

function baseCountryLayers(country, lms, regions, labels, mode) {
  for (const f of countriesFC.features) f.properties.count = 0;
  M.setMode(mode);
  M.setData({ countries: countriesFC, regions, labels, focus: EMPTY, landmarks: landmarksFC(lms) });
}

/** Landmark cards, grouped under a heading per neighborhood when there is more than one. */
function landmarkList(lms) {
  const options = {
    onShow: (id) => showLandmark(landmarkById(id)),
    onToggleVisited: (id) => { toggleVisited(id); refreshView(); },
    isVisited,
    mapsUrl: googleMapsUrl,
  };
  const groups = new Map();
  for (const lm of lms) {
    const hood = lm.neighborhood || 'Otros';
    if (!groups.has(hood)) groups.set(hood, []);
    groups.get(hood).push(lm);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (groups.size <= 1) return [UI.landmarkCards([...lms].sort(byName), options)];

  const nodes = [];
  let start = 0;
  const names = [...groups.keys()].sort((a, b) => (a === 'Otros') - (b === 'Otros') || a.localeCompare(b));
  for (const hood of names) {
    const list = groups.get(hood).sort(byName);
    nodes.push(UI.sectionTitle(`${hood} · ${list.length}`));
    nodes.push(UI.landmarkCards(list, { ...options, start }));
    start += list.length;
  }
  return nodes;
}

/* ---------- Landmarks ---------- */

function showLandmark(lm, { fly = true } = {}) {
  if (!lm) return;
  if (UI.isMobile()) UI.setSnap('peek');
  if (fly) M.flyTo([lm.lng, lm.lat], 15);
  const open = () => M.openPopup([lm.lng, lm.lat], UI.popupContent(lm, {
    place: placeLabel(lm),
    visited: isVisited(lm.id),
    mapsUrl: googleMapsUrl(lm),
    onToggleVisited: (id) => {
      toggleVisited(id);
      refreshView();
      showLandmark(landmarkById(id), { fly: false });
    },
  }));
  open();
}

function openPending(lms) {
  if (!pendingLandmark) return;
  const lm = lms.find((l) => l.id === pendingLandmark);
  pendingLandmark = null;
  if (lm) setTimeout(() => showLandmark(lm), 50);
}

async function goToLandmark(id) {
  const lm = landmarkById(id);
  if (!lm?.country || !countryByIso.has(lm.country)) {
    UI.toast('No encontré en qué país está este landmark. Revisa sus coordenadas.');
    return;
  }
  if (view.level === 'muni' && lm.adm2 === view.muniUid) return showLandmark(lm);
  if (view.level === 'state' && lm.adm1 === view.stateUid && !view.args.children.some((c) => c.properties.uid === lm.adm2)) {
    return showLandmark(lm);
  }
  pendingLandmark = id;
  const iso = lm.country;
  const name = countryByIso.get(iso).name;
  try {
    const adm1 = await load(iso, 'ADM1', `Descargando estados de ${name}…`);
    if (!adm1) return go(iso);
    assignLevel(iso, 'adm1', adm1);
    if (!lm.adm1) return go(iso);
    const adm2 = await load(iso, 'ADM2', `Descargando municipios de ${name}…`);
    if (adm2) assignLevel(iso, 'adm2', adm2);
    const children = adm2 ? childrenOf(adm2, adm1.byId.get(lm.adm1)) : [];
    if (children.length >= 2 && children.some((c) => c.properties.uid === lm.adm2)) go(iso, lm.adm1, lm.adm2);
    else go(iso, lm.adm1);
  } catch (err) {
    console.error(err);
    pendingLandmark = null;
    UI.toast('No se pudo cargar la ubicación de este landmark.');
  }
}

function placeLabel(lm) {
  const adm2 = loaded.get(`${lm.country}-ADM2`)?.byId.get(lm.adm2)?.properties.name;
  const adm1 = loaded.get(`${lm.country}-ADM1`)?.byId.get(lm.adm1)?.properties.name;
  const country = countryByIso.get(lm.country)?.name;
  const place = [adm2, adm1, country].filter(Boolean).join(', ');
  return [lm.neighborhood, place].filter(Boolean).join(' · ');
}

/* ---------- Clicks en el mapa ---------- */

function onCountry(iso) {
  if (view.level === 'world') go(iso);
}

function onRegion(uid) {
  if (view.level === 'country') go(view.iso, uid);
  else if ((view.level === 'state' || view.level === 'muni') && uid !== view.stateUid && uid !== view.muniUid) {
    go(view.iso, view.stateUid, uid);
  }
}

function onLabel(uid) {
  if (view.level === 'world') go(uid);
  else onRegion(uid);
}

function onLandmark(id) {
  goToLandmark(id);
}

/* ---------- Buscador ---------- */

const TYPE_ORDER = { landmark: 0, country: 1, state: 2, muni: 3 };

function search(q) {
  const results = [];
  const score = (name) => {
    const n = normalize(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };
  const add = (item, ...names) => {
    const s = Math.min(...names.map(score).map((v) => (v < 0 ? 99 : v)));
    if (s < 99) results.push({ ...item, score: s });
  };

  for (const lm of allLandmarks()) {
    add(
      { type: 'landmark', typeLabel: 'Landmark', name: lm.name, sub: placeLabel(lm) || lm.category, id: lm.id },
      lm.name, lm.category ?? '', lm.neighborhood ?? '',
    );
  }
  for (const c of countryByIso.values()) {
    add({ type: 'country', typeLabel: 'País', name: c.name, sub: c.nameEn !== c.name ? c.nameEn : '', iso: c.iso }, c.name, c.nameEn, c.iso);
  }
  if (view.iso) {
    const countryName = countryByIso.get(view.iso)?.name;
    for (const f of view.adm1?.features ?? []) {
      add(
        { type: 'state', typeLabel: 'Estado', name: f.properties.name, sub: countryName, iso: view.iso, uid: f.properties.uid },
        f.properties.name, f.properties.altName ?? '',
      );
    }
    for (const f of view.adm2?.features ?? []) {
      add({ type: 'muni', typeLabel: 'Municipio', name: f.properties.name, sub: countryName, iso: view.iso, uid: f.properties.uid, feature: f }, f.properties.name);
    }
  }

  results.sort((a, b) => a.score - b.score || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.length - b.name.length);
  const top = results.slice(0, 30);
  for (const r of top) {
    if (r.type !== 'muni') continue;
    r.parent = parentOf(view.adm1, r.feature, view.adm2);
    if (r.parent) r.sub = `${r.parent.properties.name}, ${r.sub}`;
  }
  return top;
}

function onSearchSelect(item) {
  if (UI.isMobile() && UI.getSnap() === 'peek') UI.setSnap('half');
  if (item.type === 'landmark') goToLandmark(item.id);
  else if (item.type === 'country') go(item.iso);
  else if (item.type === 'state') go(item.iso, item.uid);
  else if (item.type === 'muni') {
    if (item.parent) go(item.iso, item.parent.properties.uid, item.uid);
    else UI.toast('No encontré a qué estado pertenece este municipio.');
  }
}

/* ---------- GeoJSON helpers ---------- */

function fc(features) {
  return { type: 'FeatureCollection', features };
}

function point(coords, properties) {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } };
}

function coloredRegions(features, counts) {
  return features.map((f, i) => ({
    type: 'Feature',
    properties: {
      uid: f.properties.uid,
      name: f.properties.name,
      color: colorFor(i),
      count: counts.get(f.properties.uid) ?? 0,
    },
    geometry: f.geometry,
  }));
}

function labelsFor(source, regions) {
  return fc(source.map((f, i) => {
    if (!labelCache.has(f)) labelCache.set(f, labelPoint(f));
    return point(labelCache.get(f), regions[i].properties);
  }));
}

function sortedItems(regions) {
  return regions
    .map((r) => ({ ...r.properties }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function landmarksFC(lms) {
  return fc(lms.map((l) => point([l.lng, l.lat], { id: l.id, name: l.name, visited: isVisited(l.id) })));
}
