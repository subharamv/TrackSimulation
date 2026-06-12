import { useRef, useEffect, useCallback, useState } from 'react';
import { renderTrackView, getTransform } from '../utils/rendering';

export default function TrackMap2D({ trackData = [], onVisibleRangeChange, activeIdx = -1, scrollToRange = null, showSegDist = true, showCumDist = true, resetKey = 0 }) {
  const canvasRef = useRef(null);
  const scaleRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const dragRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const touchesRef = useRef(new Map()); // id → {x, y}
  const onRangeRef = useRef(onVisibleRangeChange);
  onRangeRef.current = onVisibleRangeChange;
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;

  // ── Hover tooltip state ──────────────────────────────────────────────────
  const [hoveredPt, setHoveredPt] = useState(null); // { idx, x, y } | null
  const hoverRef = useRef(null);

  // ── Ctrl+drag rubber-band selection ──────────────────────────────────────
  const [selBox, setSelBox] = useState(null);   // CSS-px coords { x1,y1,x2,y2 }
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const isSelDragRef = useRef(false);
  const selStartRef = useRef(null);

  useEffect(() => {
    const dn = (e) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true);
    };
    const up = (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setCtrlHeld(false);
        if (isSelDragRef.current) {
          isSelDragRef.current = false;
          selStartRef.current = null;
          setSelBox(null);
        }
      }
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const emitRange = useCallback((t, w, h) => {
    if (!onRangeRef.current || trackData.length < 2) return;
    const margin = 20;
    let fromIdx = -1, toIdx = -1;
    for (let i = 0; i < trackData.length; i++) {
      const p = trackData[i];
      const sx = p.easting * t.scale + t.ox;
      const sy = -p.northing * t.scale + t.oy;
      if (sx >= -margin && sx <= w + margin && sy >= -margin && sy <= h + margin) {
        if (fromIdx === -1) fromIdx = i;
        toIdx = i;
      }
    }
    if (fromIdx !== -1) onRangeRef.current({ fromIdx, toIdx });
  }, [trackData]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    renderTrackView(ctx, canvas, trackData, -1, scaleRef.current, offsetXRef.current, offsetYRef.current, false, -1, showSegDist, showCumDist);

    // Active point indicator (uses ref so no extra dep needed)
    const aIdx = activeIdxRef.current;
    const aT = getTransform(trackData, canvas.width, canvas.height, scaleRef.current, offsetXRef.current, offsetYRef.current);
    const dpr = window.devicePixelRatio || 1;

    if (aIdx >= 0 && aIdx < trackData.length) {
      const p = trackData[aIdx];
      const sx = (p.leftEasting + p.rightEasting) / 2 * aT.scale + aT.ox;
      const sy = -(p.leftNorthing + p.rightNorthing) / 2 * aT.scale + aT.oy;
      ctx.save();
      // Crosshair lines
      ctx.strokeStyle = 'rgba(244,129,32,0.35)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
      ctx.setLineDash([]);
      // Outer ring
      ctx.beginPath();
      ctx.arc(sx, sy, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244,129,32,0.12)';
      ctx.fill();
      // Centre dot
      ctx.beginPath();
      ctx.arc(sx, sy, 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#f48120';
      ctx.shadowColor = 'rgba(244,129,32,0.7)';
      ctx.shadowBlur = 8 * dpr;
      ctx.fill();
      ctx.restore();
    }

    // Hovered point indicator
    const hov = hoverRef.current;
    if (hov && hov.idx >= 0 && hov.idx < trackData.length && hov.idx !== aIdx) {
      const p = trackData[hov.idx];
      const cx = (p.leftEasting + p.rightEasting) / 2;
      const cy = (p.leftNorthing + p.rightNorthing) / 2;
      const sx = cx * aT.scale + aT.ox;
      const sy = -cy * aT.scale + aT.oy;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, 6 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16,185,129,0.12)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, 3 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.shadowColor = 'rgba(16,185,129,0.5)';
      ctx.shadowBlur = 6 * dpr;
      ctx.fill();
      ctx.restore();
    }

    if (trackData.length >= 2) {
      const t = getTransform(trackData, canvas.width, canvas.height, scaleRef.current, offsetXRef.current, offsetYRef.current);
      emitRange(t, canvas.width, canvas.height);
    }
  }, [trackData, emitRange, showSegDist, showCumDist]);

  // Commit rubber-band selection → emit range of points inside the box
  const commitSelection = useCallback((box) => {
    const canvas = canvasRef.current;
    if (!canvas || !box || !onRangeRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const minPx = Math.min(box.x1, box.x2) * dpr;
    const maxPx = Math.max(box.x1, box.x2) * dpr;
    const minPy = Math.min(box.y1, box.y2) * dpr;
    const maxPy = Math.max(box.y1, box.y2) * dpr;
    if (maxPx - minPx < 4 * dpr && maxPy - minPy < 4 * dpr) return; // too small
    const t = getTransform(trackData, canvas.width, canvas.height, scaleRef.current, offsetXRef.current, offsetYRef.current);
    let fromIdx = -1, toIdx = -1;
    for (let i = 0; i < trackData.length; i++) {
      const p = trackData[i];
      const sx = p.easting * t.scale + t.ox;
      const sy = -p.northing * t.scale + t.oy;
      if (sx >= minPx && sx <= maxPx && sy >= minPy && sy <= maxPy) {
        if (fromIdx === -1) fromIdx = i;
        toIdx = i;
      }
    }
    if (fromIdx !== -1) onRangeRef.current({ fromIdx, toIdx });
  }, [trackData]);

  // Pan to active point when it changes (only if out of visible area)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeIdx < 0 || activeIdx >= trackData.length) { draw(); return; }
    const p = trackData[activeIdx];
    const t = getTransform(trackData, canvas.width, canvas.height, scaleRef.current, offsetXRef.current, offsetYRef.current);
    const sx = p.easting * t.scale + t.ox;
    const sy = -p.northing * t.scale + t.oy;
    const margin = 40;
    if (sx < margin || sx > canvas.width - margin || sy < margin || sy > canvas.height - margin) {
      offsetXRef.current += canvas.width / 2 - sx;
      offsetYRef.current += canvas.height / 2 - sy;
    }
    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, trackData]);

  // Fit map viewport to a point index range when scrollToRange changes
  const prevScrollRangeRef = useRef(null);
  useEffect(() => {
    if (!scrollToRange || !canvasRef.current) return;
    const { fromIdx, toIdx } = scrollToRange;
    const prev = prevScrollRangeRef.current;
    if (prev && prev.fromIdx === fromIdx && prev.toIdx === toIdx) return;
    prevScrollRangeRef.current = { fromIdx, toIdx };
    const canvas = canvasRef.current;
    if (canvas.width < 2 || canvas.height < 2) return;
    const pts = trackData.slice(fromIdx, Math.min(toIdx + 1, trackData.length));
    if (pts.length === 0) return;
    const w = canvas.width;
    const h = canvas.height;
    if (pts.length === 1) {
      scaleRef.current = Math.min(50, Math.max(scaleRef.current, 6));
      const tZ = getTransform(trackData, w, h, scaleRef.current, 0, 0);
      const sx = pts[0].easting * tZ.scale + tZ.ox;
      const sy = -pts[0].northing * tZ.scale + tZ.oy;
      offsetXRef.current = w / 2 - sx;
      offsetYRef.current = h / 2 - sy;
      draw(); return;
    }
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    pts.forEach(p => {
      minE = Math.min(minE, p.easting); maxE = Math.max(maxE, p.easting);
      minN = Math.min(minN, p.northing); maxN = Math.max(maxN, p.northing);
    });
    const baseT = getTransform(trackData, w, h, 1, 0, 0);
    const sW = (maxE - minE) * baseT.scale;
    const sH = (maxN - minN) * baseT.scale;
    let vs = 1;
    if (sW > 1 && sH > 1) vs = Math.min(w * 0.82 / sW, h * 0.82 / sH);
    else if (sW > 1) vs = w * 0.82 / sW;
    else if (sH > 1) vs = h * 0.82 / sH;
    scaleRef.current = Math.max(0.1, Math.min(50, vs));
    const tZ = getTransform(trackData, w, h, scaleRef.current, 0, 0);
    const midE = (minE + maxE) / 2;
    const midN = (minN + maxN) / 2;
    offsetXRef.current = w / 2 - (midE * tZ.scale + tZ.ox);
    offsetYRef.current = h / 2 - (-midN * tZ.scale + tZ.oy);
    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToRange, trackData]);

  // Sync canvas pixel size to CSS size, redraw on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // Wheel zoom — non-passive so we can preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      const old = scaleRef.current;
      scaleRef.current = Math.max(0.05, Math.min(50, old * factor));
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) * dpr;
      const fy = (e.clientY - rect.top) * dpr;
      const ratio = scaleRef.current / old;
      offsetXRef.current = fx - (fx - offsetXRef.current) * ratio;
      offsetYRef.current = fy - (fy - offsetYRef.current) * ratio;
      draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [draw]);

  // ── Touch pan + pinch-to-zoom ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e) => {
      e.preventDefault();
      const map = touchesRef.current;
      for (const t of e.changedTouches) map.set(t.identifier, { x: t.clientX, y: t.clientY });
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const map = touchesRef.current;
      const active = [...map.keys()];

      if (e.touches.length === 1 && active.length === 1) {
        // Single finger — pan
        const prev = map.get(active[0]);
        const t = e.touches[0];
        if (prev) {
          offsetXRef.current += (t.clientX - prev.x) * dpr;
          offsetYRef.current += (t.clientY - prev.y) * dpr;
        }
        map.set(e.touches[0].identifier, { x: t.clientX, y: t.clientY });
        draw();
      } else if (e.touches.length >= 2) {
        // Two fingers — pinch zoom + pan
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const prev1 = map.get(t1.identifier) || { x: t1.clientX, y: t1.clientY };
        const prev2 = map.get(t2.identifier) || { x: t2.clientX, y: t2.clientY };

        const oldDist = Math.hypot(prev1.x - prev2.x, prev1.y - prev2.y);
        const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

        const oldMidX = ((prev1.x + prev2.x) / 2 - rect.left) * dpr;
        const oldMidY = ((prev1.y + prev2.y) / 2 - rect.top) * dpr;
        const newMidX = ((t1.clientX + t2.clientX) / 2 - rect.left) * dpr;
        const newMidY = ((t1.clientY + t2.clientY) / 2 - rect.top) * dpr;

        if (oldDist > 4) {
          const factor = Math.max(0.5, Math.min(2, newDist / oldDist));
          const old = scaleRef.current;
          scaleRef.current = Math.max(0.05, Math.min(50, old * factor));
          // Zoom around old midpoint, then pan to new midpoint
          offsetXRef.current = newMidX - (oldMidX - offsetXRef.current) * factor;
          offsetYRef.current = newMidY - (oldMidY - offsetYRef.current) * factor;
          draw();
        }

        map.set(t1.identifier, { x: t1.clientX, y: t1.clientY });
        map.set(t2.identifier, { x: t2.clientX, y: t2.clientY });
      }
    };

    const onTouchEnd = (e) => {
      const map = touchesRef.current;
      for (const t of e.changedTouches) map.delete(t.identifier);
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [draw]);

  // ── External reset trigger ────────────────────────────────────────────────
  useEffect(() => {
    resetView();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    hoverRef.current = null;
    setHoveredPt(null);
    if (e.ctrlKey || e.metaKey) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      selStartRef.current = { x, y };
      isSelDragRef.current = true;
      setSelBox({ x1: x, y1: y, x2: x, y2: y });
      e.preventDefault();
      return;
    }
    dragRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onMouseMove = (e) => {
    if (isSelDragRef.current && selStartRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      setSelBox({
        x1: selStartRef.current.x, y1: selStartRef.current.y,
        x2: e.clientX - rect.left, y2: e.clientY - rect.top,
      });
      return;
    }
    if (dragRef.current) {
      const dpr = window.devicePixelRatio || 1;
      offsetXRef.current += (e.clientX - lastPosRef.current.x) * dpr;
      offsetYRef.current += (e.clientY - lastPosRef.current.y) * dpr;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      draw();
    }
    // Point hover detection
    const canvas = canvasRef.current;
    if (!canvas || trackData.length === 0) {
      if (hoverRef.current) { hoverRef.current = null; setHoveredPt(null); }
      return;
    }
    const t = getTransform(trackData, canvas.width, canvas.height, scaleRef.current, offsetXRef.current, offsetYRef.current);
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;
    const HIT_R2 = (14 * dpr) ** 2;
    let bestI = -1, bestD = HIT_R2;
    for (let i = 0; i < trackData.length; i++) {
      const p = trackData[i];
      const cx = (p.leftEasting + p.rightEasting) / 2;
      const cy = (p.leftNorthing + p.rightNorthing) / 2;
      const sx = cx * t.scale + t.ox;
      const sy = -cy * t.scale + t.oy;
      const dx = sx - mx;
      const dy = sy - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; bestI = i; }
    }
    const found = bestI >= 0 ? { idx: bestI, x: e.clientX, y: e.clientY } : null;
    const prev = hoverRef.current;
    if (found?.idx !== prev?.idx) {
      hoverRef.current = found;
      setHoveredPt(found);
    }
  };

  const finishSelection = (e) => {
    if (!isSelDragRef.current) return false;
    const rect = e.currentTarget.getBoundingClientRect();
    const box = selStartRef.current ? {
      x1: selStartRef.current.x, y1: selStartRef.current.y,
      x2: e.clientX - rect.left,  y2: e.clientY - rect.top,
    } : null;
    commitSelection(box);
    isSelDragRef.current = false;
    selStartRef.current = null;
    setSelBox(null);
    return true;
  };

  const onMouseUp = (e) => {
    if (finishSelection(e)) return;
    dragRef.current = false;
    e.currentTarget.style.cursor = ctrlHeld ? 'crosshair' : 'grab';
  };

  const onMouseLeave = (e) => {
    if (finishSelection(e)) return;
    dragRef.current = false;
    hoverRef.current = null;
    setHoveredPt(null);
    e.currentTarget.style.cursor = 'grab';
  };

  const resetView = () => {
    scaleRef.current = 1;
    offsetXRef.current = 0;
    offsetYRef.current = 0;
    draw();
  };

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: ctrlHeld ? 'crosshair' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />

      {/* Rubber-band selection box */}
      {selBox && (
        <div style={{
          position: 'absolute', pointerEvents: 'none',
          left:   Math.min(selBox.x1, selBox.x2),
          top:    Math.min(selBox.y1, selBox.y2),
          width:  Math.abs(selBox.x2 - selBox.x1),
          height: Math.abs(selBox.y2 - selBox.y1),
          border: '1.5px dashed rgba(244,129,32,0.85)',
          background: 'rgba(244,129,32,0.07)',
          boxSizing: 'border-box',
        }} />
      )}

      {/* Ctrl hint tooltip */}
      {ctrlHeld && !selBox && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          fontSize: 9, color: 'rgba(244,129,32,0.85)',
          background: 'rgba(20,21,22,0.82)', padding: '3px 10px',
          borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap',
          border: '1px solid rgba(244,129,32,0.25)',
        }}>
          Drag to select point range
        </div>
      )}

      {/* Point hover tooltip */}
      {hoveredPt && trackData[hoveredPt.idx] && (() => {
        const pt = trackData[hoveredPt.idx];
        const cant = pt.cant * 1000;
        const cSign = cant >= 0 ? '+' : '';
        const cDir = cant > 0.05 ? 'L high' : cant < -0.05 ? 'R high' : 'level';
        const gColor = pt.gaugeStatus === 'fail' ? '#ef4444' : pt.gaugeStatus === 'warn' ? '#f97316' : '#10b981';
        const gBadge = pt.gaugeStatus === 'fail' ? 'FAIL' : pt.gaugeStatus === 'warn' ? 'WARN' : 'OK';
        const cColor = pt.cantStatus === 'fail' ? '#ef4444' : pt.cantStatus === 'warn' ? '#f97316' : '#10b981';
        const tColor = pt.type === 'arc' ? '#f59e0b' : '#10b981';
        const diffMM = pt.gaugeDiff * 1000;
        const top = Math.min(hoveredPt.y - 10, window.innerHeight - 260);
        const ROW = { display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr', gap: '1px 8px', fontSize: 9 };
        const MONO = { fontFamily: 'monospace', color: '#cbd5e1', textAlign: 'right' };
        return (
          <div style={{
            position: 'fixed', left: hoveredPt.x + 16, top,
            zIndex: 9999, pointerEvents: 'none',
            background: 'rgba(45,46,47,0.97)',
            border: '1px solid rgba(244,129,32,0.38)',
            borderRadius: 8, padding: '10px 14px',
            minWidth: 252, maxWidth: 310,
            boxShadow: '0 10px 36px rgba(0,0,0,0.75), 0 0 0 1px rgba(244,129,32,0.08)',
            fontSize: 10, color: '#94a3b8', lineHeight: 1.65,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ color: tColor, fontWeight: 700, fontSize: 12 }}>Pt #{pt.pointNumber}</span>
              <span style={{ color: '#64748b', fontSize: 9 }}>
                Ch {pt.chainage.toFixed(3)} m &nbsp;·&nbsp;
                {pt.type === 'arc' && pt.radius > 0 && pt.radius < 99999
                  ? `Arc R=${pt.radius.toFixed(0)} m`
                  : 'Straight'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ color: '#64748b', minWidth: 36 }}>Gauge</span>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{pt.gauge.toFixed(4)} m</span>
              <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: `${gColor}22`, color: gColor }}>{gBadge}</span>
              <span style={{ fontSize: 9, color: diffMM >= 0 ? '#fb923c' : '#60a5fa' }}>Δ{diffMM >= 0 ? '+' : ''}{diffMM.toFixed(2)} mm</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ color: '#64748b', minWidth: 36 }}>Cant</span>
              <span style={{ color: '#a78bfa', fontWeight: 600 }}>{cSign}{cant.toFixed(2)} mm</span>
              <span style={{ fontSize: 9, color: '#64748b' }}>{cDir}</span>
              <span style={{ padding: '0 4px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: `${cColor}22`, color: cColor, marginLeft: 'auto' }}>{pt.cantStatus?.toUpperCase()}</span>
            </div>

            <div style={{ borderTop: '1px solid rgba(244,129,32,0.15)', paddingTop: 7 }}>
              <div style={ROW}>
                <span style={{ color: '#475569' }} />
                <span style={{ color: '#475569', textAlign: 'right' }}>Easting</span>
                <span style={{ color: '#475569', textAlign: 'right' }}>Northing</span>
                <span style={{ color: '#475569', textAlign: 'right' }}>Height</span>
              </div>
              {[
                { label: 'L', color: '#3b82f6', e: pt.leftEasting, n: pt.leftNorthing, h: pt.leftHeight },
                { label: 'CL', color: '#10b981', e: (pt.leftEasting + pt.rightEasting) / 2, n: (pt.leftNorthing + pt.rightNorthing) / 2, h: (pt.leftHeight + pt.rightHeight) / 2 },
                { label: 'R', color: '#ef4444', e: pt.rightEasting, n: pt.rightNorthing, h: pt.rightHeight },
              ].map(r => (
                <div key={r.label} style={ROW}>
                  <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span>
                  <span style={MONO}>{r.e.toFixed(3)}</span>
                  <span style={MONO}>{r.n.toFixed(3)}</span>
                  <span style={MONO}>{r.h.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Zoom controls */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[
          { icon: 'add',                action: () => { scaleRef.current = Math.min(50, scaleRef.current * 1.3); draw(); } },
          { icon: 'remove',             action: () => { scaleRef.current = Math.max(0.05, scaleRef.current * 0.77); draw(); } },
          { icon: 'center_focus_strong', action: resetView },
        ].map(({ icon, action }) => (
          <button key={icon} onClick={action} style={{
            width: 24, height: 24, border: '1px solid rgba(100,116,139,0.3)',
            borderRadius: 4, background: 'rgba(30,31,32,0.85)', color: '#94a3b8',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}>
            <span className="material-icons" style={{ fontSize: 13 }}>{icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
