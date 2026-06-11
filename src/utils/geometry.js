// Geometry calculation helpers for Track Simulator
// Based on the Track Design Creator sheet logic

// ===== Rail Gauge Type Definitions =====
// toleranceMM: acceptable gauge deviation (± mm) per rail standard
// maxCantMM: design max cant in mm for this gauge/standard
// wideningMM: permitted gauge widening on curves (extra above tolerance)
export const GAUGE_TYPES = [
  { id: 'standard',      name: 'Standard Gauge',   gauge: 1.435, unit: 'm', toleranceMM: 3,  maxCantMM: 150, wideningMM: 10, desc: '1435 mm — most common worldwide' },
  { id: 'broad_indian',  name: 'Broad (Indian)',    gauge: 1.676, unit: 'm', toleranceMM: 4,  maxCantMM: 165, wideningMM: 10, desc: '1676 mm — India, Pakistan, Brazil' },
  { id: 'broad_russian', name: 'Broad (Russian)',   gauge: 1.520, unit: 'm', toleranceMM: 4,  maxCantMM: 150, wideningMM: 10, desc: '1520 mm — Russia, CIS countries' },
  { id: 'broad_iberian', name: 'Broad (Iberian)',   gauge: 1.668, unit: 'm', toleranceMM: 4,  maxCantMM: 160, wideningMM: 10, desc: '1668 mm — Spain, Portugal' },
  { id: 'broad_irish',   name: 'Broad (Irish)',     gauge: 1.600, unit: 'm', toleranceMM: 3,  maxCantMM: 150, wideningMM: 10, desc: '1600 mm — Ireland' },
  { id: 'cape',          name: 'Cape Gauge',        gauge: 1.067, unit: 'm', toleranceMM: 3,  maxCantMM: 105, wideningMM: 8,  desc: '1067 mm — Japan, Southern Africa' },
  { id: 'meter',         name: 'Meter Gauge',       gauge: 1.000, unit: 'm', toleranceMM: 3,  maxCantMM: 100, wideningMM: 8,  desc: '1000 mm — SE Asia, Switzerland' },
  { id: 'narrow_762',    name: 'Narrow (762mm)',    gauge: 0.762, unit: 'm', toleranceMM: 3,  maxCantMM: 75,  wideningMM: 6,  desc: '762 mm — industrial/mining' },
  { id: 'tramway',       name: 'Tramway (4.85m)',   gauge: 4.850, unit: 'm', toleranceMM: 5,  maxCantMM: 30,  wideningMM: 15, desc: '4850 mm — special tramway/broad' },
];

/**
 * Look up a gauge type by ID.
 */
export function getGaugeType(gaugeId) {
  return GAUGE_TYPES.find(g => g.id === gaugeId) || GAUGE_TYPES[0];
}

/**
 * Compute the Euclidean distance between two 2D points.
 */
