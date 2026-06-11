// Canvas rendering utilities for the Track Simulator — Rail Plan View
// Draws left rail, centre line, and right rail based on easting/northing coordinates

import { getBounds } from './geometry';

/**
 * Draw a coordinate grid on the canvas.
 */
export function drawGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.25)';
  ctx.lineWidth = 0.5;
  const gridSize = 60;
  for (let x = gridSize; x < w; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = gridSize; y < h; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

/**
 * Draw empty state message.
 */
export function drawEmptyState(ctx, w, h) {
  ctx.fillStyle = 'rgba(148,163,184,0.3)';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('No track data loaded', w / 2, h / 2 - 10);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.2)';
  ctx.fillText('Upload CSV or click "Sample" to load track geometry', w / 2, h / 2 + 16);
  ctx.textAlign = 'left';
}

/**
 * Compute the world-to-screen transform.
 * Returns { scale, ox, oy } where screenX = worldX * scale + ox, screenY = -worldY * scale + oy
 */
export function getTransform(trackData, w, h, viewScale, viewOffsetX, viewOffsetY) {
  if (trackData.length < 2) {
    return { scale: 1, ox: 0, oy: 0 };
  }
  const bounds = getBounds(trackData);
  const baseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
  const scale = viewScale * baseScale;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const ox = w / 2 - (cx * scale) + viewOffsetX;
  const oy = h / 2 + (cy * scale) + viewOffsetY;
  return { scale, ox, oy, bounds };
}

// ─── Circumscribed circle centre of three 2D world-space points ──────────────
// Returns { x, y } or null when points are collinear.
function circumCentre(x1, y1, x2, y2, x3, y3) {
  const ax = x2 - x1, ay = y2 - y1;
  const bx = x3 - x1, by = y3 - y1;
  const D = 2 * (ax * by - ay * bx);
  if (Math.abs(D) < 1e-10) return null;
  const ux = (by * (ax * ax + ay * ay) - ay * (bx * bx + by * by)) / D;
  const uy = (ax * (bx * bx + by * by) - bx * (ax * ax + ay * ay)) / D;
  return { x: x1 + ux, y: y1 + uy };
}

