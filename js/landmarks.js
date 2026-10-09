import { locate } from './boundaries.js';

const VISITED_KEY = 'worldwide.visited';

let landmarks = [];
let visited = new Set(readVisited());

export async function loadLandmarks(url = 'data/landmarks.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.landmarks ?? [];
  landmarks = list
    .filter((l) => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)))
    .map((l, i) => ({
      ...l,
      id: String(l.id ?? `lm-${i}`),
      lat: Number(l.lat),
      lng: Number(l.lng),
      country: l.country ?? null,
      adm1: null,
      adm2: null,
    }));
  return landmarks;
}

export function allLandmarks() {
  return landmarks;
}

export function landmarkById(id) {
  return landmarks.find((l) => l.id === id) ?? null;
}

/** Fills landmark.country (ISO3) using the world countries index. */
export function assignCountries(countries) {
  for (const l of landmarks) {
    if (l.country) continue;
    l.country = locate(countries, l.lng, l.lat)?.properties.uid ?? null;
  }
}

/** Fills landmark.adm1 or landmark.adm2 (geoBoundaries shapeID) for one country. */
export function assignLevel(iso, key, boundaries) {
  for (const l of landmarks) {
    if (l.country !== iso || l[key] !== null) continue;
    l[key] = locate(boundaries, l.lng, l.lat)?.properties.uid ?? '';
  }
}

export function countBy(list, key) {
  const counts = new Map();
  for (const l of list) {
    if (!l[key]) continue;
    counts.set(l[key], (counts.get(l[key]) ?? 0) + 1);
  }
  return counts;
}

export function googleMapsUrl(l) {
  return l.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
}

export function isVisited(id) {
  return visited.has(id);
}

export function toggleVisited(id) {
  if (visited.has(id)) visited.delete(id);
  else visited.add(id);
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...visited]));
  } catch {
    // Private mode or storage full: keep the in-memory state.
  }
  return visited.has(id);
}

function readVisited() {
  try {
    return JSON.parse(localStorage.getItem(VISITED_KEY) ?? '[]');
  } catch {
    return [];
  }
}
