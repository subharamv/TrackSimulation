import { useState, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportCSV } from '../utils/csvParser';
import { getBounds } from '../utils/geometry';

// ── Column definitions ───────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: 'pointNumber',  label: 'Pt #',     group: 'id'    },
  { key: 'chainage',     label: 'Chainage', group: 'id'    },
  { key: 'type',         label: 'Type',     group: 'id'    },
  { key: 'leftEasting',  label: 'L East',   group: 'left'  },
  { key: 'leftNorthing', label: 'L North',  group: 'left'  },
  { key: 'leftHeight',   label: 'L Hgt',    group: 'left'  },
  { key: 'rightEasting', label: 'R East',   group: 'right' },
  { key: 'rightNorthing',label: 'R North',  group: 'right' },
  { key: 'rightHeight',  label: 'R Hgt',    group: 'right' },
  { key: 'easting',      label: 'CL East',  group: 'cl'    },
  { key: 'northing',     label: 'CL North', group: 'cl'    },
  { key: 'height',       label: 'CL Hgt',   group: 'cl'    },
  { key: 'length',       label: 'Length',   group: 'id'    },
  { key: 'gauge',        label: 'Gauge',    group: 'gauge' },
  { key: 'cant',         label: 'Cant',     group: 'cant'  },
  { key: 'gaugeDiff',    label: 'Gauge Δ',  group: 'gauge' },
  { key: 'cantDiff',     label: 'Cant Δ',   group: 'cant'  },
  { key: 'radius',       label: 'Radius',   group: 'id'    },
];

const GROUP_COLORS = {
  id:    { r: 45,  g: 55,  b: 72  },
  left:  { r: 30,  g: 80,  b: 180 },
  right: { r: 180, g: 40,  b: 40  },
  cl:    { r: 10,  g: 130, b: 90  },
  gauge: { r: 160, g: 80,  b: 0   },
  cant:  { r: 100, g: 50,  b: 180 },
};

function formatValue(key, val) {
  if (val === undefined || val === null) return '-';
  if (typeof val === 'number') {
    if (['chainage','length'].includes(key))              return val.toFixed(3);
    if (['easting','northing','leftEasting','leftNorthing','rightEasting','rightNorthing'].includes(key)) return val.toFixed(4);
    if (['height','leftHeight','rightHeight'].includes(key)) return val.toFixed(4);
    if (['gauge','gaugeDiff'].includes(key))              return val.toFixed(6);
    if (['cant','cantDiff'].includes(key))                return (val * 1000).toFixed(4); // mm
    if (key === 'radius') return (val === 0 || !val) ? '—' : val.toFixed(1);
    return val.toString();
  }
  return String(val).toUpperCase();
}

function getColClass(key) {
  if (key.startsWith('left'))  return 'col-left';
  if (key.startsWith('right')) return 'col-right';
  if (['easting','northing','height'].includes(key)) return 'col-cl';
  if (['gauge','gaugeDiff'].includes(key))  return 'col-gauge';
  if (['cant','cantDiff'].includes(key))    return 'col-cant';
  return '';
}

// Build deviation thresholds from the active gauge type's rail standard values.
//   gaugeDiff: tiers at 50%/100%/200% of toleranceMM
//   cantDiff:  tiers at 10%/25%/50% of maxCantMM
function buildThresholds(gaugeType) {
  const tolM  = (gaugeType?.toleranceMM ?? 3)   / 1000;
  const cantM = (gaugeType?.maxCantMM   ?? 150) / 1000;
  return {
    gaugeDiff: [
      { limit: tolM * 2,   bg: 'rgba(239,68,68,0.18)',  text: '#b91c1c' },
      { limit: tolM,       bg: 'rgba(249,115,22,0.18)', text: '#c2410c' },
      { limit: tolM * 0.5, bg: 'rgba(234,179,8,0.18)',  text: '#92400e' },
    ],
    cantDiff: [
      { limit: cantM * 0.5,  bg: 'rgba(239,68,68,0.18)',  text: '#b91c1c' },
      { limit: cantM * 0.25, bg: 'rgba(249,115,22,0.18)', text: '#c2410c' },
      { limit: cantM * 0.10, bg: 'rgba(234,179,8,0.18)',  text: '#92400e' },
    ],
  };
}

function getDeviationStyle(key, val, thresholds) {
  const tiers = thresholds?.[key];
  if (!tiers || typeof val !== 'number') return null;
  const abs = Math.abs(val);
  for (const { limit, bg, text } of tiers) {
    if (abs >= limit) return { background: bg, color: text, fontWeight: 600 };
  }
  return null;
}

// ── Compute stats ────────────────────────────────────────────────────────────
function computePdfStats(trackData) {
  if (!trackData || trackData.length < 2) return null;
  const first = trackData[0], last = trackData[trackData.length - 1];
  const gauges  = trackData.map(p => p.gauge);
  const cants   = trackData.map(p => p.cant * 1000);
  const heights = trackData.map(p => p.height);
  const avgGauge = gauges.reduce((a, b) => a + b, 0) / gauges.length;
  const avgCant  = cants.reduce((a, b) => a + b, 0)  / cants.length;

  // Point with worst gauge deviation
  let maxDevPt = trackData[0], maxDevVal = 0;
  trackData.forEach(p => {
    const d = Math.abs(p.gaugeDiff ?? (p.gauge - avgGauge));
    if (d > maxDevVal) { maxDevVal = d; maxDevPt = p; }
  });

  // Overall bearing from start to end (degrees, 0=N clockwise)
  const dE = last.easting - first.easting;
  const dN = last.northing - first.northing;
  const bearing = ((Math.atan2(dE, dN) * 180 / Math.PI) + 360) % 360;

  return {
    chainageStart: first.chainage,
    chainageEnd:   last.chainage,
    totalLength:   last.chainage - first.chainage,
    ptCount:       trackData.length,
    minGauge:      Math.min(...gauges),
    maxGauge:      Math.max(...gauges),
    avgGauge,
    minCant:       Math.min(...cants),
    maxCant:       Math.max(...cants),
    avgCant,
    minH:          Math.min(...heights),
    maxH:          Math.max(...heights),
    elevDelta:     Math.max(...heights) - Math.min(...heights),
    maxGaugeDevPt: maxDevPt,
    maxGaugeDevVal: maxDevVal,
    bearing,
  };
}

