import { useEffect, useRef, useCallback, useState, useMemo, memo, forwardRef, useImperativeHandle } from 'react';
import { gsap } from 'gsap';
import {
  renderTrackView,
  drawMinimap,
  findPointAtPosition,
  getTransform,
} from '../utils/rendering';
import { getBounds } from '../utils/geometry';
import GraphView from './GraphView';
import Rail3DView, { ElevationProfile, Pt3DTooltip } from './Rail3DView';
import RailCompareView from './RailCompareView';

const MemoGraphView = memo(GraphView);
const MemoRailCompareView = memo(RailCompareView);
const MemoRail3DView = memo(Rail3DView);

const TrackView = forwardRef(function TrackView({
  trackData, simIndex,
  viewScale, viewScaleRef, viewOffsetX, viewOffsetY,
  viewOffsetXRef, viewOffsetYRef,
  onZoomIn, onZoomOut, onResetView, onSetViewScale,
  canvasRef,
  minimapCanvasRef,
  onMinimapMouseDown, onMinimapMouseUp,
  onMinimapWheel,
  graphViewActive, toggleGraphView,
  railVisibility, onRailCheckboxChange,
  designGauge, gaugeType, chartCount, onChartCountChange, chartSelections, onToggleChart, chartDefs,
  tooltip, setTooltip,
  hoveredPoint, setHoveredPoint,
  isDraggingRef,
  onActivePointChange,
  showSegDist = true,
  showCumDist = true,
  showElevProfile = true,
  onElevProfileChange,
  showNavOverlay = true,
  onNavOverlayChange,
  onViewModeChange,
}, ref) {
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 400 });
  const [hoveredPos, setHoveredPos] = useState({ x: 0, y: 0 });
  const [show3D, setShow3D] = useState(false);
  const show3DRef = useRef(false);

  const [showCompare, setShowCompare] = useState(false);

  // Notify parent when view mode changes
  useEffect(() => {
    if (!onViewModeChange) return;
    if (show3D) { onViewModeChange('3d'); return; }
    if (showCompare) { onViewModeChange('compare'); return; }
    if (graphViewActive) { onViewModeChange('analytics'); return; }
    onViewModeChange('2d');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show3D, showCompare, graphViewActive]);
  const [showJumpPanel, setShowJumpPanel] = useState(false);
  const [jumpPinned, setJumpPinned] = useState(false);

  const handleToggleCompare = useCallback(() => {
    setShowCompare(v => !v);
  }, []);
  const [chIndex, setChIndex] = useState(0);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [activeRange, setActiveRange] = useState(null); // { fromIdx, toIdx } | null

  // 3D view state
  const [pan3D, setPan3D] = useState({ x: 0, y: 0 });
  const pan3DRef = useRef({ x: 0, y: 0 });
  const minimap3DDragging = useRef(false);
  const [zMul, setZmul] = useState(100);
  const [zOverlayOpen, setZOverlayOpen] = useState(false);
  const [showPoints3D, setShowPoints3D] = useState(true);
  const [showPoints2D, setShowPoints2D] = useState(true);
  const [trackOffScreen, setTrackOffScreen] = useState(false);
  const [reset3DKey, setReset3DKey] = useState(0);
  const [resetMapKey, setResetMapKey] = useState(0);
  const [mapToggleKey, setMapToggleKey] = useState(0);
  const rail3DRef = useRef(null);
  const [zoom3D, setZoom3D] = useState(1.0);
  // Shared GSAP tween target ref for proper killTweensOf
  const gsapTweenRef = useRef(null);
  // Zoom slider show/hide ref
  const zoomSliderRef = useRef(null);
  const zoomHoveredRef = useRef(false);

  // View panel transition refs
  const view3DRef = useRef(null);
  const viewGraphRef = useRef(null);
  const viewCompareRef = useRef(null);

  // Jump panel hover timer (keeps panel open while cursor travels button → panel)
  const jumpCloseTimerRef = useRef(null);
  const scheduleJumpClose = useCallback(() => {
    clearTimeout(jumpCloseTimerRef.current);
    jumpCloseTimerRef.current = setTimeout(() => setShowJumpPanel(false), 120);
  }, []);
  const cancelJumpClose = useCallback(() => {
    clearTimeout(jumpCloseTimerRef.current);
  }, []);

  // Draggable toolbar state — persisted across refreshes
  const barRef = useRef(null);
  const [barPosition, setBarPosition] = useState(null); // null = default CSS pos; never persisted
  const barDragOffsetRef = useRef({ x: 0, y: 0 });
  const barDraggingRef = useRef(false);

  // Ensure gsap tween target exists
  if (!gsapTweenRef.current) {
    gsapTweenRef.current = { ox: 0, oy: 0 };
  }

  // Track container size for ElevationProfile
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 20 && height > 20) setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep show3DRef in sync
  useEffect(() => { show3DRef.current = show3D; }, [show3D]);

  // ── Zoom slider show/hide on hover ──────────────────────────────────────
  // Initial hidden state
  useEffect(() => {
    if (zoomSliderRef.current) {
      gsap.set(zoomSliderRef.current, {
        opacity: 0,
        maxWidth: 0,
        marginLeft: 0,
        marginRight: 0,
        paddingLeft: 0,
        paddingRight: 0,
        overflow: 'hidden',
      });
    }
  }, []);

  const showZoomSlider = useCallback(() => {
    if (!zoomSliderRef.current) return;
    zoomHoveredRef.current = true;
    gsap.killTweensOf(zoomSliderRef.current);
    gsap.to(zoomSliderRef.current, {
      opacity: 1,
      maxWidth: 180,
      marginLeft: 6,
      marginRight: 2,
      paddingLeft: 0,
      paddingRight: 0,
      duration: 0.3,
      ease: 'power2.out',
    });
  }, []);

  const btnPulse = useCallback((e) => {
    gsap.fromTo(e.currentTarget,
      { scale: 0.93 },
      { scale: 1, duration: 0.25, ease: 'back.out(1.7)' }
    );
  }, []);

  const hideZoomSlider = useCallback(() => {
    if (!zoomSliderRef.current) return;
    zoomHoveredRef.current = false;
    gsap.killTweensOf(zoomSliderRef.current);
    gsap.to(zoomSliderRef.current, {
      opacity: 0,
      maxWidth: 0,
      marginLeft: 0,
      marginRight: 0,
      paddingLeft: 0,
      paddingRight: 0,
      duration: 0.25,
      ease: 'power2.in',
    });
  }, []);

  // ── Coordinated view panel transitions ──────────────────────────────────
  const prevViewRef = useRef('2d');

  useEffect(() => {
    const el = view3DRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (show3D) {
      el.style.display = 'block';
      gsap.fromTo(el,
        { opacity: 0 },
        { opacity: 1, duration: 0.35, ease: 'power2.out', force3D: true,
          onComplete: () => { el.style.pointerEvents = 'auto'; }
        }
      );
    } else if (prevViewRef.current === '3d') {
      gsap.to(el, {
        opacity: 0, duration: 0.2, ease: 'power2.in', force3D: true,
        onComplete: () => { el.style.display = 'none'; el.style.pointerEvents = 'none'; }
      });
    } else {
      el.style.display = 'none'; el.style.pointerEvents = 'none';
    }
    prevViewRef.current = show3D ? '3d' : prevViewRef.current;
  }, [show3D]);

  useEffect(() => {
    const el = viewGraphRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (graphViewActive) {
      gsap.fromTo(el,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out', force3D: true,
          onComplete: () => { el.style.pointerEvents = 'auto'; }
        }
      );
    } else {
      gsap.to(el, {
        opacity: 0, scale: 0.96, duration: 0.2, ease: 'power2.in', force3D: true,
        onComplete: () => { el.style.pointerEvents = 'none'; }
      });
    }
  }, [graphViewActive]);

  useEffect(() => {
    const el = viewCompareRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (showCompare) {
      gsap.fromTo(el,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out', force3D: true,
          onComplete: () => { el.style.pointerEvents = 'auto'; }
        }
      );
    } else {
      gsap.to(el, {
        opacity: 0, scale: 0.96, duration: 0.2, ease: 'power2.in', force3D: true,
        onComplete: () => { el.style.pointerEvents = 'none'; }
      });
    }
  }, [showCompare]);

  // ── Draggable toolbar ────────────────────────────────────────────────────
  const handleBarMouseDown = useCallback((e) => {
    // Allow drag from anywhere on the bar except interactive controls
    if (e.target.closest('button, input, select, a')) return;
    e.preventDefault();
    const rect = barRef.current.getBoundingClientRect();
    barDragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    barDraggingRef.current = true;
  }, []);

  const handleBarTouchStart = useCallback((e) => {
    if (e.target.closest('button, input, select, a')) return;
    e.preventDefault();
    const t = e.touches[0];
    const rect = barRef.current.getBoundingClientRect();
    barDragOffsetRef.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    barDraggingRef.current = true;
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!barDraggingRef.current || !barRef.current) return;
      const container = barRef.current.parentElement;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const barW = barRef.current.offsetWidth;
      const barH = barRef.current.offsetHeight;
      const x = Math.max(0, Math.min(e.clientX - cRect.left - barDragOffsetRef.current.x, cRect.width - barW));
      const y = Math.max(0, Math.min(e.clientY - cRect.top - barDragOffsetRef.current.y, cRect.height - barH));
      setBarPosition({ x, y });
    };
    const onUp = () => { barDraggingRef.current = false; };
    const onTouchMove = (e) => {
      e.preventDefault();
      if (!barDraggingRef.current || !barRef.current) return;
      const container = barRef.current.parentElement;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const t = e.touches[0];
      const barW = barRef.current.offsetWidth;
      const barH = barRef.current.offsetHeight;
      const x = Math.max(0, Math.min(t.clientX - cRect.left - barDragOffsetRef.current.x, cRect.width - barW));
      const y = Math.max(0, Math.min(t.clientY - cRect.top - barDragOffsetRef.current.y, cRect.height - barH));
      setBarPosition({ x, y });
    };
    const onTouchEnd = () => { barDraggingRef.current = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // ── Filtered data based on active range ──────────────────────────────────
  const displayData = useMemo(() => {
    if (!activeRange) return trackData;
    const s = Math.max(0, activeRange.fromIdx);
    const e = Math.min(trackData.length - 1, activeRange.toIdx);
    return s <= e && s >= 0 ? trackData.slice(s, e + 1) : trackData;
  }, [trackData, activeRange]);

  // ChIndex within displayData
  const displayChIndex = useMemo(() => {
    if (!activeRange) return chIndex;
    if (chIndex >= activeRange.fromIdx && chIndex <= activeRange.toIdx) {
      return chIndex - activeRange.fromIdx;
    }
    return 0;
  }, [chIndex, activeRange]);

  // Hovered index within displayData
  const displayHoveredIdx = useMemo(() => {
    if (hoveredPoint < 0) return -1;
    if (!activeRange) return hoveredPoint;
    if (hoveredPoint >= activeRange.fromIdx && hoveredPoint <= activeRange.toIdx) {
      return hoveredPoint - activeRange.fromIdx;
    }
    return -1;
  }, [hoveredPoint, activeRange]);

  // Global active index into full trackData (for map sidebar activeIdx)
  const globalActiveIdx = (activeRange?.fromIdx ?? 0) + displayChIndex;

  // ── Visible point range based on current viewport ─────────────────────────
  const visibleIdxRange = useMemo(() => {
    const canvas = canvasRef.current;
    if (trackData.length < 2 || !canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return null;
    const { scale, ox, oy } = getTransform(trackData, w, h, viewScale, viewOffsetX, viewOffsetY);
    const worldLeft = -ox / scale;
    const worldRight = (w - ox) / scale;
    const worldTop = oy / scale;
    const worldBottom = (oy - h) / scale;
    let first = -1, last = -1;
    for (let i = 0; i < trackData.length; i++) {
      const p = trackData[i];
      if (p.easting >= worldLeft && p.easting <= worldRight &&
          p.northing >= worldBottom && p.northing <= worldTop) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first === -1) return null;
    return { fromIdx: first, toIdx: last };
  }, [trackData, viewScale, viewOffsetX, viewOffsetY]);

  // ── Filtered data for GraphView — only points in current viewport ────────
  const graphViewData = useMemo(() => {
    if (!visibleIdxRange) return displayData;
    const dataFrom = activeRange ? activeRange.fromIdx : 0;
    const dataTo = activeRange ? activeRange.toIdx : trackData.length - 1;
    const from = Math.max(dataFrom, visibleIdxRange.fromIdx);
    const to = Math.min(dataTo, visibleIdxRange.toIdx);
    return from <= to ? trackData.slice(from, to + 1) : displayData;
  }, [trackData, activeRange, visibleIdxRange, displayData]);

  // Start offset of graphViewData within fullTrackData — used by GraphView to map globalActiveIdx → chart index
  const graphViewStartIdx = useMemo(() => {
    if (!visibleIdxRange) return activeRange?.fromIdx ?? 0;
    const dataFrom = activeRange?.fromIdx ?? 0;
    return Math.max(dataFrom, visibleIdxRange.fromIdx);
  }, [activeRange, visibleIdxRange]);

  // Sync chIndex when displayData changes
  useEffect(() => {
    if (displayData.length > 0) {
      setChIndex(prev => Math.min(prev, trackData.length - 1));
    }
  }, [displayData, trackData]);

  // Notify parent of active point whenever chIndex changes
  useEffect(() => {
    if (onActivePointChange && trackData.length > 0) {
      const idx = Math.max(0, Math.min(chIndex, trackData.length - 1));
      onActivePointChange(trackData[idx] ?? null);
    }
  }, [chIndex, trackData, onActivePointChange]);

  // ── Apply range filter ────────────────────────────────────────────────────
  const applyRange = useCallback(() => {
    if (!rangeFrom || !rangeTo) return;

    const resolveIdx = (val) => {
      const trimmed = val.trim();
      // Try exact pointNumber name match first
      const byName = trackData.findIndex(p => String(p.pointNumber) === trimmed);
      if (byName !== -1) return byName;
      // Fall back to 0-based sequential index
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 0 && n < trackData.length) return n;
      return -1;
    };

    const fromIdx = resolveIdx(rangeFrom);
    const toIdx   = resolveIdx(rangeTo);
    if (fromIdx === -1 || toIdx === -1) return;

    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    setActiveRange({ fromIdx: lo, toIdx: hi });
    setChIndex(lo);
    jumpToPointInData(trackData, lo);
  }, [rangeFrom, rangeTo, trackData]);

  // ── Clear range filter ────────────────────────────────────────────────────
  const clearRange = useCallback(() => {
    setActiveRange(null);
    setRangeFrom('');
    setRangeTo('');
    onResetView();
  }, [onResetView]);

  // ── Map sidebar visible range → pre-fill Point Range Filter inputs ────────
  const handleMapRangeChange = useCallback((range) => {
    if (!range) return;
    // Skip if map just zoomed to reflect activeRange (no-op to avoid loop)
    if (activeRange &&
        Math.abs(range.fromIdx - activeRange.fromIdx) <= 1 &&
        Math.abs(range.toIdx   - activeRange.toIdx)   <= 1) return;
    const from = trackData[range.fromIdx];
    const to   = trackData[range.toIdx];
    if (!from || !to) return;
    setRangeFrom(String(from.pointNumber));
    setRangeTo(String(to.pointNumber));
  }, [trackData, activeRange]);

  // ── Jump to a specific point by index — animated ──────────────────────────
  const jumpToPointInData = useCallback((data, idx) => {
    if (!data || data.length < 2 || !containerRef.current) return;
    const idxClamped = Math.max(0, Math.min(idx, data.length - 1));
    setChIndex(idxClamped);

    const pt = data[idxClamped];
    if (!pt) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    // Use full trackData for bounds so zoom level stays consistent
    const bounds = getBounds(trackData);
    const baseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
    const scale = viewScaleRef.current * baseScale;

    const targetOx = (bounds.centerX - pt.easting) * scale;
    const targetOy = (pt.northing - bounds.centerY) * scale;

    const tgt = gsapTweenRef.current;
    tgt.ox = viewOffsetXRef.current;
    tgt.oy = viewOffsetYRef.current;
    gsap.killTweensOf(tgt);
    gsap.to(tgt, {
      ox: targetOx,
      oy: targetOy,
      duration: 0.4,
      ease: 'power2.out',
      onUpdate() {
        viewOffsetXRef.current = tgt.ox;
        viewOffsetYRef.current = tgt.oy;
      },
      onComplete() {
        viewOffsetXRef.current = targetOx;
        viewOffsetYRef.current = targetOy;
      },
    });
  }, [canvasRef, viewScaleRef, viewOffsetXRef, viewOffsetYRef, trackData]);

  // Arrow key navigation — Left/Right step through points
  useEffect(() => {
    if (!trackData || trackData.length === 0) return;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const newIdx = Math.max(0, Math.min(trackData.length - 1, chIndex + step));
      if (newIdx !== chIndex) jumpToPointInData(trackData, newIdx);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [trackData, chIndex, jumpToPointInData]);

  const jumpToPoint = useCallback((idx) => {
    jumpToPointInData(displayData, idx);
    // Correct chIndex to global trackData index when range is active
    if (activeRange) {
      const corrected = activeRange.fromIdx + Math.max(0, Math.min(idx, displayData.length - 1));
      setChIndex(corrected);
    }
  }, [jumpToPointInData, displayData, activeRange]);

  // ── Jump to point — immediate (no animation), used by slider drag ──────
  const jumpToPointInstant = useCallback((idx) => {
    if (!displayData || displayData.length < 2 || !containerRef.current || !canvasRef.current) return;
    const idxClamped = Math.max(0, Math.min(idx, displayData.length - 1));
    const pt = displayData[idxClamped];
    if (!pt) return;

    if (gsapTweenRef.current) {
      gsap.killTweensOf(gsapTweenRef.current);
    }

    const canvas = canvasRef.current;
    const w = canvas.width;
    const h = canvas.height;
    const bounds = getBounds(trackData);
    const baseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
    const scale = viewScaleRef.current * baseScale;
    viewOffsetXRef.current = (bounds.centerX - pt.easting) * scale;
    viewOffsetYRef.current = (pt.northing - bounds.centerY) * scale;

    if (activeRange) {
      const corrected = activeRange.fromIdx + idxClamped;
      setChIndex(corrected);
    } else {
      setChIndex(idxClamped);
    }
  }, [displayData, canvasRef, viewScaleRef, viewOffsetXRef, viewOffsetYRef, trackData, activeRange]);

  // ── Zoom slider handler — zooms toward active jump-to-point (falls back to canvas center) ──
  const handleZoomChange = useCallback((newScalePct) => {
    const clamped = Math.max(5, Math.min(3000, newScalePct)) / 100;
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const oldScale = viewScaleRef.current;
      const ratio = clamped / oldScale;

      const pt = displayData.length > 0 ? displayData[displayChIndex] : null;
      let fx, fy;
      if (pt) {
        const bounds = getBounds(trackData);
        const baseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
        const scale = oldScale * baseScale;
        const ox = w / 2 - bounds.centerX * scale + viewOffsetXRef.current;
        const oy = h / 2 + bounds.centerY * scale + viewOffsetYRef.current;
        fx = pt.easting * scale + ox;
        fy = -pt.northing * scale + oy;
      } else {
        fx = w / 2;
        fy = h / 2;
      }

      viewOffsetXRef.current = fx - (fx - viewOffsetXRef.current) * ratio;
      viewOffsetYRef.current = fy - (fy - viewOffsetYRef.current) * ratio;
    }
    viewScaleRef.current = clamped;
    if (onSetViewScale) onSetViewScale(clamped);
  }, [canvasRef, viewScaleRef, viewOffsetXRef, viewOffsetYRef, onSetViewScale, displayData, displayChIndex, trackData]);

  // Resize and render
  const doRender = useCallback(() => {
    if (canvasRef.current && containerRef.current) {
      const container = containerRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvasRef.current.width !== w || canvasRef.current.height !== h) {
        canvasRef.current.width = w;
        canvasRef.current.height = h;
      }
      renderTrackView(
        canvasRef.current.getContext('2d'),
        canvasRef.current,
        displayData, simIndex,
        viewScaleRef.current,
        viewOffsetXRef.current,
        viewOffsetYRef.current,
        false,
        displayChIndex, // highlight index within displayData
        showSegDist && showPoints2D,
        showCumDist && showPoints2D,
        showPoints2D
      );
    }
  }, [displayData, simIndex, viewScaleRef, viewOffsetXRef, viewOffsetYRef, canvasRef, displayChIndex, showSegDist, showCumDist, showPoints2D]);

  // Render loop
  const offScreenCheckRef = useRef(0); // throttle the off-screen check
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      doRender();
      if (minimapCanvasRef.current && canvasRef.current) {
        drawMinimap(
          minimapCanvasRef.current,
          trackData,
          canvasRef.current,
          viewScaleRef.current,
          viewOffsetXRef.current,
          viewOffsetYRef.current
        );
      }
      // Check once per ~60 frames whether any track point is visible
      offScreenCheckRef.current = (offScreenCheckRef.current + 1) % 60;
      if (offScreenCheckRef.current === 0 && canvasRef.current && displayData.length >= 2) {
        const canvas = canvasRef.current;
        const { scale, ox, oy } = getTransform(displayData, canvas.width, canvas.height, viewScaleRef.current, viewOffsetXRef.current, viewOffsetYRef.current);
        const visible = displayData.some(p => {
          const sx = p.easting * scale + ox;
          const sy = -p.northing * scale + oy;
          return sx > -40 && sx < canvas.width + 40 && sy > -40 && sy < canvas.height + 40;
        });
        setTrackOffScreen(!visible);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [doRender, trackData, viewScaleRef, viewOffsetXRef, viewOffsetYRef, canvasRef, minimapCanvasRef]);

  // Mouse handling
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const clickStartRef    = useRef(null); // mousedown position for click vs drag detection
  const lastHoveredRef   = useRef(-1);   // displayData-local index of hovered point

  // ── Ctrl+drag zoom-box state ─────────────────────────────────────────────
  const [zoomBox2D, setZoomBox2D] = useState(null); // { x1,y1,x2,y2 } in canvas-relative px
  const isZoomBox2DRef = useRef(false);
  const zoomBox2DDrawRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      isZoomBox2DRef.current = true;
      zoomBox2DDrawRef.current = { x1: x, y1: y, x2: x, y2: y };
      setZoomBox2D({ x1: x, y1: y, x2: x, y2: y });
      canvas.style.cursor = 'crosshair';
      return;
    }
    isDragging.current = true;
    clickStartRef.current = { x: e.clientX, y: e.clientY };
    dragStart.current = {
      x: e.clientX - viewOffsetXRef.current,
      y: e.clientY - viewOffsetYRef.current,
    };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';

    // Document-level listeners so pan continues even if pointer leaves canvas
    const onDocMove = (ev) => {
      if (!isDragging.current) return;
      viewOffsetXRef.current = ev.clientX - dragStart.current.x;
      viewOffsetYRef.current = ev.clientY - dragStart.current.y;
    };
    const onDocUp = (ev) => {
      isDragging.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
      if (clickStartRef.current) {
        const dx = ev.clientX - clickStartRef.current.x;
        const dy = ev.clientY - clickStartRef.current.y;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && lastHoveredRef.current >= 0) {
          jumpToPointInData(displayData, lastHoveredRef.current);
        }
        clickStartRef.current = null;
      }
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup', onDocUp);
    };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);
  }, [viewOffsetXRef, viewOffsetYRef, canvasRef, displayData, jumpToPointInData]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Update zoom-box while Ctrl-dragging
    if (isZoomBox2DRef.current) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const updated = { ...zoomBox2DDrawRef.current, x2: x, y2: y };
      zoomBox2DDrawRef.current = updated;
      setZoomBox2D({ ...updated });
      return;
    }

    // Pan is handled by the document-level listener in handleMouseDown
    if (!isDragging.current) {
      // Hover detection — search displayData so the transform matches what's rendered.
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const found = findPointAtPosition(
        displayData, mx, my, canvas,
        viewScaleRef.current,
        viewOffsetXRef.current,
        viewOffsetYRef.current
      );

      if (found >= 0) {
        setTooltip({ visible: true, x: e.clientX, y: e.clientY, html: '' });
        setHoveredPos({ x: e.clientX, y: e.clientY });
        canvas.style.cursor = 'pointer';
        lastHoveredRef.current = found; // displayData-local index
        // Convert displayData-local index back to global trackData index
        const globalIdx = activeRange ? activeRange.fromIdx + found : found;
        setHoveredPoint(globalIdx);
      } else {
        setTooltip(prev => ({ ...prev, visible: false }));
        canvas.style.cursor = e.ctrlKey ? 'crosshair' : 'default';
        lastHoveredRef.current = -1;
        setHoveredPoint(-1);
      }
    }
  }, [displayData, activeRange, viewScaleRef, viewOffsetXRef, viewOffsetYRef, canvasRef, setTooltip, setHoveredPoint, setHoveredPos]);

  const handleMouseUp = useCallback((e) => {
    // Finish zoom-box: compute new viewScale and offsets to fit the selection
    if (isZoomBox2DRef.current) {
      isZoomBox2DRef.current = false;
      const box = zoomBox2DDrawRef.current;
      zoomBox2DDrawRef.current = null;
      setZoomBox2D(null);

      const canvas = canvasRef.current;
      if (box && canvas && trackData.length >= 2) {
        const bx1 = Math.min(box.x1, box.x2);
        const by1 = Math.min(box.y1, box.y2);
        const bx2 = Math.max(box.x1, box.x2);
        const by2 = Math.max(box.y1, box.y2);
        const bw = bx2 - bx1;
        const bh = by2 - by1;
        const w = canvas.width;
        const h = canvas.height;

        const { scale, ox, oy } = getTransform(
          displayData, w, h,
          viewScaleRef.current, viewOffsetXRef.current, viewOffsetYRef.current
        );

        if (bw > 10 && bh > 10) {
          // Zoom to fit the selected box
          const bcx = (bx1 + bx2) / 2;
          const bcy = (by1 + by2) / 2;

          // World coords at box center
          const worldCx = (bcx - ox) / scale;
          const worldCy = -(bcy - oy) / scale;

          // New viewScale so the box fills the canvas (with 10% padding)
          const zf = Math.min(w / bw, h / bh) * 0.88;
          const newViewScale = Math.max(0.05, Math.min(30, viewScaleRef.current * zf));

          // New offsets so worldCx/worldCy lands at canvas center
          const bounds = getBounds(displayData);
          const newBaseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
          const newScale = newViewScale * newBaseScale;
          const cx = (bounds.minX + bounds.maxX) / 2;
          const cy = (bounds.minY + bounds.maxY) / 2;
          const targetOffX = (cx - worldCx) * newScale;
          const targetOffY = (worldCy - cy) * newScale;

          const tgt = gsapTweenRef.current;
          tgt.ox = viewOffsetXRef.current;
          tgt.oy = viewOffsetYRef.current;
          gsap.killTweensOf(tgt);
          gsap.to(tgt, {
            ox: targetOffX,
            oy: targetOffY,
            duration: 0.45,
            ease: 'power2.out',
            onUpdate() {
              viewOffsetXRef.current = tgt.ox;
              viewOffsetYRef.current = tgt.oy;
            },
            onComplete() {
              viewOffsetXRef.current = targetOffX;
              viewOffsetYRef.current = targetOffY;
            },
          });
          viewScaleRef.current = newViewScale;
          if (onSetViewScale) onSetViewScale(newViewScale);
        } else {
          // Ctrl+click (tiny box) — zoom 2× toward click point
          const mx = box.x1;
          const my = box.y1;
          const oldVS = viewScaleRef.current;
          const newVS = Math.min(30, oldVS * 2);
          const ratio = newVS / oldVS;
          const targetOffX = mx - (mx - viewOffsetXRef.current) * ratio;
          const targetOffY = my - (my - viewOffsetYRef.current) * ratio;

          const tgt = gsapTweenRef.current;
          tgt.ox = viewOffsetXRef.current;
          tgt.oy = viewOffsetYRef.current;
          gsap.killTweensOf(tgt);
          gsap.to(tgt, {
            ox: targetOffX,
            oy: targetOffY,
            duration: 0.35,
            ease: 'power2.out',
            onUpdate() {
              viewOffsetXRef.current = tgt.ox;
              viewOffsetYRef.current = tgt.oy;
            },
            onComplete() {
              viewOffsetXRef.current = targetOffX;
              viewOffsetYRef.current = targetOffY;
            },
          });
          viewScaleRef.current = newVS;
          if (onSetViewScale) onSetViewScale(newVS);
        }
      }

      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
      return;
    }

    // Drag-end and click-to-select are handled by the document listener in handleMouseDown
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  }, [canvasRef, trackData, displayData, viewScaleRef, viewOffsetXRef, viewOffsetYRef, onSetViewScale, gsapTweenRef, jumpToPointInData]);

  const handleMouseLeave = useCallback(() => {
    // isDragging is now cleared by the document mouseup listener; only clear zoom-box and tooltip here
    if (isZoomBox2DRef.current) {
      isZoomBox2DRef.current = false;
      zoomBox2DDrawRef.current = null;
      setZoomBox2D(null);
    }
    setTooltip(prev => ({ ...prev, visible: false }));
  }, [setTooltip]);

  // Touch pan — non-passive so we can preventDefault to block scroll while panning
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      isDragging.current = true;
      clickStartRef.current = { x: t.clientX, y: t.clientY };
      dragStart.current = {
        x: t.clientX - viewOffsetXRef.current,
        y: t.clientY - viewOffsetYRef.current,
      };
    };

    const onTouchMove = (e) => {
      if (!isDragging.current || e.touches.length !== 1) return;
      e.preventDefault(); // prevent page scroll while panning
      const t = e.touches[0];
      viewOffsetXRef.current = t.clientX - dragStart.current.x;
      viewOffsetYRef.current = t.clientY - dragStart.current.y;
    };

    const onTouchEnd = (e) => {
      isDragging.current = false;
      if (e.changedTouches.length > 0 && clickStartRef.current) {
        const t = e.changedTouches[0];
        const dx = t.clientX - clickStartRef.current.x;
        const dy = t.clientY - clickStartRef.current.y;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && lastHoveredRef.current >= 0) {
          jumpToPointInData(displayData, lastHoveredRef.current);
        }
        clickStartRef.current = null;
      }
    };

    canvas.addEventListener('touchstart',  onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',   onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',    onTouchEnd,   { passive: true });
    canvas.addEventListener('touchcancel', onTouchEnd,   { passive: true });
    return () => {
      canvas.removeEventListener('touchstart',  onTouchStart);
      canvas.removeEventListener('touchmove',   onTouchMove);
      canvas.removeEventListener('touchend',    onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [canvasRef, viewOffsetXRef, viewOffsetYRef, displayData, jumpToPointInData]);

  // Non-passive wheel on main canvas — zoom toward jump-to-point selection in 2D mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (show3DRef.current) return;
      const zoomFactor = e.deltaY > 0 ? 0.88 : 1.12;
      const oldScale = viewScaleRef.current;
      const newScale = Math.max(0.05, Math.min(30, oldScale * zoomFactor));
      const ratio = newScale / oldScale;

      // Prefer the jump-to-point selected point as focal; fall back to cursor
      const pt = displayData && displayData.length > 0 ? displayData[displayChIndex] : null;

      let fx, fy;
      if (pt) {
        const w = canvas.width;
        const h = canvas.height;
        const bounds = getBounds(trackData);
        const baseScale = Math.min(w / (bounds.width || 1), h / (bounds.height || 1)) * 0.85;
        const scale = oldScale * baseScale;
        const ox = w / 2 - bounds.centerX * scale + viewOffsetXRef.current;
        const oy = h / 2 + bounds.centerY * scale + viewOffsetYRef.current;
        fx = pt.easting * scale + ox;
        fy = -pt.northing * scale + oy;
      } else {
        const rect = canvas.getBoundingClientRect();
        fx = e.clientX - rect.left;
        fy = e.clientY - rect.top;
      }

      viewOffsetXRef.current = fx - (fx - viewOffsetXRef.current) * ratio;
      viewOffsetYRef.current = fy - (fy - viewOffsetYRef.current) * ratio;
      viewScaleRef.current = newScale;
      if (onSetViewScale) onSetViewScale(newScale);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef, trackData, displayData, displayChIndex, viewScaleRef, viewOffsetXRef, viewOffsetYRef, onSetViewScale]);

  // Non-passive wheel on minimap
  const minimapRef = useRef(null);
  useEffect(() => {
    const el = minimapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!show3DRef.current && onMinimapWheel) onMinimapWheel(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onMinimapWheel]);

  // ── Minimap touch pan (mobile) ──────────────────────────────────────────
  useEffect(() => {
    const el = minimapRef.current;
    if (!el) return;
    const firePan = (clientX, clientY) => {
      if (!show3DRef.current && onMinimapMouseDown) {
        onMinimapMouseDown({ clientX, clientY });
      }
    };
    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      firePan(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      firePan(e.touches[0].clientX, e.touches[0].clientY);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
    };
  }, [minimapRef, onMinimapMouseDown]);

  // ── Convert minimap pixel click → world (E, N) coordinates ─────────────
  const minimapToWorld = useCallback((clientX, clientY) => {
    if (!trackData || trackData.length < 2 || !minimapCanvasRef.current) return null;
    const container = minimapCanvasRef.current.parentElement;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (clientX - rect.left) * dpr;
    const my = (clientY - rect.top) * dpr;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    trackData.forEach(p => {
      minX = Math.min(minX, p.easting, p.leftEasting, p.rightEasting);
      maxX = Math.max(maxX, p.easting, p.leftEasting, p.rightEasting);
      minY = Math.min(minY, p.northing, p.leftNorthing, p.rightNorthing);
      maxY = Math.max(maxY, p.northing, p.leftNorthing, p.rightNorthing);
    });
    const pad = Math.max((maxX - minX) * 0.1, 10);
    const bw = maxX - minX + 2 * pad;
    const bh = maxY - minY + 2 * pad;
    if (bw < 0.01) return null;
    const mw = rect.width * dpr;
    const mh = rect.height * dpr;
    const pad2 = 16 * dpr;
    const mScale = Math.min((mw - pad2 * 2) / bw, (mh - pad2 * 2) / bh);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const mOx = mw / 2 - cx * mScale;
    const mOy = mh / 2 + cy * mScale;
    return {
      worldX: (mx - mOx) / mScale,
      worldY: -(my - mOy) / mScale,
      cx, cy,
    };
  }, [trackData, minimapCanvasRef]);

  // ── Minimap 3D pan: document-level drag ─────────────────────────────────
  const pan3DRef_stable = pan3DRef; // capture in closure
  useEffect(() => {
    const onMove = (e) => {
      if (!minimap3DDragging.current) return;
      const result = minimapToWorld(e.clientX, e.clientY);
      if (!result) return;
      const { worldX, worldY, cx, cy } = result;
      pan3DRef_stable.current = { x: worldX - cx, y: worldY - cy };
      setPan3D({ ...pan3DRef_stable.current });
    };
    const onUp = () => { minimap3DDragging.current = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [minimapToWorld, pan3DRef_stable]);

  // Minimap mouse-down: route to 3D pan or 2D pan
  const handleMinimapDown = useCallback((e) => {
    if (show3DRef.current) {
      minimap3DDragging.current = true;
      const result = minimapToWorld(e.clientX, e.clientY);
      if (!result) return;
      const { worldX, worldY, cx, cy } = result;
      pan3DRef.current = { x: worldX - cx, y: worldY - cy };
      setPan3D({ ...pan3DRef.current });
    } else {
      onMinimapMouseDown?.(e);
    }
  }, [minimapToWorld, onMinimapMouseDown]);

  // Expose view-switching methods so App.jsx keyboard shortcuts work from any overlay
  useImperativeHandle(ref, () => ({
    switchToAnalytics: () => {
      setShowCompare(false);
      setShow3D(false);
      pan3DRef.current = { x: 0, y: 0 };
      setPan3D({ x: 0, y: 0 });
      requestAnimationFrame(() => {
        if (!graphViewActive) toggleGraphView();
      });
    },
    switchToCompare: () => {
      const wasActive = graphViewActive;
      setShow3D(false);
      pan3DRef.current = { x: 0, y: 0 };
      setPan3D({ x: 0, y: 0 });
      requestAnimationFrame(() => {
        if (wasActive) toggleGraphView();
        setShowCompare(v => !v);
      });
    },
    switchTo2D: () => {
      const wasActive = graphViewActive;
      setShow3D(false);
      pan3DRef.current = { x: 0, y: 0 };
      setPan3D({ x: 0, y: 0 });
      requestAnimationFrame(() => {
        if (wasActive) toggleGraphView();
        setShowCompare(false);
      });
    },
    switchTo3D: () => {
      const wasActive = graphViewActive;
      requestAnimationFrame(() => {
        if (wasActive) toggleGraphView();
        setShowCompare(false);
        setShow3D(v => !v);
      });
    },
    togglePoints: () => {
      if (show3D) {
        setShowPoints3D(v => !v);
      } else {
        setShowPoints2D(v => !v);
      }
    },
    resetView: () => {
      clearRange();
      setResetMapKey(k => k + 1);
      if (show3DRef.current) { setReset3DKey(k => k + 1); setZoom3D(1.0); }
    },
    toggleMap: () => {
      setMapToggleKey(v => v + 1);
    },
    closeOverlays: () => {
      if (graphViewActive) {
        toggleGraphView();
      }
      setShowCompare(false);
    },
  }), [graphViewActive, toggleGraphView, show3D, clearRange]);

  return (
    <div className="center-panel">
      <div className="track-view-container" ref={containerRef} id="trackView">
        <canvas
          ref={canvasRef}
          id="trackCanvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />

        {/* Ctrl+drag zoom-box overlay */}
        {zoomBox2D && !show3D && (() => {
          const x = Math.min(zoomBox2D.x1, zoomBox2D.x2);
          const y = Math.min(zoomBox2D.y1, zoomBox2D.y2);
          const bw = Math.abs(zoomBox2D.x2 - zoomBox2D.x1);
          const bh = Math.abs(zoomBox2D.y2 - zoomBox2D.y1);
          return (
            <svg style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 10,
            }}>
              <rect x={x} y={y} width={bw} height={bh}
                fill="rgba(244,129,32,0.07)"
                stroke="#f48120" strokeWidth="1.5"
                strokeDasharray="7,4" />
              {[[x, y], [x + bw, y], [x, y + bh], [x + bw, y + bh]].map(([cx, cy], i) => (
                <g key={i}>
                  <line x1={cx - (i % 2 === 0 ? 0 : 7)} y1={cy} x2={cx + (i % 2 === 0 ? 7 : 0)} y2={cy}
                    stroke="#f48120" strokeWidth="2" />
                  <line x1={cx} y1={cy - (i < 2 ? 0 : 7)} x2={cx} y2={cy + (i < 2 ? 7 : 0)}
                    stroke="#f48120" strokeWidth="2" />
                </g>
              ))}
              {bw > 50 && bh > 20 && (
                <text x={x + bw / 2} y={y + bh / 2 + 4} textAnchor="middle"
                  fill="rgba(244,129,32,0.7)" fontSize="10"
                  fontFamily="'Segoe UI',sans-serif" fontWeight="600">
                  Zoom to selection
                </text>
              )}
            </svg>
          );
        })()}

        {/* ── 2D Stats HUD ── */}
        {!show3D && !graphViewActive && !showCompare && (() => {
          const pt = trackData?.[hoveredPoint >= 0 ? hoveredPoint : chIndex];
          if (!pt) return null;
          const idx = hoveredPoint >= 0 ? hoveredPoint : chIndex;
          let grade = 0;
          if (idx > 0 && idx < trackData.length - 1) {
            const prev = trackData[idx - 1];
            const dist = Math.hypot(pt.easting - prev.easting, pt.northing - prev.northing);
            if (dist >= 0.001) grade = ((pt.height - prev.height) / dist) * 100;
          }
          const gradeColor = grade > 2 ? '#f97316' : grade < -2 ? '#3b82f6' : '#10b981';
          const gradeLabel = `${grade >= 0 ? '+' : ''}${grade.toFixed(2)}%`;
          const cant = pt.cant * 1000;
          const cDir = cant > 0.5 ? 'L↑' : cant < -0.5 ? 'R↑' : '—';
          const gColor = pt.gaugeStatus === 'fail' ? '#ef4444' : pt.gaugeStatus === 'warn' ? '#f97316' : '#10b981';
          const gBadge = pt.gaugeStatus === 'fail' ? 'FAIL' : pt.gaugeStatus === 'warn' ? 'WARN' : 'OK';
          const cColor = pt.cantStatus === 'fail' ? '#ef4444' : pt.cantStatus === 'warn' ? '#f97316' : '#10b981';
          const cBadge = pt.cantStatus === 'fail' ? 'FAIL' : pt.cantStatus === 'warn' ? 'WARN' : 'OK';
          const tColor = pt.type === 'arc' ? '#f59e0b' : '#10b981';
          const diffMM = pt.gaugeDiff * 1000;
          const typeLabel = pt.type.toUpperCase() + (pt.radius > 0 && pt.radius < 99999 ? ` R${pt.radius.toFixed(0)}m` : '');
          const items = [
            { label: 'POINT',  value: `#${pt.pointNumber}`, color: '#f59e0b', big: true },
            { label: 'TYPE',   value: typeLabel,             color: tColor },
            { label: 'CHAIN',  value: `${pt.chainage.toFixed(2)}m`, color: '#94a3b8' },
            { label: 'ELEV',   value: `${pt.height.toFixed(3)}m`,   color: '#38bdf8' },
            { label: 'GRADE',  value: gradeLabel,                color: gradeColor },
            { label: 'GAUGE',  value: `${pt.gauge.toFixed(4)}m`, color: gColor,
              badge: gBadge, sub: `Δ${diffMM >= 0 ? '+' : ''}${diffMM.toFixed(2)}mm` },
            { label: 'CANT',   value: `${cant >= 0 ? '+' : ''}${cant.toFixed(2)}mm`, color: cColor,
              badge: cBadge, sub: cDir },
            { label: 'ZOOM',   value: `${Math.round(viewScale * 100)}%`, color: '#64748b' },
          ];
          return (
            <div className="stats-hud-2d" style={{
              position: 'absolute', top: 8, left: 8, zIndex: 10,
              pointerEvents: 'none', userSelect: 'none',
              display: 'flex', gap: 4, flexWrap: 'wrap',
              maxWidth: 'calc(100% - 120px)',
            }}>
              {items.map((item, i) => (
                <div key={i} style={{
                  background: 'rgba(15,23,42,0.75)',
                  border: '1px solid rgba(99,102,241,0.12)',
                  borderRadius: 5,
                  padding: item.big ? '3px 8px' : '2px 6px',
                  backdropFilter: 'blur(6px)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 0.5,
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
                    {item.sub && (
                      <span style={{ fontSize: 7, color: 'rgba(148,163,184,0.5)', fontWeight: 400 }}>
                        {item.sub}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Graph View (overlay) */}
        <div ref={viewGraphRef} style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          zIndex: 4, opacity: 0, willChange: 'opacity, transform',
          backfaceVisibility: 'hidden', transform: 'translateZ(0)',
        }}>
          <MemoGraphView
            graphViewActive={graphViewActive}
            toggleGraphView={toggleGraphView}
            trackData={graphViewData}
            fullTrackData={trackData}
            visibleRange={visibleIdxRange}
            railVisibility={railVisibility}
            onRailCheckboxChange={onRailCheckboxChange}
            designGauge={designGauge}
            gaugeType={gaugeType}
            chartCount={chartCount}
            onChartCountChange={onChartCountChange}
            chartSelections={chartSelections}
            onToggleChart={onToggleChart}
            chartDefs={chartDefs}
            onMapRangeChange={handleMapRangeChange}
            activeIndex={globalActiveIdx}
            chartStartIdx={graphViewStartIdx}
            scrollToRange={activeRange}
            showSegDist={showSegDist}
            showCumDist={showCumDist}
            resetMapKey={resetMapKey}
            mapToggleKey={mapToggleKey}
          />
        </div>

        {/* 3D Rail View (overlay) */}
        <div ref={view3DRef}
          style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            zIndex: 5, display: 'none', willChange: 'opacity',
            backfaceVisibility: 'hidden', transform: 'translateZ(0)',
          }}
        >
          <MemoRail3DView
            ref={rail3DRef}
            trackData={trackData}
            railVisibility={railVisibility}
            panX={pan3D.x}
            panY={pan3D.y}
            chIndex={chIndex}
            zMul={zMul}
            showPoints={showPoints3D}
            showSegDist={showSegDist}
            showCumDist={showCumDist}
            rangeFrom={activeRange ? activeRange.fromIdx : 0}
            rangeTo={activeRange ? activeRange.toIdx : (trackData ? trackData.length - 1 : 0)}
            resetTrigger={reset3DKey}
            showElevProfile={showElevProfile}
            onElevProfileChange={onElevProfileChange}
            showNavOverlay={showNavOverlay}
            onZoomChange={setZoom3D}
            onChIndexChange={(idx) => {
              const clamped = Math.max(0, Math.min(idx, trackData.length - 1));
              setChIndex(clamped);
              jumpToPointInData(trackData, clamped);
            }}
          />
        </div>

        {/* Rail Compare View (overlay) */}
        <div ref={viewCompareRef} style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          zIndex: 4, opacity: 0, willChange: 'opacity, transform',
          backfaceVisibility: 'hidden', transform: 'translateZ(0)',
        }}>
          <MemoRailCompareView
            visible={showCompare}
            onClose={handleToggleCompare}
            trackData={graphViewData}
            fullTrackData={trackData}
            activeRange={activeRange}
            activeIndex={graphViewData.length > 0 && globalActiveIdx >= 0 ? Math.max(0, Math.min(globalActiveIdx - graphViewStartIdx, graphViewData.length - 1)) : 0}
            hoveredIdx={graphViewData.length > 0 && hoveredPoint >= 0 ? Math.max(0, Math.min(hoveredPoint - graphViewStartIdx, graphViewData.length - 1)) : -1}
            chartStartIdx={graphViewStartIdx}
            onMapRangeChange={handleMapRangeChange}
            scrollToRange={activeRange}
            showSegDist={showSegDist}
            showCumDist={showCumDist}
            resetMapKey={resetMapKey}
            mapToggleKey={mapToggleKey}
          />
        </div>

        {/* Elevation Profile strip — 2D mode only */}
        {!show3D && !graphViewActive && !showCompare && showElevProfile && displayData.length >= 2 && (
          <ElevationProfile
            filteredData={displayData}
            localChIndex={displayChIndex}
            size={containerSize}
            bottom={72}
            onClose={onElevProfileChange ? () => onElevProfileChange(false) : undefined}
          />
        )}

        {/* Minimap — hidden in 3D mode (3D view has its own built-in navigator) */}
        <div
          className="minimap-container"
          id="minimapContainer"
          ref={minimapRef}
          style={{ display: show3D || graphViewActive || showCompare ? 'none' : undefined }}
          onMouseDown={handleMinimapDown}
          onMouseUp={() => {
            minimap3DDragging.current = false;
            if (!show3DRef.current) onMinimapMouseUp?.();
          }}
          onMouseLeave={() => {
            minimap3DDragging.current = false;
            if (!show3DRef.current) onMinimapMouseUp?.();
          }}
        >
          <canvas ref={minimapCanvasRef} id="minimapCanvas" />
          <div className="minimap-label">
            <span className="mini-dot" style={{ background: '#3b82f6' }}></span> L
            <span className="mini-dot" style={{ background: '#10b981' }}></span> C
            <span className="mini-dot" style={{ background: '#ef4444' }}></span> R
            &nbsp;— {show3D ? '3D Pan' : 'Overview'}
          </div>
        </div>

        {/* Tooltip — rich card for 2D point hover */}
        {!show3D && tooltip.visible && hoveredPoint >= 0 && trackData[hoveredPoint] && (
          <Pt3DTooltip
            pt={trackData[hoveredPoint]}
            x={hoveredPos.x}
            y={hoveredPos.y}
          />
        )}

        {/* Jump / Range Panel — positions above or below the bar based on available space */}
        {showJumpPanel && trackData.length > 1 && (() => {
          const GAP = 10;
          let pos = { position: 'absolute', bottom: 82, left: '50%', transform: 'translateX(-50%)' };
          if (barRef.current && containerRef.current) {
            const cRect = containerRef.current.getBoundingClientRect();
            const bRect = barRef.current.getBoundingClientRect();
            const barTop = bRect.top - cRect.top;
            const barBottom = bRect.bottom - cRect.top;
            const spaceAbove = barTop;
            const spaceBelow = cRect.height - barBottom;
            const barCenterX = bRect.left - cRect.left + bRect.width / 2;
            if (spaceAbove > spaceBelow) {
              pos = { position: 'absolute', bottom: cRect.height - barTop + GAP, left: barCenterX, transform: 'translateX(-50%)' };
            } else {
              pos = { position: 'absolute', top: barBottom + GAP, left: barCenterX, transform: 'translateX(-50%)' };
            }
          }
          return (
          <div
            style={{
              ...pos,
              zIndex: 25,
              background: 'rgba(45,46,47,0.97)',
              border: '1px solid rgba(244,129,32,0.25)',
              borderRadius: 10,
              padding: '10px 16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
              minWidth: 340,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              userSelect: 'none',
            }}
            onMouseDown={e => e.stopPropagation()}
            onMouseEnter={cancelJumpClose}
            onMouseLeave={() => { if (!jumpPinned) scheduleJumpClose(); }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: 'var(--brand)',
                letterSpacing: '0.5px', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span className="material-icons" style={{ fontSize: 13 }}>my_location</span>
                Jump to Point
                {showCompare && (
                  <span style={{
                    fontSize: 8, fontWeight: 400, color: '#10b981',
                    background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: 4, padding: '0 5px', marginLeft: 4, letterSpacing: 0,
                    textTransform: 'none',
                  }}>
                    synced with Compare
                  </span>
                )}
              </span>
              <button
                onClick={() => setJumpPinned(v => !v)}
                title={jumpPinned ? 'Unpin panel' : 'Pin panel open'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: jumpPinned ? 'var(--brand)' : '#64748b',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <span className="material-icons" style={{ fontSize: 14 }}>
                  {jumpPinned ? 'push_pin' : 'push_pin'}
                </span>
              </button>
            </div>

            {/* Jump slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                className="jump-slider"
                title="Jump-to-Point — orange line tracks active point"
                min={0}
                max={Math.max(0, displayData.length - 1)}
                step={1}
                value={displayChIndex}
                onChange={(e) => jumpToPointInstant(Number(e.target.value))}
                style={{
                  flex: 1, height: 4,
                  WebkitAppearance: 'none', appearance: 'none',
                  background: 'rgba(100,116,139,0.25)',
                  borderRadius: 2, outline: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{
                fontSize: 11, color: 'var(--brand)', fontWeight: 700,
                fontFamily: 'monospace', minWidth: 70, textAlign: 'right',
              }}>
                {displayData.length > 0 && displayData[displayChIndex]
                  ? `Pt#${displayData[displayChIndex].pointNumber}`
                  : '—'}
              </span>
            </div>
            <style>{`
              .jump-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 13px; height: 13px;
                border-radius: 50%;
                background: var(--brand);
                border: 2px solid rgba(255,255,255,0.35);
                cursor: pointer;
                box-shadow: 0 0 8px rgba(244,129,32,0.3);
              }
              .jump-slider::-moz-range-thumb {
                width: 13px; height: 13px;
                border-radius: 50%;
                background: var(--brand);
                border: 2px solid rgba(255,255,255,0.35);
                cursor: pointer;
              }
            `}</style>

            {/* Point info */}
            {displayData.length > 0 && displayData[displayChIndex] && (
              <div style={{
                fontSize: 9, color: '#94a3b8',
                display: 'flex', gap: 12, flexWrap: 'wrap',
                padding: '4px 0', borderTop: '1px solid rgba(100,116,139,0.15)',
              }}>
                <span>Ch: {displayData[displayChIndex].chainage.toFixed(3)} m</span>
                <span>Gauge: {displayData[displayChIndex].gauge.toFixed(4)} m</span>
                <span>Cant: {(displayData[displayChIndex].cant * 1000).toFixed(2)} mm</span>
                <span style={{
                  color: displayData[displayChIndex].type === 'arc' ? '#f59e0b' : '#10b981',
                }}>
                  {displayData[displayChIndex].type.toUpperCase()}
                  {displayData[displayChIndex].radius > 0
                    ? ` R=${displayData[displayChIndex].radius.toFixed(0)}m`
                    : ''}
                </span>
              </div>
            )}

            {/* Divider */}
            <div style={{
              borderTop: '1px solid rgba(100,116,139,0.15)', paddingTop: 6,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 600, color: '#64748b',
                marginBottom: 5, textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                ⊡ Point Range Filter
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: '#64748b', minWidth: 30 }}>From</span>
                <input
                  type="text"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  placeholder="Name or #"
                  onKeyDown={(e) => { if (e.key === 'Enter') applyRange(); }}
                  style={{
                    width: 84, padding: '4px 6px', fontSize: 10,
                    borderRadius: 4, border: '1px solid rgba(100,116,139,0.3)',
                    background: 'rgba(100,116,139,0.1)',
                    color: '#e2e8f0', outline: 'none',
                    fontFamily: 'monospace', textAlign: 'center',
                  }}
                />
                <span style={{ fontSize: 9, color: '#64748b', minWidth: 16, textAlign: 'center' }}>To</span>
                <input
                  type="text"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="Name or #"
                  onKeyDown={(e) => { if (e.key === 'Enter') applyRange(); }}
                  style={{
                    width: 84, padding: '4px 6px', fontSize: 10,
                    borderRadius: 4, border: '1px solid rgba(100,116,139,0.3)',
                    background: 'rgba(100,116,139,0.1)',
                    color: '#e2e8f0', outline: 'none',
                    fontFamily: 'monospace', textAlign: 'center',
                  }}
                />
                <button
                  onClick={applyRange}
                  style={{
                    padding: '3px 10px', fontSize: 9, fontWeight: 600,
                    borderRadius: 4, border: '1px solid rgba(244,129,32,0.4)',
                    background: 'rgba(244,129,32,0.15)',
                    color: 'var(--brand)', cursor: 'pointer',
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                >Apply</button>
                {activeRange && (
                  <button
                    onClick={clearRange}
                    style={{
                      padding: '3px 8px', fontSize: 9,
                      borderRadius: 4, border: '1px solid rgba(100,116,139,0.25)',
                      background: 'transparent',
                      color: '#64748b', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >Clear</button>
                )}
              </div>
              {activeRange && (
                <div style={{ fontSize: 8, color: 'rgba(244,129,32,0.6)', marginTop: 3 }}>
                  Showing pts {trackData[activeRange.fromIdx]?.pointNumber}
                  —{trackData[activeRange.toIdx]?.pointNumber}
                  &nbsp;({displayData.length} of {trackData.length} pts)
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* Back-to-track button — shown when track is fully off-screen */}
        {trackOffScreen && !show3D && !graphViewActive && !showCompare && displayData.length >= 2 && (
          <button
            className="back-to-track-btn"
            onClick={() => {
              clearRange();
              setResetMapKey(k => k + 1);
            }}
            title="Track is off-screen — tap to re-centre"
          >
            <span className="material-icons" style={{ fontSize: 18, pointerEvents: 'none' }}>my_location</span>
            Back to track
          </button>
        )}

        {/* View Controls — draggable toolbar */}
        <div
          className="view-controls"
          ref={barRef}
          onMouseDown={handleBarMouseDown}
          onTouchStart={handleBarTouchStart}
          style={barPosition ? {
            position: 'absolute',
            left: barPosition.x,
            top: barPosition.y,
            bottom: 'unset',
            transform: 'none',
          } : undefined}
        >
          {/* Drag handle */}
          <span
            className="material-icons bar-drag-handle"
            style={{ fontSize: 16, marginRight: 2, color: '#f48120', userSelect: 'none', pointerEvents: 'none' }}
          >drag_indicator</span>

          {/* Zoom — only icon, slider appears on hover */}
          <div
            className="zoom-area"
            onMouseEnter={showZoomSlider}
            onMouseLeave={hideZoomSlider}
          >
            <button className="btn-icon zoom-trigger-btn" title="Zoom">
              <span className="material-icons" style={{ fontSize: 17, pointerEvents: 'none' }}>search</span>
            </button>
            <div className="zoom-slider-wrap" ref={zoomSliderRef}>
              <input
                type="range"
                className="zoom-slider"
                min={5}
                max={3000}
                step={1}
                value={show3D ? Math.round(zoom3D * 100) : Math.round(viewScale * 100)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (show3D) {
                    rail3DRef.current?.setZoomLevel(val / 100);
                    setZoom3D(val / 100);
                  } else {
                    handleZoomChange(val);
                  }
                }}
                title="Zoom Level"
                style={{
                  background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${((show3D ? zoom3D * 100 : viewScale * 100) - 5) / (3000 - 5) * 100}%, rgba(100,116,139,0.2) ${((show3D ? zoom3D * 100 : viewScale * 100) - 5) / (3000 - 5) * 100}%, rgba(100,116,139,0.2) 100%)`,
                }}
              />
              <span className="zoom-indicator" id="zoomLevel">
                {show3D ? Math.round(zoom3D * 100) : Math.round(viewScale * 100)}%
              </span>
            </div>
          </div>

          <div className="view-separator" />

          <button
            className="btn-icon"
            onClick={() => {
              clearRange();
              setResetMapKey(k => k + 1);
              if (show3D) { setReset3DKey(k => k + 1); setZoom3D(1.0); }
            }}
            title="Reset View (Ctrl+Shift+R)"
          >
            <span className="material-icons" style={{ fontSize: 18, pointerEvents: 'none' }}>replay</span>
          </button>

          <button
            className={`btn-icon${showJumpPanel ? ' active-jump' : ''}`}
            onMouseEnter={() => { cancelJumpClose(); setShowJumpPanel(true); }}
            onMouseLeave={() => { if (!jumpPinned) scheduleJumpClose(); }}
            onClick={() => {
              if (jumpPinned) {
                setJumpPinned(false);
                setShowJumpPanel(false);
              } else {
                setJumpPinned(true);
                setShowJumpPanel(true);
              }
            }}
            title="Jump to Point / Range Filter"
            style={showJumpPanel ? {
              color: 'var(--brand)',
              borderColor: 'rgba(244,129,32,0.4)',
              background: jumpPinned ? 'rgba(244,129,32,0.2)' : 'rgba(244,129,32,0.1)',
            } : undefined}
          >
            <span className="material-icons" style={{ fontSize: 17, pointerEvents: 'none' }}>my_location</span>
          </button>

          <div className="view-separator" />

          <button
            className={`btn-label${graphViewActive ? ' active-compare' : ''}`}
            onClick={(e) => {
              btnPulse(e);
              // hide others first, then show analytics
              setShowCompare(false);
              setShow3D(false);
              pan3DRef.current = { x: 0, y: 0 };
              setPan3D({ x: 0, y: 0 });
              requestAnimationFrame(() => {
                if (!graphViewActive) toggleGraphView();
              });
            }}
            id="viewModeBtn"
            title="Analytics View (Ctrl+Shift+A)"
          >
            <span className="material-icons" style={{ fontSize: 14, pointerEvents: 'none' }}>bar_chart</span>
            <span className="btn-label-text">Analytics</span>
          </button>

          <div className="view-separator" />

          <button
            className={`btn-label${showCompare ? ' active-compare' : ''}`}
            onClick={(e) => {
              btnPulse(e);
              const wasActive = graphViewActive;
              // hide others first, then toggle compare
              setShow3D(false);
              pan3DRef.current = { x: 0, y: 0 };
              setPan3D({ x: 0, y: 0 });
              requestAnimationFrame(() => {
                if (wasActive) toggleGraphView();
                handleToggleCompare();
              });
            }}
            title="Compare View (Ctrl+Shift+C)"
          >
            <span className="material-icons" style={{ fontSize: 14, pointerEvents: 'none' }}>compare</span>
            <span className="btn-label-text">Compare</span>
          </button>

          <div className="view-separator" />

          <div className="mode-toggle" title="Switch between 2D and 3D view">
            {/* Desktop: two separate buttons */}
            <button
              className={`mode-toggle-btn mode-toggle-btn--desktop${!show3D && !graphViewActive && !showCompare ? ' mode-toggle-active' : ''}`}
              onClick={(e) => {
                btnPulse(e);
                const wasActive = graphViewActive;
                setShow3D(false);
                pan3DRef.current = { x: 0, y: 0 };
                setPan3D({ x: 0, y: 0 });
                requestAnimationFrame(() => {
                  if (wasActive) toggleGraphView();
                  setShowCompare(false);
                });
              }}
              title="2D View (Ctrl+Shift+2)"
            >
              2D
            </button>
            <button
              className={`mode-toggle-btn mode-toggle-btn--desktop${show3D ? ' mode-toggle-active' : ''}`}
              onClick={(e) => {
                btnPulse(e);
                const wasActive = graphViewActive;
                requestAnimationFrame(() => {
                  if (wasActive) toggleGraphView();
                  setShowCompare(false);
                  setShow3D(true);
                });
              }}
              title="3D View (Ctrl+Shift+3)"
            >
              <span className="material-icons" style={{ fontSize: 12, pointerEvents: 'none' }}>view_in_ar</span>
              3D
            </button>
            {/* Mobile: single toggle button */}
            <button
              className={`mode-toggle-btn mode-toggle-btn--mobile mode-toggle-active`}
              onClick={(e) => {
                btnPulse(e);
                const wasActive = graphViewActive;
                if (show3D) {
                  setShow3D(false);
                  pan3DRef.current = { x: 0, y: 0 };
                  setPan3D({ x: 0, y: 0 });
                  requestAnimationFrame(() => {
                    if (wasActive) toggleGraphView();
                    setShowCompare(false);
                  });
                } else {
                  requestAnimationFrame(() => {
                    if (wasActive) toggleGraphView();
                    setShowCompare(false);
                    setShow3D(true);
                  });
                }
              }}
              title="Toggle 2D / 3D view"
            >
              {show3D
                ? <><span className="material-icons" style={{ fontSize: 12, pointerEvents: 'none' }}>view_in_ar</span>3D</>
                : <>2D</>}
            </button>
          </div>

          <div className="view-separator" />

          <button
            className={`btn-label${show3D ? (showPoints3D ? ' active' : '') : (showPoints2D ? ' active' : '')}`}
            onClick={() => {
              if (show3D) {
                setShowPoints3D(v => !v);
              } else {
                setShowPoints2D(v => !v);
              }
            }}
            title="Toggle Point Markers (Ctrl+Shift+O)"
            style={{ padding: '3px 8px', fontSize: 9 }}
          >
            <span className="material-icons" style={{ fontSize: 12, pointerEvents: 'none' }}>scatter_plot</span>
            <span className="btn-label-text">Pts</span>
          </button>

          {show3D && (
            <>
              <div className="view-separator" />
              <button
                className="btn-icon"
                onClick={() => setReset3DKey(k => k + 1)}
                title="Home view"
              >
                <span className="material-icons" style={{ fontSize: 18, pointerEvents: 'none' }}>home</span>
              </button>

              <button
                className={`btn-icon${showNavOverlay ? ' active' : ''}`}
                onClick={() => onNavOverlayChange?.(v => !v)}
                title={showNavOverlay ? 'Hide NAV panel' : 'Show NAV panel'}
                style={showNavOverlay ? { color: 'var(--brand)', background: 'rgba(244,129,32,0.12)' } : undefined}
              >
                <span className="material-icons" style={{ fontSize: 16, pointerEvents: 'none' }}>map</span>
              </button>

              {/* Desktop: inline horizontal Z slider */}
              <div className="z-adjuster-desktop" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 8, color: 'rgba(148,163,184,0.6)', pointerEvents: 'none' }}>Z</span>
                <input
                  type="range" min="100" max="8000" step="100"
                  value={zMul}
                  onChange={(e) => setZmul(Number(e.target.value))}
                  title="Vertical Exaggeration"
                  style={{ width: 50, height: 3, accentColor: 'var(--brand)' }}
                />
                <span style={{
                  fontSize: 9, color: 'rgba(148,163,184,0.5)',
                  minWidth: 32, fontFamily: 'monospace', pointerEvents: 'none',
                }}>×{zMul}</span>
              </div>

              {/* Mobile: Z button + vertical overlay */}
              <button
                className="btn-icon z-adjuster-mobile"
                onClick={() => setZOverlayOpen(v => !v)}
                title="Vertical Exaggeration"
                style={zOverlayOpen ? { color: 'var(--brand)', background: 'rgba(244,129,32,0.15)' } : undefined}
              >
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', pointerEvents: 'none' }}>Z</span>
              </button>

            </>
          )}
        </div>
      </div>

      {/* Z vertical overlay — rendered outside view-controls to escape its transform stacking context */}
      {show3D && zOverlayOpen && (
        <div
          className="z-overlay-backdrop"
          onClick={() => setZOverlayOpen(false)}
        >
          <div className="z-overlay-panel" onClick={e => e.stopPropagation()}>
            <span className="z-overlay-label">×{zMul}</span>
            <div className="z-overlay-track">
              <input
                type="range"
                className="z-overlay-slider"
                min="100" max="8000" step="100"
                value={zMul}
                onChange={(e) => setZmul(Number(e.target.value))}
              />
            </div>
            <span className="z-overlay-title">Z</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default TrackView;

