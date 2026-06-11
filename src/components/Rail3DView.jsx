import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { gsap } from 'gsap';
import ViewCube3D from './ViewCube3D';

// ─── 3-D perspective projection ───────────────────────────────────────────
function project3D(E, N, H, s) {
  const x = E - s.cx;
  const y = N - s.cy;
  const z = (H - s.cz) * s.zMul;

  // Azimuth rotation (around Z)
  const xA = x * s.cosAz - y * s.sinAz;
  const yA = x * s.sinAz + y * s.cosAz;

  // Elevation rotation (around X)
  const yE = yA * s.cosEl - z * s.sinEl;
  const zE = yA * s.sinEl + z * s.cosEl;

  // Perspective divide
  const w = s.focal / (s.focal + zE);
  return {
    sx: s.svgW * 0.5 + xA * s.scale * w,
    sy: s.svgH * 0.5 - yE * s.scale * w,
    depth: zE,
  };
}

// ─── Catmull-Rom → cubic bezier smooth path ──────────────────────────────
// Produces a smooth curve that passes through every input point.
function toSmoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M${pts[0].sx.toFixed(2)},${pts[0].sy.toFixed(2)} L${pts[1].sx.toFixed(2)},${pts[1].sy.toFixed(2)}`;
  }

  const n = pts.length;
  const c = (i) => ({ x: pts[i].sx, y: pts[i].sy });

  // Catmull-Rom → cubic Bezier for segment between P1 and P2
  // C1 = P1 + (P2 - P0) / 6
  // C2 = P2 - (P3 - P1) / 6
  function segmentCmd(p0, p1, p2, p3) {
    const cpx1 = p1.x + (p2.x - p0.x) / 6;
    const cpy1 = p1.y + (p2.y - p0.y) / 6;
    const cpx2 = p2.x - (p3.x - p1.x) / 6;
    const cpy2 = p2.y - (p3.y - p1.y) / 6;
    return `C${cpx1.toFixed(2)},${cpy1.toFixed(2)} ${cpx2.toFixed(2)},${cpy2.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  // Build path using Catmull-Rom with extrapolated virtual boundary points
  // Virtual point before start: P_virt = 2*P0 - P1 (reflects P1 through P0)
  // Virtual point after end: P_virt = 2*P_last - P_last-1
  // This gives natural tangents at the boundaries instead of zero-velocity starts
  const cp = c; // shorthand
  let d = `M${pts[0].sx.toFixed(2)},${pts[0].sy.toFixed(2)}`;

  // Virtual left neighbor: mirror P1 through P0
  const vLeft = { x: 2 * cp(0).x - cp(1).x, y: 2 * cp(0).y - cp(1).y };
  // First segment: P0 → P1 using virtual left neighbor
  d += segmentCmd(vLeft, cp(0), cp(1), cp(2));

  // Middle segments: P1 → P2, P2 → P3, ...
  for (let i = 2; i < n - 1; i++) {
    d += segmentCmd(cp(i - 2), cp(i - 1), cp(i), cp(i + 1));
  }

  // Final segment: Pn-2 → Pn-1
  if (n >= 3) {
    // Virtual right neighbor: mirror Pn-2 through Pn-1
    const vRight = { x: 2 * cp(n - 1).x - cp(n - 2).x, y: 2 * cp(n - 1).y - cp(n - 2).y };
    d += segmentCmd(cp(n - 3), cp(n - 2), cp(n - 1), vRight);
  }

  return d;
}

// ─── Smooth interpolation helper ──────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

// ─── Grade (slope) calculation ──────────────────────────────────────────────
function calcGrade(filteredData, idx) {
  if (!filteredData || idx <= 0 || idx >= filteredData.length - 1) return 0;
  const prev = filteredData[idx - 1];
  const curr = filteredData[idx];
  const dist = Math.hypot(curr.easting - prev.easting, curr.northing - prev.northing);
  if (dist < 0.001) return 0;
  return ((curr.height - prev.height) / dist) * 100;
}

