export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Golden-angle hues keep consecutive (usually neighboring) regions visually distinct. */
export function colorFor(index) {
  const hue = Math.round((index * 137.508 + 25) % 360);
  return `hsl(${hue}, 85%, 58%)`;
}

export function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function bboxContains(b, lng, lat, pad = 0) {
  return lng >= b[0] - pad && lng <= b[2] + pad && lat >= b[1] - pad && lat <= b[3] + pad;
}

function polygonParts(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function bboxGapKm(a, b) {
  const dx = Math.max(0, b[0] - a[2], a[0] - b[2]);
  const dy = Math.max(0, b[1] - a[3], a[1] - b[3]);
  const k = Math.cos((((a[1] + a[3]) / 2) * Math.PI) / 180);
  return Math.hypot(dx * k, dy) * 111;
}

/**
 * Bounding box of the largest part plus the big or nearby parts, so small far-away
 * islands (Tokyo's Izu islands, French Guiana) don't zoom the camera out to the ocean.
 */
export function mainBbox(feature) {
  const parts = polygonParts(feature)
    .map((coords) => {
      const poly = turf.polygon(coords);
      return { poly, area: turf.area(poly), bbox: turf.bbox(poly) };
    })
    .sort((a, b) => b.area - a.area);
  if (!parts.length) return turf.bbox(feature);
  const [main] = parts;
  const b = main.bbox;
  const diagKm = turf.distance([b[0], b[1]], [b[2], b[3]]);
  const kept = parts.filter((p) => {
    if (p === main) return true;
    const ratio = p.area / main.area;
    const gap = bboxGapKm(b, p.bbox);
    return (ratio >= 0.02 && gap <= diagKm * 0.5) || (ratio >= 0.1 && gap <= diagKm * 2);
  });
  return turf.bbox(turf.featureCollection(kept.map((p) => p.poly)));
}

/** A point guaranteed to be inside the largest part of the feature, used for labels. */
export function labelPoint(feature) {
  const parts = polygonParts(feature);
  if (!parts.length) return turf.pointOnFeature(feature).geometry.coordinates;
  let best = parts[0];
  let bestArea = -1;
  for (const coords of parts) {
    const area = turf.area(turf.polygon(coords));
    if (area > bestArea) { best = coords; bestArea = area; }
  }
  const poly = turf.polygon(best);
  const center = turf.centerOfMass(poly);
  if (turf.booleanPointInPolygon(center, poly)) return center.geometry.coordinates;
  return turf.pointOnFeature(poly).geometry.coordinates;
}

/** Approximate distance (in degrees, longitude scaled by latitude) to the closest vertex. */
export function nearestVertexDistance(feature, lng, lat) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  turf.coordEach(feature, ([x, y]) => {
    const dx = (x - lng) * k;
    const dy = y - lat;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  });
  return Math.sqrt(best);
}
