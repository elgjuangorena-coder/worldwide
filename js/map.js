const STYLES = {
  light: 'data/styles/liberty.json',
  dark: 'data/styles/dark.json',
};
const STYLE_KEY = 'worldwide.mapStyle';
const SECONDS_PER_REVOLUTION = 100;
const EMPTY = { type: 'FeatureCollection', features: [] };
const HOVER = ['boolean', ['feature-state', 'hover'], false];
const SELECTED = ['boolean', ['feature-state', 'selected'], false];
const COUNT = ['coalesce', ['get', 'count'], 0];
const REGION_OPACITY = ['case', SELECTED, 0.42, HOVER, 0.34, 0.16];
const REGION_OPACITY_MUNI = ['case', SELECTED, 0.12, HOVER, 0.24, 0.1];

let map;
let styleName = localStorage.getItem(STYLE_KEY) === 'dark' ? 'dark' : 'light';
let spinning = true;
let mode = 'world';
let popup = null;
let hovered = null;
let selectedUid = null;
let handlers = {};
let getPadding = () => 40;

const data = {
  countries: EMPTY,
  regions: EMPTY,
  labels: EMPTY,
  focus: EMPTY,
  landmarks: EMPTY,
};

export function initMap(options) {
  handlers = options.handlers ?? {};
  getPadding = options.getPadding ?? getPadding;
  const narrow = window.innerWidth < 768;

  map = new maplibregl.Map({
    container: options.container,
    style: STYLES[styleName],
    center: [-40, 22],
    zoom: worldZoom(narrow),
    attributionControl: { compact: true },
    dragRotate: true,
    maxPitch: 60,
  });

  map.on('style.load', onStyleLoad);
  map.on('moveend', spin);
  for (const evt of ['mousedown', 'touchstart', 'wheel', 'dragstart']) {
    map.on(evt, () => { spinning = false; });
  }
  map.on('click', onClick);
  map.on('mousemove', onHover);
  map.on('mouseout', clearHover);

  return new Promise((resolve) => map.once('load', resolve));
}

function onStyleLoad() {
  map.setProjection({ type: 'globe' });
  try {
    map.setSky({
      'sky-color': '#0b1026',
      'horizon-color': '#38e1ff',
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    });
  } catch {
    // Older renderers without sky support still work fine.
  }
  addLayers();
  applyData();
  applyMode();
  spin();
}

function addLayers() {
  map.addSource('countries', { type: 'geojson', data: EMPTY, promoteId: 'uid' });
  map.addSource('regions', { type: 'geojson', data: EMPTY, promoteId: 'uid' });
  map.addSource('focus', { type: 'geojson', data: EMPTY });
  map.addSource('labels', { type: 'geojson', data: EMPTY });
  map.addSource('landmarks', { type: 'geojson', data: EMPTY, promoteId: 'id' });

  map.addLayer({
    id: 'countries-fill',
    type: 'fill',
    source: 'countries',
    paint: {
      'fill-color': ['case', ['>', COUNT, 0], '#ffcc33', '#38e1ff'],
      'fill-opacity': ['case', HOVER, 0.4, ['>', COUNT, 0], 0.3, 0.06],
    },
  });
  map.addLayer({
    id: 'countries-line',
    type: 'line',
    source: 'countries',
    paint: {
      'line-color': ['case', ['>', COUNT, 0], '#ffcc33', 'rgba(255,255,255,0.55)'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.5],
    },
  });

  map.addLayer({
    id: 'regions-fill',
    type: 'fill',
    source: 'regions',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': REGION_OPACITY,
    },
  });
  map.addLayer({
    id: 'regions-casing',
    type: 'line',
    source: 'regions',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': 'rgba(255,255,255,0.75)', 'line-width': ['case', SELECTED, 7, 4] },
  });
  map.addLayer({
    id: 'regions-line',
    type: 'line',
    source: 'regions',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', SELECTED, 4, 2] },
  });
  map.addLayer({
    id: 'focus-line',
    type: 'line',
    source: 'focus',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#0b1026', 'line-width': 3, 'line-dasharray': [2, 1.5] },
  });

  map.addLayer({
    id: 'labels-name',
    type: 'symbol',
    source: 'labels',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 14],
      'text-offset': ['case', ['>', COUNT, 0], ['literal', [0, 1.5]], ['literal', [0, 0]]],
      'text-anchor': 'top',
      'text-max-width': 8,
      'symbol-sort-key': ['-', 0, COUNT],
    },
    paint: { 'text-color': '#101530', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  map.addLayer({
    id: 'labels-count-circle',
    type: 'circle',
    source: 'labels',
    filter: ['>', COUNT, 0],
    paint: {
      'circle-radius': 13,
      'circle-color': '#ffcc33',
      'circle-stroke-color': '#1b1400',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'labels-count-text',
    type: 'symbol',
    source: 'labels',
    filter: ['>', COUNT, 0],
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#1b1400' },
  });

  map.addLayer({
    id: 'landmarks-circle',
    type: 'circle',
    source: 'landmarks',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 10, 8, 15, 11],
      'circle-color': ['case', ['get', 'visited'], '#3ddc84', '#ff5c7a'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 10, 2.5],
    },
  });
  map.addLayer({
    id: 'landmarks-label',
    type: 'symbol',
    source: 'landmarks',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-max-width': 9,
    },
    paint: { 'text-color': '#101530', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
}

function applyData() {
  for (const key of Object.keys(data)) map.getSource(key)?.setData(data[key]);
  if (selectedUid) map.setFeatureState({ source: 'regions', id: selectedUid }, { selected: true });
}

function applyMode() {
  if (!map.getLayer('countries-fill')) return;
  const world = mode === 'world';
  map.setLayoutProperty('countries-fill', 'visibility', world ? 'visible' : 'none');
  map.setPaintProperty('countries-line', 'line-opacity', world ? 1 : 0.35);
  map.setLayoutProperty('landmarks-label', 'visibility', mode === 'muni' ? 'visible' : 'none');
  map.setPaintProperty('regions-fill', 'fill-opacity', mode === 'muni' ? REGION_OPACITY_MUNI : REGION_OPACITY);
  map.setPaintProperty('labels-name', 'text-opacity', world ? 0 : 1);
}

export function setData(partial) {
  Object.assign(data, partial);
  if (!map.getSource('countries')) return;
  hovered = null;
  for (const key of Object.keys(partial)) map.getSource(key).setData(data[key]);
}

export function setMode(next) {
  mode = next;
  applyMode();
}

export function setSelectedRegion(uid) {
  if (selectedUid && map.getSource('regions')) {
    map.removeFeatureState({ source: 'regions', id: selectedUid }, 'selected');
  }
  selectedUid = uid;
  if (uid && map.getSource('regions')) {
    map.setFeatureState({ source: 'regions', id: uid }, { selected: true });
  }
}

export function fitBbox(bbox, maxZoom = 14) {
  spinning = false;
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: getPadding(),
    maxZoom,
    duration: 1400,
    essential: true,
  });
}