// ─── Component ────────────────────────────────────────────────────────────
const Rail3DView = forwardRef(function Rail3DView({ trackData, railVisibility, panX = 0, panY = 0,
  chIndex = 0, zMul = 2000, showPoints = true,
  showSegDist = true, showCumDist = true,
  rangeFrom = 0, rangeTo = 0,
  resetTrigger = 0,
  showElevProfile = true,
  onElevProfileChange,
  onChIndexChange,
  onZoomChange,
}, ref) {
  const svgRef       = useRef(null);
  const containerRef = useRef(null);
  const dragging     = useRef(false);
  const dragMode     = useRef('orbit'); // 'orbit' | 'pan'
  const lastPos      = useRef({ x: 0, y: 0 });
  const azRef        = useRef(-0.55);
  const elevRef      = useRef(0.42);
  const rafRef       = useRef(null);
  const momentumRef  = useRef(null);
  const momentumVel  = useRef({ x: 0, y: 0 });
  const lastVelocities = useRef([]);
  const localPanRef  = useRef({ x: 0, y: 0 });
  const zoomRef      = useRef(1.0);
  const projRef      = useRef(null); // always-current projection for hit-testing

  const [size,  setSize]  = useState({ w: 800, h: 220 });
  const [az,    setAz]    = useState(-0.55);
  const [elev,  setElev]  = useState(0.42);
  const [focal]           = useState(600);
  const [zoom,  setZoom]  = useState(1.0);
  const [localPan, setLocalPan] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [hoveredPt,  setHoveredPt]  = useState(null); // {idx, x, y} | null
  const hoveredPtRef    = useRef(null);  // ref mirror of hoveredPt for mousedown capture
  const clickStartRef3D = useRef(null);  // mousedown position for click detection
  const clickTargetIdx  = useRef(-1);    // hovered point idx captured at mousedown

  // Filtered data slice based on unified range from parent
  const filteredData = useMemo(() => {
    if (!trackData || trackData.length === 0) return [];
    const s = Math.max(0, Math.min(rangeFrom, trackData.length - 1));
    const e = Math.max(s + 1, Math.min(rangeTo, trackData.length - 1));
    return trackData.slice(s, e + 1);
  }, [trackData, rangeFrom, rangeTo]);

  // Map global chIndex to a local index within filteredData
  const localChIndex = useMemo(() => {
    if (!trackData || !filteredData || filteredData.length === 0) return 0;
    const target = trackData[chIndex];
    if (!target) return 0;
    const found = filteredData.findIndex(p => p.pointNumber === target.pointNumber);
    return Math.max(0, found);
  }, [chIndex, trackData, filteredData]);

  // SMOOTH ZOOM — animated zoom target
  const zoomTargetRef = useRef(1.0);
  const zoomAnimRef   = useRef(null);

  // ── Ctrl+drag zoom-box state ─────────────────────────────────────────────
  const [zoomBox,   setZoomBox]   = useState(null); // {x1,y1,x2,y2} SVG coords
  const [ctrlHeld,  setCtrlHeld]  = useState(false);
  const isZoomBoxRef  = useRef(false);
  const zoomBoxDrawRef = useRef(null);
  // Stable refs so onMouseUp can read latest values without stale closures
  const baseRef  = useRef(null);
  const sizeRef  = useRef({ w: 800, h: 220 });

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 20 && height > 20) {
        setSize({ w: width, h: height });
        sizeRef.current = { w: width, h: height };
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Ctrl key tracking (for cursor + zoom-box mode) ───────────────────────
  useEffect(() => {
    const dn = (e) => { if (e.key === 'Control') setCtrlHeld(true);  };
    const up = (e) => { if (e.key === 'Control') setCtrlHeld(false); };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // ── Smooth zoom animation loop ──────────────────────────────────────────
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const current = zoomRef.current;
      const target  = zoomTargetRef.current;
      if (Math.abs(current - target) > 0.001) {
        const newZoom = lerp(current, target, 0.18);
        zoomRef.current = newZoom;
        setZoom(newZoom);
        onZoomChange?.(newZoom);
      }
      zoomAnimRef.current = requestAnimationFrame(loop);
    };
    zoomAnimRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(zoomAnimRef.current); };
  }, []);

  // ── Wheel zoom with smooth animation target ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      zoomTargetRef.current = Math.max(0.02, Math.min(80, zoomTargetRef.current * factor));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // ── Schedule a React state update for az/elev ───────────────────────────
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setAz(azRef.current);
      setElev(elevRef.current);
    });
  }, []);

  // ── Momentum engine ─────────────────────────────────────────────────────
  const startMomentum = useCallback((velX, velY) => {
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);

    function step() {
      const v = momentumVel.current;
      // Exponential decay friction
      v.x *= 0.93;
      v.y *= 0.93;

      if (Math.abs(v.x) < 0.00005 && Math.abs(v.y) < 0.00005) {
        momentumRef.current = null;
        return;
      }

      azRef.current += v.x;
      elevRef.current = Math.max(-1.3, Math.min(1.3, elevRef.current - v.y));
      scheduleUpdate();
      momentumRef.current = requestAnimationFrame(step);
    }

    momentumVel.current = { x: velX, y: velY };
    momentumRef.current = requestAnimationFrame(step);
  }, [scheduleUpdate]);

  // ── Stop momentum ───────────────────────────────────────────────────────
  const stopMomentum = useCallback(() => {
    if (momentumRef.current) {
      cancelAnimationFrame(momentumRef.current);
      momentumRef.current = null;
    }
    momentumVel.current = { x: 0, y: 0 };
    lastVelocities.current = [];
  }, []);

  // ── Mouse handlers ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    // Ctrl held → start zoom-box mode
    if (e.ctrlKey) {
      e.preventDefault();
      stopMomentum();
      isZoomBoxRef.current = true;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      zoomBoxDrawRef.current = { x1: x, y1: y, x2: x, y2: y };
      setZoomBox({ x1: x, y1: y, x2: x, y2: y });
      return;
    }
    clickTargetIdx.current  = hoveredPtRef.current?.idx ?? -1;
    clickStartRef3D.current = { x: e.clientX, y: e.clientY };
    hoveredPtRef.current = null;
    setHoveredPt(null);
    stopMomentum();
    dragging.current = true;
    // Left button = orbit, Middle(1) / Right(2) = pan
    dragMode.current = e.button === 0 ? 'orbit' : 'pan';
    lastPos.current = { x: e.clientX, y: e.clientY };
    lastVelocities.current = [];
    e.preventDefault();
  }, [stopMomentum]);

  const onMouseMove = useCallback((e) => {
    // 1. Zoom-box drag update
    if (isZoomBoxRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !zoomBoxDrawRef.current) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const updated = { ...zoomBoxDrawRef.current, x2: x, y2: y };
      zoomBoxDrawRef.current = updated;
      setZoomBox({ ...updated });
      return;
    }

    // 2. Orbit / pan while dragging
    if (dragging.current) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };

      if (dragMode.current === 'orbit') {
        lastVelocities.current.push({ dx, dy, time: performance.now() });
        const now = performance.now();
        lastVelocities.current = lastVelocities.current.filter(v => now - v.time < 80);
        azRef.current += dx * 0.007;
        elevRef.current = Math.max(-1.3, Math.min(1.3, elevRef.current - dy * 0.007));
      } else {
        const scl = (baseRef.current?.scale ?? 1) * zoomRef.current;
        localPanRef.current = {
          x: localPanRef.current.x + dx / scl,
          y: localPanRef.current.y + dy / scl,
        };
        setLocalPan({ ...localPanRef.current });
      }
      setHoveredPt(null);
      scheduleUpdate();
      return;
    }

    // 3. Hover hit-test against ALL projected CL points (not just sampled)
    const p = projRef.current;
    if (p && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const HIT_R2 = 22 * 22;
      let bestD = HIT_R2, bestI = -1;
      for (let i = 0; i < p.cl.length; i++) {
        const ddx = p.cl[i].sx - mx;
        const ddy = p.cl[i].sy - my;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) { bestD = d2; bestI = i; }
      }
      const hov = bestI >= 0 ? { idx: bestI, x: e.clientX, y: e.clientY } : null;
      hoveredPtRef.current = hov;
      setHoveredPt(hov);
    }
  }, [scheduleUpdate]);

  const onMouseUp = useCallback((e) => {
    // Finish zoom-box: pan + zoom to the selected region
    if (isZoomBoxRef.current) {
      isZoomBoxRef.current = false;
      const box = zoomBoxDrawRef.current;
      zoomBoxDrawRef.current = null;
      setZoomBox(null);

      if (box && baseRef.current) {
        const bx1 = Math.min(box.x1, box.x2);
        const by1 = Math.min(box.y1, box.y2);
        const bx2 = Math.max(box.x1, box.x2);
        const by2 = Math.max(box.y1, box.y2);
        const bw  = bx2 - bx1;
        const bh  = by2 - by1;
        const sw  = sizeRef.current.w;
        const sh  = sizeRef.current.h;
        const curScale = baseRef.current.scale * zoomRef.current;

        if (bw > 10 && bh > 10) {
          // Zoom box — pan to box center + scale to fit
          const bcx = (bx1 + bx2) / 2;
          const bcy = (by1 + by2) / 2;
          const worldDx =  (bcx - sw / 2) / curScale;
          const worldDy = -(bcy - sh / 2) / curScale;
          const panObj = { px: localPanRef.current.x, py: localPanRef.current.y };
          gsap.killTweensOf(panObj);
          gsap.to(panObj, {
            px: localPanRef.current.x + worldDx,
            py: localPanRef.current.y + worldDy,
            duration: 0.45, ease: 'power2.out',
            onUpdate() {
              localPanRef.current.x = panObj.px;
              localPanRef.current.y = panObj.py;
              setLocalPan({ x: panObj.px, y: panObj.py });
            },
          });
          const zf = Math.min(sw / bw, sh / bh) * 0.82;
          zoomTargetRef.current = Math.max(0.1, Math.min(80, zoomRef.current * zf));
        } else {
          // Ctrl+click (tiny drag) — zoom 2× toward click point
          const worldDx =  (box.x1 - sw / 2) / curScale * 0.5;
          const worldDy = -(box.y1 - sh / 2) / curScale * 0.5;
          const panObj = { px: localPanRef.current.x, py: localPanRef.current.y };
          gsap.killTweensOf(panObj);
          gsap.to(panObj, {
            px: localPanRef.current.x + worldDx,
            py: localPanRef.current.y + worldDy,
            duration: 0.35, ease: 'power2.out',
            onUpdate() {
              localPanRef.current.x = panObj.px;
              localPanRef.current.y = panObj.py;
              setLocalPan({ x: panObj.px, y: panObj.py });
            },
          });
          zoomTargetRef.current = Math.min(80, zoomRef.current * 2.0);
        }
      }
      return;
    }

    if (!dragging.current) return;
    dragging.current = false;

    // Compute momentum from recent velocity history
    if (dragMode.current === 'orbit') {
      const vel = lastVelocities.current;
      if (vel.length >= 2) {
        const oldest = vel[0];
        const newest = vel[vel.length - 1];
        const dt = (newest.time - oldest.time) / 1000;
        if (dt > 0.008) {
          const totalDx = newest.dx;
          const totalDy = newest.dy;
          const speed = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
          if (speed > 0.5) {
            const velX = totalDx * 0.007 * 2.5;
            const velY = totalDy * 0.007 * 2.5;
            startMomentum(velX, velY);
          }
        }
      }
    }
    lastVelocities.current = [];

    // Click-to-select: if barely moved and a point was hovered at mousedown
    if (e && clickStartRef3D.current && clickTargetIdx.current >= 0) {
      const dx = e.clientX - clickStartRef3D.current.x;
      const dy = e.clientY - clickStartRef3D.current.y;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        onChIndexChange?.(rangeFrom + clickTargetIdx.current);
      }
    }
    clickStartRef3D.current = null;
    clickTargetIdx.current  = -1;
  }, [startMomentum, onChIndexChange, rangeFrom]);

  // ── Touch handlers ──────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    stopMomentum();
    const t = e.touches[0];
    dragging.current = true;
    dragMode.current = 'orbit';
    lastPos.current = { x: t.clientX, y: t.clientY };
    lastVelocities.current = [];
  }, [stopMomentum]);

  const onTouchMove = useCallback((e) => {
    if (!dragging.current) return;
    const t = e.touches[0];
    const dx = t.clientX - lastPos.current.x;
    const dy = t.clientY - lastPos.current.y;
    lastPos.current = { x: t.clientX, y: t.clientY };

    lastVelocities.current.push({ dx, dy, time: performance.now() });
    const now = performance.now();
    lastVelocities.current = lastVelocities.current.filter(v => now - v.time < 80);

    azRef.current += dx * 0.007;
    elevRef.current = Math.max(-1.3, Math.min(1.3, elevRef.current - dy * 0.007));
    scheduleUpdate();
  }, [scheduleUpdate]);

  const onTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const vel = lastVelocities.current;
    if (vel.length >= 2) {
      const newest = vel[vel.length - 1];
      const speed = Math.sqrt(newest.dx * newest.dx + newest.dy * newest.dy);
      if (speed > 0.5) {
        startMomentum(newest.dx * 0.007 * 2.5, newest.dy * 0.007 * 2.5);
      }
    }
    lastVelocities.current = [];
  }, [startMomentum]);

  // ── Context menu: prevent on right-click ────────────────────────────────
  const onContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  // Pre-compute centroid + base scale (single-pass to avoid large intermediate arrays)
  const base = useMemo(() => {
    if (!filteredData || filteredData.length < 2) return null;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < filteredData.length; i++) {
      const p = filteredData[i];
      if (p.leftEasting  < minE) minE = p.leftEasting;
      if (p.leftEasting  > maxE) maxE = p.leftEasting;
      if (p.easting      < minE) minE = p.easting;
      if (p.easting      > maxE) maxE = p.easting;
      if (p.rightEasting < minE) minE = p.rightEasting;
      if (p.rightEasting > maxE) maxE = p.rightEasting;
      if (p.leftNorthing  < minN) minN = p.leftNorthing;
      if (p.leftNorthing  > maxN) maxN = p.leftNorthing;
      if (p.northing      < minN) minN = p.northing;
      if (p.northing      > maxN) maxN = p.northing;
      if (p.rightNorthing < minN) minN = p.rightNorthing;
      if (p.rightNorthing > maxN) maxN = p.rightNorthing;
      if (p.leftHeight  < minH) minH = p.leftHeight;
      if (p.leftHeight  > maxH) maxH = p.leftHeight;
      if (p.height      < minH) minH = p.height;
      if (p.height      > maxH) maxH = p.height;
      if (p.rightHeight < minH) minH = p.rightHeight;
      if (p.rightHeight > maxH) maxH = p.rightHeight;
    }
    const cx = (minE + maxE) / 2;
    const cy = (minN + maxN) / 2;
    const cz = (minH + maxH) / 2;
    const span = Math.max(maxE - minE, maxN - minN);
    const scale = Math.min(size.w, size.h) * 0.40 / (span || 1);
    const result = { cx, cy, cz, scale, svgW: size.w, svgH: size.h, span };
    baseRef.current = result;
    return result;
  }, [filteredData, size]);

  // Auto-pan 3D view when chIndex changes from unified slider
  const prevChRef = useRef(chIndex);
  useEffect(() => {
    if (chIndex === prevChRef.current) return;
    prevChRef.current = chIndex;
    if (!filteredData || filteredData.length < 2 || !base) return;
    const pt = filteredData[localChIndex];
    if (!pt) return;
    stopMomentum();
    const tgtX = pt.easting - base.cx - panX;
    const tgtY = pt.northing - base.cy - panY;
    const panObj = { px: localPanRef.current.x, py: localPanRef.current.y };
    gsap.killTweensOf(panObj);
    gsap.to(panObj, {
      px: tgtX, py: tgtY,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate() {
        localPanRef.current.x = panObj.px;
        localPanRef.current.y = panObj.py;
        setLocalPan({ x: panObj.px, y: panObj.py });
      },
    });
    // Zoom in on the point
    zoomTargetRef.current = Math.max(zoomTargetRef.current, 2.0);
  }, [chIndex, localChIndex, filteredData, base, panX, panY, stopMomentum]);

  // Full projection state
  const state = useMemo(() => {
    if (!base) return null;
    return {
      ...base,
      cx:    base.cx + panX + localPan.x,
      cy:    base.cy + panY + localPan.y,
      scale: base.scale * zoom,
      zMul,
      focal,
      cosAz: Math.cos(az),   sinAz: Math.sin(az),
      cosEl: Math.cos(elev), sinEl: Math.sin(elev),
    };
  }, [base, az, elev, zMul, focal, zoom, panX, panY, localPan]);

  // Project all rail points
  const proj = useMemo(() => {
    if (!state) return null;
    const left  = filteredData.map(p => project3D(p.leftEasting,  p.leftNorthing,  p.leftHeight,  state));
    const cl    = filteredData.map(p => project3D(p.easting,      p.northing,      p.height,      state));
    const right = filteredData.map(p => project3D(p.rightEasting, p.rightNorthing, p.rightHeight, state));
    return { left, cl, right };
  }, [state, filteredData]);

  // Keep projRef current so onMouseMove can read latest projection without stale closure
  useEffect(() => { projRef.current = proj; }, [proj]);

  // GSAP entrance animation
  useEffect(() => {
    if (!proj || !svgRef.current) return;
    const paths = svgRef.current.querySelectorAll('.r3d-path');
    gsap.killTweensOf(paths);
    gsap.fromTo(paths, { opacity: 0 }, { opacity: 1, duration: 0.7, stagger: 0.12, ease: 'power2.out' });
    const ties = svgRef.current.querySelectorAll('.r3d-tie');
    gsap.fromTo(ties, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out', delay: 0.3 });
    const pts = svgRef.current.querySelectorAll('.r3d-pt');
    const ptStagger = pts.length > 60 ? 0.005 : 0.02;
    gsap.fromTo(pts,
      { scale: 0, transformOrigin: 'center center' },
      { scale: 1, duration: 0.3, stagger: ptStagger, ease: 'back.out(1.4)', delay: 0.5 }
    );
  }, [filteredData]);

  const resetView = useCallback(() => {
    stopMomentum();
    zoomTargetRef.current = 1.0;
    localPanRef.current = { x: 0, y: 0 };
    setLocalPan({ x: 0, y: 0 });
    const obj = { az: azRef.current, elev: elevRef.current };
    gsap.killTweensOf(obj);
    gsap.to(obj, {
      az: -0.55, elev: 0.42,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate() {
        azRef.current = obj.az;
        elevRef.current = obj.elev;
        setAz(obj.az);
        setElev(obj.elev);
      },
      onComplete() {
        azRef.current = -0.55;
        elevRef.current = 0.42;
        setAz(-0.55);
        setElev(0.42);
      },
    });
  }, [stopMomentum]);

  // Expose zoom controls to parent via ref
  useImperativeHandle(ref, () => ({
    zoomIn:  () => { zoomTargetRef.current = Math.min(80, zoomTargetRef.current * 1.3); },
    zoomOut: () => { zoomTargetRef.current = Math.max(0.02, zoomTargetRef.current * (1 / 1.3)); },
    setZoomLevel: (factor) => { zoomTargetRef.current = Math.max(0.02, Math.min(80, factor)); },
    getZoom: () => zoomRef.current,
    resetZoom: () => resetView(),
  }), [resetView]);

  // Reset 3D view when resetTrigger changes (from nav bar Home button)
  useEffect(() => {
    if (resetTrigger > 0) resetView();
  }, [resetTrigger, resetView]);

  const onSnap = useCallback((targetAz, targetElev) => {
    stopMomentum();
    const obj = { az: azRef.current, elev: elevRef.current };
    gsap.killTweensOf(obj);
    gsap.to(obj, {
      az: targetAz, elev: targetElev,
      duration: 0.45,
      ease: 'power2.inOut',
      onUpdate() {
        azRef.current   = obj.az;
        elevRef.current = obj.elev;
        setAz(obj.az);
        setElev(obj.elev);
      },
    });
  }, [stopMomentum]);

  const hasData = filteredData && filteredData.length >= 2 && proj;

  // Adaptive sampling step for sleeper/tie rendering only
  const pointCount = filteredData.length;
  const tieStep = pointCount > 80 ? Math.ceil(pointCount / 60) : 1;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
        cursor: isZoomBoxRef.current || ctrlHeld
          ? 'crosshair'
          : dragging.current ? 'grabbing'
          : isHovering ? 'grab' : 'default',
        userSelect: 'none',
        background: 'linear-gradient(180deg, #0c1929 0%, #1a2332 40%, #2d2e2f 70%, #1e1f20 100%)',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        // Cancel zoom box on leave
        if (isZoomBoxRef.current) {
          isZoomBoxRef.current = false;
          zoomBoxDrawRef.current = null;
          setZoomBox(null);
        }
        setIsHovering(false); setHoveredPt(null); onMouseUp();
      }}
    >
      {!hasData ? (
        <div style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-dim)', fontSize: 12, pointerEvents: 'none',
        }}>
          No track data
        </div>
      ) : (
        <>
          <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <filter id="glow-blue" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="glow-red" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="glow-green" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              {/* Subtle grid pattern */}
              <pattern id="grid3d" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.03)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* Grid overlay */}
            <rect width="100%" height="100%" fill="url(#grid3d)" />

            {/* Track bed fill — sampled for large datasets */}
            <path d={(() => {
              const parts = [];
              const bedStep = pointCount > 100 ? Math.ceil(pointCount / 80) : 1;
              for (let i = 0; i < filteredData.length; i += bedStep) {
                parts.push(`${i === 0 ? 'M' : 'L'}${proj.left[i].sx.toFixed(1)},${proj.left[i].sy.toFixed(1)}`);
              }
              // Ensure last point
              const last = filteredData.length - 1;
              if ((filteredData.length - 1) % bedStep !== 0) {
                parts.push(`L${proj.left[last].sx.toFixed(1)},${proj.left[last].sy.toFixed(1)}`);
              }
              for (let i = filteredData.length - 1; i >= 0; i -= bedStep) {
                parts.push(`L${proj.right[i].sx.toFixed(1)},${proj.right[i].sy.toFixed(1)}`);
              }
              if (0 % bedStep !== 0) {
                parts.push(`L${proj.right[0].sx.toFixed(1)},${proj.right[0].sy.toFixed(1)}`);
              }
              return parts.join(' ');
            })()}
              fill="rgba(244,129,32,0.04)" stroke="none" />

            {/* Grade/slope markers — shown where grade is significant */}
            {showPoints && filteredData.map((pt, idx) => {
              if (idx === 0) return null;
              const grade = calcGrade(filteredData, idx);
              if (Math.abs(grade) < 0.5 || !proj.cl[idx]) return null;
              const prevPt = proj.cl[idx - 1];
              if (!prevPt) return null;
              const segPx = Math.hypot(proj.cl[idx].sx - prevPt.sx, proj.cl[idx].sy - prevPt.sy);
              if (segPx < 40) return null;
              const mx = (prevPt.sx + proj.cl[idx].sx) / 2;
              const my = (prevPt.sy + proj.cl[idx].sy) / 2;
              const gradeColor = grade > 2 ? '#f97316' : grade < -2 ? '#3b82f6' : '#10b981';
              const gradeLabel = `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}%`;
              return (
                <g key={`grade-${idx}`} style={{ pointerEvents: 'none' }}>
                  <rect x={mx - 14} y={my - 5} width={28} height={10} rx={2}
                    fill="rgba(15,23,42,0.7)" stroke={`${gradeColor}40`} strokeWidth="0.5" />
                  <text x={mx} y={my + 3} textAnchor="middle"
                    fill={gradeColor} fontSize="6.5" fontWeight="700"
                    fontFamily="'Segoe UI',sans-serif">
                    {gradeLabel}
                  </text>
                </g>
              );
            })}

            {/* Cross-ties — sampled for large datasets */}
            <g className="ties-group">
              {filteredData.filter((_, i) => i % tieStep === 0).map((_, i) => {
                const idx = i * tieStep;
                return (
                  <line key={`tie-${idx}`} className="r3d-tie"
                    x1={proj.left[idx].sx} y1={proj.left[idx].sy}
                    x2={proj.right[idx].sx} y2={proj.right[idx].sy}
                    stroke="rgba(148,163,184,0.30)" strokeWidth="1.5" />
                );
              })}
            </g>

            {/* Rail ground shadows */}
            {railVisibility.left && (
              <path d={toSmoothPath(proj.left)} fill="none"
                stroke="rgba(244,129,32,0.06)" strokeWidth="8"
                strokeLinecap="round" strokeLinejoin="round" />
            )}
            {railVisibility.right && (
              <path d={toSmoothPath(proj.right)} fill="none"
                stroke="rgba(239,68,68,0.06)" strokeWidth="8"
                strokeLinecap="round" strokeLinejoin="round" />
            )}

            {/* Left rail */}
            {railVisibility.left && (
              <path className="r3d-path" d={toSmoothPath(proj.left)}
                fill="none" stroke="#3b82f6" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round"
                filter="url(#glow-blue)" />
            )}

            {/* Centreline */}
            {railVisibility.center && (
              <path className="r3d-path" d={toSmoothPath(proj.cl)}
                fill="none" stroke="#10b981" strokeWidth="1.5"
                strokeDasharray="6,4" strokeLinecap="round" />
            )}

            {/* Right rail */}
            {railVisibility.right && (
              <path className="r3d-path" d={toSmoothPath(proj.right)}
                fill="none" stroke="#ef4444" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round"
                filter="url(#glow-red)" />
            )}

            {/* Segment distance labels — shown when segment is long enough on screen */}
            {showPoints && showSegDist && proj.cl.map((p, idx) => {
              if (idx === 0) return null;
              const prev   = proj.cl[idx - 1];
              const segPx  = Math.hypot(p.sx - prev.sx, p.sy - prev.sy);
              if (segPx < 28) return null;

              const mx  = (prev.sx + p.sx) / 2;
              const my  = (prev.sy + p.sy) / 2;
              const ang = Math.atan2(p.sy - prev.sy, p.sx - prev.sx) * 180 / Math.PI;
              // Keep text upright on steep diagonals
              const rot = (ang > 90 || ang < -90) ? ang + 180 : ang;

              const dist  = Math.abs(filteredData[idx].chainage - filteredData[idx - 1].chainage);
              const label = dist >= 10 ? `${dist.toFixed(1)}m` : `${dist.toFixed(2)}m`;
              const tw    = label.length * 6.2; // approx text width at 10px bold

              return (
                <g key={`seg-${idx}`} transform={`translate(${mx},${my}) rotate(${rot})`}
                  style={{ pointerEvents: 'none' }}>
                  {/* Background pill — placed below the track line to avoid overlap with point labels above */}
                  <rect x={-tw / 2 - 3} y={10} width={tw + 6} height={13} rx={3}
                    fill="rgba(20,22,26,0.72)" />
                  <text textAnchor="middle" y={20}
                    fill="rgba(250,220,80,0.92)"
                    fontSize="10" fontWeight="700"
                    fontFamily="'Segoe UI',sans-serif">
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Survey point markers — all points shown; labels when pixel spacing allows */}
            {showPoints && proj.cl.map((p, idx) => {
              const pt    = filteredData[idx];
              const baseR = pt.type === 'arc' ? 3.5 : 2.5;
              const ptCol = pt.type === 'arc' ? '#f59e0b' : '#10b981';
              const next  = proj.cl[idx + 1];
              const prev  = proj.cl[idx - 1];
              const neighbor = next ?? prev;
              const pixDist  = neighbor
                ? Math.hypot(neighbor.sx - p.sx, neighbor.sy - p.sy)
                : 999;
              const showLabel = pixDist >= 14 || idx === 0 || idx === proj.cl.length - 1;
              return (
                <g key={`pt-${idx}`} className="r3d-pt">
                  <circle
                    cx={p.sx} cy={p.sy}
                    r={baseR}
                    fill={ptCol}
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth="0.8"
                  />
                  {showLabel && (
                    <text x={p.sx} y={p.sy - baseR - 3}
                      fill="rgba(148,163,184,0.82)"
                      fontSize="7.5"
                      textAnchor="middle"
                      fontFamily="'Segoe UI',sans-serif">
                      P{pt.pointNumber}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Hovered-point highlight — always drawn, covers non-sampled points too */}
            {hoveredPt !== null && proj.cl[hoveredPt.idx] && (() => {
              const p   = proj.cl[hoveredPt.idx];
              const pt  = filteredData[hoveredPt.idx];
              const col = pt.type === 'arc' ? '#f59e0b' : '#10b981';
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <circle cx={p.sx} cy={p.sy} r={16}
                    fill={`${col}10`} stroke={`${col}40`} strokeWidth="1.5" />
                  <circle cx={p.sx} cy={p.sy} r={6}
                    fill={col} stroke="#fff" strokeWidth="2" />
                </g>
              );
            })()}

            {/* Start / End enhanced 3D markers */}
            {proj.cl.length > 0 && (
              <>
                {/* ── START marker ── */}
                <g>
                  {/* L/CL/R start markers */}
                  {[
                    { p: proj.left[0],  c: '#3b82f6', l: 'L' },
                    { p: proj.cl[0],    c: '#10b981', l: 'CL' },
                    { p: proj.right[0], c: '#ef4444', l: 'R' },
                  ].map(({ p, c, l }) => (
                    <g key={`start-${l}`}>
                      <circle cx={p.sx} cy={p.sy} r={4}
                        fill={c} stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
                      <text x={p.sx + 5} y={p.sy + 2.5}
                        fill={c} fontSize="6" fontFamily="'Segoe UI',sans-serif" opacity="0.6">{l}</text>
                    </g>
                  ))}
                  {/* Start flag */}
                  <g transform={`translate(${proj.cl[0].sx + 10},${proj.cl[0].sy - 28})`}>
                    <rect x={-2} y={-1} width={86} height={12} rx={2}
                      fill="rgba(16,185,129,0.18)" stroke="rgba(16,185,129,0.45)" strokeWidth="0.5" />
                    <text fill="#10b981" fontSize="8" x={2} y={8}
                      fontFamily="'Segoe UI',sans-serif" fontWeight="600">
                      ◀ START  Pt#{filteredData[0].pointNumber} Ch {filteredData[0].chainage.toFixed(2)}m
                    </text>
                  </g>
                </g>

                {/* ── END marker ── */}
                <g>
                  {/* L/CL/R end markers */}
                  {[
                    { p: proj.left[proj.left.length-1],  c: '#3b82f6', l: 'L' },
                    { p: proj.cl[proj.cl.length-1],      c: '#10b981', l: 'CL' },
                    { p: proj.right[proj.right.length-1], c: '#ef4444', l: 'R' },
                  ].map(({ p, c, l }) => (
                    <g key={`end-${l}`}>
                      <circle cx={p.sx} cy={p.sy} r={4}
                        fill={c} stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
                      <text x={p.sx + 5} y={p.sy + 2.5}
                        fill={c} fontSize="6" fontFamily="'Segoe UI',sans-serif" opacity="0.6">{l}</text>
                    </g>
                  ))}
                  {/* End flag */}
                  <g transform={`translate(${proj.cl[proj.cl.length-1].sx + 10},${proj.cl[proj.cl.length-1].sy - 28})`}>
                    <rect x={-2} y={-1} width={60} height={12} rx={2}
                      fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.45)" strokeWidth="0.5" />
                    <text fill="#ef4444" fontSize="8" x={2} y={8}
                      fontFamily="'Segoe UI',sans-serif" fontWeight="600">
                      ◼ END  Ch {filteredData[filteredData.length-1].chainage.toFixed(2)}m
                    </text>
                  </g>
                </g>
              </>
            )}

            {/* Cumulative distance labels — shown below each point when pixel spacing allows */}
            {showPoints && showCumDist && proj.cl.map((p, idx) => {
              if (idx === 0 || idx === proj.cl.length - 1) return null;
              const next = proj.cl[idx + 1];
              const prev = proj.cl[idx - 1];
              const neighbor = next ?? prev;
              if (!neighbor) return null;
              const pixDist = Math.hypot(neighbor.sx - p.sx, neighbor.sy - p.sy);
              if (pixDist < 20) return null;

              const pt     = filteredData[idx];
              const cumDist = pt.chainage - filteredData[0].chainage;
              const cumLabel = `${cumDist.toFixed(2)}m`;
              const tw = cumLabel.length * 5.8;

              return (
                <g key={`cum-${idx}`} style={{ pointerEvents: 'none' }}>
                  <rect x={p.sx - tw / 2 - 3} y={p.sy + 5} width={tw + 6} height={12} rx={3}
                    fill="rgba(20,22,26,0.75)" stroke="rgba(148,163,184,0.25)" strokeWidth="0.5" />
                  <text x={p.sx} y={p.sy + 14}
                    textAnchor="middle"
                    fill="rgba(186,230,253,0.95)"
                    fontSize="8" fontWeight="600"
                    fontFamily="'Segoe UI',sans-serif">
                    {cumLabel}
                  </text>
                </g>
              );
            })}

            {/* ── Chainage slider highlight marker (local index) ── */}
            {proj.cl[localChIndex] && (
              <g>
                {/* Outer glow ring */}
                <circle cx={proj.cl[localChIndex].sx} cy={proj.cl[localChIndex].sy} r={12}
                  fill="rgba(244,129,32,0.06)" stroke="rgba(244,129,32,0.35)" strokeWidth="1.5" />
                {/* Crosshair */}
                <line x1={proj.cl[localChIndex].sx - 10} y1={proj.cl[localChIndex].sy}
                  x2={proj.cl[localChIndex].sx + 10} y2={proj.cl[localChIndex].sy}
                  stroke="rgba(244,129,32,0.3)" strokeWidth="0.5" />
                <line x1={proj.cl[localChIndex].sx} y1={proj.cl[localChIndex].sy - 10}
                  x2={proj.cl[localChIndex].sx} y2={proj.cl[localChIndex].sy + 10}
                  stroke="rgba(244,129,32,0.3)" strokeWidth="0.5" />
                {/* Center dot */}
                <circle cx={proj.cl[localChIndex].sx} cy={proj.cl[localChIndex].sy} r={4.5}
                  fill="#f48120" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />
              </g>
            )}

            {/* ── Ctrl+drag zoom box ── */}
            {zoomBox && (() => {
              const x = Math.min(zoomBox.x1, zoomBox.x2);
              const y = Math.min(zoomBox.y1, zoomBox.y2);
              const w = Math.abs(zoomBox.x2 - zoomBox.x1);
              const h = Math.abs(zoomBox.y2 - zoomBox.y1);
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={x} y={y} width={w} height={h}
                    fill="rgba(244,129,32,0.07)"
                    stroke="#f48120" strokeWidth="1.5"
                    strokeDasharray="7,4" />
                  {/* Corner tick marks */}
                  {[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([cx,cy], i) => (
                    <g key={i}>
                      <line x1={cx - (i%2===0?0:6)} y1={cy} x2={cx + (i%2===0?6:0)} y2={cy}
                        stroke="#f48120" strokeWidth="2" />
                      <line x1={cx} y1={cy - (i<2?0:6)} x2={cx} y2={cy + (i<2?6:0)}
                        stroke="#f48120" strokeWidth="2" />
                    </g>
                  ))}
                  {w > 40 && h > 18 && (
                    <text x={x + w/2} y={y + h/2 + 4} textAnchor="middle"
                      fill="rgba(244,129,32,0.65)" fontSize="9"
                      fontFamily="'Segoe UI',sans-serif" fontWeight="600">
                      {w.toFixed(0)} × {h.toFixed(0)} px
                    </text>
                  )}
                </g>
              );
            })()}


          </svg>

          {/* Nav Overlay — bottom-left */}
          <NavOverlay
            filteredData={filteredData}
            trackData={trackData}
            az={az} elev={elev}
            chIndex={chIndex}
            localChIndex={localChIndex}
            railVisibility={railVisibility}
            zoom={zoom}
            camE={state ? state.cx : 0}
            camN={state ? state.cy : 0}
            halfWWorld={state ? size.w / 2 / state.scale : 0}
            halfHWorld={state ? size.h / 2 / state.scale : 0}
            onChIndexChange={onChIndexChange}
            onNavigate={({ az: newAz, worldX, worldY }) => {
              if (!base) return;
              stopMomentum();
              const tgtX = worldX - base.cx - panX;
              const tgtY = worldY - base.cy - panY;
              const azObj = { a: azRef.current };
              gsap.killTweensOf(azObj);
              gsap.to(azObj, { a: newAz, duration: 0.35, ease: 'power2.out',
                onUpdate() { azRef.current = azObj.a; setAz(azObj.a); } });
              const panObj = { px: localPanRef.current.x, py: localPanRef.current.y };
              gsap.killTweensOf(panObj);
              gsap.to(panObj, { px: tgtX, py: tgtY, duration: 0.45, ease: 'power2.out',
                onUpdate() { localPanRef.current.x = panObj.px; localPanRef.current.y = panObj.py; setLocalPan({ x: panObj.px, y: panObj.py }); } });
              zoomTargetRef.current = 1.0;
            }}
          />
        </>
      )}

      {/* ViewCube — bottom-right */}
      <ViewCube3D az={az} elev={elev} onSnap={onSnap} />

      {/* Telemetry HUD — top-left */}
      {hasData && (
        <TelemetryHUD
          filteredData={filteredData}
          localChIndex={localChIndex}
          zoom={zoom}
          az={az}
          elev={elev}
          proj={proj}
        />
      )}

      {/* Elevation Profile mini-chart — bottom-center */}
      {hasData && filteredData.length >= 2 && showElevProfile && (
        <ElevationProfile
          filteredData={filteredData}
          localChIndex={localChIndex}
          size={size}
          onClose={onElevProfileChange ? () => onElevProfileChange(false) : undefined}
        />
      )}

      {/* Hint overlay — small badge at top-right */}
      <div
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{
          fontSize: 8, color: 'rgba(148,163,184,0.4)',
          textAlign: 'right', lineHeight: 1.4,
          background: 'rgba(15,23,42,0.5)',
          padding: '3px 7px', borderRadius: 4,
          border: '1px solid rgba(99,102,241,0.08)',
        }}>
          <span style={{ color: 'rgba(148,163,184,0.5)' }}>🔄 Drag rotate</span> ·
          <span style={{ color: 'rgba(148,163,184,0.5)' }}> 🔍 Scroll zoom</span><br />
          <span style={{ color: 'rgba(148,163,184,0.4)' }}>Right-drag pan</span> ·
          <span style={{ color: '#f48120', opacity: 0.7 }}>Ctrl+drag zoom area</span>
        </div>
      </div>

      {/* ── Point hover tooltip ── */}
      {hoveredPt !== null && filteredData[hoveredPt.idx] && (
        <Pt3DTooltip pt={filteredData[hoveredPt.idx]} x={hoveredPt.x} y={hoveredPt.y} />
      )}
    </div>
  );
});