// ── High-DPI 2-D track renderer ──────────────────────────────────────────────
function renderTrackHiDPI(trackData, pxW, pxH) {
  const canvas = document.createElement('canvas');
  canvas.width  = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  // Background with subtle gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, pxH);
  bgGrad.addColorStop(0, '#16181a');
  bgGrad.addColorStop(1, '#1c1e21');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, pxW, pxH);

  if (!trackData || trackData.length < 2) return canvas;

  const bounds = getBounds(trackData);
  const padL = pxW * 0.09;  // wider left for coord labels
  const padR = pxW * 0.05;
  const padT = pxH * 0.09;
  const padB = pxH * 0.12;
  const drawW = pxW - padL - padR;
  const drawH = pxH - padT - padB;
  const scaleX = drawW / (bounds.width  || 1);
  const scaleY = drawH / (bounds.height || 1);
  const scale  = Math.min(scaleX, scaleY);

  const ox = padL + drawW / 2 - bounds.centerX * scale;
  const oy = padT + drawH / 2 + bounds.centerY * scale;
  const toS = (e, n) => ({ x: e * scale + ox, y: -n * scale + oy });

  const lw1 = Math.max(1, pxW * 0.00022); // base fine line

  // ── Grid ──────────────────────────────────────────────────────────
  const GRID_DIVS = 20;
  for (let i = 0; i <= GRID_DIVS; i++) {
    const isMajor = i % 5 === 0;
    const gx = padL + (drawW / GRID_DIVS) * i;
    const gy = padT + (drawH / GRID_DIVS) * i;
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
    ctx.lineWidth = isMajor ? lw1 * 2.5 : lw1;
    ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + drawH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + drawW, gy); ctx.stroke();
  }

  // Plot area border
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = lw1 * 2;
  ctx.strokeRect(padL, padT, drawW, drawH);

  // ── Axis coordinate labels ─────────────────────────────────────────
  const axFontSz = Math.round(pxH * 0.016);
  ctx.font = `${axFontSz}px sans-serif`;
  ctx.fillStyle = 'rgba(170,185,210,0.55)';
  ctx.textAlign = 'right';
  for (let i = 0; i <= GRID_DIVS; i += 5) {
    const gy = padT + (drawH / GRID_DIVS) * i;
    const nVal = bounds.maxY - (bounds.height / GRID_DIVS) * i;
    ctx.fillText(nVal.toFixed(0), padL - pxW * 0.006, gy + axFontSz * 0.38);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= GRID_DIVS; i += 5) {
    const gx = padL + (drawW / GRID_DIVS) * i;
    const eVal = bounds.minX + (bounds.width / GRID_DIVS) * i;
    ctx.fillText(eVal.toFixed(0), gx, padT + drawH + pxH * 0.033);
  }
  // Axis titles
  const titleSz = Math.round(pxH * 0.019);
  ctx.fillStyle = 'rgba(200,215,235,0.6)';
  ctx.font = `${titleSz}px sans-serif`;
  ctx.fillText('Easting (m)', padL + drawW / 2, padT + drawH + pxH * 0.072);
  ctx.save();
  ctx.translate(padL - pxW * 0.065, padT + drawH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Northing (m)', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';

  // ── Rail lines ────────────────────────────────────────────────────
  const railLW = Math.max(1, pxW * 0.00055);
  const dashSz  = pxW * 0.006;
  const dashGap  = pxW * 0.003;

  const rails = [
    { ek: 'leftEasting',  nk: 'leftNorthing',  color: '#4a90d9', glow: 'rgba(74,144,217,0.16)',  label: 'Left Rail',   lw: railLW * 1.7, dash: [] },
    { ek: 'easting',      nk: 'northing',       color: '#22c47a', glow: 'rgba(34,196,122,0.13)',  label: 'Centre Line', lw: railLW,       dash: [dashSz, dashGap] },
    { ek: 'rightEasting', nk: 'rightNorthing',  color: '#e05555', glow: 'rgba(224,85,85,0.16)',   label: 'Right Rail',  lw: railLW * 1.7, dash: [] },
  ];

  rails.forEach(({ ek, nk, color, glow, lw, dash }) => {
    ctx.beginPath();
    ctx.strokeStyle = glow;
    ctx.lineWidth = lw * 6;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    trackData.forEach((p, i) => {
      const { x, y } = toS(p[ek], p[nk]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    trackData.forEach((p, i) => {
      const { x, y } = toS(p[ek], p[nk]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // ── Direction arrows along centre line ────────────────────────────
  const arrowEvery = Math.max(5, Math.floor(trackData.length / 8));
  const arrowSz = pxW * 0.0055;
  ctx.fillStyle = 'rgba(34,196,122,0.55)';
  for (let i = arrowEvery; i < trackData.length - 1; i += arrowEvery) {
    const prev = toS(trackData[i - 1].easting, trackData[i - 1].northing);
    const curr = toS(trackData[i].easting, trackData[i].northing);
    const ang = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    ctx.save();
    ctx.translate(curr.x, curr.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(arrowSz, 0);
    ctx.lineTo(-arrowSz * 0.65, -arrowSz * 0.42);
    ctx.lineTo(-arrowSz * 0.65,  arrowSz * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Point markers ─────────────────────────────────────────────────
  // Target ≤12 labeled points regardless of dataset size; every point gets a dot
  const MAX_LABELS = 12;
  const labelEvery = Math.max(5, Math.round(trackData.length / MAX_LABELS));

  const dotR_major = Math.max(2, pxW * 0.0014);
  const dotR_minor = Math.max(1, pxW * 0.0006);

  // Compact font — readable at 600 DPI but not overpowering
  const labelFontSz = Math.round(pxW * 0.007);
  const chainFontSz = Math.round(pxW * 0.0055);

  trackData.forEach((p, i) => {
    const { x, y } = toS(p.easting, p.northing);
    const isLabel = i % labelEvery === 0 || i === 0 || i === trackData.length - 1;
    const isTick  = !isLabel; // every non-labeled point still gets a small dot

    const r = isLabel ? dotR_major : dotR_minor;

    if (isLabel) {
      // Subtle halo only — no crosshair to keep it clean
      ctx.beginPath();
      ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244,129,32,0.12)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isLabel ? '#f48120' : 'rgba(244,129,32,0.45)';
    ctx.fill();

    if (isLabel) {
      // Alternate label side every other label to avoid crowding on diagonal tracks
      const side = (i / labelEvery) % 2 === 0 ? 1 : -1;
      const perpX = side * r * 5;
      const perpY = side * -r * 4;
      // Leader line from dot to label
      ctx.strokeStyle = 'rgba(244,129,32,0.3)';
      ctx.lineWidth = Math.max(0.5, lw1);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + perpX * 0.85, y + perpY * 0.85);
      ctx.stroke();
      // Point number
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${labelFontSz}px sans-serif`;
      ctx.fillText(`P${p.pointNumber}`, x + perpX, y + perpY);
      // Chainage on next line
      ctx.fillStyle = 'rgba(175,195,220,0.65)';
      ctx.font = `${chainFontSz}px sans-serif`;
      ctx.fillText(`${p.chainage.toFixed(1)}m`, x + perpX, y + perpY + labelFontSz * 1.3);
    }
  });

  // ── Legend (bottom-left inside plot) ─────────────────────────────
  const legPad   = pxW * 0.007;
  const legItemH = pxH * 0.033;
  const legLineW = pxW * 0.028;
  const legTxtSz = Math.round(pxH * 0.021);
  const legItems = [
    { color: '#4a90d9', label: 'Left Rail',   dash: [] },
    { color: '#22c47a', label: 'Centre Line', dash: [dashSz, dashGap] },
    { color: '#e05555', label: 'Right Rail',  dash: [] },
  ];
  const legW = legLineW + pxW * 0.095 + legPad * 2;
  const legH = legItemH * legItems.length + legPad * 1.6;
  const legX = padL + pxW * 0.008;
  const legY = padT + drawH - legH - pxH * 0.008;

  ctx.fillStyle = 'rgba(8,10,14,0.75)';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = lw1;
  ctx.beginPath();
  ctx.roundRect(legX, legY, legW, legH, pxW * 0.003);
  ctx.fill();
  ctx.stroke();

  legItems.forEach(({ color, label, dash }, i) => {
    const ly = legY + legPad + (i + 0.5) * legItemH;
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = railLW * 1.7;
    ctx.beginPath();
    ctx.moveTo(legX + legPad, ly);
    ctx.lineTo(legX + legPad + legLineW, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(225,235,248,0.88)';
    ctx.font = `${legTxtSz}px sans-serif`;
    ctx.fillText(label, legX + legPad + legLineW + pxW * 0.005, ly + legTxtSz * 0.38);
  });

  // ── North arrow (top-right inside plot) ──────────────────────────
  const naX = padL + drawW - pxW * 0.025;
  const naY = padT + pxH * 0.065;
  const naR  = pxW * 0.01;
  const nFontSz = Math.round(pxW * 0.012);

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = naR * 0.2;
  ctx.beginPath();
  ctx.moveTo(naX, naY + naR * 1.3);
  ctx.lineTo(naX, naY - naR * 1.3);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(naX, naY - naR * 1.9);
  ctx.lineTo(naX - naR * 0.55, naY - naR * 0.15);
  ctx.lineTo(naX, naY + naR * 0.35);
  ctx.lineTo(naX + naR * 0.55, naY - naR * 0.15);
  ctx.closePath();
  ctx.fillStyle = '#f48120';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(naX, naY + naR * 1.9);
  ctx.lineTo(naX - naR * 0.55, naY + naR * 0.15);
  ctx.lineTo(naX, naY - naR * 0.35);
  ctx.lineTo(naX + naR * 0.55, naY + naR * 0.15);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = `bold ${nFontSz}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('N', naX, naY - naR * 2.7);
  ctx.textAlign = 'left';

  // ── Scale bar (bottom-right inside plot) ─────────────────────────
  const worldPerPx = 1 / scale;
  const targetBarPx = drawW / 5;
  const targetBarM = targetBarPx * worldPerPx;
  // Round to nice number
  const exp = Math.pow(10, Math.floor(Math.log10(targetBarM)));
  const f = targetBarM / exp;
  const niceM = f < 1.5 ? exp : f < 3.5 ? 2 * exp : f < 7.5 ? 5 * exp : 10 * exp;
  const barPx = niceM / worldPerPx;

  const sbX = padL + drawW - barPx - pxW * 0.012;
  const sbY = padT + drawH - pxH * 0.022;
  const sbH = pxH * 0.009;
  const sbTxtSz = Math.round(pxH * 0.017);

  ctx.fillStyle = 'rgba(8,10,14,0.65)';
  ctx.fillRect(sbX - pxW * 0.008, sbY - sbH - pxH * 0.008, barPx + pxW * 0.016, sbH + sbTxtSz * 1.8 + pxH * 0.01);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(sbX, sbY, barPx, sbH);
  // Hatching every half
  ctx.fillStyle = 'rgba(100,110,130,0.8)';
  ctx.fillRect(sbX + barPx / 4, sbY, barPx / 4, sbH);
  ctx.fillRect(sbX + barPx * 3 / 4, sbY, barPx / 4, sbH);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = lw1 * 2;
  ctx.strokeRect(sbX, sbY, barPx, sbH);

  // End ticks
  ctx.beginPath();
  ctx.moveTo(sbX, sbY - sbH * 0.6); ctx.lineTo(sbX, sbY + sbH * 1.6);
  ctx.moveTo(sbX + barPx, sbY - sbH * 0.6); ctx.lineTo(sbX + barPx, sbY + sbH * 1.6);
  ctx.stroke();

  ctx.fillStyle = 'rgba(230,238,252,0.88)';
  ctx.font = `${sbTxtSz}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('0', sbX, sbY - sbH * 0.8);
  const scaleLabel = niceM >= 1000 ? `${(niceM / 1000).toFixed(0)} km` : `${niceM.toFixed(0)} m`;
  ctx.fillText(scaleLabel, sbX + barPx, sbY - sbH * 0.8);
  ctx.fillStyle = 'rgba(170,185,210,0.6)';
  ctx.font = `${Math.round(sbTxtSz * 0.85)}px sans-serif`;
  ctx.fillText('Scale', sbX + barPx / 2, sbY + sbH + sbTxtSz * 1.1);
  ctx.textAlign = 'left';

  // ── Title bar (above plot) ─────────────────────────────────────────
  const ttlSz = Math.round(pxH * 0.027);
  const subSz  = Math.round(pxH * 0.018);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `bold ${ttlSz}px sans-serif`;
  ctx.fillText('2D Track Plan', padL, padT - pxH * 0.022);
  ctx.fillStyle = 'rgba(175,190,215,0.65)';
  ctx.font = `${subSz}px sans-serif`;
  ctx.fillText(
    `${trackData.length} points  |  ${bounds.width.toFixed(1)} × ${bounds.height.toFixed(1)} m`,
    padL,
    padT - pxH * 0.004,
  );

  return canvas;
}

// ── Gauge / Cant profile chart renderer ──────────────────────────────────────
function renderProfileChart(trackData, pxW, pxH, gaugeType) {
  const canvas = document.createElement('canvas');
  canvas.width  = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#16181a';
  ctx.fillRect(0, 0, pxW, pxH);
  if (!trackData || trackData.length < 2) return canvas;

  const chainages = trackData.map(p => p.chainage);
  const minCh = chainages[0], maxCh = chainages[chainages.length - 1];
  const chRange = maxCh - minCh || 1;

  const padL = pxW * 0.075, padR = pxW * 0.025;
  const padT = pxH * 0.05,  padB = pxH * 0.09;
  const gap  = pxH * 0.04;
  const drawW = pxW - padL - padR;
  const gaugeH = (pxH - padT - padB - gap) * 0.55;
  const cantH  = (pxH - padT - padB - gap) * 0.45;
  const gaugeY = padT;
  const cantY  = padT + gaugeH + gap;
  const lw = Math.max(1, pxW * 0.0004);

  const chToX = ch => padL + ((ch - minCh) / chRange) * drawW;

  // ── Gauge panel ──────────────────────────────────────────────────
  const gauges = trackData.map(p => p.gauge);
  const designG = gaugeType?.gauge ?? (gauges.reduce((a,b)=>a+b,0)/gauges.length);
  const tolM = (gaugeType?.toleranceMM ?? 3) / 1000;
  const gPad = Math.max(tolM * 2.5, (Math.max(...gauges) - Math.min(...gauges)) * 0.25);
  const gMin = designG - gPad, gMax = designG + gPad;
  const gRange = gMax - gMin;
  const gToY = g => gaugeY + gaugeH - ((g - gMin) / gRange) * gaugeH;

  ctx.fillStyle = '#1c1e22';
  ctx.fillRect(padL, gaugeY, drawW, gaugeH);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = lw * 2;
  ctx.strokeRect(padL, gaugeY, drawW, gaugeH);

  // Tolerance bands
  const bands = [
    [designG - tolM * 2, designG - tolM, 'rgba(239,68,68,0.10)'],
    [designG - tolM, designG,             'rgba(249,115,22,0.06)'],
    [designG, designG + tolM,             'rgba(249,115,22,0.06)'],
    [designG + tolM, designG + tolM * 2,  'rgba(239,68,68,0.10)'],
  ];
  bands.forEach(([lo, hi, color]) => {
    const y1 = gToY(Math.min(hi, gMax));
    const y2 = gToY(Math.max(lo, gMin));
    if (y2 > y1) { ctx.fillStyle = color; ctx.fillRect(padL, y1, drawW, y2 - y1); }
  });

  // Grid + X tick lines
  const GSTEPS = 8;
  for (let i = 0; i <= GSTEPS; i++) {
    const gy = gaugeY + (gaugeH / GSTEPS) * i;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + drawW, gy); ctx.stroke();
  }

  // Design gauge line
  const dgY = gToY(designG);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = lw * 2;
  ctx.setLineDash([pxW * 0.005, pxW * 0.003]);
  ctx.beginPath(); ctx.moveTo(padL, dgY); ctx.lineTo(padL + drawW, dgY); ctx.stroke();
  ctx.setLineDash([]);

  // Tolerance ±1σ lines
  [designG - tolM, designG + tolM].forEach(tg => {
    const ty = gToY(tg);
    if (ty >= gaugeY && ty <= gaugeY + gaugeH) {
      ctx.strokeStyle = 'rgba(249,115,22,0.45)'; ctx.lineWidth = lw;
      ctx.setLineDash([pxW * 0.003, pxW * 0.002]);
      ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + drawW, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Gauge line
  ctx.beginPath(); ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = lw * 2.5; ctx.lineJoin = 'round';
  trackData.forEach((p, i) => { const pt = { x: chToX(p.chainage), y: gToY(p.gauge) }; i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y); });
  ctx.stroke();

  // Out-of-tolerance dots
  trackData.forEach(p => {
    if (Math.abs(p.gauge - designG) > tolM) {
      ctx.beginPath(); ctx.arc(chToX(p.chainage), gToY(p.gauge), lw*5, 0, Math.PI*2);
      ctx.fillStyle = '#ef4444'; ctx.fill();
    }
  });

  // Y-axis labels
  const axSz = Math.round(pxH * 0.024);
  ctx.fillStyle = 'rgba(170,188,215,0.7)'; ctx.font = `${axSz}px sans-serif`; ctx.textAlign = 'right';
  for (let i = 0; i <= GSTEPS; i += 2) {
    const gv = gMin + (gRange / GSTEPS) * (GSTEPS - i);
    ctx.fillText(gv.toFixed(4), padL - lw*5, gaugeY + (gaugeH/GSTEPS)*i + axSz*0.38);
  }
  ctx.textAlign = 'left';

  // Panel title + design label
  const ttSz = Math.round(pxH * 0.032);
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = `bold ${ttSz}px sans-serif`;
  ctx.fillText('Gauge (m)', padL + lw*4, gaugeY + ttSz * 1.1);
  ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.font = `${Math.round(pxH*0.022)}px sans-serif`;
  ctx.fillText(`Design: ${designG.toFixed(4)} m  ±${(tolM*1000).toFixed(0)} mm tol.`, padL + drawW*0.02, dgY - lw*4);

  // ── Cant panel ───────────────────────────────────────────────────
  const cants = trackData.map(p => p.cant * 1000);
  const cAbsMax = Math.max(Math.abs(Math.min(...cants)), Math.abs(Math.max(...cants)));
  const cPad = Math.max(1, cAbsMax * 0.18);
  const cMin = Math.min(...cants) - cPad, cMax = Math.max(...cants) + cPad;
  const cRange = cMax - cMin;
  const cToY = c => cantY + cantH - ((c - cMin) / cRange) * cantH;

  ctx.fillStyle = '#1c1e22';
  ctx.fillRect(padL, cantY, drawW, cantH);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = lw * 2;
  ctx.strokeRect(padL, cantY, drawW, cantH);

  // Zero line
  const zY = cToY(0);
  if (zY >= cantY && zY <= cantY + cantH) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = lw * 2;
    ctx.setLineDash([pxW*0.005, pxW*0.003]);
    ctx.beginPath(); ctx.moveTo(padL, zY); ctx.lineTo(padL + drawW, zY); ctx.stroke();
    ctx.setLineDash([]);
  }

  const CSTEPS = 6;
  for (let i = 0; i <= CSTEPS; i++) {
    const cy = cantY + (cantH / CSTEPS) * i;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(padL + drawW, cy); ctx.stroke();
  }

  // Cant line
  ctx.beginPath(); ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = lw * 2.5; ctx.lineJoin = 'round';
  trackData.forEach((p, i) => { const pt = { x: chToX(p.chainage), y: cToY(p.cant*1000) }; i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y); });
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = 'rgba(170,188,215,0.7)'; ctx.font = `${axSz}px sans-serif`; ctx.textAlign = 'right';
  for (let i = 0; i <= CSTEPS; i += 2) {
    const cv = cMin + (cRange / CSTEPS) * (CSTEPS - i);
    ctx.fillText(cv.toFixed(2), padL - lw*5, cantY + (cantH/CSTEPS)*i + axSz*0.38);
  }
  ctx.textAlign = 'left';

  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = `bold ${ttSz}px sans-serif`;
  ctx.fillText('Cant (mm)', padL + lw*4, cantY + ttSz * 1.1);

  // Shared X axis (chainage)
  const xSz = Math.round(pxH * 0.022);
  const XSTEPS = 10;
  ctx.fillStyle = 'rgba(165,185,215,0.6)'; ctx.font = `${xSz}px sans-serif`; ctx.textAlign = 'center';
  for (let i = 0; i <= XSTEPS; i++) {
    const chv = minCh + (chRange / XSTEPS) * i;
    const gx  = padL + (drawW / XSTEPS) * i;
    ctx.fillText(`${chv.toFixed(0)}m`, gx, cantY + cantH + xSz * 1.5);
    // Shared vertical gridline across both panels
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(gx, gaugeY); ctx.lineTo(gx, cantY + cantH); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(180,198,222,0.55)'; ctx.font = `${Math.round(pxH*0.024)}px sans-serif`;
  ctx.fillText('Chainage (m)', padL + drawW / 2, cantY + cantH + xSz * 2.9);
  ctx.textAlign = 'left';

  // Unit axis label (left side, rotated)
  ctx.save();
  ctx.translate(padL - pxW*0.055, padT + (gaugeH + cantH + gap) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(190,205,230,0.5)'; ctx.font = `${Math.round(pxH*0.024)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Value', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';

  return canvas;
}

// ── PDF page helpers ─────────────────────────────────────────────────────────
const BRAND   = [30,  40,  60 ]; // deep navy
const ACCENT  = [244, 129, 32 ]; // orange
const LTGRAY  = [240, 242, 245];
const MIDGRAY = [160, 165, 175];

function drawPageHeader(doc, pageW, title, pageNum, totalPages, trackName) {
  // Top bar
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 12, 'F');

  // Orange left accent stripe
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, 4, 12, 'F');

  // App name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('RAIL SIM', 8, 7.5);

  // separator dot
  doc.setTextColor(...ACCENT);
  doc.text('•', 24, 7.5);

  // Section title
  doc.setTextColor(200, 210, 225);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 30, 7.5);

  // Track name (right-center)
  doc.setTextColor(180, 190, 200);
  doc.setFontSize(7);
  doc.text(trackName || 'Track Report', pageW / 2, 7.5, { align: 'center' });

  // Page number (right)
  doc.setTextColor(180, 190, 200);
  doc.text(`Page ${pageNum} / ${totalPages}`, pageW - 10, 7.5, { align: 'right' });
}

function drawPageFooter(doc, pageW, pageH) {
  doc.setDrawColor(...MIDGRAY);
  doc.setLineWidth(0.2);
  doc.line(10, pageH - 8, pageW - 10, pageH - 8);

  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated by Rail SIM — Track Geometry Simulator', 10, pageH - 4);
  doc.text(new Date().toLocaleString(), pageW - 10, pageH - 4, { align: 'right' });
}

// ── Main export function ─────────────────────────────────────────────────────
async function generatePDF(trackData, visibleColumns, trackName, gaugeType) {
  const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageW = doc.internal.pageSize.getWidth();   // 420 mm
  const pageH = doc.internal.pageSize.getHeight();  // 297 mm
  const M     = 12; // margin

  // jsPDF total-pages alias — replaced with real count at the very end
  const TPAGES = '{total_pages}';

  doc.setProperties({
    title:   `RailSIM Track Report — ${trackName || 'Track'}`,
    subject: 'Track Geometry Survey Report',
    author:  'Rail SIM Track Geometry Simulator',
    creator: 'Rail SIM Track Geometry Simulator',
  });

  const stats     = computePdfStats(trackData);

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER / SUMMARY
  // ════════════════════════════════════════════════════════════════
  drawPageHeader(doc, pageW, 'Track Summary', 1, TPAGES, trackName);
  drawPageFooter(doc, pageW, pageH);

  // Big title block
  doc.setFillColor(...BRAND);
  doc.rect(M, 18, pageW - M * 2, 28, 'F');
  doc.setFillColor(...ACCENT);
  doc.rect(M, 18, 3, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Track Data Report', M + 8, 30);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 210, 230);
  doc.text(trackName || 'Unnamed Track', M + 8, 39);

  doc.setFontSize(8);
  doc.setTextColor(170, 180, 200);
  doc.text(new Date().toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' }), pageW - M, 39, { align: 'right' });

  // Summary stats cards — 2 rows of 6
  if (stats) {
    const bearingDir = (b) => {
      const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      return dirs[Math.round(b / 22.5) % 16];
    };
    const row1 = [
      { label: 'Total Points',   value: stats.ptCount.toString(),                         unit: 'pts'  },
      { label: 'Total Length',   value: stats.totalLength.toFixed(3),                     unit: 'm'    },
      { label: 'Start Chainage', value: stats.chainageStart.toFixed(3),                   unit: 'm'    },
      { label: 'End Chainage',   value: stats.chainageEnd.toFixed(3),                     unit: 'm'    },
      { label: 'Elevation Δ',    value: stats.elevDelta.toFixed(4),                       unit: 'm'    },
      { label: 'Track Bearing',  value: `${stats.bearing.toFixed(1)}° ${bearingDir(stats.bearing)}`, unit: 'azimuth' },
    ];
    const row2 = [
      { label: 'Gauge Range',    value: `${stats.minGauge.toFixed(4)} – ${stats.maxGauge.toFixed(4)}`, unit: 'm'  },
      { label: 'Avg Gauge',      value: stats.avgGauge.toFixed(5),                        unit: 'm'    },
      { label: 'Max Gauge Dev',  value: `±${stats.maxGaugeDevVal.toFixed(4)}`,            unit: 'm'    },
      { label: 'Worst Dev Pt',   value: `P${stats.maxGaugeDevPt.pointNumber}`,            unit: 'pt#'  },
      { label: 'Cant Range',     value: `${stats.minCant.toFixed(2)} – ${stats.maxCant.toFixed(2)}`,   unit: 'mm' },
      { label: 'Avg Cant',       value: stats.avgCant.toFixed(3),                         unit: 'mm'   },
    ];

    const ROWS = [row1, row2];
    const cardW = (pageW - M * 2 - 5 * 3) / 6;
    const CARD_H = 22;
    const ROW_GAP = 3;

    ROWS.forEach((cards, rowIdx) => {
      const cardY = 52 + rowIdx * (CARD_H + ROW_GAP);
      cards.forEach((card, i) => {
        const cx = M + i * (cardW + 3);
        doc.setFillColor(...LTGRAY);
        doc.roundedRect(cx, cardY, cardW, CARD_H, 2, 2, 'F');
        doc.setDrawColor(218, 223, 230);
        doc.setLineWidth(0.25);
        doc.roundedRect(cx, cardY, cardW, CARD_H, 2, 2, 'S');
        doc.setFillColor(...ACCENT);
        doc.roundedRect(cx, cardY, cardW, 2, 1, 1, 'F');

        doc.setTextColor(...MIDGRAY);
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'normal');
        doc.text(card.label, cx + cardW / 2, cardY + 7.5, { align: 'center' });

        doc.setTextColor(...BRAND);
        doc.setFontSize(card.value.length > 14 ? 7 : 8);
        doc.setFont('helvetica', 'bold');
        doc.text(card.value, cx + cardW / 2, cardY + 15.5, { align: 'center' });

        doc.setTextColor(...MIDGRAY);
        doc.setFontSize(5);
        doc.setFont('helvetica', 'normal');
        doc.text(card.unit, cx + cardW / 2, cardY + 20, { align: 'center' });
      });
    });
  }

  // ── Column legend strip ──────────────────────────────────────────────────────
  const colInfoY = 102;
  doc.setFillColor(...BRAND);
  doc.rect(M, colInfoY, pageW - M * 2, 6, 'F');
  doc.setFillColor(...ACCENT);
  doc.rect(M, colInfoY, 3, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DATA PREVIEW — first 5 points', M + 7, colInfoY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 195, 215);
  doc.text(`${visibleColumns.length} columns exported`, pageW - M, colInfoY + 4, { align: 'right' });

  // ── Preview data table ───────────────────────────────────────────────────────
  const previewTableY = colInfoY + 8;

  // Explicit column widths (mm) — keeps cells from overflowing
  const COL_WIDTHS = {
    pointNumber: 8,  chainage: 16,    type: 13,
    leftEasting: 22, leftNorthing: 22, leftHeight: 15,
    rightEasting: 22,rightNorthing: 22, rightHeight: 15,
    easting: 22,     northing: 22,     height: 15,
    length: 14,      gauge: 18,        cant: 14,
    gaugeDiff: 16,   cantDiff: 14,     radius: 12,
  };

  // Select columns that fit within the printable width
  const avail = pageW - M * 2;
  let runW = 0;
  const previewCols = [];
  for (const col of visibleColumns) {
    const w = COL_WIDTHS[col.key] ?? 18;
    if (runW + w > avail + 1) break;
    previewCols.push(col);
    runW += w;
  }

  autoTable(doc, {
    startY: previewTableY,
    margin: { left: M, right: M },
    columns: previewCols.map(c => ({ header: c.label, dataKey: c.key })),
    body: trackData.slice(0, 5).map(p =>
      Object.fromEntries(previewCols.map(c => [c.key, formatValue(c.key, p[c.key])]))
    ),
    styles: {
      fontSize: 6.5,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
      font: 'helvetica',
      overflow: 'ellipsize',
      lineColor: [210, 218, 228],
      lineWidth: 0.18,
    },
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.5,
      halign: 'center',
    },
    columnStyles: Object.fromEntries(
      previewCols.map((c, i) => {
        const gc = GROUP_COLORS[c.group] ?? GROUP_COLORS.id;
        return [i, {
          cellWidth: COL_WIDTHS[c.key] ?? 18,
          halign: ['pointNumber', 'type'].includes(c.key) ? 'center' : 'right',
          textColor: [gc.r, gc.g, gc.b],
        }];
      })
    ),
    alternateRowStyles: { fillColor: [248, 249, 252] },
    tableLineColor: [210, 215, 225],
    tableLineWidth: 0.18,
    didParseCell(data) {
      if (data.section === 'head') {
        const gc = GROUP_COLORS[previewCols[data.column.index]?.group] ?? GROUP_COLORS.id;
        // Slightly tinted navy per group
        data.cell.styles.fillColor = [
          Math.max(18, Math.min(60, BRAND[0] + Math.round((gc.r - 80) * 0.22))),
          Math.max(25, Math.min(70, BRAND[1] + Math.round((gc.g - 80) * 0.22))),
          Math.max(48, Math.min(110, BRAND[2] + Math.round((gc.b - 80) * 0.22))),
        ];
        data.cell.styles.textColor = [220, 230, 245];
      }
    },
  });

  const previewEndY = (doc.lastAutoTable?.finalY ?? 0) + 3.5;
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(6);
  doc.text(
    `Preview: first 5 of ${trackData.length} points — complete dataset on data pages.`,
    M, previewEndY,
  );

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — FULL-PAGE TRACK PLAN
  // ════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageHeader(doc, pageW, '2D Track Plan View', 2, TPAGES, trackName);
  drawPageFooter(doc, pageW, pageH);

  const plotAreaW = pageW - M * 2;
  const plotAreaH = pageH - 28;
  const PX_PER_MM = 600 / 25.4;
  const pxW = Math.round(plotAreaW * PX_PER_MM);
  const pxH = Math.round(plotAreaH * PX_PER_MM);

  const trackCanvas = renderTrackHiDPI(trackData, pxW, pxH);
  const trackImg    = trackCanvas.toDataURL('image/jpeg', 0.94);

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.4);
  doc.rect(M - 0.5, 13.5, plotAreaW + 1, plotAreaH + 1);
  doc.addImage(trackImg, 'JPEG', M, 14, plotAreaW, plotAreaH, undefined, 'FAST');

  if (trackData && trackData.length >= 2) {
    const bounds = getBounds(trackData);
    doc.setTextColor(...MIDGRAY);
    doc.setFontSize(6);
    doc.text(
      `Extent: E ${bounds.minX.toFixed(2)} – ${bounds.maxX.toFixed(2)}  |  N ${bounds.minY.toFixed(2)} – ${bounds.maxY.toFixed(2)}`,
      M, pageH - 9.5,
    );
  }

  // ════════════════════════════════════════════════════════════════
  // PAGE 3 — GAUGE & CANT PROFILE CHART
  // ════════════════════════════════════════════════════════════════
  doc.addPage();
  drawPageHeader(doc, pageW, 'Gauge & Cant Profile', 3, TPAGES, trackName);
  drawPageFooter(doc, pageW, pageH);

  const profW = Math.round(plotAreaW * PX_PER_MM);
  const profH = Math.round(plotAreaH * PX_PER_MM);
  const profCanvas = renderProfileChart(trackData, profW, profH, gaugeType);
  const profImg    = profCanvas.toDataURL('image/jpeg', 0.92);

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.4);
  doc.rect(M - 0.5, 13.5, plotAreaW + 1, plotAreaH + 1);
  doc.addImage(profImg, 'JPEG', M, 14, plotAreaW, plotAreaH, undefined, 'FAST');

  // ════════════════════════════════════════════════════════════════
  // PAGE 4+ — FULL DATA TABLE
  // ════════════════════════════════════════════════════════════════
  doc.addPage();

  // Conditionally drop Radius column if all points are straight
  const allStraight = trackData.every(p => !p.radius || p.radius === 0);
  const tableCols   = visibleColumns.filter(c => !(c.key === 'radius' && allStraight));

  // Deviation thresholds for row highlighting
  const devThresh = buildThresholds(gaugeType);

  const tableRows = trackData.map(p =>
    Object.fromEntries(tableCols.map(c => [c.key, formatValue(c.key, p[c.key])]))
  );

  autoTable(doc, {
    startY: 16,
    margin: { left: M, right: M, top: 16, bottom: 14 },
    columns: tableCols.map(c => ({ header: c.label, dataKey: c.key })),
    body: tableRows,
    styles: {
      fontSize: 6.5,
      cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 },
      font: 'helvetica',
      textColor: [40, 50, 60],
      lineColor: [215, 220, 228],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
    },
    columnStyles: Object.fromEntries(
      tableCols.map((c, i) => {
        const gc = GROUP_COLORS[c.group] ?? GROUP_COLORS.id;
        return [i, {
          textColor: [gc.r, gc.g, gc.b],
          halign: ['pointNumber', 'type'].includes(c.key) ? 'center' : 'right',
        }];
      })
    ),
    alternateRowStyles: { fillColor: [248, 249, 252] },
    didParseCell(data) {
      if (data.section === 'head') {
        const gc = GROUP_COLORS[tableCols[data.column.index]?.group] ?? GROUP_COLORS.id;
        data.cell.styles.fillColor = [
          Math.min(255, BRAND[0] + (gc.r - BRAND[0]) * 0.35),
          Math.min(255, BRAND[1] + (gc.g - BRAND[1]) * 0.35),
          Math.min(255, BRAND[2] + (gc.b - BRAND[2]) * 0.35),
        ];
      }
      if (data.section === 'body') {
        const col = tableCols[data.column.index];
        const pt  = trackData[data.row.index];
        if (col && pt) {
          const devStyle = getDeviationStyle(col.key, pt[col.key], devThresh);
          if (devStyle) {
            const bg = devStyle.background.match(/\d+/g).map(Number);
            data.cell.styles.fillColor = [bg[0], bg[1], bg[2]];
            const fg = devStyle.color.match(/\w{2}/g)?.map(h => parseInt(h, 16)) ?? [180, 40, 40];
            data.cell.styles.textColor = fg;
            data.cell.styles.fontStyle  = 'bold';
          }
        }
      }
    },
    didDrawPage() {
      const pn = doc.internal.getCurrentPageInfo().pageNumber;
      drawPageHeader(doc, pageW, 'Track Data Table', pn, TPAGES, trackName);
      drawPageFooter(doc, pageW, pageH);
    },
    tableLineColor: [210, 215, 225],
    tableLineWidth: 0.2,
    showFoot: 'lastPage',
    foot: [[...tableCols.map((c, i) => i === 0 ? `${trackData.length} points total` : '')]],
    footStyles: { fillColor: LTGRAY, textColor: BRAND, fontStyle: 'bold', fontSize: 7 },
  });

  // Resolve total-pages placeholder throughout the document
  doc.putTotalPages(TPAGES);

  return doc;
}

// ── React component ──────────────────────────────────────────────────────────
export default function TrackDataModal({ visible, onClose, trackData, onExportData, trackName, gaugeType }) {
  const [columnVisibility, setColumnVisibility] = useState(
    Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true]))
  );
  const [exporting, setExporting] = useState(false);

  const toggleColumn = (key) => setColumnVisibility(prev => ({ ...prev, [key]: !prev[key] }));

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter(c => columnVisibility[c.key]),
    [columnVisibility]
  );

  const devThresholds = useMemo(() => buildThresholds(gaugeType), [gaugeType]);

  const handleExportPDF = useCallback(async () => {
    if (!trackData || trackData.length === 0) return;
    setExporting(true);
    try {
      const doc = await generatePDF(trackData, visibleColumns, trackName, gaugeType);
      doc.save(`RailSIM_TrackReport_${Date.now()}.pdf`);
    } finally {
      setExporting(false);
    }
  }, [trackData, visibleColumns, trackName, gaugeType]);

  if (!visible) return null;

  return (
    <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>
            <span className="material-icons" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6 }}>table_view</span>
            Track Data
          </h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="column-toggles" id="columnToggles">
          {ALL_COLUMNS.map(col => (
            <label key={col.key} className={`column-toggle${columnVisibility[col.key] ? ' active' : ''}`}>
              <input type="checkbox" checked={columnVisibility[col.key]} onChange={() => toggleColumn(col.key)} />
              <span className="indicator"></span>
              {col.label}
            </label>
          ))}
        </div>

        {/* Deviation legend */}
        {gaugeType && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.6px',
              marginRight: 4, whiteSpace: 'nowrap',
            }}>
              Deviation — {gaugeType.name}
            </span>
            {[
              {
                bg: 'rgba(234,179,8,0.18)',
                border: 'rgba(146,64,14,0.35)',
                text: '#92400e',
                severity: 'Low',
                label: `Gauge >±${(gaugeType.toleranceMM * 0.5).toFixed(1)} mm`,
                label2: `Cant >±${(gaugeType.maxCantMM * 0.10).toFixed(1)} mm`,
              },
              {
                bg: 'rgba(249,115,22,0.18)',
                border: 'rgba(194,65,12,0.35)',
                text: '#c2410c',
                severity: 'Med',
                label: `Gauge >±${gaugeType.toleranceMM.toFixed(1)} mm`,
                label2: `Cant >±${(gaugeType.maxCantMM * 0.25).toFixed(1)} mm`,
              },
              {
                bg: 'rgba(239,68,68,0.18)',
                border: 'rgba(185,28,28,0.35)',
                text: '#b91c1c',
                severity: 'High',
                label: `Gauge >±${(gaugeType.toleranceMM * 2).toFixed(1)} mm`,
                label2: `Cant >±${(gaugeType.maxCantMM * 0.5).toFixed(1)} mm`,
              },
            ].map(({ bg, border, text, severity, label, label2 }) => (
              <span key={severity} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 5,
                padding: '3px 8px',
              }}>
                <span style={{
                  fontSize: 8, fontWeight: 800, color: text,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                }}>
                  {severity}
                </span>
                <span style={{ width: 1, height: 10, background: border, flexShrink: 0 }} />
                <span style={{ fontSize: 9, color: text, whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <span style={{ fontSize: 9, color: text, opacity: 0.7, whiteSpace: 'nowrap' }}>
                  · {label2}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="modal-table-wrap">
          <table className="modal-table">
            <thead>
              <tr>
                {visibleColumns.map(col => (
                  <th key={col.key} className={getColClass(col.key)}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trackData.map((p, i) => (
                <tr key={i}>
                  {visibleColumns.map(col => {
                    const devStyle = getDeviationStyle(col.key, p[col.key], devThresholds);
                    return (
                      <td
                        key={col.key}
                        className={getColClass(col.key)}
                        style={devStyle ?? undefined}
                      >
                        {formatValue(col.key, p[col.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-footer">
          <span id="modalDataCount">{trackData.length} points</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => onExportData(visibleColumns.map(c => c.key))}>
              <span className="material-icons" style={{ fontSize: 13 }}>download</span>
              Export CSV
            </button>
            <button
              className="btn btn-sm btn-pdf"
              onClick={handleExportPDF}
              disabled={exporting}
              title="Export official PDF report with 2D track plan + full data table"
            >
              <span className="material-icons" style={{ fontSize: 13 }}>picture_as_pdf</span>
              {exporting ? 'Generating…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