// ─── Arc-aware rail path with quadratic-bezier arcs ──────────────────────────
// For each arc segment the circumscribed circle of the surrounding three survey
// points is projected to canvas.  The bezier control point Q is derived so that
// the curve passes exactly through the arc mid-point: Q = 2·arcMid − chordMid.
function drawArcRailPath(ctx, points, getX, getY, scale, ox, oy,
                          color, lineWidth, dash, glowColor, glowWidth) {
  if (points.length < 2) return;

  // Pre-project every survey point to canvas space
  const sc = points.map(p => ({
    x: getX(p) * scale + ox,
    y: -getY(p) * scale + oy,
  }));

  function stroke(strokeColor, sw, lineDash) {
    ctx.beginPath();
    sc.forEach((s, i) => {
      if (i === 0) { ctx.moveTo(s.x, s.y); return; }

      const p    = points[i];
      const prev = sc[i - 1];
      const isArc = p.type === 'arc' && p.radius > 0 && p.radius < 800000;

      if (isArc) {
        // Pick the best three-point triplet to define the circumscribed circle.
        // Prefer (i-2, i-1, i) when available so we only look backwards.
        // Fall back to (i-1, i, i+1) for the very first arc segment.
        let triA, triB, triC;
        if (i >= 2) {
          triA = points[i - 2]; triB = points[i - 1]; triC = points[i];
        } else if (i + 1 < points.length) {
          triA = points[i - 1]; triB = points[i]; triC = points[i + 1];
        }

        if (triA) {
          const c = circumCentre(
            getX(triA), getY(triA),
            getX(triB), getY(triB),
            getX(triC), getY(triC)
          );

          if (c) {
            // Circle centre in canvas space (note Y-flip)
            const ccx = c.x * scale + ox;
            const ccy = -c.y * scale + oy;

            // Chord midpoint in canvas
            const mx = (prev.x + s.x) / 2;
            const my = (prev.y + s.y) / 2;

            // Vector from circle centre → chord midpoint
            const vx = mx - ccx, vy = my - ccy;
            const vLen = Math.sqrt(vx * vx + vy * vy);

            if (vLen > 0.01) {
              // Radius of the circumscribed circle in canvas pixels
              const Rc = Math.hypot(prev.x - ccx, prev.y - ccy);

              // Arc midpoint = centre + Rc * unit(C→M)
              const amx = ccx + Rc * vx / vLen;
              const amy = ccy + Rc * vy / vLen;

              // Quadratic bezier control point: Q = 2·arcMid − chordMid
              const qx = 2 * amx - mx;
              const qy = 2 * amy - my;

              ctx.quadraticCurveTo(qx, qy, s.x, s.y);
              return;
            }
          }
        }
      }

      ctx.lineTo(s.x, s.y); // straight fallback
    });

    if (lineDash) ctx.setLineDash(lineDash);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (glowColor) stroke(glowColor, glowWidth, null);
  stroke(color, lineWidth, dash);
}

// ─── Shared point / label / cross-section rendering ──────────────────────────
function drawPointMarkers(ctx, trackData, simIndex, transforms, showSegDist = true, showCumDist = true, showPoints = true) {
  const { scale, ox, oy } = transforms;

  // Pre-compute screen positions
  const screen = trackData.map(p => ({
    x: p.easting * scale + ox,
    y: -p.northing * scale + oy,
  }));

  // Segment distance labels — drawn below centre line at midpoint
  if (showSegDist) {
    const SEG_LABEL_MIN_PX = 28;
    ctx.textAlign = 'center';
    for (let i = 1; i < trackData.length; i++) {
      const ax = screen[i - 1].x, ay = screen[i - 1].y;
      const bx = screen[i].x,     by = screen[i].y;
      const segPx = Math.hypot(bx - ax, by - ay);
      if (segPx < SEG_LABEL_MIN_PX) continue;

      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const ang = Math.atan2(by - ay, bx - ax);

      const dist = Math.abs(trackData[i].chainage - trackData[i - 1].chainage);
      const label = `${dist.toFixed(2)}m`;

      ctx.save();
      ctx.translate(mx, my);
      const readableAng = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
      ctx.rotate(readableAng);
      ctx.font = 'bold 10px sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(20,22,26,0.72)';
      ctx.fillRect(-tw / 2 - 3, 10, tw + 6, 13);
      ctx.fillStyle = 'rgba(250,220,80,0.88)';
      ctx.fillText(label, 0, 20);
      ctx.restore();
    }
  }

  // Point markers + labels
  if (!showPoints) {
    // Still draw active highlight ring on the active point
    trackData.forEach((p, i) => {
      if (i === simIndex) {
        const { x: cx, y: cy } = screen[i];
        ctx.beginPath();
        ctx.arc(cx, cy, 5 + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    // Still draw cross-section lines
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    trackData.forEach(p => {
      const lx = p.leftEasting * scale + ox;
      const ly = -p.leftNorthing * scale + oy;
      const rx = p.rightEasting * scale + ox;
      const ry = -p.rightNorthing * scale + oy;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.stroke();
    });
    return;
  }

  // Point markers + labels
  // Show label for every point whose screen distance to the next point is ≥ MIN_LABEL_PX.
  // This is zoom-aware: zoomed in → all labels; zoomed out → only where spacing allows.
  const MIN_LABEL_PX = 14;

  trackData.forEach((p, i) => {
    const { x: cx, y: cy } = screen[i];
    const isActive = i === simIndex;
    const isArc = p.type === 'arc';
    const r = isActive ? 5 : isArc ? 3.5 : 2.5;

    if (isActive) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = isArc ? '#f59e0b' : '#10b981';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#fff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.stroke();

    // Label visibility: always show for active/first/last; otherwise check pixel spacing
    let spacingOk = isActive || i === 0 || i === trackData.length - 1;
    if (!spacingOk) {
      const nx = screen[i + 1]?.x ?? screen[i - 1].x;
      const ny = screen[i + 1]?.y ?? screen[i - 1].y;
      spacingOk = Math.hypot(nx - cx, ny - cy) >= MIN_LABEL_PX;
    }

    if (spacingOk) {
      // Point number — above the dot
      ctx.fillStyle = isActive ? '#fff' : 'rgba(148,163,184,0.75)';
      ctx.font = isActive ? 'bold 10px sans-serif' : '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`P${p.pointNumber}`, cx, cy - r - 5);

      // Cumulative distance — below the dot
      if (showCumDist && i > 0) {
        const cumDist = p.chainage - trackData[0].chainage;
        const cumLabel = `${cumDist.toFixed(2)}m`;
        ctx.font = 'bold 8px sans-serif';
        const tw = ctx.measureText(cumLabel).width;
        ctx.fillStyle = 'rgba(20,22,26,0.75)';
        ctx.fillRect(cx - tw / 2 - 3, cy + r + 3, tw + 6, 12);
        ctx.fillStyle = 'rgba(186,230,253,0.95)';
        ctx.fillText(cumLabel, cx, cy + r + 12);
      }
    }
  });

  // Cross-section lines L→R
  ctx.strokeStyle = 'rgba(148,163,184,0.08)';
  ctx.lineWidth = 1;
  trackData.forEach(p => {
    const lx = p.leftEasting * scale + ox;
    const ly = -p.leftNorthing * scale + oy;
    const rx = p.rightEasting * scale + ox;
    const ry = -p.rightNorthing * scale + oy;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.stroke();
  });
}

/**
 * Draw the three rail lines (left, centre, right) on the canvas.
 */
export function drawRailLines(ctx, trackData, simIndex, transforms, showSegDist = true, showCumDist = true, showPoints = true) {
  if (trackData.length < 2) return;
  const { scale, ox, oy } = transforms;

  // Helper to draw a polyline
  function drawLine(points, getX, getY, color, width, dash, glowColor, glowWidth) {
    // Glow
    if (glowColor) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const sx = getX(p) * scale + ox;
        const sy = -getY(p) * scale + oy;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = glowWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Main line
    ctx.beginPath();
    points.forEach((p, i) => {
      const sx = getX(p) * scale + ox;
      const sy = -getY(p) * scale + oy;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  // Left rail (blue)
  drawLine(
    trackData,
    p => p.leftEasting, p => p.leftNorthing,
    '#3b82f6', 3, null,
    'rgba(59,130,246,0.15)', 10
  );

  // Centre line (green, dashed)
  drawLine(
    trackData,
    p => p.easting, p => p.northing,
    '#10b981', 1.5, [6, 4],
    'rgba(16,185,129,0.1)', 8
  );

  // Right rail (red)
  drawLine(
    trackData,
    p => p.rightEasting, p => p.rightNorthing,
    '#ef4444', 3, null,
    'rgba(239,68,68,0.15)', 10
  );

  drawPointMarkers(ctx, trackData, simIndex, transforms, showSegDist, showCumDist, showPoints);
}

/**
 * Arc-aware rail rendering — arc segments drawn as bezier curves fitted to
 * the circumscribed circle of each consecutive triplet of survey points.
 * Straight segments fall back to lineTo.
 */
export function drawRailLinesArc(ctx, trackData, simIndex, transforms, showSegDist = true, showCumDist = true, showPoints = true) {
  if (trackData.length < 2) return;
  const { scale, ox, oy } = transforms;

  drawArcRailPath(ctx, trackData,
    p => p.leftEasting,  p => p.leftNorthing,
    scale, ox, oy, '#3b82f6', 3, null, 'rgba(59,130,246,0.15)', 10);

  drawArcRailPath(ctx, trackData,
    p => p.easting, p => p.northing,
    scale, ox, oy, '#10b981', 1.5, [6, 4], 'rgba(16,185,129,0.1)', 8);

  drawArcRailPath(ctx, trackData,
    p => p.rightEasting, p => p.rightNorthing,
    scale, ox, oy, '#ef4444', 3, null, 'rgba(239,68,68,0.15)', 10);

  drawPointMarkers(ctx, trackData, simIndex, transforms, showSegDist, showCumDist, showPoints);
}

/**
 * Draw active point highlight — orange glow ring + crosshair.
 */
export function drawActiveHighlight(ctx, trackData, highlightIndex, transforms) {
  if (highlightIndex < 0 || highlightIndex >= trackData.length) return;
  const p = trackData[highlightIndex];
  const { scale, ox, oy } = transforms;
  const sx = p.easting * scale + ox;
  const sy = -p.northing * scale + oy;

  const pulse = 8 + Math.sin(Date.now() / 250) * 3;

  // Outer glow ring
  ctx.beginPath();
  ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(244, 129, 32, 0.35)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inner glow fill
  ctx.beginPath();
  ctx.arc(sx, sy, pulse * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 129, 32, 0.1)';
  ctx.fill();

  // Crosshair lines
  const ch = Math.min(pulse * 1.8, 18);
  ctx.strokeStyle = 'rgba(244, 129, 32, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx - ch, sy); ctx.lineTo(sx + ch, sy);
  ctx.moveTo(sx, sy - ch); ctx.lineTo(sx, sy + ch);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#f48120';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Rail cross-section highlight
  const lx = p.leftEasting * scale + ox;
  const ly = -p.leftNorthing * scale + oy;
  const rx = p.rightEasting * scale + ox;
  const ry = -p.rightNorthing * scale + oy;
  ctx.strokeStyle = 'rgba(244, 129, 32, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.stroke();
}

/**
 * Draw simulation marker animation.
 */
export function drawSimMarker(ctx, trackData, simIndex, transforms) {
  if (simIndex < 0 || simIndex >= trackData.length) return;
  const p = trackData[simIndex];
  const { scale, ox, oy } = transforms;
  const sx = p.easting * scale + ox;
  const sy = -p.northing * scale + oy;
  const pulse = 10 + Math.sin(Date.now() / 200) * 4;

  // Outer pulse
  ctx.beginPath();
  ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rail cross-section highlight
  const lx = p.leftEasting * scale + ox;
  const ly = -p.leftNorthing * scale + oy;
  const rx = p.rightEasting * scale + ox;
  const ry = -p.rightNorthing * scale + oy;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.stroke();
}

/**
 * Main render function for the track plan view.
 * @param {number} [highlightIndex] - index of point to draw active highlight on (if not simulating)
 */
export function renderTrackView(ctx, canvas, trackData, simIndex, viewScale, viewOffsetX, viewOffsetY, useArcs = false, highlightIndex = -1, showSegDist = true, showCumDist = true, showPoints = true) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  bg.addColorStop(0, '#353637');
  bg.addColorStop(1, '#2d2e2f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h);

  if (trackData.length < 2) {
    drawEmptyState(ctx, w, h);
    return;
  }

  const transforms = getTransform(trackData, w, h, viewScale, viewOffsetX, viewOffsetY);

  if (useArcs) {
    drawRailLinesArc(ctx, trackData, simIndex, transforms, showSegDist, showCumDist, showPoints);
  } else {
    drawRailLines(ctx, trackData, simIndex, transforms, showSegDist, showCumDist, showPoints);
  }

  if (simIndex > 0 && simIndex < trackData.length) {
    drawSimMarker(ctx, trackData, simIndex, transforms);
  } else if (highlightIndex >= 0 && highlightIndex < trackData.length) {
    drawActiveHighlight(ctx, trackData, highlightIndex, transforms);
  }

}

/**
 * Draw minimap overview.
 */
export function drawMinimap(minimapCanvas, trackData, mainCanvas, viewScale, viewOffsetX, viewOffsetY) {
  if (!minimapCanvas || trackData.length < 2) return;
  const ctx = minimapCanvas.getContext('2d');
  const container = minimapCanvas.parentElement;
  if (!container) return;

  const mw = container.clientWidth;
  const mh = container.clientHeight;
  if (mw < 10 || mh < 10) return;

  const dpr = window.devicePixelRatio || 1;
  const w = mw * dpr;
  const h = mh * dpr;

  if (minimapCanvas.width !== w || minimapCanvas.height !== h) {
    minimapCanvas.width = w;
    minimapCanvas.height = h;
    minimapCanvas.style.width = mw + 'px';
    minimapCanvas.style.height = mh + 'px';
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(45, 46, 47, 0.95)';
  ctx.fillRect(0, 0, w, h);

  const bounds = getBounds(trackData);
  const bw = bounds.width;
  const bh = bounds.height;
  if (bw < 0.01 || bh < 0.01) return;

  const pad = 16 * dpr;
  const availW = w - pad * 2;
  const availH = h - pad * 2;
  const mScale = Math.min(availW / bw, availH / bh);
  const cxm = (bounds.minX + bounds.maxX) / 2;
  const cym = (bounds.minY + bounds.maxY) / 2;
  const mOx = w / 2 - cxm * mScale;
  const mOy = h / 2 + cym * mScale;

  // Draw all three rails on minimap
  function drawMinimapLine(points, getX, getY, color, width) {
    ctx.beginPath();
    points.forEach((p, i) => {
      const sx = getX(p) * mScale + mOx;
      const sy = -getY(p) * mScale + mOy;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawMinimapLine(trackData, p => p.leftEasting, p => p.leftNorthing, 'rgba(59,130,246,0.3)', 1.5);
  drawMinimapLine(trackData, p => p.easting, p => p.northing, 'rgba(16,185,129,0.3)', 1);
  drawMinimapLine(trackData, p => p.rightEasting, p => p.rightNorthing, 'rgba(239,68,68,0.3)', 1.5);

  // Start/end markers
  const firstP = trackData[0];
  const lastP = trackData[trackData.length - 1];
  const fsx = firstP.easting * mScale + mOx;
  const fsy = -firstP.northing * mScale + mOy;
  ctx.beginPath();
  ctx.arc(fsx, fsy, Math.max(3, 3.5 * dpr), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
  ctx.fill();
  const lsx = lastP.easting * mScale + mOx;
  const lsy = -lastP.northing * mScale + mOy;
  ctx.beginPath();
  ctx.arc(lsx, lsy, Math.max(3, 3.5 * dpr), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
  ctx.fill();

  // Viewport rectangle
  const transforms = getTransform(trackData, mainCanvas.width, mainCanvas.height, viewScale, viewOffsetX, viewOffsetY);
  const s = transforms.scale;
  const ox2 = transforms.ox;
  const oy2 = transforms.oy;
  const canvasW = mainCanvas.width;
  const canvasH = mainCanvas.height;

  const worldLeft = -ox2 / s;
  const worldRight = (canvasW - ox2) / s;
  const worldTop = oy2 / s;
  const worldBottom = (oy2 - canvasH) / s;

  const vpLeft = worldLeft * mScale + mOx;
  const vpRight = worldRight * mScale + mOx;
  const vpTopY = Math.min(worldTop, worldBottom) * (-mScale) + mOy;
  const vpBottomY = Math.max(worldTop, worldBottom) * (-mScale) + mOy;

  const vpX = Math.max(pad, Math.min(w - pad, Math.min(vpLeft, vpRight)));
  const vpY = Math.max(pad, Math.min(h - pad, Math.min(vpTopY, vpBottomY)));
  const vpW = Math.max(10, Math.min(w - pad * 2, Math.abs(vpRight - vpLeft)));
  const vpH = Math.max(10, Math.min(h - pad * 2, Math.abs(vpBottomY - vpTopY)));

  ctx.fillStyle = 'rgba(244, 129, 32, 0.06)';
  ctx.fillRect(vpX, vpY, vpW, vpH);
  ctx.strokeStyle = 'rgba(244, 129, 32, 0.5)';
  ctx.lineWidth = Math.max(1, 1.5 * dpr);
  ctx.strokeRect(vpX, vpY, vpW, vpH);

  // Dim outside viewport
  ctx.fillStyle = 'rgba(45, 46, 47, 0.3)';
  ctx.fillRect(0, 0, vpX, h);
  ctx.fillRect(vpX + vpW, 0, w - vpX - vpW, h);
  ctx.fillRect(vpX, 0, vpW, vpY);
  ctx.fillRect(vpX, vpY + vpH, vpW, h - vpY - vpH);
}

/**
 * Find the closest point to a screen position.
 */
export function findPointAtPosition(trackData, mx, my, canvas, viewScale, viewOffsetX, viewOffsetY) {
  if (trackData.length < 1) return -1;
  const transforms = getTransform(trackData, canvas.width, canvas.height, viewScale, viewOffsetX, viewOffsetY);
  const { scale, ox, oy } = transforms;

  for (let i = 0; i < trackData.length; i++) {
    const p = trackData[i];
    const sx = (p.easting * scale) + ox;
    const sy = (-p.northing * scale) + oy;
    const dist = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
    if (dist < 10) return i;
  }
  return -1;
}