// ── NavOverlay: HTML overlay panel replacing the SVG Minimap ─────────────────
function NavOverlay({ filteredData, trackData, az, elev, chIndex, localChIndex, railVisibility, zoom,
  camE, camN, halfWWorld, halfHWorld,
  onChIndexChange, onNavigate }) {
  const PANEL_W = 168, MAP_H = 100;

  // ── Memoize minimap bounds + projection ──────────────────────────────────
  const mmParams = useMemo(() => {
    if (!trackData || trackData.length === 0) return null;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const p of trackData) {
      if (p.easting < minE) minE = p.easting; if (p.easting > maxE) maxE = p.easting;
      if (p.northing < minN) minN = p.northing; if (p.northing > maxN) maxN = p.northing;
    }
    const bw = maxE - minE || 1, bh = maxN - minN || 1;
    const pad = 10;
    const scaleX = (PANEL_W - pad * 2) / bw;
    const scaleY = (MAP_H  - pad * 2) / bh;
    const s = Math.min(scaleX, scaleY);
    const ox = pad + ((PANEL_W - pad*2) - bw * s) / 2;
    const oy = pad + ((MAP_H   - pad*2) - bh * s) / 2;
    const toMM = (e, n) => ({ x: ox + (e - minE) * s, y: MAP_H - oy - (n - minN) * s });
    return { toMM, minE, maxE, minN, maxN, s, cx: (minE+maxE)/2, cy: (minN+maxN)/2 };
  }, [trackData]);

  // ── Memoize sampled rail paths ────────────────────────────────────────────
  const mmPaths = useMemo(() => {
    if (!mmParams || !trackData || trackData.length < 2) return null;
    const { toMM } = mmParams;
    const step = Math.max(1, Math.floor(trackData.length / 80));
    const pts = [];
    for (let i = 0; i < trackData.length; i += step) pts.push(i);
    if (pts[pts.length - 1] !== trackData.length - 1) pts.push(trackData.length - 1);

    const toPoly = (getter) => pts.map(i => { const p = getter(i); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

    return {
      left:  toPoly(i => toMM(trackData[i].leftEasting,  trackData[i].leftNorthing)),
      cl:    toPoly(i => toMM(trackData[i].easting,      trackData[i].northing)),
      right: toPoly(i => toMM(trackData[i].rightEasting, trackData[i].rightNorthing)),
      start: toMM(trackData[0].easting, trackData[0].northing),
      end:   toMM(trackData[trackData.length-1].easting, trackData[trackData.length-1].northing),
    };
  }, [mmParams, trackData]);

  // Current point position on minimap
  const activePt = useMemo(() => {
    if (!mmParams || !filteredData || filteredData.length === 0) return null;
    const p = filteredData[Math.min(localChIndex, filteredData.length - 1)];
    if (!p) return null;
    return mmParams.toMM(p.easting, p.northing);
  }, [mmParams, filteredData, localChIndex]);

  // Viewport footprint on minimap — shows actual 3D camera position + visible area
  const viewportOverlay = useMemo(() => {
    if (!mmParams || !camE || !camN) return null;
    const { s } = mmParams;
    const center = mmParams.toMM(camE, camN);
    // Half-extents in minimap pixels along each viewport axis
    const hw = Math.min(halfWWorld * s, PANEL_W * 0.9);
    const hh = Math.min(halfHWorld * s, MAP_H   * 0.9);
    // Viewport rect axes in minimap pixel space
    // world (cosAz, -sinAz) → minimap (cosAz, sinAz)  [N flipped]
    // world (sinAz,  cosAz) → minimap (sinAz, -cosAz)
    const cosA = Math.cos(az), sinA = Math.sin(az);
    const corners = [
      { x: center.x + hw * cosA + hh * sinA, y: center.y + hw * sinA - hh * cosA },
      { x: center.x - hw * cosA + hh * sinA, y: center.y - hw * sinA - hh * cosA },
      { x: center.x - hw * cosA - hh * sinA, y: center.y - hw * sinA + hh * cosA },
      { x: center.x + hw * cosA - hh * sinA, y: center.y + hw * sinA + hh * cosA },
    ];
    // FOV arrow: points in the forward (+az) direction from camera center
    const arrowLen = Math.max(8, Math.min(hh * 0.65, 18));
    const tip = { x: center.x + sinA * arrowLen, y: center.y - cosA * arrowLen };
    const lW  = { x: center.x + Math.sin(az - 0.38) * arrowLen * 0.65, y: center.y - Math.cos(az - 0.38) * arrowLen * 0.65 };
    const rW  = { x: center.x + Math.sin(az + 0.38) * arrowLen * 0.65, y: center.y - Math.cos(az + 0.38) * arrowLen * 0.65 };
    return { center, corners, tip, lW, rW };
  }, [mmParams, camE, camN, halfWWorld, halfHWorld, az]);

  // Click → navigate
  const handleMapClick = useCallback((e) => {
    if (!mmParams) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { toMM, minE, minN, s } = mmParams;
    const worldX = minE + px / s;
    const worldY = minN + (MAP_H - py) / s;
    const dx = (px - PANEL_W / 2) / s;
    const dy = -(py - MAP_H / 2) / s;
    onNavigate?.({ az: Math.atan2(dx, dy), worldX, worldY });
  }, [mmParams, onNavigate]);

  const elevDeg = Math.round(elev * 57.3);
  const prevPt = () => onChIndexChange?.(Math.max(0, chIndex - 1));
  const nextPt = () => onChIndexChange?.(chIndex + 1);

  const ptInfo = filteredData?.[localChIndex];

  return (
    <div
      style={{
        position: 'absolute', bottom: 76, left: 8, zIndex: 10,
        width: PANEL_W, pointerEvents: 'auto',
        userSelect: 'none',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* ── Main nav card (glass-morphism) ── */}
      <div style={{
        background: 'rgba(15,23,42,0.8)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 10,
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        {/* Title bar with nav arrows */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 8px',
          background: 'rgba(99,102,241,0.08)',
          borderBottom: '1px solid rgba(99,102,241,0.12)',
        }}>
          <button onClick={prevPt} style={navBtnStyle} title="Previous point">
            ◀
          </button>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#818cf8', letterSpacing: '1.5px' }}>
            ◈ NAV ◈
          </span>
          <button onClick={nextPt} style={navBtnStyle} title="Next point">
            ▶
          </button>
        </div>

        {/* Minimap SVG */}
        <svg
          width={PANEL_W} height={MAP_H}
          style={{ display: 'block', cursor: 'crosshair' }}
          onClick={handleMapClick}
        >
          {/* Rail paths */}
          {mmPaths && (<>
            {railVisibility.left   && <polyline points={mmPaths.left}  fill="none" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />}
            {railVisibility.center && <polyline points={mmPaths.cl}    fill="none" stroke="#10b981" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7" />}
            {railVisibility.right  && <polyline points={mmPaths.right} fill="none" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />}

            {/* Start / end dots */}
            <circle cx={mmPaths.start.x} cy={mmPaths.start.y} r={3} fill="#10b981" opacity="0.8" />
            <circle cx={mmPaths.end.x}   cy={mmPaths.end.y}   r={3} fill="#ef4444" opacity="0.8" />
          </>)}

          {/* Viewport footprint — rotated rect + look direction arrow */}
          {viewportOverlay && (<>
            <polygon
              points={viewportOverlay.corners.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
              fill="rgba(244,129,32,0.08)"
              stroke="rgba(244,129,32,0.45)"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            <polygon
              points={[viewportOverlay.center, viewportOverlay.lW, viewportOverlay.tip, viewportOverlay.rW]
                .map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
              fill="rgba(244,129,32,0.18)" stroke="rgba(244,129,32,0.55)" strokeWidth="0.8"
            />
            <line
              x1={viewportOverlay.center.x} y1={viewportOverlay.center.y}
              x2={viewportOverlay.tip.x}    y2={viewportOverlay.tip.y}
              stroke="rgba(244,129,32,0.9)" strokeWidth="1.5" strokeLinecap="round"
            />
            <circle cx={viewportOverlay.center.x} cy={viewportOverlay.center.y} r={2.5}
              fill="#f48120" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" />
          </>)}

          {/* Active point marker */}
          {activePt && (<>
            <circle cx={activePt.x} cy={activePt.y} r={6}
              fill="rgba(244,129,32,0.12)" stroke="rgba(244,129,32,0.5)" strokeWidth="1" />
            <circle cx={activePt.x} cy={activePt.y} r={2.8}
              fill="#f48120" stroke="#fff" strokeWidth="0.8" />
          </>)}
        </svg>

        {/* Footer bar: point info */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px 5px',
          borderTop: '1px solid rgba(99,102,241,0.1)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          {/* Point info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {ptInfo ? (<>
              <div style={{ fontSize: 9, color: '#818cf8', fontWeight: 700, lineHeight: 1.3 }}>
                Pt#{ptInfo.pointNumber}
              </div>
              <div style={{ fontSize: 8.5, color: '#94a3b8', lineHeight: 1.3 }}>
                Ch {ptInfo.chainage?.toFixed(2)}m
              </div>
              <div style={{ fontSize: 8, color: '#64748b', lineHeight: 1.3 }}>
                {ptInfo.type === 'arc' ? `Arc R${ptInfo.radius?.toFixed(0)}m` : 'Straight'}
              </div>
            </>) : (
              <div style={{ fontSize: 8, color: '#64748b' }}>—</div>
            )}
          </div>

          {/* Elevation + zoom badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            <div style={{ fontSize: 7.5, color: '#64748b' }}>
              El {elevDeg}°
            </div>
            <div style={{ fontSize: 7.5, color: '#64748b' }}>
              ×{zoom.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Legend strip */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        marginTop: 5, paddingLeft: 2,
        fontSize: 8.5, pointerEvents: 'none',
      }}>
        {railVisibility.left   && <span style={{ color: '#3b82f6' }}>━ Left Rail</span>}
        {railVisibility.center && <span style={{ color: '#10b981' }}>╌ CL</span>}
        {railVisibility.right  && <span style={{ color: '#ef4444' }}>━ Right Rail</span>}
        <span style={{ color: '#f59e0b' }}>◆ Arc</span>
      </div>
    </div>
  );
}

const navBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#f48120', fontSize: 10, padding: '2px 6px',
  borderRadius: 4, lineHeight: 1,
  transition: 'background 0.12s',
};

// ── Telemetry HUD: top-left data dashboard ───────────────────────────────────
function TelemetryHUD({ filteredData, localChIndex, zoom, az, elev, proj }) {
  const pt = filteredData?.[localChIndex];
  if (!pt) return null;
  const grade = calcGrade(filteredData, localChIndex);
  const gradeColor = grade > 2 ? '#f97316' : grade < -2 ? '#3b82f6' : '#10b981';
  const gradeLabel = `${grade >= 0 ? '+' : ''}${grade.toFixed(2)}%`;
  const azDeg = ((az * 180 / Math.PI + 360) % 360).toFixed(0);
  const elevDeg = Math.round(elev * 57.3);
  const cant = pt.cant * 1000;
  const cantDir = cant > 0.5 ? 'L↑' : cant < -0.5 ? 'R↑' : '—';
  const gColor = pt.gaugeStatus === 'fail' ? '#ef4444' : pt.gaugeStatus === 'warn' ? '#f97316' : '#10b981';
  const gBadge = pt.gaugeStatus === 'fail' ? 'FAIL' : pt.gaugeStatus === 'warn' ? 'WARN' : 'OK';
  const cColor = pt.cantStatus === 'fail' ? '#ef4444' : pt.cantStatus === 'warn' ? '#f97316' : '#10b981';
  const cBadge = pt.cantStatus === 'fail' ? 'FAIL' : pt.cantStatus === 'warn' ? 'WARN' : 'OK';

  const items = [
    { label: 'POINT',  value: `#${pt.pointNumber}`, color: '#f59e0b', big: true },
    { label: 'CHAIN',  value: `${pt.chainage.toFixed(2)}m`, color: '#94a3b8' },
    { label: 'ELEV',   value: `${pt.height.toFixed(3)}m`, color: '#38bdf8' },
    { label: 'GRADE',  value: gradeLabel, color: gradeColor },
    { label: 'GAUGE',  value: `${pt.gauge.toFixed(4)}m`, color: gColor, badge: gBadge },
    { label: 'CANT',   value: `${cant >= 0 ? '+' : ''}${cant.toFixed(2)}mm`, color: cColor, badge: cBadge },
    { label: 'AZIMUTH', value: `${azDeg}°`, color: '#a78bfa' },
    { label: 'ELEV°',  value: `${elevDeg}°`, color: '#38bdf8' },
    { label: 'ZOOM',   value: `×${zoom.toFixed(1)}`, color: '#64748b' },
  ];

  return (
    <div
      style={{
        position: 'absolute', top: 8, left: 8, zIndex: 10,
        pointerEvents: 'none', userSelect: 'none',
        display: 'flex', gap: 4, flexWrap: 'wrap',
        maxWidth: 'calc(100% - 120px)',
      }}
    >
      {items.map((item, i) => (
        <div key={i} style={{
          background: 'rgba(15,23,42,0.75)',
          border: `1px solid rgba(99,102,241,0.12)`,
          borderRadius: 5,
          padding: item.big ? '3px 8px' : '2px 6px',
          backdropFilter: 'blur(6px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center',
          gap: 0.5,
        }}>
          <div style={{
            fontSize: 6.5, fontWeight: 600,
            color: 'rgba(148,163,184,0.6)',
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
            fontFamily: "'Segoe UI',sans-serif",
          }}>
            {item.label}
          </div>
          <div style={{
            fontSize: item.big ? 13 : 9.5,
            fontWeight: item.big ? 800 : 700,
            color: item.color,
            fontFamily: "'Segoe UI',sans-serif",
            lineHeight: 1.2,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            {item.value}
            {item.badge && (
              <span style={{
                fontSize: 7, fontWeight: 700,
                padding: '0 3px', borderRadius: 2,
                background: `${item.color}22`,
                color: item.color,
                lineHeight: '1.3',
              }}>
                {item.badge}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Elevation Profile — draggable + resizable panel ──────────────────────────
const ELEV_TITLE_H = 22;
const ELEV_MIN_W   = 180;
const ELEV_MIN_H   = 60;
const ELEV_HANDLE  = 8;

function getElevDefault(bottom) {
  const w = Math.min(Math.max(window.innerWidth * 0.45, ELEV_MIN_W), 820);
  const h = 90;
  const left = Math.round((window.innerWidth - w) / 2);
  const top  = window.innerHeight - bottom - h;
  return { left, top, w, h };
}

export function ElevationProfile({ filteredData, localChIndex, size, bottom = 148, onClose }) {
  const [rect, setRect] = useState(() => {
    try {
      const s = localStorage.getItem('railsim_elevProfile_rect');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });

  // Initialise default position after first paint so window dimensions are known
  useEffect(() => {
    if (!rect) setRect(getElevDefault(bottom));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rect) localStorage.setItem('railsim_elevProfile_rect', JSON.stringify(rect));
  }, [rect]);

  const r = rect ?? getElevDefault(bottom);

  // ── Drag title bar ────────────────────────────────────────────────────────
  const onTitleMouseDown = useCallback((e) => {
    if (e.button !== 0 || e.target.dataset.resize) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const initL = r.left, initT = r.top;
    const onMove = (me) => {
      setRect(prev => ({ ...(prev ?? getElevDefault(bottom)), left: initL + me.clientX - startX, top: initT + me.clientY - startY }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [r.left, r.top, bottom]);

  // ── Resize handles ────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e, dir) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const { left: iL, top: iT, w: iW, h: iH } = r;
    const cursors = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
    document.body.style.cursor = cursors[dir] || 'nwse-resize';
    document.body.style.userSelect = 'none';
    const onMove = (me) => {
      const dx = me.clientX - startX, dy = me.clientY - startY;
      setRect(() => {
        let left = iL, top = iT, w = iW, h = iH;
        if (dir.includes('e')) w = Math.max(ELEV_MIN_W, iW + dx);
        if (dir.includes('s')) h = Math.max(ELEV_MIN_H, iH + dy);
        if (dir.includes('w')) { w = Math.max(ELEV_MIN_W, iW - dx); left = iL + iW - w; }
        if (dir.includes('n')) { h = Math.max(ELEV_MIN_H, iH - dy); top = iT + iH - h; }
        return { left, top, w, h };
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [r]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartW = r.w;
  const chartH = r.h - ELEV_TITLE_H;
  const padL = 30, padR = 10, padT = 6, padB = 10;
  const drawW = Math.max(1, chartW - padL - padR);
  const drawH = Math.max(1, chartH - padT - padB);

  const chart = useMemo(() => {
    if (!filteredData || filteredData.length < 2) return null;
    let minH = Infinity, maxH = -Infinity;
    for (const p of filteredData) {
      if (p.height < minH) minH = p.height;
      if (p.height > maxH) maxH = p.height;
    }
    const range = maxH - minH || 1;
    const points = filteredData.map((p, i) => ({
      x: padL + (i / (filteredData.length - 1)) * drawW,
      y: padT + drawH - ((p.height - minH) / range) * drawH,
      height: p.height,
    }));
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fillD = pathD + ` L${points[points.length - 1].x},${padT + drawH} L${points[0].x},${padT + drawH}Z`;
    const activeIdx = Math.min(localChIndex, filteredData.length - 1);
    return { pathD, fillD, minH, maxH, activePt: points[activeIdx] };
  }, [filteredData, localChIndex, drawW, drawH]);

  if (!chart) return null;

  // ── Resize handle position helper ─────────────────────────────────────────
  const hs = ELEV_HANDLE;
  const hh = hs / 2;
  const hStyles = {
    n:  { top: -hh,     left: hs,    right: hs,   height: hs, cursor: 'n-resize'  },
    s:  { bottom: -hh,  left: hs,    right: hs,   height: hs, cursor: 's-resize'  },
    e:  { right: -hh,   top: hs,     bottom: hs,  width: hs,  cursor: 'e-resize'  },
    w:  { left: -hh,    top: hs,     bottom: hs,  width: hs,  cursor: 'w-resize'  },
    ne: { top: -hh,     right: -hh,  width: hs,   height: hs, cursor: 'ne-resize' },
    nw: { top: -hh,     left: -hh,   width: hs,   height: hs, cursor: 'nw-resize' },
    se: { bottom: -hh,  right: -hh,  width: hs,   height: hs, cursor: 'se-resize' },
    sw: { bottom: -hh,  left: -hh,   width: hs,   height: hs, cursor: 'sw-resize' },
  };

  return (
    <div style={{
      position: 'fixed', left: r.left, top: r.top, width: r.w, height: r.h,
      zIndex: 20, userSelect: 'none',
      borderRadius: 7, overflow: 'visible',
      background: 'rgba(15,23,42,0.82)',
      border: '1px solid rgba(99,102,241,0.22)',
      boxShadow: '0 6px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(56,189,248,0.04)',
      backdropFilter: 'blur(10px)',
    }}>
      {/* ── Resize handles (8 directions) ─────────────────────────────── */}
      {Object.entries(hStyles).map(([dir, st]) => (
        <div
          key={dir}
          data-resize={dir}
          onMouseDown={(e) => onResizeMouseDown(e, dir)}
          style={{ position: 'absolute', background: 'transparent', zIndex: 3, ...st }}
        />
      ))}

      {/* ── Title / drag bar ──────────────────────────────────────────── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          height: ELEV_TITLE_H, display: 'flex', alignItems: 'center',
          padding: '0 8px', gap: 5,
          cursor: 'grab',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
          borderRadius: '7px 7px 0 0',
          background: 'rgba(99,102,241,0.06)',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
      >
        <span className="material-icons" style={{ fontSize: 12, color: 'rgba(148,163,184,0.35)', pointerEvents: 'none' }}>drag_indicator</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(56,189,248,0.75)', letterSpacing: '1.2px', textTransform: 'uppercase', pointerEvents: 'none' }}>
          Elev Profile
        </span>
        <span style={{ fontSize: 7.5, color: 'rgba(148,163,184,0.38)', marginLeft: 'auto', fontFamily: 'monospace', pointerEvents: 'none' }}>
          {chart.minH.toFixed(2)} – {chart.maxH.toFixed(2)} m
        </span>
        {onClose && (
          <button
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Hide elevation profile"
            style={{
              marginLeft: 6, flexShrink: 0,
              width: 16, height: 16, borderRadius: 3,
              background: 'transparent', border: 'none',
              color: 'rgba(148,163,184,0.4)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(148,163,184,0.4)'}
          >
            <span className="material-icons" style={{ fontSize: 11 }}>close</span>
          </button>
        )}
      </div>

      {/* ── Chart SVG ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: ELEV_TITLE_H, left: 0, right: 0, bottom: 0, overflow: 'hidden', borderRadius: '0 0 7px 7px', pointerEvents: 'none' }}>
        <svg width={chartW} height={chartH} style={{ display: 'block' }}>
          {/* Fill */}
          <path d={chart.fillD} fill="rgba(56,189,248,0.07)" />
          {/* Line */}
          <path d={chart.pathD} fill="none" stroke="rgba(56,189,248,0.65)" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
          {/* Active marker */}
          {chart.activePt && (
            <>
              <line x1={chart.activePt.x} y1={padT} x2={chart.activePt.x} y2={padT + drawH}
                stroke="rgba(244,129,32,0.45)" strokeWidth="0.9" strokeDasharray="2,2" />
              <circle cx={chart.activePt.x} cy={chart.activePt.y} r={3.5}
                fill="#f48120" stroke="rgba(255,255,255,0.5)" strokeWidth="0.9" />
              <text x={chart.activePt.x + 5} y={chart.activePt.y - 3}
                fill="#f48120" fontSize="7" fontWeight="700" fontFamily="'Segoe UI',sans-serif">
                {chart.activePt.height.toFixed(2)}m
              </text>
            </>
          )}
          {/* Y-axis labels */}
          <text x={2} y={padT + 8}       fill="rgba(148,163,184,0.4)" fontSize="6" fontFamily="'Segoe UI',sans-serif">{chart.maxH.toFixed(2)}</text>
          <text x={2} y={padT + drawH - 1} fill="rgba(148,163,184,0.4)" fontSize="6" fontFamily="'Segoe UI',sans-serif">{chart.minH.toFixed(2)}</text>
        </svg>
      </div>
    </div>
  );
}

// ── Separate component so the tooltip is always rendered outside the SVG ────
export function Pt3DTooltip({ pt, x, y }) {
  const cant    = pt.cant * 1000;
  const cSign   = cant >= 0 ? '+' : '';
  const cDir    = cant >  0.05 ? 'L high' : cant < -0.05 ? 'R high' : 'level';
  const gColor  = pt.gaugeStatus === 'fail' ? '#ef4444' : pt.gaugeStatus === 'warn' ? '#f97316' : '#10b981';
  const gBadge  = pt.gaugeStatus === 'fail' ? 'FAIL'    : pt.gaugeStatus === 'warn' ? 'WARN'    : 'OK';
  const cColor  = pt.cantStatus  === 'fail' ? '#ef4444' : pt.cantStatus  === 'warn' ? '#f97316' : '#10b981';
  const tColor  = pt.type === 'arc' ? '#f59e0b' : '#10b981';
  const diffMM  = pt.gaugeDiff * 1000;

  // Clamp so tooltip doesn't overflow the viewport bottom
  const top = Math.min(y - 10, (typeof window !== 'undefined' ? window.innerHeight : 800) - 260);

  const ROW = { display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr', gap: '1px 8px', fontSize: 9 };
  const MONO = { fontFamily: 'monospace', color: '#cbd5e1', textAlign: 'right' };

  return (
    <div style={{
      position: 'fixed', left: x + 16, top,
      zIndex: 9999, pointerEvents: 'none',
      background: 'rgba(45,46,47,0.97)',
      border: '1px solid rgba(244,129,32,0.38)',
      borderRadius: 8, padding: '10px 14px',
      minWidth: 252, maxWidth: 310,
      boxShadow: '0 10px 36px rgba(0,0,0,0.75), 0 0 0 1px rgba(244,129,32,0.08)',
      fontSize: 10, color: '#94a3b8', lineHeight: 1.65,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ color: tColor, fontWeight: 700, fontSize: 12 }}>
          Pt #{pt.pointNumber}
        </span>
        <span style={{ color: '#64748b', fontSize: 9 }}>
          Ch {pt.chainage.toFixed(3)} m &nbsp;·&nbsp;
          {pt.type === 'arc' && pt.radius > 0 && pt.radius < 99999
            ? `Arc R=${pt.radius.toFixed(0)} m`
            : 'Straight'}
        </span>
      </div>

      {/* Gauge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ color: '#64748b', minWidth: 36 }}>Gauge</span>
        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{pt.gauge.toFixed(4)} m</span>
        <span style={{
          padding: '0 4px', borderRadius: 3, fontSize: 8, fontWeight: 700,
          background: `${gColor}22`, color: gColor,
        }}>{gBadge}</span>
        <span style={{ fontSize: 9, color: diffMM >= 0 ? '#fb923c' : '#60a5fa' }}>
          Δ{diffMM >= 0 ? '+' : ''}{diffMM.toFixed(2)} mm
        </span>
      </div>

      {/* Cant */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color: '#64748b', minWidth: 36 }}>Cant</span>
        <span style={{ color: '#a78bfa', fontWeight: 600 }}>{cSign}{cant.toFixed(2)} mm</span>
        <span style={{ fontSize: 9, color: '#64748b' }}>{cDir}</span>
        <span style={{
          padding: '0 4px', borderRadius: 3, fontSize: 8, fontWeight: 700,
          background: `${cColor}22`, color: cColor, marginLeft: 'auto',
        }}>{pt.cantStatus?.toUpperCase()}</span>
      </div>

      {/* Coordinates grid */}
      <div style={{ borderTop: '1px solid rgba(244,129,32,0.15)', paddingTop: 7 }}>
        {/* Header */}
        <div style={ROW}>
          <span style={{ color: '#475569' }} />
          <span style={{ color: '#475569', textAlign: 'right' }}>Easting</span>
          <span style={{ color: '#475569', textAlign: 'right' }}>Northing</span>
          <span style={{ color: '#475569', textAlign: 'right' }}>Height</span>
        </div>
        {[
          { label: 'L',  color: '#3b82f6', e: pt.leftEasting,  n: pt.leftNorthing,  h: pt.leftHeight  },
          { label: 'CL', color: '#10b981', e: pt.easting,       n: pt.northing,       h: pt.height      },
          { label: 'R',  color: '#ef4444', e: pt.rightEasting, n: pt.rightNorthing, h: pt.rightHeight },
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
}

export default Rail3DView;
