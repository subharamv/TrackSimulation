import { useCallback, useEffect, useState, useRef } from 'react';
import Header from './components/Header';
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

  // ── Refs ───────────────────────────────────────────────────────────────
  const trackViewRef = useRef(null);

  // ── Track Statistics visibility ───────────────────────────────────────
  const [showStats, setShowStats] = useState(() => {
    const saved = localStorage.getItem('railsim_showStats');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('railsim_showStats', String(showStats));
  }, [showStats]);

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

  // ── 3D NAV overlay toggle ─────────────────────────────────────────────────
  const [showNavOverlay, setShowNavOverlay] = useState(() => {
    const saved = localStorage.getItem('railsim_showNavOverlay');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('railsim_showNavOverlay', String(showNavOverlay));
  }, [showNavOverlay]);

  // ── Universal keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrlShift = e.ctrlKey && e.shiftKey;
      const tv = trackViewRef.current;

      if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowStats(v => !v);
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
  }, []);

  // Auto-load first project on mount
  useEffect(() => {
    handleLoadProject(PROJECTS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      {/* V2 floating header overlay (track name + point count) */}
      <Header
        trackName={track.trackName}
        pointCount={track.trackData.length}
        onDataLoaded={(data) => { track.setTrackDataFromCSV(data); setActiveProjectId(null); }}
        onToggleInput={handleToggleInput}
        onSampleData={() => { track.loadSampleData(); setActiveProjectId(null); }}
        gaugeTypeId={track.gaugeTypeId}
        onGaugeTypeChange={track.setGaugeTypeId}
        compactMode={true}
        hideUpload={false}
        activeView={activeView}
      />

      <div className="main" style={{ height: '100vh' }}>

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
            showNavOverlay={showNavOverlay}
            onNavOverlayChange={setShowNavOverlay}
            onViewModeChange={setActiveView}
          />

          {/* ── Floating sidebar ─────────────────────────────────────── */}
          {activeView !== 'analytics' && activeView !== 'compare' && (
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
              activeView={activeView}
              showElevProfile={showElevProfile}
              onElevProfileChange={setShowElevProfile}
              showStats={showStats}
              onShowStatsChange={setShowStats}
            />
          )}

          {/* ── Stats overlay ────────────────────────────────────────── */}
          {showStats && (
            <StatsOverlay
              trackData={track.trackData}
              designGauge={track.designGauge}
              gaugeType={track.gaugeType}
              activePoint={activePoint}
              activeView={activeView}
            />
          )}

          {/* ── Logo watermark ───────────────────────────────────────── */}
          <div className="v2-logo">
            <span className="material-icons" style={{ fontSize: 14, color: 'var(--brand)' }}>tram</span>
            <span className="v2-logo-text">
              RAIL<span className="v2-logo-sub">SIM</span>
            </span>
          </div>
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
