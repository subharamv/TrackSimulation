import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { getBounds } from '../utils/geometry';
import TrackMap2D from './TrackMap2D';
import { tooltipConfig, hideTooltip } from '../utils/tooltip';
import {
  Chart,
  LineController,
  BarController,
  ScatterController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

Chart.register(
  LineController, BarController, ScatterController, LineElement, BarElement,
  PointElement, LinearScale, CategoryScale, Title, Tooltip, Legend, Filler
);

// ── Base tooltip style ──────────────────────────────────────────────────────
// Uses shared external HTML tooltip with Material Icons, drag-to-resize, and smart positioning.
const tooltipBase = { ...tooltipConfig };

const scaleBase = {
  x: { grid: { color: 'rgba(0,0,0,0.1)' }, ticks: { color: '#111827', font: { size: 9 } } },
  y: { grid: { color: 'rgba(0,0,0,0.1)' }, ticks: { color: '#111827', font: { size: 9 } } },
};

// ── Hook: create once, update in-place; only destroy on unmount or no-data ──
function useChart(canvasId, makeConfig, deps, indexDeps) {
  const chartRef = useRef(null);
  const makeConfigRef = useRef(makeConfig);
  makeConfigRef.current = makeConfig;

  useEffect(() => {
    const canvas = document.getElementById(canvasId);
    const cfg = makeConfig();

    if (!canvas || !cfg) {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      return;
    }

    if (chartRef.current) {
      // Recreate if chart type changed or canvas was detached from DOM (view toggle)
      const needsRecreate = (cfg.type && cfg.type !== chartRef.current.config.type)
        || !document.body.contains(chartRef.current.canvas);
      if (needsRecreate) {
        chartRef.current.destroy();
        chartRef.current = new Chart(canvas, cfg);
      } else {
        chartRef.current.data = cfg.data;
        // Patch options that need refreshing (tooltip callbacks, y-axis titles, scales)
        try {
          const to = chartRef.current.options.plugins.tooltip;
          const newTo = cfg.options?.plugins?.tooltip ?? {};
          Object.assign(to, newTo);
          if (cfg.options?.scales?.y?.min !== undefined) chartRef.current.options.scales.y.min = cfg.options.scales.y.min;
          if (cfg.options?.scales?.y?.max !== undefined) chartRef.current.options.scales.y.max = cfg.options.scales.y.max;
        } catch (_) { /* ignore */ }
        chartRef.current.update('none');
      }
    } else {
      chartRef.current = new Chart(canvas, cfg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Lightweight effect — only patches plugin options (e.g. vertical indicator line) without rebuilding data
  useEffect(() => {
    if (!chartRef.current) return;
    const cfg = makeConfigRef.current();
    if (!cfg?.options?.plugins) return;
    const pluginSrc = cfg.options.plugins;
    const pluginTarget = chartRef.current.options.plugins;
    if (!pluginTarget) return;
    Object.keys(pluginSrc).forEach(key => {
      try { Object.assign(pluginTarget[key] ??= {}, pluginSrc[key]); } catch (_) {}
    });
    chartRef.current.update('none');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, indexDeps ?? []);

  // Destroy only on unmount
  useEffect(() => () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
  }, []);
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

// ── Component ───────────────────────────────────────────────────────────────
export default function GraphView({
  graphViewActive,
  toggleGraphView,
  trackData: rawTrackData,
  fullTrackData,
  visibleRange,
  railVisibility,
  onRailCheckboxChange,
  designGauge = 4.85,
  gaugeType,
  chartCount,
  onChartCountChange,
  chartSelections,
  onToggleChart,
  onMapRangeChange,
  activeIndex = -1,
  chartStartIdx = 0,
  scrollToRange = null,
  showSegDist = true,
  showCumDist = true,
  resetMapKey = 0,
  mapToggleKey = 0,
}) {
  const onMapRangeChangeRef = useRef(onMapRangeChange);
  onMapRangeChangeRef.current = onMapRangeChange;

  // ── Sidebar map range → slice fullTrackData for charts ──────────────────
  const [sidebarRange, setSidebarRange] = useState(null);
  // Shadow the prop so all chart code below uses the active (possibly filtered) data
  // eslint-disable-next-line no-shadow
  const trackData = (sidebarRange && fullTrackData?.length >= 2)
    ? fullTrackData.slice(sidebarRange.fromIdx, sidebarRange.toIdx + 1)
    : rawTrackData;

  const hasData = trackData.length >= 2;
  const labels = trackData.map(p => p.chainage.toFixed(3));

  // Always-current ref so chart callbacks never close over stale data
  const tdRef = useRef(trackData);
  tdRef.current = trackData;

  // Vertical indicator line index — mapped from global activeIndex into the current trackData slice
  const chartOffset = sidebarRange ? sidebarRange.fromIdx : chartStartIdx;
  const chartActiveIdx = (activeIndex >= 0 && trackData.length > 0)
    ? Math.max(0, Math.min(activeIndex - chartOffset, trackData.length - 1))
    : -1;
  const activePt = chartActiveIdx >= 0 ? (trackData[chartActiveIdx] ?? null) : null;
  const vertLine = {
    enabled: chartActiveIdx >= 0,
    activeIndex: chartActiveIdx,
    label: activePt ? `Pt#${activePt.pointNumber}` : null,
  };

  // ── Shared title callback (Point # + Chainage) ──────────────────────────
  const makeTitle = (items) => {
    const idx = items[0]?.dataIndex ?? 0;
    const p = tdRef.current[idx];
    if (!p) return `Ch: ${items[0]?.label ?? '?'} m`;
    const typeTag = p.type === 'arc' ? `Arc R=${p.radius > 0 ? p.radius.toFixed(0) : '∞'}m` : 'Straight';
    return `Pt #${p.pointNumber}  •  Ch: ${p.chainage.toFixed(3)} m  •  ${typeTag}`;
  };

  // ── Gauge chart ─────────────────────────────────────────────────────────
  useChart('gvGaugeChart', () => {
    if (!hasData) return null;
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Gauge',
            data: trackData.map(p => p.gauge),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.1)',
            fill: true, tension: 0.3,
            pointRadius: 3.5, pointHoverRadius: 9,
            pointHoverBorderWidth: 3,
            pointBackgroundColor: trackData.map(p =>
              p.gaugeStatus === 'fail' ? '#ef4444'
                : p.gaugeStatus === 'warn' ? '#f97316'
                  : '#10b981'
            ),
            borderWidth: 2,
          },
          {
            label: 'Design',
            data: trackData.map(() => designGauge),
            borderColor: 'rgba(239,68,68,0.55)', borderDash: [5, 3],
            borderWidth: 1.5, pointRadius: 0, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            callbacks: {
              title: makeTitle,
              label: (item) => {
                const p = tdRef.current[item.dataIndex];
                if (item.datasetIndex === 1) return `  ─ Design: ${item.parsed.y.toFixed(4)} m`;
                if (!p) return `  Gauge: ${item.parsed.y.toFixed(4)} m`;
                const sign = p.gaugeDiff >= 0 ? '+' : '';
                const status = p.gaugeStatus === 'fail' ? '✗ FAIL' : p.gaugeStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                return [
                  `  ◉ Gauge:        ${p.gauge.toFixed(4)} m`,
                  `  ⬌ Deviation:    ${sign}${(p.gaugeDiff * 1000).toFixed(2)} mm  ${status}`,
                ];
              },
              footer: (items) => {
                const p = tdRef.current[items[0]?.dataIndex];
                if (!p) return [];
                const cant = p.cant * 1000;
                const sign = cant >= 0 ? '+' : '';
                const dir = cant > 0.05 ? '(L high)' : cant < -0.05 ? '(R high)' : '(level)';
                return [`  ⟐ Cant: ${sign}${cant.toFixed(2)} mm ${dir}`];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: { ...scaleBase.y, title: { display: true, text: 'Gauge (m)', color: '#111827', font: { size: 9 } } },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, designGauge, sidebarRange], [chartActiveIdx]);

  // ── Cant chart ──────────────────────────────────────────────────────────
  useChart('gvCantChart', () => {
    if (!hasData) return null;
    const cantMM = trackData.map(p => p.cant * 1000);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Cant',
            data: cantMM,
            backgroundColor: cantMM.map(v => v >= 0 ? 'rgba(124,58,237,0.75)' : 'rgba(100,116,139,0.35)'),
            borderColor: '#7c3aed', borderWidth: 1, borderRadius: 2,
          },
          {
            label: '_zero',
            data: cantMM.map(() => 0),
            borderColor: 'rgba(239,68,68,0.2)', borderDash: [2, 2],
            borderWidth: 1, pointRadius: 0, fill: false, type: 'line',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: makeTitle,
              label: (item) => {
                if (item.datasetIndex !== 0) return null;
                const p = tdRef.current[item.dataIndex];
                if (!p) return null;
                const cant = p.cant * 1000;
                const sign = cant >= 0 ? '+' : '';
                const dir = cant > 0.05 ? '(L high)' : cant < -0.05 ? '(R high)' : '(level)';
                const status = p.cantStatus === 'fail' ? '✗ FAIL' : p.cantStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                return [
                  `  ◈ Cant:     ${sign}${cant.toFixed(2)} mm ${dir}`,
                  `  Status:     ${status}`,
                ];
              },
              footer: (items) => {
                const p = tdRef.current[items[0]?.dataIndex];
                if (!p) return [];
                return [`  ◉ Gauge:    ${p.gauge.toFixed(4)} m`];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: { ...scaleBase.y, title: { display: true, text: 'Cant (mm)', color: '#111827', font: { size: 9 } } },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, sidebarRange], [chartActiveIdx]);

  // ── L/R Height chart ────────────────────────────────────────────────────
  useChart('gvHeightChart', () => {
    if (!hasData) return null;
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Left H',
            data: trackData.map(p => p.leftHeight),
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)',
            fill: false, tension: 0.3, pointRadius: 2.5, pointHoverRadius: 8,
            pointHoverBorderWidth: 3,
            pointBackgroundColor: '#3b82f6', borderWidth: 2,
          },
          {
            label: 'Right H',
            data: trackData.map(p => p.rightHeight),
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)',
            fill: false, tension: 0.3, pointRadius: 2.5, pointHoverRadius: 8,
            pointHoverBorderWidth: 3,
            pointBackgroundColor: '#ef4444', borderWidth: 2,
          },
          {
            label: 'CL H',
            data: trackData.map(p => p.height),
            borderColor: '#10b981', borderDash: [4, 4],
            borderWidth: 1, pointRadius: 0, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#111827', font: { size: 8 }, usePointStyle: true, boxWidth: 6, padding: 4 },
          },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            mode: 'index',
            callbacks: {
              title: makeTitle,
              label: (item) => {
                const colors = ['#3b82f6', '#ef4444', '#10b981'];
                const names = ['Left Rail', 'Right Rail', 'Centre Line'];
                const col = colors[item.datasetIndex] || '#94a3b8';
                return `  ● ${names[item.datasetIndex]}: ${item.parsed.y.toFixed(4)} m`;
              },
              footer: (items) => {
                const p = tdRef.current[items[0]?.dataIndex];
                if (!p) return [];
                const cant = p.cant * 1000;
                const sign = cant >= 0 ? '+' : '';
                const dir = cant > 0.05 ? '(L high)' : cant < -0.05 ? '(R high)' : '(level)';
                return [
                  `  ⟐ Cant:   ${sign}${cant.toFixed(2)} mm ${dir}`,
                  `  ◉ Gauge:  ${p.gauge.toFixed(4)} m`,
                ];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: { ...scaleBase.y, title: { display: true, text: 'Height (m)', color: '#111827', font: { size: 9 } } },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, sidebarRange], [chartActiveIdx]);

  // ── Cant Deviation chart ────────────────────────────────────────────────
  useChart('gvCantDiffChart', () => {
    if (!hasData) return null;
    const cantDiffMM = trackData.map(p => (p.cantDiff ?? p.cant) * 1000);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Cant Dev',
            data: cantDiffMM,
            backgroundColor: trackData.map(p =>
              p.cantStatus === 'fail' ? 'rgba(239,68,68,0.75)'
                : p.cantStatus === 'warn' ? 'rgba(249,115,22,0.70)'
                  : 'rgba(167,139,250,0.65)'
            ),
            borderColor: trackData.map(p =>
              p.cantStatus === 'fail' ? '#ef4444'
                : p.cantStatus === 'warn' ? '#f97316'
                  : '#a78bfa'
            ),
            borderWidth: 1, borderRadius: 2,
          },
          {
            label: '_zero',
            data: cantDiffMM.map(() => 0),
            borderColor: 'rgba(255,255,255,0.12)', borderDash: [2, 2],
            borderWidth: 1, pointRadius: 0, fill: false, type: 'line',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: makeTitle,
              label: (item) => {
                if (item.datasetIndex !== 0) return null;
                const p = tdRef.current[item.dataIndex];
                if (!p) return null;
                const v = item.parsed.y;
                const sign = v >= 0 ? '+' : '';
                const status = p.cantStatus === 'fail' ? '✗ FAIL'
                  : p.cantStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                return [
                  `  ◈ Cant Dev:  ${sign}${v.toFixed(2)} mm  ${status}`,
                  `  ⟐ Cant:     ${(p.cant * 1000).toFixed(2)} mm`,
                ];
              },
              footer: (items) => {
                const p = tdRef.current[items[0]?.dataIndex];
                if (!p) return [];
                return [`  ◉ Gauge:     ${p.gauge.toFixed(4)} m`];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: { ...scaleBase.y, title: { display: true, text: 'Cant Dev (mm)', color: '#111827', font: { size: 9 } } },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, sidebarRange], [chartActiveIdx]);

  // ── Quality Analysis chart ──────────────────────────────────────────────
  // Shows gauge dev + cant normalised as % of their respective tolerances.
  // 0% = perfect, 100% = at tolerance limit, 200% = double tolerance.
  useChart('gvAnalysisChart', () => {
    if (!hasData) return null;
    const tolMM = gaugeType?.toleranceMM ?? 3;
    const cantMaxMM = gaugeType?.maxCantMM ?? 150;

    // Absolute deviation as % of tolerance
    const gaugePct = trackData.map(p => Math.abs((p.gaugeDiff ?? 0) * 1000) / tolMM * 100);
    const cantPct = trackData.map(p => Math.abs(p.cant * 1000) / cantMaxMM * 100);

    // 5-point moving average of gauge %
    const movAvg = gaugePct.map((_, i) => {
      const win = gaugePct.slice(Math.max(0, i - 2), Math.min(gaugePct.length, i + 3));
      return win.reduce((a, b) => a + b, 0) / win.length;
    });

    const gaugeBarColors = trackData.map(p =>
      p.gaugeStatus === 'fail' ? 'rgba(239,68,68,0.70)'
        : p.gaugeStatus === 'warn' ? 'rgba(249,115,22,0.65)'
          : 'rgba(16,185,129,0.55)'
    );

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `Gauge Dev %  (tol ${tolMM} mm)`,
            data: gaugePct,
            backgroundColor: gaugeBarColors,
            borderColor: gaugeBarColors.map(c => c.replace('0.70', '1').replace('0.65', '1').replace('0.55', '1')),
            borderWidth: 1, borderRadius: 2, order: 3,
          },
          {
            label: `Cant %  (max ${cantMaxMM} mm)`,
            data: cantPct,
            type: 'line',
            borderColor: '#a78bfa',
            backgroundColor: 'rgba(167,139,250,0.08)',
            fill: false, tension: 0.35,
            pointRadius: 2.5, pointHoverRadius: 8,
            pointHoverBorderWidth: 3,
            borderWidth: 1.8, order: 2,
          },
          {
            label: '5-pt Avg (Gauge)',
            data: movAvg,
            type: 'line',
            borderColor: '#f48120',
            backgroundColor: 'transparent',
            fill: false, tension: 0.4,
            pointRadius: 0, borderWidth: 2,
            borderDash: [4, 3], order: 1,
          },
          // Tolerance reference lines
          {
            label: '100% (at limit)',
            data: labels.map(() => 100),
            type: 'line',
            borderColor: 'rgba(239,68,68,0.45)',
            borderDash: [5, 3], borderWidth: 1.5,
            pointRadius: 0, fill: false, order: 0,
          },
          {
            label: '50% (caution)',
            data: labels.map(() => 50),
            type: 'line',
            borderColor: 'rgba(249,115,22,0.30)',
            borderDash: [3, 3], borderWidth: 1,
            pointRadius: 0, fill: false, order: 0,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#111827', font: { size: 8 }, usePointStyle: true, boxWidth: 8, padding: 6 },
          },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            filter: (item) => item.datasetIndex <= 1,
            callbacks: {
              title: makeTitle,
              label: (item) => {
                const p = tdRef.current[item.dataIndex];
                if (!p) return null;
                if (item.datasetIndex === 0) {
                  const diffMM = Math.abs((p.gaugeDiff ?? 0) * 1000);
                  const status = p.gaugeStatus === 'fail' ? '✗ FAIL'
                    : p.gaugeStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                  return [
                    `  ◉ Gauge Dev:   ${diffMM.toFixed(3)} mm`,
                    `  ▸ ${item.parsed.y.toFixed(1)}% of ${tolMM}mm tol  ${status}`,
                  ];
                }
                if (item.datasetIndex === 1) {
                  return [
                    `  ⟐ Cant:       ${(p.cant * 1000).toFixed(2)} mm`,
                    `  ▸ ${item.parsed.y.toFixed(1)}% of ${cantMaxMM}mm max`,
                  ];
                }
                return null;
              },
              footer: (items) => {
                const p = tdRef.current[items[0]?.dataIndex];
                if (!p) return [];
                const gSt = p.gaugeStatus === 'fail' ? '✗' : p.gaugeStatus === 'warn' ? '⚠' : '✓';
                const cSt = p.cantStatus === 'fail' ? '✗' : p.cantStatus === 'warn' ? '⚠' : '✓';
                return [`  Gauge ${gSt}    Cant ${cSt}`];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: {
            ...scaleBase.y,
            min: 0,
            title: { display: true, text: '% of Tolerance / Max', color: '#111827', font: { size: 9 } },
          },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, gaugeType, sidebarRange], [chartActiveIdx]);

  // ── Column layout (1 or 2 columns) ──────────────────────────────────────
  const [rowLayout, setRowLayout] = useState(1);
  const [colLayout, setColLayout] = useState(1);
  const chartsGridRef = useRef(null);

  // Stagger entrance animation when layout rows/cols change
  useEffect(() => {
    const grid = chartsGridRef.current;
    if (!grid) return;
    const cells = grid.querySelectorAll('.gv-chart-cell');
    if (!cells.length) return;
    gsap.fromTo(cells,
      { opacity: 0.3, scale: 0.97 },
      { opacity: 1, scale: 1, duration: 0.25, stagger: 0.04, ease: 'power2.out', force3D: true }
    );
  }, [rowLayout, colLayout]);

  // ── Dropdown state for header controls ──────────────────────────────────
  const [viewModeOpen, setViewModeOpen] = useState(false);
  const [chartSelectOpen, setChartSelectOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!viewModeOpen && !chartSelectOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setViewModeOpen(false);
        setChartSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [viewModeOpen, chartSelectOpen]);

  // ── Map popup drag + resize ─────────────────────────────────────────────
  const [mapPopupPos, setMapPopupPos] = useState(null); // null = default top-right position
  const [mapPopupSize, setMapPopupSize] = useState(() => {
    try {
      const saved = localStorage.getItem('railsim_mapPopupSize');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  }); // null = use CSS defaults
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

  // ── Map sidebar state ────────────────────────────────────────────────────
  const [showMapSidebar, setShowMapSidebar] = useState(false);
  // Toggle map when keyboard shortcut fires (mapToggleKey increments)
  useEffect(() => {
    if (mapToggleKey > 0) setShowMapSidebar(v => !v);
  }, [mapToggleKey]);

  // ── Gauge vs Elevation chart (scatter or line, with status filters) ───
  const [gvseChartType, setGvseChartType] = useState('scatter');
  const [gvseFilters, setGvseFilters] = useState({ ok: true, warn: true, fail: true });

  const gvseStatusColors = {
    ok: { bg: 'rgba(16,185,129,0.55)', border: '#10b981' },
    warn: { bg: 'rgba(249,115,22,0.6)', border: '#f97316' },
    fail: { bg: 'rgba(239,68,68,0.6)', border: '#ef4444' },
  };
  const gvseFillColors = {
    ok: 'rgba(16,185,129,0.08)',
    warn: 'rgba(249,115,22,0.06)',
    fail: 'rgba(239,68,68,0.08)',
  };

  useChart('gvGaugeVsElevChart', () => {
    if (!hasData) return null;

    const isLine = gvseChartType === 'line';
    const statuses = ['ok', 'warn', 'fail'];

    // Build datasets for each visible status
    const datasets = [];
    statuses.forEach(status => {
      if (!gvseFilters[status]) return;
      const pts = trackData
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.gaugeStatus === status);
      if (pts.length === 0) return;

      const color = gvseStatusColors[status];
      datasets.push({
        label: status === 'ok' ? '✓ OK' : status === 'warn' ? '⚠ WARN' : '✗ FAIL',
        data: pts.map(({ p }) => ({ x: p.gauge, y: p.height })),
        backgroundColor: isLine ? gvseFillColors[status] : color.bg,
        borderColor: color.border,
        fill: isLine,
        tension: isLine ? 0.25 : undefined,
        showLine: isLine,
        pointRadius: isLine ? 3 : 4.5,
        pointHoverRadius: 9,
        pointHoverBorderWidth: 3,
        pointBackgroundColor: color.bg,
        pointBorderColor: color.border,
        borderWidth: isLine ? 1.5 : 1,
        order: status === 'fail' ? 1 : status === 'warn' ? 2 : 3,
      });
    });

    // Design gauge reference line
    const elevRange = trackData.length > 0
      ? { min: Math.min(...trackData.map(p => p.height)), max: Math.max(...trackData.map(p => p.height)) }
      : { min: 0, max: 1 };
    const elevPad = (elevRange.max - elevRange.min) * 0.15 || 0.1;
    datasets.push({
      label: 'Design Gauge',
      data: [
        { x: designGauge, y: elevRange.min - elevPad },
        { x: designGauge, y: elevRange.max + elevPad },
      ],
      borderColor: '#f48120',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      showLine: true,
      order: 99,
    });

    return {
      type: isLine ? 'line' : 'scatter',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: datasets.length <= 4,
            labels: { color: '#111827', font: { size: 8 }, usePointStyle: true, boxWidth: 8, padding: 4 },
          },
          tooltip: {
            ...tooltipBase,
            mode: 'nearest',
            intersect: true,
            callbacks: {
              title: (items) => {
                const item = items[0];
                if (!item) return '';
                const idx = item.dataIndex;
                const status = item.dataset.label === '✓ OK' ? 'ok'
                  : item.dataset.label === '⚠ WARN' ? 'warn' : 'fail';
                const pts = trackData.filter(p => p.gaugeStatus === status);
                const p = pts[idx];
                if (!p) return `Gauge: ${item.parsed.x.toFixed(4)} m`;
                const typeTag = p.type === 'arc' ? `Arc R=${p.radius > 0 ? p.radius.toFixed(0) : '∞'}m` : 'Straight';
                return `Pt #${p.pointNumber}  •  Ch: ${p.chainage.toFixed(3)} m  •  ${typeTag}`;
              },
              label: (item) => {
                const st = item.dataset.label === '✓ OK' ? 'ok'
                  : item.dataset.label === '⚠ WARN' ? 'warn' : 'fail';
                const pts = trackData.filter(p => p.gaugeStatus === st);
                const p = pts[item.dataIndex];
                if (!p) return '';
                const status = p.gaugeStatus === 'fail' ? '✗ FAIL'
                  : p.gaugeStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                const diff = p.gaugeDiff * 1000;
                const sign = diff >= 0 ? '+' : '';
                return [
                  `  ◉ Gauge:      ${p.gauge.toFixed(4)} m`,
                  `  ⤒ Elevation:  ${p.height.toFixed(4)} m`,
                  `  ⬌ Deviation:  ${sign}${diff.toFixed(2)} mm  ${status}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            ...scaleBase.x,
            title: { display: true, text: 'Gauge (m)', color: '#111827', font: { size: 9 } },
          },
          y: {
            ...scaleBase.y,
            title: { display: true, text: 'Elevation (m)', color: '#111827', font: { size: 9 } },
          },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, designGauge, gvseChartType, gvseFilters, sidebarRange], [chartActiveIdx]);

  // ── Gauge Deviation chart ───────────────────────────────────────────────
  useChart('gvGaugeDiffChart', () => {
    if (!hasData) return null;
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Gauge Dev',
            data: trackData.map(p => p.gaugeDiff * 1000),
            backgroundColor: trackData.map(p =>
              p.gaugeStatus === 'fail' ? 'rgba(239,68,68,0.75)'
                : p.gaugeStatus === 'warn' ? 'rgba(249,115,22,0.7)'
                  : 'rgba(16,185,129,0.6)'
            ),
            borderColor: trackData.map(p =>
              p.gaugeStatus === 'fail' ? '#ef4444'
                : p.gaugeStatus === 'warn' ? '#f97316'
                  : '#10b981'
            ),
            borderWidth: 1, borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          rcVertLine: vertLine,
          tooltip: {
            ...tooltipBase,
            callbacks: {
              title: makeTitle,
              label: (item) => {
                const p = tdRef.current[item.dataIndex];
                if (!p) return `  Deviation: ${item.parsed.y.toFixed(2)} mm`;
                const sign = item.parsed.y >= 0 ? '+' : '';
                const status = p.gaugeStatus === 'fail' ? '✗ FAIL'
                  : p.gaugeStatus === 'warn' ? '⚠ WARN' : '✓ OK';
                return [
                  `  ⬌ Deviation:   ${sign}${item.parsed.y.toFixed(2)} mm  ${status}`,
                  `  ◉ Gauge:       ${p.gauge.toFixed(4)} m`,
                  `  ─ Design:      ${designGauge.toFixed(4)} m`,
                ];
              },
            },
          },
        },
        scales: {
          ...scaleBase,
          y: { ...scaleBase.y, title: { display: true, text: 'Deviation (mm)', color: '#111827', font: { size: 9 } } },
        },
      },
    };
  }, [graphViewActive, hasData, trackData, labels, designGauge, sidebarRange], [chartActiveIdx]);

  // Chart definitions for the carousel
  const chartDefs = [
    {
      id: 'gvGaugeChart',
      title: 'Gauge Profile',
      subtitle: `m — ref ${designGauge.toFixed(3)} m`,
      dotColor: '#f59e0b',
    },
    {
      id: 'gvCantChart',
      title: 'Cant Profile',
      subtitle: 'mm',
      dotColor: '#7c3aed',
    },
    {
      id: 'gvHeightChart',
      title: 'L/R Rail Height',
      subtitle: 'm',
      dotColors: ['#3b82f6', '#ef4444'],
    },
    {
      id: 'gvGaugeDiffChart',
      title: 'Gauge Deviation',
      subtitle: `mm from ${designGauge.toFixed(3)} m`,
      dotColor: '#10b981',
    },
    {
      id: 'gvCantDiffChart',
      title: 'Cant Deviation',
      subtitle: 'mm from design',
      dotColor: '#a78bfa',
    },
    {
      id: 'gvGaugeVsElevChart',
      title: 'Gauge vs Elevation',
      subtitle: gvseChartType === 'line' ? 'line' : 'scatter',
      dotColor: '#f48120',
    },
    {
      id: 'gvAnalysisChart',
      title: 'Quality Analysis',
      subtitle: `% of tolerance`,
      dotColor: '#38bdf8',
    },
  ];

  // Hide tooltip when leaving analytics view
  useEffect(() => {
    if (!graphViewActive) hideTooltip();
  }, [graphViewActive]);

  if (!graphViewActive) return null;

  // Show all selected charts — rows/cols control viewport density, not count
  const visibleDefs = chartSelections
    ? chartDefs.filter(d => chartSelections[d.id])
    : chartDefs;

  const gridStyle = {
    gridTemplateColumns: `repeat(${colLayout}, 1fr)`,
    gridAutoRows: `calc(100% / ${rowLayout})`,
    transition: 'grid-template-columns 0.35s cubic-bezier(0.4,0,0.2,1), grid-auto-rows 0.35s cubic-bezier(0.4,0,0.2,1)',
  };

  const ddBtn = (open) => ({
    padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    borderRadius: 4, border: '1px solid var(--border)',
    background: open ? 'rgba(244,129,32,0.12)' : 'var(--bg-card)',
    color: open ? 'var(--accent)' : '#111827',
    fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
    transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
    userSelect: 'none',
  });
  const ddMenu = (open, width) => ({
    position: 'absolute', top: '100%', left: 0, marginTop: 3, zIndex: 100,
    background: '#2d2e2f', border: '1px solid rgba(100,116,139,0.3)',
    borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    minWidth: width || 140,
    opacity: open ? 1 : 0,
    transform: open ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.95)',
    transformOrigin: 'top center',
    pointerEvents: open ? 'auto' : 'none',
    visibility: open ? 'visible' : 'hidden',
    transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
  });
  const ddItem = (active) => ({
    display: 'flex', alignItems: 'center', gap: 7, width: '100%',
    padding: '5px 10px', border: 'none',
    background: active ? 'rgba(244,129,32,0.05)' : 'transparent',
    color: active ? '#e2e8f0' : '#94a3b8',
    cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', textAlign: 'left',
    transition: 'all 0.12s ease',
    outline: 'none',
  });

  const selectedCount = chartDefs ? chartDefs.filter(d => chartSelections[d.id]).length : 0;

  return (
    <div id="graphViewContainer" className="active">
      <div className="graph-controls" ref={dropdownRef}>
        <span className="graph-title">
          <span className="graph-title-full">Track Profile Charts</span>
          <span className="graph-title-short">Analytics</span>
        </span>

        {/* Layout picker: rows × cols */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button style={ddBtn(viewModeOpen)} onClick={() => { setViewModeOpen(v => !v); setChartSelectOpen(false); }}>
            <span className="material-icons" style={{ fontSize: 12 }}>grid_view</span>
            <span className="gv-dd-arrow" style={{ fontSize: 11 }}>{rowLayout}×{colLayout}</span>
            <span className="material-icons gv-dd-arrow" style={{ fontSize: 14, opacity: 0.6 }}>arrow_drop_down</span>
          </button>
          <div style={ddMenu(viewModeOpen, 178)}>
            {/* Rows */}
            <div style={{ padding: '6px 10px 3px', fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', fontFamily: 'inherit' }}>
              Rows per view
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '2px 10px 6px' }}>
              {[1, 2].map(r => (
                <button
                  key={r}
                  onClick={(e) => { e.stopPropagation(); setRowLayout(r); }}
                  style={{
                    flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 600,
                    border: `1px solid ${rowLayout === r ? 'var(--accent)' : 'rgba(148,163,184,0.2)'}`,
                    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                    background: rowLayout === r ? 'rgba(244,129,32,0.15)' : 'rgba(148,163,184,0.06)',
                    color: rowLayout === r ? 'var(--accent)' : '#e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                    transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                    outline: 'none',
                  }}
                  onMouseEnter={e => { if (rowLayout !== r) { e.currentTarget.style.background = 'rgba(148,163,184,0.12)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'; } }}
                  onMouseLeave={e => { if (rowLayout !== r) { e.currentTarget.style.background = 'rgba(148,163,184,0.06)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'; } }}
                >
                  <span className="material-icons" style={{ fontSize: 12, color: rowLayout === r ? 'var(--accent)' : '#94a3b8', transition: 'color 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                    {r === 1 ? 'crop_landscape' : 'table_rows'}
                  </span>
                  {r} row
                </button>
              ))}
            </div>
            <div style={{ borderTop: '1px solid rgba(148,163,184,0.15)', margin: '0 0 0' }} />
            {/* Columns */}
            <div style={{ padding: '6px 10px 3px', fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', fontFamily: 'inherit' }}>
              Columns per view
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '2px 10px 8px' }}>
              {[1, 2].map(c => (
                <button
                  key={c}
                  onClick={(e) => { e.stopPropagation(); setColLayout(c); }}
                  style={{
                    flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 600,
                    border: `1px solid ${colLayout === c ? 'var(--accent)' : 'rgba(148,163,184,0.2)'}`,
                    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                    background: colLayout === c ? 'rgba(244,129,32,0.15)' : 'rgba(148,163,184,0.06)',
                    color: colLayout === c ? 'var(--accent)' : '#e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                    transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                    outline: 'none',
                  }}
                  onMouseEnter={e => { if (colLayout !== c) { e.currentTarget.style.background = 'rgba(148,163,184,0.12)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'; } }}
                  onMouseLeave={e => { if (colLayout !== c) { e.currentTarget.style.background = 'rgba(148,163,184,0.06)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'; } }}
                >
                  <span className="material-icons" style={{ fontSize: 12, color: colLayout === c ? 'var(--accent)' : '#94a3b8', transition: 'color 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                    {c === 1 ? 'view_agenda' : 'view_column'}
                  </span>
                  {c} col
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart selection dropdown */}
        <div style={{ position: 'relative' }}>
          <button style={ddBtn(chartSelectOpen)} onClick={() => { setChartSelectOpen(v => !v); setViewModeOpen(false); }}>
            <span className="material-icons" style={{ fontSize: 12 }}>bar_chart</span>
            <span className="gv-dd-arrow" style={{ fontSize: 11 }}>Charts ({selectedCount})</span>
            <span className="material-icons gv-dd-arrow" style={{ fontSize: 14, opacity: 0.6 }}>arrow_drop_down</span>
          </button>
          <div style={ddMenu(chartSelectOpen, 160)}>
            {chartDefs.map(def => {
              const checked = chartSelections[def.id];
              return (
                <button
                  key={def.id}
                  onClick={() => { onToggleChart(def.id); }}
                  style={ddItem(checked)}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,129,32,0.08)'; e.currentTarget.style.color = '#e2e8f0'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? 'rgba(244,129,32,0.05)' : 'transparent'; e.currentTarget.style.color = checked ? '#e2e8f0' : '#94a3b8'; }}
                >
                  <span className="material-icons" style={{ fontSize: 13, color: def.dotColor, transition: 'all 0.12s ease' }}>
                    {checked ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: def.dotColor, opacity: checked ? 1 : 0.3, flexShrink: 0,
                    transition: 'opacity 0.15s ease',
                  }} />
                  {def.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Map viewport range indicator — inline (desktop only) */}
        {sidebarRange && (
          <div className="gv-map-range gv-map-range--inline">
            <span className="material-icons" style={{ fontSize: 12, color: '#f48120' }}>filter_list</span>
            <span>
              Map view: <b style={{ color: '#111827' }}>Pt#{trackData[0]?.pointNumber}</b>
              {' – '}
              <b style={{ color: '#111827' }}>Pt#{trackData[trackData.length - 1]?.pointNumber}</b>
              <span style={{ color: '#374151' }}> ({trackData.length}/{fullTrackData?.length ?? trackData.length} pts)</span>
            </span>
            <button onClick={() => setSidebarRange(null)} title="Clear map filter" className="gv-map-range-close">
              <span className="material-icons" style={{ fontSize: 12 }}>close</span>
            </button>
          </div>
        )}

        {/* Map sidebar toggle */}
        <button style={ddBtn(showMapSidebar)} onClick={() => { setShowMapSidebar(v => { if (v) setSidebarRange(null); return !v; }); }} title="Toggle map panel">
          <span className="material-icons" style={{ fontSize: 12 }}>map</span>
          <span className="gv-dd-arrow" style={{ fontSize: 11 }}>Map</span>
        </button>

        <button className="btn btn-sm" onClick={toggleGraphView} title="Close (Esc)" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="material-icons" style={{ fontSize: 13 }}>close</span>
          <span className="gv-dd-arrow" style={{ fontSize: 11 }}>Close</span>
        </button>

        {/* Map range — second row on mobile */}
        {sidebarRange && (
          <div className="gv-map-range gv-map-range--row2">
            <span className="material-icons" style={{ fontSize: 12, color: '#f48120' }}>filter_list</span>
            <span style={{ flex: 1 }}>
              Map: <b>Pt#{trackData[0]?.pointNumber}</b>–<b>Pt#{trackData[trackData.length - 1]?.pointNumber}</b>
              <span style={{ color: '#374151', marginLeft: 4 }}>({trackData.length} pts)</span>
            </span>
            <button onClick={() => setSidebarRange(null)} title="Clear map filter" className="gv-map-range-close">
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

      {/* Charts + Map sidebar */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="gv-charts-grid" ref={chartsGridRef} style={gridStyle}>
          {visibleDefs.map((def, i) => {
            const lastRow = i >= visibleDefs.length - colLayout;
            const lastCol = (i + 1) % colLayout === 0 || i === visibleDefs.length - 1;
            const cellStyle = {
              borderRight: lastCol ? 'none' : '1px solid var(--border)',
              borderBottom: lastRow ? 'none' : '1px solid var(--border)',
              transition: 'border-color 0.25s ease, opacity 0.25s ease',
            };
          return (
            <div key={def.id} className="gv-chart-cell" style={cellStyle}>
              <div className="chart-title">
                {def.dotColors ? (
                  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                    {def.dotColors.map((c, ci) => (
                      <span key={ci} className="chart-dot" style={{ background: c }}></span>
                    ))}
                  </span>
                ) : (
                  <span className="chart-dot" style={{ background: def.dotColor }}></span>
                )}
                {def.title} <span className="chart-sub">{def.subtitle}</span>

                {def.id === 'gvGaugeVsElevChart' && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
                    {/* Chart type toggle */}
                    <button
                      onClick={() => setGvseChartType(t => t === 'scatter' ? 'line' : 'scatter')}
                      title="Toggle scatter / line"
                      style={{
                        padding: '1px 5px', fontSize: 8, borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)', color: 'var(--text-secondary)',
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.12s ease',
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(244,129,32,0.4)'; e.currentTarget.style.color = 'var(--brand)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      {gvseChartType === 'scatter' ? '◉ Scatter' : '━ Line'}
                    </button>
                    {/* Status filter pills */}
                    {['ok', 'warn', 'fail'].map(st => {
                      const active = gvseFilters[st];
                      const c = gvseStatusColors[st];
                      return (
                        <button
                          key={st}
                          onClick={() => setGvseFilters(f => ({ ...f, [st]: !f[st] }))}
                          title={`${active ? 'Hide' : 'Show'} ${st.toUpperCase()} points`}
                          style={{
                            padding: '1px 4px', fontSize: 7, borderRadius: 3,
                            border: `1px solid ${active ? c.border : 'rgba(148,163,184,0.25)'}`,
                            background: active ? c.bg : 'transparent',
                            color: active ? c.border : '#94a3b8',
                            cursor: 'pointer', fontFamily: 'inherit',
                            fontWeight: active ? 600 : 400,
                            transition: 'all 0.12s ease',
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(148,163,184,0.1)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                          onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; } }}
                        >
                          {st === 'ok' ? '✓' : st === 'warn' ? '⚠' : '✗'}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
              <canvas id={def.id}></canvas>
            </div>
          );
        })}
        </div>

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
          {/* Drag handle header */}
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
              onClick={() => { setShowMapSidebar(false); setSidebarRange(null); setMapPopupPos(null); }}
              title="Close map"
            >
              <span className="material-icons" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <TrackMap2D
              trackData={fullTrackData}
              onVisibleRangeChange={(range) => {
                setSidebarRange(range);
                onMapRangeChangeRef.current?.(range);
              }}
              activeIdx={activeIndex}
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
