// ── Shared external HTML tooltip for Chart.js ──────────────────────────────
// Renders a Material Icons–rich tooltip with drag-to-resize and smart
// positioning so the tooltip never covers the hovered data point.

let tooltipEl = null;
let resizeData = null;
let isHoveringTooltip = false;
let savedW = 300;
let savedFontSz = 13;

function applyFontSize(el, sz) {
  if (!el) return;
  const titles = el.querySelectorAll('.cht-title');
  const rows = el.querySelectorAll('.cht-row');
  const footers = el.querySelectorAll('.cht-footer-row');
  const icons = el.querySelectorAll('.cht-row .material-icons, .cht-title .material-icons, .cht-footer-row .material-icons');
  const values = el.querySelectorAll('.cht-row .cht-val');
  titles.forEach(n => n.style.fontSize = (sz + 1) + 'px');
  rows.forEach(n => n.style.fontSize = sz + 'px');
  footers.forEach(n => n.style.fontSize = (sz - 1) + 'px');
  icons.forEach(n => n.style.fontSize = (sz + 2) + 'px');
  values.forEach(n => n.style.fontSize = (sz + 1) + 'px');
}

function ensureContainer() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'cht-tooltip';
  const s = tooltipEl.style;
  s.position = 'fixed';
  s.pointerEvents = 'auto';
  s.zIndex = 999999;
  s.background = '#1e1f22';
  s.border = '1.5px solid rgba(244,129,32,0.55)';
  s.borderRadius = '8px';
  s.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
  s.padding = '0';
  s.fontFamily = "'Poppins','Segoe UI',sans-serif";
  s.opacity = '0';
  s.visibility = 'hidden';
  s.transition = 'opacity 0.12s ease';
  s.minWidth = '220px';
  s.width = savedW + 'px';
  s.maxWidth = '500px';
  s.userSelect = 'text';

  // Lock position when hovering the tooltip so the edge zone stays put
  tooltipEl.addEventListener('pointerenter', () => { isHoveringTooltip = true; });
  tooltipEl.addEventListener('pointerleave', () => { isHoveringTooltip = false; });

  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function iconForText(trimmed) {
  if (trimmed.startsWith('Gauge') || trimmed.includes('Gauge:'))     return { icon: 'straighten',    color: '#f59e0b' };
  if (trimmed.startsWith('Deviation') || trimmed.includes('Deviation')) return { icon: 'swap_horiz',  color: '#f97316' };
  if (trimmed.startsWith('Cant') || trimmed.includes('Cant:'))       return { icon: 'swap_vert',     color: '#7c3aed' };
  if (trimmed.startsWith('Design') || trimmed.includes('Design'))    return { icon: 'target',        color: '#ef4444' };
  if (trimmed.includes('Elevation') || trimmed.includes('Height'))   return { icon: 'height',        color: '#3b82f6' };
  if (trimmed.includes('FAIL') || trimmed.includes('✗'))            return { icon: 'cancel',         color: '#ef4444' };
  if (trimmed.includes('WARN') || trimmed.includes('⚠'))            return { icon: 'warning',        color: '#f97316' };
  if (trimmed.includes('OK') || trimmed.includes('✓'))              return { icon: 'check_circle',   color: '#10b981' };
  if (trimmed.startsWith('Left') || trimmed.includes('Left'))        return { icon: 'arrow_back',     color: '#3b82f6' };
  if (trimmed.startsWith('Right') || trimmed.includes('Right'))      return { icon: 'arrow_forward',  color: '#ef4444' };
  if (trimmed.startsWith('Centre') || trimmed.includes('Centre') || trimmed.includes('CL'))
    return { icon: 'horizontal_rule', color: '#10b981' };
  if (trimmed.includes('Gauge Dev') || trimmed.includes('Dev %'))    return { icon: 'analytics',     color: '#a78bfa' };
  if (trimmed.includes('ΔE') || trimmed.includes('ΔN') || trimmed.includes('ΔH') || trimmed.includes('Diff'))
    return { icon: 'compare_arrows',  color: '#f59e0b' };
  if (trimmed.includes('Easting') || trimmed.includes('East'))      return { icon: 'east',           color: '#38bdf8' };
  if (trimmed.includes('Northing') || trimmed.includes('North'))    return { icon: 'north',          color: '#8b5cf6' };
  return { icon: 'circle', color: '#94a3b8' };
}

function updatePosition(el, tooltipModel) {
  const caretX = tooltipModel.caretX;
  const caretY = tooltipModel.caretY;
  const elRect = el.getBoundingClientRect();
  const elW = elRect.width;
  const elH = elRect.height;
  let left = caretX + 16;
  let top = caretY + 16;
  if (left + elW > window.innerWidth - 12) left = caretX - elW - 16;
  if (top + elH > window.innerHeight - 12) top = caretY - elH - 16;
  if (left < 12) left = 12;
  if (top < 12) top = 12;
  el.style.left = left + 'px';
  el.style.top = top + 'px';

  const arrow = el.querySelector('.cht-arrow');
  if (arrow) {
    const isRight = left > caretX;
    const isBelow = top > caretY;
    if (isRight && isBelow)      { arrow.style.top = '-6px';  arrow.style.left = '16px'; arrow.style.right = arrow.style.bottom = ''; }
    else if (!isRight && isBelow) { arrow.style.top = '-6px';  arrow.style.right = '16px'; arrow.style.left = arrow.style.bottom = ''; }
    else if (isRight && !isBelow) { arrow.style.bottom = '-6px'; arrow.style.left = '16px'; arrow.style.top = arrow.style.right = ''; }
    else                          { arrow.style.bottom = '-6px'; arrow.style.right = '16px'; arrow.style.top = arrow.style.left = ''; }
  }
}