function dist2D(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Take raw left/right rail coordinates and compute all derived
 * geometry: centre line, chainage, length, gauge, cant, gauge diff, cant diff.
 *
 * Input point format:
 *   { leftEasting, leftNorthing, leftHeight, rightEasting, rightNorthing, rightHeight, type?, radius? }
 *
 * Output format:
 *   Full point with centre line, chainage, length, gauge, cant, gaugeDiff, cantDiff
 *
 * @param {Array} points - raw point data
 * @param {number} designGauge - the design gauge value in metres to compute gaugeDiff against
 * @param {number} toleranceMM - acceptable deviation in mm; drives gaugeStatus classification
 * @param {number} maxCantMM - design max cant in mm; drives cantStatus classification
 */
export function computeTrackGeometry(points, designGauge = 4.85, toleranceMM = 5, maxCantMM = 30) {
  if (!points || points.length === 0) return [];

  const results = [];

  for (let i = 0; i < points.length; i++) {
    const raw = points[i];

    // Centre line = average of left and right coordinates
    const easting = (raw.leftEasting + raw.rightEasting) / 2;
    const northing = (raw.leftNorthing + raw.rightNorthing) / 2;
    const height = (raw.leftHeight + raw.rightHeight) / 2;

    // Gauge = 2D plan distance between left and right rails (in metres)
    const gauge = dist2D(
      raw.leftEasting, raw.leftNorthing,
      raw.rightEasting, raw.rightNorthing
    );

    // Cant = height difference (Left H - Right H) in metres
    const cant = raw.leftHeight - raw.rightHeight;

    // Length = distance from previous centre point
    let length = 0;
    if (i > 0) {
      const prev = results[i - 1];
      length = dist2D(easting, northing, prev.easting, prev.northing);
    }

    // Chainage = cumulative distance
    const chainage = i > 0 ? results[i - 1].chainage + length : 0;

    // Gauge diff from design gauge
    const gaugeDiff = gauge - designGauge;

    // Gauge status: ok / warn / fail based on tolerance bands
    const absDiffMM = Math.abs(gaugeDiff * 1000);
    const gaugeStatus = absDiffMM <= toleranceMM ? 'ok'
      : absDiffMM <= toleranceMM * 2 ? 'warn'
      : 'fail';

    // Cant diff from previous
    let cantDiff = 0;
    if (i > 0) {
      cantDiff = cant - results[i - 1].cant;
    }

    // Cant status vs design max
    const absCantMM = Math.abs(cant * 1000);
    const cantStatus = absCantMM <= maxCantMM ? 'ok'
      : absCantMM <= maxCantMM * 1.2 ? 'warn'
      : 'fail';

    // Straight/Arc classification if not provided
    const type = raw.type || (raw.radius && raw.radius > 0 ? 'arc' : 'straight');

    results.push({
      pointNumber: raw.pointNumber || String(i + 1),
      leftEasting: raw.leftEasting,
      leftNorthing: raw.leftNorthing,
      leftHeight: raw.leftHeight,
      rightEasting: raw.rightEasting,
      rightNorthing: raw.rightNorthing,
      rightHeight: raw.rightHeight,
      easting,
      northing,
      height,
      chainage: parseFloat(chainage.toFixed(6)),
      length: parseFloat(length.toFixed(6)),
      gauge: parseFloat(gauge.toFixed(6)),
      cant: parseFloat(cant.toFixed(6)),
      gaugeDiff: parseFloat(gaugeDiff.toFixed(6)),
      cantDiff: parseFloat(cantDiff.toFixed(6)),
      gaugeStatus,
      cantStatus,
      type,
      radius: raw.radius || 0,
    });
  }

  return results;
}

/**
 * Compute summary statistics from processed track data.
 */
export function computeStats(trackData, designGauge = 4.85, toleranceMM = 5) {
  if (trackData.length < 2) {
    return {
      totalLength: 0,
      avgGauge: 0,
      maxCant: 0, minCant: 0,
      minGauge: 0,
      maxGauge: 0,
      minRadius: Infinity,
      maxSpeed: 0,
      elevationDelta: 0,
      designGauge,
      toleranceMM,
      okCount: 0, warnCount: 0, failCount: 0,
    };
  }

  const totalLength = trackData[trackData.length - 1].chainage;
  const avgGauge = trackData.reduce((s, p) => s + p.gauge, 0) / trackData.length;
  const maxCant = Math.max(...trackData.map(p => p.cant));
  const minCant = Math.min(...trackData.map(p => p.cant));
  const minGauge = Math.min(...trackData.map(p => p.gauge));
  const maxGauge = Math.max(...trackData.map(p => p.gauge));
  const minRadius = Math.min(
    ...trackData.map(p => (p.radius && p.radius > 0 ? p.radius : Infinity))
  );
  const minH = Math.min(...trackData.map(p => p.height));
  const maxH = Math.max(...trackData.map(p => p.height));

  // Estimate max speed from radius and cant
  let maxSpeed = 0;
  trackData.forEach(p => {
    if (p.radius > 0 && p.radius < 99999 && Math.abs(p.cant) > 0.0001) {
      const cantMM = p.cant * 1000;
      const speed = Math.sqrt(127 * p.radius * (cantMM + 50) / 1000) * 3.6;
      maxSpeed = Math.max(maxSpeed, speed);
    }
  });

  const okCount   = trackData.filter(p => p.gaugeStatus === 'ok').length;
  const warnCount = trackData.filter(p => p.gaugeStatus === 'warn').length;
  const failCount = trackData.filter(p => p.gaugeStatus === 'fail').length;

  return {
    totalLength,
    avgGauge,
    maxCant,
    minCant,
    minGauge,
    maxGauge,
    minRadius: minRadius === Infinity ? 0 : minRadius,
    maxSpeed,
    elevationDelta: maxH - minH,
    designGauge,
    toleranceMM,
    okCount,
    warnCount,
    failCount,
  };
}

/**
 * Compute the bounding box of track data (for view fitting).
 */
export function getBounds(trackData) {
  if (trackData.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1, width: 1, height: 1 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  trackData.forEach(p => {
    // Check all three lines for bounds
    [p.leftEasting, p.easting, p.rightEasting].forEach(v => {
      minX = Math.min(minX, v);
      maxX = Math.max(maxX, v);
    });
    [p.leftNorthing, p.northing, p.rightNorthing].forEach(v => {
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    });
  });
  const pad = Math.max((maxX - minX) * 0.08, 5);
  return {
    minX: minX - pad, maxX: maxX + pad,
    minY: minY - pad, maxY: maxY + pad,
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}
