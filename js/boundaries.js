import { bboxContains, bboxIntersects, nearestVertexDistance } from './utils.js';

const API = 'https://www.geoboundaries.org/api/current';
const RELEASES = ['gbOpen', 'gbHumanitarian', 'gbAuthoritative'];
const CACHE_NAME = 'worldwide-boundaries-v1';

const memory = new Map();

/**
 * Loads ADM1 (states/provinces) or ADM2 (municipalities/districts) for a country.
 * Resolves to null when geoBoundaries has no data for that level.
 */
export function loadBoundaries(iso, level, onProgress) {
  const key = `${iso}-${level}`;
  if (!memory.has(key)) {
    const promise = fetchBoundaries(iso, level, onProgress)
      .then((fc) => (fc ? prepare(iso, level, fc) : null))
      .catch((err) => {
        memory.delete(key);
        throw err;
      });
    memory.set(key, promise);
  }
  return memory.get(key);
}

export function peekBoundaries(iso, level) {
  return memory.get(`${iso}-${level}`) ?? null;
}

async function fetchBoundaries(iso, level, onProgress) {
  const meta = await fetchMeta(iso, level);
  if (!meta) return null;
  let lastError;
  for (const url of candidateUrls(meta.simplifiedGeometryGeoJSON)) {
    try {
      const data = await cachedJson(url, onProgress);
      if (data?.type === 'FeatureCollection') return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No se pudieron descargar las fronteras');
}

async function fetchMeta(iso, level) {
  for (const release of RELEASES) {
    const url = `${API}/${release}/${iso}/${level}/`;
    try {
      const meta = await cachedJson(url);
      if (meta?.simplifiedGeometryGeoJSON) return meta;
    } catch {
      // Try the next release.
    }
  }
  return null;
}

/** github.com/.../raw/ redirects without CORS headers; the LFS media host allows CORS. */
function candidateUrls(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/(.+)$/);
  if (!m) return [url];
  const [, owner, repo, rest] = m;
  return [
    `https://media.githubusercontent.com/media/${owner}/${repo}/${rest}`,
    `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`,
  ];
}

async function openCache() {
  if (!('caches' in window)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function cachedJson(url, onProgress) {
  const cache = await openCache();
  const hit = cache && (await cache.match(url));
  if (hit) {
    onProgress?.(1);
    return hit.json();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  const text = await readText(res, onProgress);
  const data = JSON.parse(text);
  cache?.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
  return data;
}

async function readText(res, onProgress) {
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !onProgress) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let loaded = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    text += decoder.decode(value, { stream: true });
    onProgress(total ? loaded / total : null);
  }
  return text + decoder.decode();
}

function prepare(iso, level, fc) {
  const features = fc.features.filter((f) => f.geometry);
  features.forEach((f, i) => {
    const p = f.properties ?? {};
    f.properties = { uid: p.shapeID || `${iso}-${level}-${i}`, name: p.shapeName || 'Sin nombre' };
  });
  return { iso, level, ...indexFeatures(features) };
}

/** Builds the lookup structure used by locate/childrenOf. Features need properties.uid. */
export function indexFeatures(features) {
  const byId = new Map();
  const bbox = new Map();
  for (const f of features) {
    if (!byId.has(f.properties.uid)) byId.set(f.properties.uid, f);
    bbox.set(f, turf.bbox(f));
  }
  return { features, byId, bbox, repPoints: new Map(), childCache: new Map() };
}

function repPoint(b, feature) {
  if (!b.repPoints.has(feature)) b.repPoints.set(feature, turf.pointOnFeature(feature));
  return b.repPoints.get(feature);
}

/** Municipalities (ADM2) whose interior point falls inside the given state (ADM1). */
export function childrenOf(adm2, stateFeature) {
  const key = stateFeature.properties.uid;
  if (adm2.childCache.has(key)) return adm2.childCache.get(key);
  const sb = turf.bbox(stateFeature);
  const children = adm2.features.filter((f) => {
    if (!bboxIntersects(adm2.bbox.get(f), sb)) return false;
    return turf.booleanPointInPolygon(repPoint(adm2, f), stateFeature);
  });
  adm2.childCache.set(key, children);
  return children;
}

/** The ADM1 feature that contains an ADM2 feature. */
export function parentOf(adm1, feature, adm2) {
  const pt = adm2 ? repPoint(adm2, feature) : turf.pointOnFeature(feature);
  const [lng, lat] = pt.geometry.coordinates;
  return locate(adm1, lng, lat);
}

/**
 * Finds the feature containing a coordinate. Points that fall just outside the simplified
 * coastline (piers, reclaimed land) snap to the closest nearby feature.
 */
export function locate(b, lng, lat) {
  const pt = turf.point([lng, lat]);
  for (const f of b.features) {
    if (bboxContains(b.bbox.get(f), lng, lat) && turf.booleanPointInPolygon(pt, f)) return f;
  }
  let best = null;
  let bestDist = 0.05;
  for (const f of b.features) {
    if (!bboxContains(b.bbox.get(f), lng, lat, 0.05)) continue;
    const d = nearestVertexDistance(f, lng, lat);
    if (d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}