function renderTooltip(tooltipModel, chart) {
  const el = ensureContainer();
  if (tooltipModel.opacity === 0 || !tooltipModel.body?.length) {
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    return;
  }

  // During active resize or hovering tooltip, skip full re-render & repositioning
  if (resizeData || isHoveringTooltip) {
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    return;
  }

  const sz = savedFontSz;
  const titleLines = tooltipModel.title || [];
  const bodyLines = tooltipModel.body.map(b => b.lines).flat().filter(Boolean);
  const footerLines = tooltipModel.footer || [];

  const titleHtml = titleLines.map(t => {
    return `<div class="cht-title" style="display:flex;align-items:center;gap:6px;padding:8px 14px 4px;font-size:${sz + 1}px;font-weight:700;color:#f1f5f9;border-bottom:1px solid rgba(100,116,139,0.25)">
      <span class="material-icons" style="font-size:${sz + 2}px;color:var(--brand,#f48120);flex-shrink:0">pin_drop</span>
      <span>${t}</span>
    </div>`;
  }).join('');

  const bodyHtml = bodyLines.map(line => {
    const trimmed = line.trim();
    const ic = iconForText(trimmed);
    const valMatch = trimmed.match(/([+-]?[\d.]+)\s*(mm|m)?$/);
    const valueStr = valMatch ? valMatch[0] : '';
    const labelStr = trimmed.replace(valueStr, '').replace(/[:]\s*$/, '').replace(/[✗⚠✓]$/, '').trim();
    const statusMatch = trimmed.match(/(✗ FAIL|⚠ WARN|✓ OK)/);
    const statusStr = statusMatch ? statusMatch[1] : '';

    return `<div class="cht-row" style="display:flex;align-items:center;gap:8px;padding:4px 14px;font-size:${sz}px;line-height:1.5">
      <span class="material-icons" style="font-size:${sz + 2}px;color:${ic.color};flex-shrink:0;width:20px;text-align:center">${ic.icon}</span>
      <span style="color:#cbd5e1;flex:1;min-width:0">${labelStr}</span>
      <span class="cht-val" style="color:#f1f5f9;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-size:${sz + 1}px">${valueStr}</span>
      ${statusStr ? `<span style="color:${ic.color};font-size:${sz}px;font-weight:600;margin-left:4px">${statusStr}</span>` : ''}
    </div>`;
  }).join('');

  const footerHtml = footerLines.map(f => {
    const trimmed = f.trim();
    const ic = iconForText(trimmed);
    return `<div class="cht-footer-row" style="display:flex;align-items:center;gap:6px;padding:3px 14px;font-size:${sz - 1}px;color:#94a3b8;border-top:1px solid rgba(100,116,139,0.15)">
      <span class="material-icons" style="font-size:${sz}px;color:${ic.color};flex-shrink:0">${ic.icon}</span>
      <span>${trimmed.replace(/[✗⚠✓]/g, '').trim()}</span>
    </div>`;
  }).join('');

  const edgeZone = `<div class="cht-resize-edge" style="
    position:absolute;right:0;top:0;bottom:0;width:20px;
    cursor:ew-resize;z-index:10;touch-action:none;
  "></div>`;

  el.innerHTML = `<div style="position:relative;padding:2px 0">${titleHtml}${bodyHtml}${footerHtml}${edgeZone}</div>`;

  // ── Smart positioning ──────────────────────────────────────────────────
  updatePosition(el, tooltipModel);

  el.style.visibility = 'visible';
  el.style.opacity = '1';

  // ── Resize via right-edge drag ─────────────────────────────────────────
  const edge = el.querySelector('.cht-resize-edge');
  if (edge) {
    edge.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeData = { el, startW: el.offsetWidth, startX: e.clientX, startFont: savedFontSz };
    };
  }
}

// Global pointer move/up for resize
document.addEventListener('pointermove', (e) => {
  if (!resizeData) return;
  const { el, startW, startX, startFont } = resizeData;
  const newW = Math.max(220, Math.min(600, startW + (e.clientX - startX)));
  const ratio = newW / startW;
  savedFontSz = Math.round(Math.max(10, Math.min(22, startFont * ratio)));
  savedW = newW;
  el.style.width = newW + 'px';
  applyFontSize(el, savedFontSz);
});

document.addEventListener('pointerup', () => {
  if (resizeData) {
    resizeData.el.style.cursor = '';
    resizeData = null;
  }
});

export function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.opacity = '0';
    tooltipEl.style.visibility = 'hidden';
  }
}

export function externalTooltipHandler(context) {
  const { chart, tooltip } = context;
  ensureContainer();
  renderTooltip(tooltip, chart);
}

export const tooltipConfig = {
  enabled: true,
  backgroundColor: 'transparent',
  titleColor: 'transparent',
  bodyColor: 'transparent',
  footerColor: 'transparent',
  borderColor: 'transparent',
  caretColor: 'transparent',
  multiKeyBackground: 'transparent',
  displayColors: false,
  boxPadding: 0,
  external: externalTooltipHandler,
  mode: 'index',
  intersect: false,
  padding: { x: 16, y: 14 },
  cornerRadius: 8,
  caretSize: 8,
  caretPadding: 10,
  titleFont: { size: 14, weight: '700' },
  bodyFont: { size: 13 },
  footerFont: { size: 11 },
};
