import { useCallback, useEffect, useState, useRef } from 'react';
import Header from './components/Header';
import LeftPanel from './components/LeftPanel';
import SidebarV2 from './components/SidebarV2';
import StatsOverlay from './components/StatsOverlay';
import TrackView from './components/TrackView';
import RightPanel from './components/RightPanel';
import TrackDataModal from './components/TrackDataModal';
import { useTrackData } from './hooks/useTrackData';
import { exportCSV, extractCSVHeaders, autoDetectMapping, parseCSVWithMapping } from './utils/csvParser';
import { PROJECTS } from './data/projects';
import './App.css';

const CHART_DEFS = [
  { id: 'gvGaugeChart',    title: 'Gauge Profile',      dotColor: '#f59e0b' },
  { id: 'gvCantChart',     title: 'Cant Profile',        dotColor: '#7c3aed' },
  { id: 'gvHeightChart',   title: 'L/R Rail Height',     dotColor: '#f48120' },
  { id: 'gvGaugeDiffChart',title: 'Gauge Deviation',     dotColor: '#10b981' },
  { id: 'gvCantDiffChart', title: 'Cant Deviation',      dotColor: '#a78bfa' },
  { id: 'gvGaugeVsElevChart', title: 'Gauge vs Elevation', dotColor: '#f48120' },
  { id: 'gvAnalysisChart', title: 'Quality Analysis',    dotColor: '#38bdf8' },
];

