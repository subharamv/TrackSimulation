import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { getBounds } from '../utils/geometry';
import TrackMap2D from './TrackMap2D';
import { tooltipConfig, hideTooltip } from '../utils/tooltip';
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Tooltip, Legend,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

// ── Global vertical-indicator plugin (registered once) ───────────────────────
Chart.register({
  id: 'rcVertLine',
  afterDraw(chart) {
    const opts = chart.options.plugins?.rcVertLine;
    if (!opts?.enabled || opts.activeIndex == null) return;
    const idx = opts.activeIndex;
    if (!chart.scales?.x || !chart.chartArea) return;
    const { ctx, chartArea: { top, bottom, right } } = chart;
    const xPx = chart.scales.x.getPixelForValue(idx);
    if (xPx < chart.chartArea.left || xPx > right) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(244,129,32,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(xPx, top); ctx.lineTo(xPx, bottom); ctx.stroke();
    ctx.setLineDash([]);

    // Dot at top of line
    ctx.beginPath(); ctx.arc(xPx, top + 3, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f48120'; ctx.fill();

    // Label — flip side if near right edge
    if (opts.label) {
      ctx.font = 'bold 7.5px sans-serif';
      const tw = ctx.measureText(opts.label).width;
      const lx = xPx + 5 + tw > right ? xPx - tw - 5 : xPx + 5;
      ctx.fillStyle = 'rgba(244,129,32,0.9)';
      ctx.fillText(opts.label, lx, top + 12);
    }
    ctx.restore();
  },
});

// ── Chart hook ────────────────────────────────────────────────────────────────
// dataDeps  → update data in-place (data structure / series visibility changed)
// indexDeps → lightweight plugin-only update (active point changed)
function useChart(canvasId, makeConfig, dataDeps, indexDeps) {
  const chartRef     = useRef(null);
  const makeConfigRef = useRef(makeConfig);
  makeConfigRef.current = makeConfig;

  // Update data in-place when data or series visibility changes
  useEffect(() => {
    const canvas = document.getElementById(canvasId);
    const cfg = makeConfigRef.current();
    if (!canvas || !cfg) {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      return;
    }
    if (chartRef.current) {
      const needsRecreate = !document.body.contains(chartRef.current.canvas);
      if (needsRecreate) {
        chartRef.current.destroy();
        chartRef.current = new Chart(canvas, cfg);
      } else {
        chartRef.current.data = cfg.data;
        try {
          const to = chartRef.current.options.plugins.tooltip;
          const no = cfg.options?.plugins?.tooltip ?? {};
          Object.assign(to, no);
        } catch (_) {}
        chartRef.current.update('none');
      }
    } else {
      chartRef.current = new Chart(canvas, cfg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dataDeps);

  // Lightweight update — only refreshes plugin options (no full update)
  useEffect(() => {
    if (!chartRef.current) return;
    const cfg = makeConfigRef.current();
    if (!cfg) return;
    const target = chartRef.current.options.plugins;
    const src    = cfg.options?.plugins ?? {};
    Object.keys(src).forEach(key => {
      try { Object.assign(target[key] ??= {}, src[key]); } catch (_) {}
    });
    chartRef.current.update('none');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, indexDeps);

  useEffect(() => () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
  }, []);
}

// ── Palette ───────────────────────────────────────────────────────────────────
const C_L  = '#3b82f6';
const C_CL = '#10b981';
const C_R  = '#ef4444';
const C_DE = '#f59e0b';
const C_DN = '#8b5cf6';
const C_DH = '#f48120';

const ttBase = { ...tooltipConfig };

const scaleBase = {
  x: { grid: { color: 'rgba(0,0,0,0.1)' }, ticks: { color: '#111827', font: { size: 7.5 }, maxTicksLimit: 10 } },
  y: { grid: { color: 'rgba(0,0,0,0.1)' }, ticks: { color: '#111827', font: { size: 7.5 } } },
};

const legendBase = {
  display: true,
  labels: { color: '#111827', font: { size: 8 }, usePointStyle: true, boxWidth: 6, padding: 6 },
};

function Chip({ active, color, label, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      padding: '1px 8px', fontSize: 8, borderRadius: 10, lineHeight: 1.8,
      border: `1px solid ${active ? color : 'rgba(100,116,139,0.3)'}`,
      background: active ? `${color}1a` : 'transparent',
      color: active ? color : '#374151',
      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
      fontWeight: active ? 600 : 400,
    }}>
      {active ? '◉' : '○'} {label}
    </button>
  );
}

// ── Minimap drawing ──────────────────────────────────────────────────────────
function drawMiniOverlay(canvas, trackData, fromIdx, toIdx) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  if (cw < 10 || ch < 10) return;

  const w = cw * dpr;
  const h = ch * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(30,31,32,0.94)';
  ctx.beginPath();
  const r = 6 * dpr;
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  const bounds = getBounds(trackData);
  const bw = bounds.width;
  const bh = bounds.height;
  if (bw < 0.01 || bh < 0.01) return;

  const pad = 10 * dpr;
  const availW = w - pad * 2;
  const availH = h - pad * 2;
  const scale = Math.min(availW / bw, availH / bh);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const ox = w / 2 - cx * scale;
  const oy = h / 2 + cy * scale;

  function drawLine(points, getX, getY, color, width) {
    if (points.length === 0) return;
    ctx.beginPath();
    points.forEach((p, i) => {
      const sx = getX(p) * scale + ox;
      const sy = -getY(p) * scale + oy;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  drawLine(trackData, p => p.leftEasting, p => p.leftNorthing, 'rgba(59,130,246,0.18)', 1.5);
  drawLine(trackData, p => p.easting, p => p.northing, 'rgba(16,185,129,0.18)', 1);
  drawLine(trackData, p => p.rightEasting, p => p.rightNorthing, 'rgba(239,68,68,0.18)', 1.5);

  if (fromIdx != null && toIdx != null && fromIdx >= 0 && toIdx < trackData.length && fromIdx <= toIdx) {
    const visible = trackData.slice(fromIdx, toIdx + 1);
    drawLine(visible, p => p.leftEasting, p => p.leftNorthing, 'rgba(59,130,246,0.7)', 2.5);
    drawLine(visible, p => p.easting, p => p.northing, 'rgba(16,185,129,0.7)', 2);
    drawLine(visible, p => p.rightEasting, p => p.rightNorthing, 'rgba(239,68,68,0.7)', 2.5);
  }

  const first = trackData[0];
  const last = trackData[trackData.length - 1];
  const fsx = first.easting * scale + ox;
  const fsy = -first.northing * scale + oy;
  ctx.beginPath();
  ctx.arc(fsx, fsy, 2.5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16,185,129,0.8)';
  ctx.fill();
  const lsx = last.easting * scale + ox;
  const lsy = -last.northing * scale + oy;
  ctx.beginPath();
  ctx.arc(lsx, lsy, 2.5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239,68,68,0.8)';
  ctx.fill();
}

// ── Chart definitions ─────────────────────────────────────────────────────────
const RC_CHARTS = [
  { id: 'rcEasting',  title: 'Easting',           dotColor: C_L },
  { id: 'rcNorthing', title: 'Northing',           dotColor: C_CL },
  { id: 'rcHeight',   title: 'Height',             dotColor: C_DE },
  { id: 'rcDiff',     title: 'Rail Differences',   dotColor: C_DH },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function RailCompareView({ visible, onClose, trackData, fullTrackData, chartStartIdx = 0, activeRange, activeIndex = 0, hoveredIdx = -1, onMapRangeChange, scrollToRange = null, showSegDist = true, showCumDist = true, resetMapKey = 0, mapToggleKey = 0 }) {
  // ── Hooks (stable order) ──────────────────────────────────────────────────
  const tdRef = useRef(null);
  const onMapRangeChangeRef = useRef(onMapRangeChange);
  onMapRangeChangeRef.current = onMapRangeChange;

  const [vis, setVis] = useState({
    eastL: true,  eastCL: true,  eastR: true,
    nortL: true,  nortCL: true,  nortR: true,
    hgtL:  true,  hgtCL:  true,  hgtR:  true,
    diffE: true,  diffN:  true,  diffH:  true,
  });
  const tog = (k) => setVis(p => ({ ...p, [k]: !p[k] }));

  // ── Layout + chart selection ──────────────────────────────────────────────
  const [rowLayout, setRowLayout] = useState(1);
  const [colLayout, setColLayout] = useState(1);
  const rcGridRef = useRef(null);

  // Stagger entrance animation when layout rows/cols change
  useEffect(() => {
    const grid = rcGridRef.current;
    if (!grid) return;
    const cells = grid.children;
    if (!cells.length) return;
    gsap.fromTo(cells,
      { opacity: 0.3, scale: 0.97 },
      { opacity: 1, scale: 1, duration: 0.25, stagger: 0.04, ease: 'power2.out', force3D: true }
    );
  }, [rowLayout, colLayout]);
  const [chartSel, setChartSel] = useState(() => Object.fromEntries(RC_CHARTS.map(c => [c.id, true])));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const hdrDropRef = useRef(null);
  useEffect(() => {
    if (!layoutOpen && !chartOpen) return;
    const h = (e) => { if (hdrDropRef.current && !hdrDropRef.current.contains(e.target)) { setLayoutOpen(false); setChartOpen(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [layoutOpen, chartOpen]);

  const [mapPopupPos, setMapPopupPos] = useState(null);
  const [mapPopupSize, setMapPopupSize] = useState(() => {
    try {
      const saved = localStorage.getItem('railsim_mapPopupSize');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const mapPopupRef = useRef(null);
  const startMapPopupDrag = useCallback((clientX, clientY) => {
    const el = mapPopupRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const offX = clientX - rect.left;
    const offY = clientY - rect.top;
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const vpW = window.innerWidth, vpH = window.innerHeight;
      setMapPopupPos({
        x: Math.max(0, Math.min(cx - offX, vpW - el.offsetWidth)),
        y: Math.max(0, Math.min(cy - offY, vpH - el.offsetHeight)),
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }, []);

  // Corner resize handler (mouse + touch)
  const startMapResize = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = mapPopupRef.current;
    if (!el) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const startX = cx;
    const startY = cy;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const newW = Math.max(240, Math.min(vpW - 40, startW + dx));
      const newH = Math.max(200, Math.min(vpH - 100, startH + dy));
      setMapPopupSize({ width: newW, height: newH });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist final size to localStorage
      const el = mapPopupRef.current;
      if (el) {
        try {
          localStorage.setItem('railsim_mapPopupSize', JSON.stringify({ width: el.offsetWidth, height: el.offsetHeight }));
        } catch {}
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const [showMapSidebar, setShowMapSidebar] = useState(false);
  const [mapRange, setMapRange] = useState(null);
  // Toggle map when keyboard shortcut fires (mapToggleKey increments)
  useEffect(() => {
    if (mapToggleKey > 0) setShowMapSidebar(v => !v);
  }, [mapToggleKey]);

  // ── Derived (non-hook) ─────────────────────────────────────────────────────
  const clampedIdx = Math.max(0, Math.min(activeIndex, trackData.length - 1));
  const showIdx = hoveredIdx >= 0 && hoveredIdx < trackData.length ? hoveredIdx : clampedIdx;
  const activePt = trackData.length > 0 ? trackData[showIdx] : null;

  // Map sidebar gives indices into fullTrackData (or trackData when fullTrackData absent)
  const mapData = fullTrackData ?? trackData;
  const chartData = (mapRange && mapData.length >= 2)
    ? mapData.slice(mapRange.fromIdx, Math.min(mapRange.toIdx + 1, mapData.length))
    : trackData;
  const chartLabels = chartData.map(p => p.chainage.toFixed(3));
  const hasData = chartData.length >= 2;
  tdRef.current = chartData;

  // Global index of active point into mapData, then remapped to chartData index
  const mapActiveIdx = chartStartIdx + showIdx;
  const chartShowIdx = mapRange
    ? Math.max(0, Math.min(mapActiveIdx - mapRange.fromIdx, chartData.length - 1))
    : Math.min(showIdx, chartData.length - 1);

  // When map is at full extent, treat as no filter
  const handleMapRange = (range) => {
    const newRange = (!range || (range.fromIdx <= 0 && range.toIdx >= mapData.length - 1))
      ? null : range;
    setMapRange(newRange);
    onMapRangeChangeRef.current?.(newRange);
  };

  const mkTitle = (items) => {
    const p = tdRef.current[items[0]?.dataIndex];
    return p ? `Pt #${p.pointNumber}  Ch: ${p.chainage.toFixed(3)} m` : '';
  };

  const ds = (label, data, color, dash) => ({
    label, data,
    borderColor: color, borderDash: dash,
    borderWidth: dash ? 1.5 : 2,
    pointRadius: 2, pointHoverRadius: 8,
    pointHoverBorderWidth: 3,
    fill: false, tension: 0.2,
  });

  // Shared rcVertLine options for every chart
  const vertLine = {
    enabled: true,
    activeIndex: chartShowIdx,
    label: activePt ? `Pt#${activePt.pointNumber}` : null,
  };

  // ── Easting ────────────────────────────────────────────────────────────────
  useChart('rcEasting', () => {
    if (!hasData) return null;
    const datasets = [
      vis.eastL  && ds('Left E',   chartData.map(p => p.leftEasting),  C_L),
      vis.eastCL && ds('Centre E', chartData.map(p => p.easting),       C_CL, [4, 3]),
      vis.eastR  && ds('Right E',  chartData.map(p => p.rightEasting),  C_R),
    ].filter(Boolean);
    return {
      type: 'line', data: { labels: chartLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: {
          legend: legendBase, rcVertLine: vertLine,            tooltip: { ...ttBase, callbacks: { title: mkTitle,
            label: (i) => `  ● ${i.dataset.label}: ${i.parsed.y.toFixed(4)} m`,
            footer: (items) => {
              const p = tdRef.current[items[0]?.dataIndex];
              if (!p) return [];
              return [`  ⬌ ΔEast L−R: ${((p.leftEasting - p.rightEasting)*1000).toFixed(2)} mm`];
            },
          }},
        },
        scales: { ...scaleBase, y: { ...scaleBase.y, title: { display: true, text: 'Easting (m)', color: '#111827', font: { size: 8 } } } },
      },
    };
  }, [visible, hasData, chartData, chartLabels, vis.eastL, vis.eastCL, vis.eastR], [chartShowIdx]);

  // ── Northing ───────────────────────────────────────────────────────────────
  useChart('rcNorthing', () => {
    if (!hasData) return null;
    const datasets = [
      vis.nortL  && ds('Left N',   chartData.map(p => p.leftNorthing),  C_L),
      vis.nortCL && ds('Centre N', chartData.map(p => p.northing),       C_CL, [4, 3]),
      vis.nortR  && ds('Right N',  chartData.map(p => p.rightNorthing),  C_R),
    ].filter(Boolean);
    return {
      type: 'line', data: { labels: chartLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: {
          legend: legendBase, rcVertLine: vertLine,            tooltip: { ...ttBase, callbacks: { title: mkTitle,
            label: (i) => `  ● ${i.dataset.label}: ${i.parsed.y.toFixed(4)} m`,
            footer: (items) => {
              const p = tdRef.current[items[0]?.dataIndex];
              if (!p) return [];
              return [`  ⬌ ΔNort L−R: ${((p.leftNorthing - p.rightNorthing)*1000).toFixed(2)} mm`];
            },
          }},
        },
        scales: { ...scaleBase, y: { ...scaleBase.y, title: { display: true, text: 'Northing (m)', color: '#111827', font: { size: 8 } } } },
      },
    };
  }, [visible, hasData, chartData, chartLabels, vis.nortL, vis.nortCL, vis.nortR], [chartShowIdx]);

  // ── Height ─────────────────────────────────────────────────────────────────
  useChart('rcHeight', () => {
    if (!hasData) return null;
    const datasets = [
      vis.hgtL  && ds('Left H',   chartData.map(p => p.leftHeight),  C_L),
      vis.hgtCL && ds('Centre H', chartData.map(p => p.height),       C_CL, [4, 3]),
      vis.hgtR  && ds('Right H',  chartData.map(p => p.rightHeight),  C_R),
    ].filter(Boolean);
    return {
      type: 'line', data: { labels: chartLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: {
          legend: legendBase, rcVertLine: vertLine,            tooltip: { ...ttBase, callbacks: { title: mkTitle,
            label: (i) => `  ● ${i.dataset.label}: ${i.parsed.y.toFixed(4)} m`,
            footer: (items) => {
              const p = tdRef.current[items[0]?.dataIndex];
              if (!p) return [];
              const cant = p.cant * 1000;
              const sign = cant >= 0 ? '+' : '';
              return [`  ⟐ Cant (L−R): ${sign}${cant.toFixed(2)} mm`];
            },
          }},
        },
        scales: { ...scaleBase, y: { ...scaleBase.y, title: { display: true, text: 'Height (m)', color: '#111827', font: { size: 8 } } } },
      },
    };
  }, [visible, hasData, chartData, chartLabels, vis.hgtL, vis.hgtCL, vis.hgtR], [chartShowIdx]);

  // ── Differences (L−R, mm) ──────────────────────────────────────────────────
  useChart('rcDiff', () => {
    if (!hasData) return null;
    const datasets = [
      vis.diffE && ds('ΔEasting (L−R)',       chartData.map(p => (p.leftEasting  - p.rightEasting)  * 1000), C_DE),
      vis.diffN && ds('ΔNorthing (L−R)',      chartData.map(p => (p.leftNorthing - p.rightNorthing) * 1000), C_DN),
      vis.diffH && ds('ΔHeight / Cant (L−R)', chartData.map(p => p.cant * 1000),                             C_DH),
    ].filter(Boolean);
    return {
      type: 'line', data: { labels: chartLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: {
          legend: legendBase, rcVertLine: vertLine,            tooltip: { ...ttBase, callbacks: { title: mkTitle,
            label: (i) => {
              const s = i.parsed.y >= 0 ? '+' : '';
              return `  ◈ ${i.dataset.label}: ${s}${i.parsed.y.toFixed(2)} mm`;
            },
          }},
        },
        scales: { ...scaleBase, y: { ...scaleBase.y, title: { display: true, text: 'Difference (mm)', color: '#111827', font: { size: 8 } } } },
      },
    };
  }, [visible, hasData, chartData, chartLabels, vis.diffE, vis.diffN, vis.diffH], [chartShowIdx]);

  // ── Minimap state (hidden) ────────────────────────────────────────────────

  // Hide tooltip when leaving compare view
  useEffect(() => {
    if (!visible) hideTooltip();
  }, [visible]);

  if (!visible) return null;

  const ChartCell = ({ title, sub, chips, canvasId }) => (
    <div className="gv-chart-cell">
      <div className="chart-title" style={{ justifyContent: 'space-between', minHeight: 20 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {title} <span className="chart-sub">{sub}</span>
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{chips}</div>
      </div>
      <canvas id={canvasId} />
    </div>
  );

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 15,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Header ── */}
      <div className="rc-header" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px', background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        minHeight: 36,
      }}>
        {/* Title */}
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap',
        }}>
          <span className="material-icons" style={{ fontSize: 15 }}>compare</span>
          <span className="rc-title-full">Rail Comparison</span>
          <span className="rc-title-short">Compare</span>
        </span>

        {/* Map viewport range indicator */}
        {/* Map range — inline (desktop only) */}
        {mapRange && (
          <div className="gv-map-range gv-map-range--inline">
            <span className="material-icons" style={{ fontSize: 12, color: '#f48120' }}>filter_list</span>
            <span>
              Map view: <b style={{ color: '#111827' }}>Pt#{chartData[0]?.pointNumber}</b>
              {' – '}
              <b style={{ color: '#111827' }}>Pt#{chartData[chartData.length - 1]?.pointNumber}</b>
              <span style={{ color: '#374151' }}> ({chartData.length}/{mapData.length} pts)</span>
            </span>
            <button onClick={() => setMapRange(null)} title="Clear map filter" className="gv-map-range-close">
              <span className="material-icons" style={{ fontSize: 12 }}>close</span>
            </button>
          </div>
        )}

        {/* Layout + Charts dropdowns */}
        <div ref={hdrDropRef} className="rc-right" style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
          {/* Layout dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setLayoutOpen(v => !v); setChartOpen(false); }}
              style={{
                padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                borderRadius: 4, border: '1px solid var(--border)',
                background: layoutOpen ? 'rgba(244,129,32,0.12)' : 'var(--bg-card)',
                color: layoutOpen ? 'var(--accent)' : '#111827',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                userSelect: 'none',
              }}
            >
              <span className="material-icons" style={{ fontSize: 13 }}>grid_view</span>
              <span className="rc-dd-arrow" style={{ fontSize: 11 }}>{rowLayout}×{colLayout}</span>
              <span className="material-icons rc-dd-arrow" style={{ fontSize: 14, opacity: 0.7 }}>arrow_drop_down</span>
            </button>
            <div className="rc-dd-menu" style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 3, zIndex: 200,
              background: '#2d2e2f', border: '1px solid rgba(100,116,139,0.3)',
              borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 178,
              opacity: layoutOpen ? 1 : 0,
              transform: layoutOpen ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.95)',
              transformOrigin: 'top center',
              pointerEvents: layoutOpen ? 'auto' : 'none',
              visibility: layoutOpen ? 'visible' : 'hidden',
              transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            }}>
              {[['Rows per view', [1,2], rowLayout, setRowLayout, ['crop_landscape','table_rows']],
                ['Columns per view', [1,2], colLayout, setColLayout, ['view_agenda','view_column']]
              ].map(([label, opts, cur, set, icons], gi) => (
                <div key={label}>
                  <div style={{ padding: '6px 10px 3px', fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', fontFamily: 'inherit' }}>{label}</div>
                  <div style={{ display: 'flex', gap: 4, padding: '2px 10px 6px' }}>
                    {opts.map((o, i) => (
                      <button key={o} onClick={(e) => { e.stopPropagation(); set(o); }}
                        style={{
                          flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 600,
                          border: `1px solid ${cur === o ? 'var(--accent)' : 'rgba(148,163,184,0.2)'}`,
                          borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                          background: cur === o ? 'rgba(244,129,32,0.15)' : 'rgba(148,163,184,0.06)',
                          color: cur === o ? 'var(--accent)' : '#e2e8f0',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                          outline: 'none',
                        }}
                        onMouseEnter={e => { if (cur !== o) { e.currentTarget.style.background = 'rgba(148,163,184,0.12)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'; } }}
                        onMouseLeave={e => { if (cur !== o) { e.currentTarget.style.background = 'rgba(148,163,184,0.06)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'; } }}
                      >
                        <span className="material-icons" style={{ fontSize: 12, color: cur === o ? 'var(--accent)' : '#94a3b8', transition: 'color 0.15s cubic-bezier(0.4,0,0.2,1)' }}>{icons[i]}</span>
                        {o} {label.startsWith('Row') ? 'row' : 'col'}
                      </button>
                    ))}
                  </div>
                  {gi === 0 && <div style={{ borderTop: '1px solid rgba(148,163,184,0.15)' }} />}
                </div>
              ))}
            </div>
          </div>

          {/* Charts dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setChartOpen(v => !v); setLayoutOpen(false); }}
              style={{
                padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                borderRadius: 4, border: '1px solid var(--border)',
                background: chartOpen ? 'rgba(244,129,32,0.12)' : 'var(--bg-card)',
                color: chartOpen ? 'var(--accent)' : '#111827',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                userSelect: 'none',
              }}
            >
              <span className="material-icons" style={{ fontSize: 13 }}>bar_chart</span>
              <span className="rc-dd-arrow" style={{ fontSize: 11 }}>Charts ({RC_CHARTS.filter(c => chartSel[c.id]).length})</span>
              <span className="material-icons rc-dd-arrow" style={{ fontSize: 14, opacity: 0.7 }}>arrow_drop_down</span>
            </button>
            <div className="rc-dd-menu" style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 3, zIndex: 200,
              background: '#2d2e2f', border: '1px solid rgba(100,116,139,0.3)',
              borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 160,
              opacity: chartOpen ? 1 : 0,
              transform: chartOpen ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.95)',
              transformOrigin: 'top center',
              pointerEvents: chartOpen ? 'auto' : 'none',
              visibility: chartOpen ? 'visible' : 'hidden',
              transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            }}>
              {RC_CHARTS.map(def => {
                const on = chartSel[def.id];
                return (
                  <button key={def.id} onClick={() => setChartSel(p => ({ ...p, [def.id]: !p[def.id] }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                      padding: '5px 10px', border: 'none',
                      background: on ? 'rgba(244,129,32,0.05)' : 'transparent',
                      color: on ? '#e2e8f0' : '#94a3b8',
                      cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', textAlign: 'left',
                      transition: 'all 0.12s ease',
                      outline: 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,129,32,0.08)'; e.currentTarget.style.color = '#e2e8f0'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = on ? 'rgba(244,129,32,0.05)' : 'transparent'; e.currentTarget.style.color = on ? '#e2e8f0' : '#94a3b8'; }}
                  >
                    <span className="material-icons" style={{ fontSize: 13, color: def.dotColor, transition: 'all 0.12s ease' }}>{on ? 'check_box' : 'check_box_outline_blank'}</span>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: def.dotColor, opacity: on ? 1 : 0.3, flexShrink: 0, transition: 'opacity 0.15s ease' }} />
                    {def.title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          className={`btn btn-sm${showMapSidebar ? ' active' : ''}`}
          onClick={() => setShowMapSidebar(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: showMapSidebar ? 'rgba(244,129,32,0.12)' : undefined,
            borderColor: showMapSidebar ? 'rgba(244,129,32,0.4)' : undefined,
            color: showMapSidebar ? 'var(--accent)' : '#111827',
          }}
          title="Toggle track map"
        >
          <span className="material-icons" style={{ fontSize: 13 }}>map</span>
          <span className="rc-dd-arrow" style={{ fontSize: 11 }}>Map</span>
        </button>

        <button
          className="btn btn-sm"
          onClick={onClose}
          title="Close (Esc)"
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#111827' }}
        >
          <span className="material-icons" style={{ fontSize: 13 }}>close</span>
          <span className="rc-dd-arrow" style={{ fontSize: 11 }}>Close</span>
        </button>

        {/* Map range — second row on mobile */}
        {mapRange && (
          <div className="gv-map-range gv-map-range--row2">
            <span className="material-icons" style={{ fontSize: 12, color: '#f48120' }}>filter_list</span>
            <span style={{ flex: 1 }}>
              Map: <b>Pt#{chartData[0]?.pointNumber}</b>–<b>Pt#{chartData[chartData.length - 1]?.pointNumber}</b>
              <span style={{ color: '#374151', marginLeft: 4 }}>({chartData.length} pts)</span>
            </span>
            <button onClick={() => setMapRange(null)} title="Clear map filter" className="gv-map-range-close">
              <span className="material-icons" style={{ fontSize: 12 }}>close</span>
            </button>
          </div>
        )}
      </div>

      {/* Active point info bar */}
      {activePt && (
        <div className="gv-pt-info">
          <span className="gv-pt-badge">
            <span className="material-icons" style={{ fontSize: 11 }}>pin_drop</span>
            Pt #{activePt.pointNumber}
          </span>
          <span className="gv-pt-stat">
            Ch: <b>{activePt.chainage.toFixed(3)}</b> m
          </span>
          <span className="gv-pt-stat">
            Gauge: <b>{activePt.gauge.toFixed(4)}</b> m
          </span>
          <span className="gv-pt-stat">
            Cant: <b>{(activePt.cant * 1000).toFixed(2)}</b> mm
          </span>
          <span style={{
            padding: '0 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
            background: activePt.type === 'arc' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
            color: activePt.type === 'arc' ? '#f59e0b' : '#10b981',
            border: `1px solid ${activePt.type === 'arc' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'}`,
          }}>
            {activePt.type.toUpperCase()}
            {activePt.radius > 0 && activePt.radius < 99999 ? ` R${activePt.radius.toFixed(0)}m` : ''}
          </span>
        </div>
      )}

      {/* ── Charts + Map sidebar ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Dynamic chart grid */}
        {(() => {
          const allCells = [
            chartSel['rcEasting'] && (
              <ChartCell key="rcEasting"
                title="Easting" sub="m along chainage" canvasId="rcEasting"
                chips={<>
                  <Chip active={vis.eastL}  color={C_L}  label="Left"  onToggle={() => tog('eastL')} />
                  <Chip active={vis.eastCL} color={C_CL} label="CL"    onToggle={() => tog('eastCL')} />
                  <Chip active={vis.eastR}  color={C_R}  label="Right" onToggle={() => tog('eastR')} />
                </>}
              />
            ),
            chartSel['rcNorthing'] && (
              <ChartCell key="rcNorthing"
                title="Northing" sub="m along chainage" canvasId="rcNorthing"
                chips={<>
                  <Chip active={vis.nortL}  color={C_L}  label="Left"  onToggle={() => tog('nortL')} />
                  <Chip active={vis.nortCL} color={C_CL} label="CL"    onToggle={() => tog('nortCL')} />
                  <Chip active={vis.nortR}  color={C_R}  label="Right" onToggle={() => tog('nortR')} />
                </>}
              />
            ),
            chartSel['rcHeight'] && (
              <ChartCell key="rcHeight"
                title="Height" sub="m absolute" canvasId="rcHeight"
                chips={<>
                  <Chip active={vis.hgtL}  color={C_L}  label="Left"  onToggle={() => tog('hgtL')} />
                  <Chip active={vis.hgtCL} color={C_CL} label="CL"    onToggle={() => tog('hgtCL')} />
                  <Chip active={vis.hgtR}  color={C_R}  label="Right" onToggle={() => tog('hgtR')} />
                </>}
              />
            ),
            chartSel['rcDiff'] && (
              <ChartCell key="rcDiff"
                title="Rail Differences (L − R)" sub="mm" canvasId="rcDiff"
                chips={<>
                  <Chip active={vis.diffE} color={C_DE} label="ΔEasting"  onToggle={() => tog('diffE')} />
                  <Chip active={vis.diffN} color={C_DN} label="ΔNorthing" onToggle={() => tog('diffN')} />
                  <Chip active={vis.diffH} color={C_DH} label="ΔHeight"   onToggle={() => tog('diffH')} />
                </>}
              />
            ),
          ].filter(Boolean);
          return (
            <div ref={rcGridRef} style={{
              flex: 1, display: 'grid', gap: 0, minHeight: 0, overflowY: 'auto',
              gridTemplateColumns: `repeat(${colLayout}, 1fr)`,
              gridAutoRows: `calc(100% / ${rowLayout})`,
              willChange: 'grid-template-columns, grid-auto-rows',
            }}>
              {allCells}
            </div>
          );
        })()}

      </div>

      {/* Map — draggable popup (desktop + mobile) */}
      {showMapSidebar && (
        <div
          ref={mapPopupRef}
          className="gv-map-overlay-mobile"
          style={{
            ...(mapPopupSize ? { width: mapPopupSize.width, height: mapPopupSize.height } : {}),
            ...(mapPopupPos ? { top: mapPopupPos.y, left: mapPopupPos.x, transform: 'none', bottom: 'unset', right: 'unset' } : {}),
          }}
        >
          <div
            className="gv-map-overlay-header"
            onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); startMapPopupDrag(e.clientX, e.clientY); } }}
            onTouchStart={(e) => { e.preventDefault(); startMapPopupDrag(e.touches[0].clientX, e.touches[0].clientY); }}
          >
            <span className="material-icons" style={{ fontSize: 13, color: 'rgba(148,163,184,0.4)' }}>drag_indicator</span>
            <span className="material-icons" style={{ fontSize: 14, color: 'var(--brand)' }}>route</span>
            <span style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>Track Map</span>
            <button
              className="gv-map-overlay-close"
              onClick={() => { setShowMapSidebar(false); setMapRange(null); setMapPopupPos(null); }}
              title="Close map"
            >
              <span className="material-icons" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <TrackMap2D
              trackData={mapData}
              onVisibleRangeChange={handleMapRange}
              activeIdx={mapActiveIdx}
              scrollToRange={scrollToRange}
              showSegDist={showSegDist}
              showCumDist={showCumDist}
              resetKey={resetMapKey}
            />
            {/* Corner resize handle */}
            <div
              className="gv-map-resize-corner"
              onMouseDown={startMapResize}
              onTouchStart={startMapResize}
              title="Drag to resize"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 9L9 1M4 9L9 4M7 9L9 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <div className="gv-map-overlay-legend">
            {[['#3b82f6','L Rail'],['#10b981','CL'],['#ef4444','R Rail']].map(([c,l]) => (
              <span key={l}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:c, display:'inline-block', flexShrink:0 }}/>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
