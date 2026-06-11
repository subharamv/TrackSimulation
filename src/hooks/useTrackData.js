import { useState, useRef, useCallback, useEffect } from 'react';
import { computeTrackGeometry, getGaugeType } from '../utils/geometry';
import { getSampleData } from '../utils/csvParser';

export function useTrackData() {
  // Core data
  const [trackData, setTrackData] = useState([]);
  const [trackName, setTrackName] = useState('Main Line Track');
  const [startChainage, setStartChainage] = useState(0);

  // Raw input points (before geometry computation)
  const [rawPoints, setRawPoints] = useState([]);

  // Gauge type selection
  const [gaugeTypeId, setGaugeTypeId] = useState('tramway');
  const gaugeType = getGaugeType(gaugeTypeId);
  const designGauge = gaugeType.gauge;
  const toleranceMM = gaugeType.toleranceMM ?? 5;
  const maxCantMM   = gaugeType.maxCantMM   ?? 30;

  // Simulation state
  const [simIndex, setSimIndex] = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(60);

  // View state — persisted across refreshes
  const readViewState = (key, fallback) => {
    try {
      const v = localStorage.getItem('railsim_' + key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  };
  const [viewScale, setViewScaleInternal] = useState(() => readViewState('viewScale', 1));
  const [viewOffsetX, setViewOffsetX] = useState(() => readViewState('viewOffsetX', 0));
  const [viewOffsetY, setViewOffsetY] = useState(() => readViewState('viewOffsetY', 0));
  const viewScaleRef = useRef(viewScale);
  const viewOffsetXRef = useRef(viewOffsetX);
  const viewOffsetYRef = useRef(viewOffsetY);

  // Keep refs in sync and persist whenever values change
  useEffect(() => {
    viewScaleRef.current = viewScale;
    localStorage.setItem('railsim_viewScale', JSON.stringify(viewScale));
  }, [viewScale]);
  useEffect(() => {
    viewOffsetXRef.current = viewOffsetX;
    localStorage.setItem('railsim_viewOffsetX', JSON.stringify(viewOffsetX));
  }, [viewOffsetX]);
  useEffect(() => {
    viewOffsetYRef.current = viewOffsetY;
    localStorage.setItem('railsim_viewOffsetY', JSON.stringify(viewOffsetY));
  }, [viewOffsetY]);

  // Graph view
  const [graphViewActive, setGraphViewActive] = useState(false);
  const [railVisibility, setRailVisibility] = useState({ left: true, center: true, right: true });

  // UI state
  const [inputPanelVisible, setInputPanelVisible] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [trackDataModalVisible, setTrackDataModalVisible] = useState(false);
  const [railPlanModalVisible, setRailPlanModalVisible] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(-1);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, html: '' });

  // Manual point input state
  const [newPoint, setNewPoint] = useState({
    leftEasting: '', leftNorthing: '', leftHeight: '',
    rightEasting: '', rightNorthing: '', rightHeight: '',
    type: 'straight', radius: '',
  });

  // Refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const minimapIsDraggingRef = useRef(false);
  const canvasRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const simStepRef = useRef(null);
  const simRunningRef = useRef(false);

  // Keep a ref to the latest rawPoints + designGauge for recomputation
  const rawPointsRef = useRef([]);
  const designGaugeRef  = useRef(designGauge);
  const toleranceMMRef  = useRef(toleranceMM);
  const maxCantMMRef    = useRef(maxCantMM);

  // Sync simRunning ref
  useEffect(() => {
    simRunningRef.current = simRunning;
  }, [simRunning]);

  // ===== Process raw points into computed track data =====
  const processRawPoints = useCallback((raw) => {
    rawPointsRef.current = raw;
    const dg  = designGaugeRef.current;
    const tol = toleranceMMRef.current;
    const mc  = maxCantMMRef.current;
    const computed = computeTrackGeometry(raw, dg, tol, mc);
    setRawPoints(raw);
    setTrackData(computed);
    setSimIndex(0);
    setGraphViewActive(false);
  }, []);

  // ===== Recompute when gauge type changes (design gauge or tolerance) =====
  useEffect(() => {
    designGaugeRef.current = designGauge;
    toleranceMMRef.current = toleranceMM;
    maxCantMMRef.current   = maxCantMM;
    if (rawPointsRef.current.length > 0) {
      const recomputed = computeTrackGeometry(rawPointsRef.current, designGauge, toleranceMM, maxCantMM);
      setTrackData(recomputed);
    }
  }, [designGauge, toleranceMM, maxCantMM]);

  // ===== Load sample data from test.xlsm =====
  const loadSampleData = useCallback(() => {
    const sample = getSampleData();
    processRawPoints(sample);
  }, [processRawPoints]);

  // ===== Set track data from CSV =====
  const setTrackDataFromCSV = useCallback((csvRawPoints) => {
    processRawPoints(csvRawPoints);
  }, [processRawPoints]);

  // ===== Add a single point manually =====
  const addPoint = useCallback(() => {
    const le = parseFloat(newPoint.leftEasting);
    const ln = parseFloat(newPoint.leftNorthing);
    const re = parseFloat(newPoint.rightEasting);
    const rn = parseFloat(newPoint.rightNorthing);
    if (isNaN(le) || isNaN(ln) || isNaN(re) || isNaN(rn)) {
      alert('Please enter both Left and Right rail Easting/Northing');
      return;
    }

    const raw = [...rawPoints, {
      pointNumber: String(rawPoints.length + 1),
      leftEasting: le,
      leftNorthing: ln,
      leftHeight: parseFloat(newPoint.leftHeight) || 0,
      rightEasting: re,
      rightNorthing: rn,
      rightHeight: parseFloat(newPoint.rightHeight) || 0,
      type: newPoint.type,
      radius: parseFloat(newPoint.radius) || 0,
    }];

    processRawPoints(raw);

    setNewPoint(prev => ({
      ...prev,
      leftEasting: '', leftNorthing: '', leftHeight: '',
      rightEasting: '', rightNorthing: '', rightHeight: '',
    }));
  }, [newPoint, rawPoints, processRawPoints]);

  // ===== Clear all data =====
  const clearData = useCallback(() => {
    setTrackData([]);
    setRawPoints([]);
    rawPointsRef.current = [];
    setSimIndex(0);
  }, []);

  // ===== Simulation =====
  useEffect(() => {
    if (!simRunning) {
      if (simStepRef.current) {
        clearTimeout(simStepRef.current);
        simStepRef.current = null;
      }
      return;
    }

    const step = () => {
      if (!simRunningRef.current) return;

      setSimIndex(prev => {
        if (prev >= trackData.length - 1) {
          setSimRunning(false);
          return prev;
        }
        return prev + 1;
      });

      const delay = Math.max(30, 300 - simSpeed * 2.5);
      simStepRef.current = setTimeout(step, delay);
    };

    const delay = Math.max(30, 300 - simSpeed * 2.5);
    simStepRef.current = setTimeout(step, delay);

    return () => {
      if (simStepRef.current) {
        clearTimeout(simStepRef.current);
        simStepRef.current = null;
      }
    };
  }, [simRunning, simSpeed, trackData.length]);

  const toggleSimulation = useCallback(() => {
    if (trackData.length < 2) return;
    setSimRunning(prev => !prev);
  }, [trackData.length]);

  const resetSimulation = useCallback(() => {
    setSimRunning(false);
    setSimIndex(0);
  }, []);

  const onSimSlider = useCallback((val) => {
    if (trackData.length < 2) return;
    setSimRunning(false);
    const idx = Math.round((val / 100) * (trackData.length - 1));
    setSimIndex(idx);
  }, [trackData]);

  const onSimSpeedChange = useCallback((val) => {
    setSimSpeed(parseInt(val));
  }, []);

  // ===== View Controls =====
  const setViewScale = useCallback((scale) => {
    viewScaleRef.current = scale;
    setViewScaleInternal(scale);
  }, []);

  const zoomIn = useCallback(() => {
    const newScale = Math.min(20, viewScaleRef.current + 0.2);
    setViewScale(newScale);
  }, [setViewScale]);

  const zoomOut = useCallback(() => {
    const newScale = Math.max(0.1, viewScaleRef.current - 0.2);
    setViewScale(newScale);
  }, [setViewScale]);

  const resetView = useCallback(() => {
    viewOffsetXRef.current = 0;
    viewOffsetYRef.current = 0;
    setViewScale(1);
    setViewOffsetX(0);
    setViewOffsetY(0);
  }, [setViewScale, viewOffsetXRef, viewOffsetYRef]);

  const toggleGraphView = useCallback(() => {
    setGraphViewActive(prev => !prev);
  }, []);

  const onRailCheckboxChange = useCallback((rail, checked) => {
    setRailVisibility(prev => ({ ...prev, [rail]: checked }));
  }, []);

  // ===== Drag/Pan =====
  const handleCanvasMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - viewOffsetXRef.current,
      y: e.clientY - viewOffsetYRef.current,
    };
  }, []);

  const handleCanvasMouseMove = useCallback((e) => {
    if (isDraggingRef.current) {
      const newOx = e.clientX - dragStartRef.current.x;
      const newOy = e.clientY - dragStartRef.current.y;
      viewOffsetXRef.current = newOx;
      viewOffsetYRef.current = newOy;
      setViewOffsetX(newOx);
      setViewOffsetY(newOy);
    }
  }, []);

  const handleCanvasMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleCanvasWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const newScale = Math.max(0.1, Math.min(20, viewScaleRef.current + delta));
    setViewScale(newScale);
  }, [setViewScale]);

  // ===== Minimap — fix stale closure + document-level drag =====
  // Ref always holds the latest panMinimapTo logic so useCallback handlers are never stale
  const panMinimapToRef = useRef(null);

  function panMinimapTo(e) {
    if (trackData.length < 2 || !canvasRef.current || !minimapCanvasRef.current) return;
    const container = minimapCanvasRef.current.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;

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
    if (bw < 0.01 || bh < 0.01) return;

    const mw = rect.width * dpr;
    const mh = rect.height * dpr;
    const pad2 = 16 * dpr;
    const mScale = Math.min((mw - pad2 * 2) / bw, (mh - pad2 * 2) / bh);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const mOx = mw / 2 - cx * mScale;
    const mOy = mh / 2 + cy * mScale;

    const worldX = (mx - mOx) / mScale;
    const worldY = -(my - mOy) / mScale;

    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;
    const baseScale = Math.min(canvasW / bw, canvasH / bh) * 0.85;
    const s = viewScaleRef.current * baseScale;
    const cx2 = (minX + maxX) / 2;
    const cy2 = (minY + maxY) / 2;

    const newOx = cx2 * s - worldX * s;
    const newOy = -(cy2 * s - worldY * s);

    viewOffsetXRef.current = newOx;
    viewOffsetYRef.current = newOy;
    setViewOffsetX(newOx);
    setViewOffsetY(newOy);
  }

  // Keep the ref up to date every render
  panMinimapToRef.current = panMinimapTo;

  // Document-level drag listeners for minimap panning
  // Using useEffect so we add/remove listeners on mount/unmount
  useEffect(() => {
    const onMouseMove = (e) => {
      if (minimapIsDraggingRef.current && panMinimapToRef.current) {
        panMinimapToRef.current(e);
      }
    };
    const onMouseUp = () => {
      minimapIsDraggingRef.current = false;
    };
    // Must use capture phase so we intercept before React's synthetic events
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Minimap mousedown just sets the flag + does the first pan
  const handleMinimapMouseDown = useCallback((e) => {
    minimapIsDraggingRef.current = true;
    panMinimapToRef.current?.(e);
  }, []);

  // No need for minimap mousemove/mouseup — document-level handlers handle that
  const handleMinimapMouseUp = useCallback(() => {
    // fallback — also handled by document listener above
    minimapIsDraggingRef.current = false;
  }, []);

  const handleMinimapWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(20, viewScaleRef.current + delta));
    setViewScale(newScale);
  }, [setViewScale]);

  // ===== Gauge type change =====
  const handleGaugeTypeChange = useCallback((newTypeId) => {
    setGaugeTypeId(newTypeId);
  }, []);

  return {
    // Data
    trackData,
    rawPoints,
    trackName, setTrackName,
    startChainage, setStartChainage,

    // Gauge type
    gaugeTypeId,
    gaugeType,
    designGauge,
    toleranceMM,
    maxCantMM,
    setGaugeTypeId: handleGaugeTypeChange,

    // Simulation
    simIndex, setSimIndex,
    simRunning,
    simSpeed,
    toggleSimulation,
    resetSimulation,
    onSimSlider,
    onSimSpeedChange,

    // View
    viewScale, viewScaleRef,
    viewOffsetX, viewOffsetXRef,
    viewOffsetY, viewOffsetYRef,
    setViewScale,
    zoomIn, zoomOut, resetView,
    handleCanvasMouseDown, handleCanvasMouseMove, handleCanvasMouseUp,
    handleCanvasWheel,
    canvasRef,
    isDraggingRef, dragStartRef,

    // Minimap
    minimapCanvasRef,
    handleMinimapMouseDown, handleMinimapMouseUp,
    handleMinimapWheel,

    // Graph View
    graphViewActive,
    toggleGraphView,
    railVisibility,
    onRailCheckboxChange,

    // UI
    inputPanelVisible, setInputPanelVisible,
    uploadModalVisible, setUploadModalVisible,
    trackDataModalVisible, setTrackDataModalVisible,
    railPlanModalVisible, setRailPlanModalVisible,
    hoveredPoint, setHoveredPoint,
    tooltip, setTooltip,
    newPoint, setNewPoint,

    // Actions
    loadSampleData,
    setTrackDataFromCSV,
    addPoint,
    clearData,
  };
}
