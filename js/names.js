import { locate } from './boundaries.js';
import { normalize } from './utils.js';

const GENERIC = /\b(prefecture|province|provincia|state|estado|region|department|departamento|governorate|district|oblast|county|municipality|capital|metropolitan|autonomous|de|del|la|el|of|the)\b/g;

let admin1Promise = null;
let commonPromise = null;

function loadJson(url) {
  return fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
}

function key(name) {
  return normalize(name).replace(/[^a-z0-9]+/g, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
}

function sameName(a, b) {
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  return ka === kb || (kb.length >= 4 && ka.includes(kb)) || (ka.length >= 4 && kb.includes(ka));
}

/** `entry` is a common name, or { name, official } to also correct an outdated official name. */
function rename(feature, entry) {
  if (!entry) return;
  const p = feature.properties;
  const { name, official } = typeof entry === 'string' ? { name: entry } : entry;
  if (name && name !== p.name) {
    p.official ??= p.name;
    p.name = name;
  }
  if (official) p.official = official;
}

/** The official name, only when it says something different from the common one. */
export function officialName(properties) {
  const { name, official } = properties;
  if (!official || normalize(official) === normalize(name)) return '';
  return official;
}

/**
 * Makes the common name primary and keeps the official geoBoundaries name as `official`.
 * States use Spanish names from Natural Earth; any level can be overridden by hand in
 * data/common-names.json, keyed by the geoBoundaries name:
 * { "MEX": { "San Pedro Garza García": "San Pedro", "Distrito Federal": { "name": "...", "official": "..." } } }
 */
export async function applyNames(iso, level, boundaries) {
  if (boundaries.namesApplied) return;
  boundaries.namesApplied = true;
  if (level === 'ADM1') await applyAdmin1Names(iso, boundaries);

  commonPromise ??= loadJson('data/common-names.json');
  const common = (await commonPromise)[iso] ?? {};
  for (const f of boundaries.features) {
    const p = f.properties;
    rename(f, common[p.official ?? p.name] ?? common[p.name]);
  }
}

/**
 * A state is renamed only when exactly one Natural Earth state falls inside it and either
 * the subdivision counts are similar or the names match, so countries where both sources
 * use different systems (France: departments vs regions) keep their names.
 */
async function applyAdmin1Names(iso, adm1) {
  admin1Promise ??= loadJson('data/admin1-names.json');
  const entries = (await admin1Promise)[iso] ?? [];
  if (!entries.length) return;

  const hits = new Map();
  for (const entry of entries) {
    const f = locate(adm1, entry[2], entry[3]);
    if (!f) continue;
    if (!hits.has(f)) hits.set(f, []);
    hits.get(f).push(entry);
  }

  const total = adm1.features.length;
  const similarCount = Math.abs(entries.length - total) <= Math.max(2, total * 0.2);
  for (const [f, list] of hits) {
    if (list.length !== 1) continue;
    const [es, alts] = list[0];
    if (!similarCount && ![es, ...alts].some((n) => sameName(n, f.properties.name))) continue;
    rename(f, es);
  }
}