export default function App() {
  const track = useTrackData();
  const [activePoint, setActivePoint] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeView, setActiveView] = useState('2d'); // '2d' | '3d' | 'analytics' | 'compare'

  // ── Sidebar version toggle (v1 = classic panel, v2 = floating icon bar) ──
  const [sidebarV2, setSidebarV2] = useState(() => {
    const saved = localStorage.getItem('railsim_sidebarV2');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('railsim_sidebarV2', String(sidebarV2));
  }, [sidebarV2]);

  // ── Compact (immersive) header ─────────────────────────────────────────
  const [compactMode, setCompactMode] = useState(() => {
    const saved = localStorage.getItem('railsim_compactMode');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('railsim_compactMode', String(compactMode));
  }, [compactMode]);
  const toggleCompactMode = useCallback(() => setCompactMode(v => !v), []);

  // ── Refs ───────────────────────────────────────────────────────────────
  const trackViewRef = useRef(null);
  const headerRef    = useRef(null);

  // ── Load project ───────────────────────────────────────────────────────
  const handleLoadProject = useCallback((proj) => {
    try {
      const { headers } = extractCSVHeaders(proj.csvText);
      const mapping = autoDetectMapping(headers);
      const data = parseCSVWithMapping(proj.csvText, mapping);
      track.setTrackDataFromCSV(data);
      track.setTrackName(proj.code);
      setActiveProjectId(proj.id);
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }, [track]);

  const [showSegDist, setShowSegDist] = useState(true);
  const [showCumDist, setShowCumDist] = useState(true);
  const [chartCount, setChartCount] = useState(5);
  const [chartSelections, setChartSelections] = useState(() => {
    const s = {};
    CHART_DEFS.forEach(d => { s[d.id] = true; });
    return s;
  });
  const toggleChart = useCallback((id) => {
    setChartSelections(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleExportData = useCallback((columnKeys) => {
    const csv = exportCSV(track.trackData, columnKeys);
    if (!csv) return alert('No data to export');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rail_track_data.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [track.trackData]);

  const handleClearData = useCallback(() => {
    if (track.trackData.length === 0) return;
    track.clearData();
  }, [track]);

  const handleToggleInput = useCallback(() => {
    track.setInputPanelVisible(prev => !prev);
  }, [track]);

  const handleOpenTrackData = useCallback(() => {
    track.setTrackDataModalVisible(true);
  }, [track]);

  // ── Sidebar collapse (V1 only) ─────────────────────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    const saved = localStorage.getItem('railsim_leftCollapsed');
    return saved !== null ? saved === 'true' : false;
  });
  useEffect(() => {
    localStorage.setItem('railsim_leftCollapsed', String(leftCollapsed));
  }, [leftCollapsed]);

  // ── Elevation profile strip toggle ────────────────────────────────────────
  const [showElevProfile, setShowElevProfile] = useState(() => {
    const saved = localStorage.getItem('railsim_showElevProfile');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('railsim_showElevProfile', String(showElevProfile));
  }, [showElevProfile]);

  // ── Universal keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrlShift = e.ctrlKey && e.shiftKey;
      const tv = trackViewRef.current;

      if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        if (sidebarV2) setSidebarV2(false);
        else setLeftCollapsed(v => !v);
        return;
      }
      if (ctrlShift && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); tv?.switchToAnalytics(); return; }
      if (ctrlShift && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); tv?.switchToCompare(); return; }
      if (ctrlShift && e.code === 'Digit2') { e.preventDefault(); tv?.switchTo2D(); return; }
      if (ctrlShift && e.code === 'Digit3') { e.preventDefault(); tv?.switchTo3D(); return; }
      if (ctrlShift && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); tv?.resetView(); return; }
      if (ctrlShift && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); tv?.toggleMap(); return; }
      if (ctrlShift && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); tv?.togglePoints(); return; }
      if (e.key === 'Escape') { tv?.closeOverlays(); return; }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarV2]);

  // Auto-load first project on mount
  useEffect(() => {
    handleLoadProject(PROJECTS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <Header
        ref={headerRef}
        trackName={track.trackName}
        pointCount={track.trackData.length}
        onDataLoaded={(data) => { track.setTrackDataFromCSV(data); setActiveProjectId(null); }}
        onToggleInput={handleToggleInput}
        onSampleData={() => { track.loadSampleData(); setActiveProjectId(null); }}
        gaugeTypeId={track.gaugeTypeId}
        onGaugeTypeChange={track.setGaugeTypeId}
        compactMode={compactMode}
        onToggleCompactMode={toggleCompactMode}
        hideUpload={sidebarV2}
      />

      <div className="main" style={compactMode ? { height: '100vh' } : undefined}>

        {/* ── V1 classic sidebar ─────────────────────────────────────── */}
        {!sidebarV2 && (
          <LeftPanel
            trackData={track.trackData}
            onOpenTrackData={handleOpenTrackData}
            gaugeType={track.gaugeType}
            gaugeTypeId={track.gaugeTypeId}
            setGaugeTypeId={track.setGaugeTypeId}
            designGauge={track.designGauge}
            showSegDist={showSegDist}
            showCumDist={showCumDist}
            onShowSegDistChange={setShowSegDist}
            onShowCumDistChange={setShowCumDist}
            chartCount={chartCount}
            onChartCountChange={setChartCount}
            chartSelections={chartSelections}
            onToggleChart={toggleChart}
            chartDefs={CHART_DEFS}
            activePoint={activePoint}
            onLoadProject={handleLoadProject}
            activeProjectId={activeProjectId}
            compactMode={compactMode}
            onSampleData={() => { track.loadSampleData(); setActiveProjectId(null); }}
            collapsed={leftCollapsed}
            onCollapseChange={setLeftCollapsed}
          />
        )}

        {/* ── Main view area ─────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <TrackView
            ref={trackViewRef}
            trackData={track.trackData}
            simIndex={track.simIndex}
            viewScale={track.viewScale}
            viewScaleRef={track.viewScaleRef}
            viewOffsetX={track.viewOffsetX}
            viewOffsetY={track.viewOffsetY}
            viewOffsetXRef={track.viewOffsetXRef}
            viewOffsetYRef={track.viewOffsetYRef}
            onZoomIn={track.zoomIn}
            onZoomOut={track.zoomOut}
            onResetView={track.resetView}
            onSetViewScale={track.setViewScale}
            canvasRef={track.canvasRef}
            minimapCanvasRef={track.minimapCanvasRef}
            onMinimapMouseDown={track.handleMinimapMouseDown}
            onMinimapMouseUp={track.handleMinimapMouseUp}
            onMinimapWheel={track.handleMinimapWheel}
            graphViewActive={track.graphViewActive}
            toggleGraphView={track.toggleGraphView}
            selectedGraph={track.selectedGraph}
            railVisibility={track.railVisibility}
            onRailCheckboxChange={track.onRailCheckboxChange}
            designGauge={track.designGauge}
            gaugeType={track.gaugeType}
            chartCount={chartCount}
            onChartCountChange={setChartCount}
            chartSelections={chartSelections}
            onToggleChart={toggleChart}
            chartDefs={CHART_DEFS}
            tooltip={track.tooltip}
            setTooltip={track.setTooltip}
            hoveredPoint={track.hoveredPoint}
            setHoveredPoint={track.setHoveredPoint}
            isDraggingRef={track.isDraggingRef}
            onActivePointChange={setActivePoint}
            showSegDist={showSegDist}
            showCumDist={showCumDist}
            showElevProfile={showElevProfile}
            onElevProfileChange={setShowElevProfile}
            onViewModeChange={setActiveView}
          />

          {/* ── V2 floating sidebar ──────────────────────────────────── */}
          {sidebarV2 && activeView !== 'analytics' && activeView !== 'compare' && (
            <SidebarV2
              trackData={track.trackData}
              onOpenTrackData={handleOpenTrackData}
              gaugeType={track.gaugeType}
              gaugeTypeId={track.gaugeTypeId}
              setGaugeTypeId={track.setGaugeTypeId}
              designGauge={track.designGauge}
              onLoadProject={handleLoadProject}
              activeProjectId={activeProjectId}
              showSegDist={showSegDist}
              showCumDist={showCumDist}
              onShowSegDistChange={setShowSegDist}
              onShowCumDistChange={setShowCumDist}
              onSampleData={() => { track.loadSampleData(); setActiveProjectId(null); }}
              onClearData={handleClearData}
              onToggleInput={handleToggleInput}
              onDataLoaded={(data) => { track.setTrackDataFromCSV(data); setActiveProjectId(null); }}
              onGaugeTypeChange={track.setGaugeTypeId}
              onSwitchToV1={() => setSidebarV2(false)}
              activeView={activeView}
              showElevProfile={showElevProfile}
              onElevProfileChange={setShowElevProfile}
            />
          )}

          {/* ── Stats overlay (floating stats + point info) ────────────── */}
          <StatsOverlay
            trackData={track.trackData}
            designGauge={track.designGauge}
            gaugeType={track.gaugeType}
            compactMode={compactMode}
            activePoint={activePoint}
            activeView={activeView}
            sidebarV2={sidebarV2}
            leftCollapsed={leftCollapsed}
          />

          {/* ── V2 logo bottom-left ─────────────────────────────────── */}
          {sidebarV2 && (
            <div className="v2-logo">
              <span className="material-icons" style={{ fontSize: 14, color: 'var(--brand)' }}>tram</span>
              <span className="v2-logo-text">
                RAIL<span className="v2-logo-sub">SIM</span>
              </span>
            </div>
          )}

          {/* ── V1 "switch to V2" hint button ───────────────────────── */}
          {!sidebarV2 && (
            <button
              className="v1-switch-v2-btn"
              onClick={() => setSidebarV2(true)}
              title="Switch to V2 sidebar"
            >
              <span className="material-icons" style={{ fontSize: 13 }}>auto_awesome</span>
              V2
            </button>
          )}
        </div>

        <RightPanel
          visible={track.inputPanelVisible}
          trackName={track.trackName}
          onTrackNameChange={track.setTrackName}
          startChainage={track.startChainage}
          onStartChainageChange={track.setStartChainage}
          newPoint={track.newPoint}
          onNewPointChange={track.setNewPoint}
          onAddPoint={track.addPoint}
          onExportData={handleExportData}
          onClearData={handleClearData}
          gaugeTypeId={track.gaugeTypeId}
          onGaugeTypeChange={track.setGaugeTypeId}
          designGauge={track.designGauge}
        />
      </div>

      <TrackDataModal
        visible={track.trackDataModalVisible}
        onClose={() => track.setTrackDataModalVisible(false)}
        trackData={track.trackData}
        onExportData={handleExportData}
        trackName={track.trackName}
        canvasRef={track.canvasRef}
        gaugeType={track.gaugeType}
      />
    </div>
  );
}
