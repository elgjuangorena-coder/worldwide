import { locate } from './boundaries.js';
import { normalize } from './utils.js';

const GENERIC = /\b(prefecture|province|provincia|state|estado|region|department|departamento|governorate|district|oblast|county|municipality|capital|metropolitan|autonomous|de|del|la|el|of|the)\b/g;

let namesPromise = null;

function loadNames() {
  namesPromise ??= fetch('data/admin1-names.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return namesPromise;
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

/**
 * Replaces geoBoundaries ADM1 names with common Spanish names from Natural Earth
 * (Tokyo -> Tokio, Nuevo Leon -> Nuevo León). A state is renamed only when exactly one
 * Natural Earth state falls inside it and either the subdivision counts are similar or the
 * names match, so countries where both sources use different systems keep their names.
 */
export async function applyAdmin1Names(iso, adm1) {
  if (adm1.namesApplied) return;
  adm1.namesApplied = true;
  const entries = (await loadNames())[iso] ?? [];
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
    const original = f.properties.name;
    if (!similarCount && ![es, ...alts].some((n) => sameName(n, original))) continue;
    if (es !== original) {
      f.properties.altName = original;
      f.properties.name = es;
    }
  }
}