export function flyTo(lngLat, zoom) {
  spinning = false;
  map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), zoom), padding: getPadding(), duration: 1200, essential: true });
}

export function flyToWorld() {
  spinning = true;
  map.flyTo({
    center: [map.getCenter().lng, 22],
    zoom: worldZoom(window.innerWidth < 768),
    pitch: 0,
    bearing: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 1600,
    essential: true,
  });
}

function worldZoom(narrow) {
  return narrow ? 1 : 2.2;
}

function spin() {
  if (!spinning || mode !== 'world' || map.getZoom() > 4) return;
  const center = map.getCenter();
  center.lng -= 360 / SECONDS_PER_REVOLUTION;
  map.easeTo({ center, duration: 1000, easing: (n) => n });
}

export function openPopup(lngLat, element) {
  popup?.remove();
  popup = new maplibregl.Popup({ offset: 14, maxWidth: '320px', focusAfterOpen: false })
    .setLngLat(lngLat)
    .setDOMContent(element)
    .addTo(map);
  return popup;
}

export function closePopup() {
  popup?.remove();
  popup = null;
}

export function toggleStyle() {
  styleName = styleName === 'light' ? 'dark' : 'light';
  localStorage.setItem(STYLE_KEY, styleName);
  map.setStyle(STYLES[styleName]);
  hovered = null;
}

export function resize() {
  map?.resize();
}

function queryAt(point, layers) {
  const pad = 10;
  const existing = layers.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!existing.length) return [];
  return map.queryRenderedFeatures(
    [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]],
    { layers: existing },
  );
}

function onClick(e) {
  const lm = queryAt(e.point, ['landmarks-circle'])[0];
  if (lm) return handlers.onLandmark?.(lm.properties.id);

  const count = queryAt(e.point, ['labels-count-circle'])[0];
  if (count) return handlers.onLabel?.(count.properties.uid);

  const exact = map.queryRenderedFeatures(e.point, {
    layers: ['regions-fill', 'countries-fill']
      .filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none'),
  });
  const region = exact.find((f) => f.layer.id === 'regions-fill');
  if (region) return handlers.onRegion?.(region.properties.uid);
  const country = exact.find((f) => f.layer.id === 'countries-fill');
  if (country) return handlers.onCountry?.(country.properties.uid);

  handlers.onBackground?.();
}

function onHover(e) {
  const layers = ['landmarks-circle', 'labels-count-circle', 'regions-fill', 'countries-fill']
    .filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  const features = map.queryRenderedFeatures(e.point, { layers });
  map.getCanvas().style.cursor = features.length ? 'pointer' : '';
  const target = features.find((f) => f.layer.id === 'regions-fill' || f.layer.id === 'countries-fill');
  const next = target ? { source: target.source, id: target.id } : null;
  if (hovered && (!next || hovered.source !== next.source || hovered.id !== next.id)) clearHover();
  if (next && next.id !== undefined && !hovered) {
    hovered = next;
    map.setFeatureState(hovered, { hover: true });
  }
}

function clearHover() {
  if (hovered && map.getSource(hovered.source)) map.setFeatureState(hovered, { hover: false });
  hovered = null;
}
