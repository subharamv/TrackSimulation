import { useState, useRef, useEffect } from 'react';
import { computeStats, GAUGE_TYPES } from '../utils/geometry';
import { PROJECTS } from '../data/projects';

export default function LeftPanel({
  trackData,
  onOpenTrackData,
  gaugeType,
  gaugeTypeId,
  setGaugeTypeId,
  designGauge,
  activePoint,
  onLoadProject,
  activeProjectId,
  showSegDist,
  showCumDist,
  onShowSegDistChange,
  onShowCumDistChange,
  compactMode = false,
  onSampleData,
  collapsed = false,
  onCollapseChange,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  const [settingsPos, setSettingsPos] = useState({ top: 0 });
  const stats = trackData.length >= 2 ? computeStats(trackData, designGauge) : null;

  // Close settings dropdown when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  if (collapsed) {
    return (
      <div className="left-panel left-panel--collapsed">
        <button
          className="panel-collapse-btn"
          onClick={() => onCollapseChange?.(false)}
          title="Expand sidebar"
        >
          <span className="material-icons" style={{ fontSize: 18 }}>chevron_right</span>
        </button>
      </div>
    );
  }

  return (
    <div className="left-panel">
      <div className="panel-collapse-header">
        {compactMode && (
          <div className="sidebar-logo">
            <span className="material-icons" style={{ fontSize: 16, color: 'var(--brand)' }}>tram</span>
            RAIL<span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-dim)', letterSpacing: '0.5px' }}>SIM</span>
          </div>
        )}
        <button
          className="panel-collapse-btn"
          onClick={() => onCollapseChange?.(true)}
          title="Collapse sidebar"
        >
          <span className="material-icons" style={{ fontSize: 18 }}>chevron_left</span>
        </button>
      </div>

      {/* Track Statistics */}
      <div className="panel-section" style={{ paddingBottom: '8px' }}>
        <div className="section-title">
          <span className="material-icons" style={{ fontSize: 14 }}>bar_chart</span>
          Track Statistics
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Track Length</div>
            <div className="stat-value accent">
              {stats ? stats.totalLength.toFixed(2) : '—'} <span className="stat-unit">m</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Design Gauge</div>
            <div className="stat-value" style={{ color: '#94a3b8', fontSize: 13 }}>
              {stats ? `${stats.designGauge.toFixed(3)}` : '—'} <span className="stat-unit">m</span>
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-dim)', marginTop: 1 }}>{gaugeType?.name || ''}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Gauge Range</div>
            <div className="stat-value accent3" style={{ fontSize: 13 }}>
              {stats ? `${stats.minGauge.toFixed(3)}–${stats.maxGauge.toFixed(3)}` : '—'} <span className="stat-unit">m</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Cant Range</div>
            <div className="stat-value accent2" style={{ fontSize: 13 }}>
              {stats ? `${(stats.minCant * 1000).toFixed(1)}–${(stats.maxCant * 1000).toFixed(1)}` : '—'} <span className="stat-unit">mm</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Gauge</div>
            <div className="stat-value accent3" style={{ fontSize: 13 }}>
              {stats ? stats.avgGauge.toFixed(4) : '—'} <span className="stat-unit">m</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Elevation Δ</div>
            <div className="stat-value accent4">
              {stats ? stats.elevationDelta.toFixed(3) : '—'} <span className="stat-unit">m</span>
            </div>
          </div>
        </div>
      </div>

      {activePoint && (
        <div className="point-detail-card">
          <div className="point-detail-header">
            <span className="material-icons" style={{ fontSize: 12 }}>radio_button_checked</span>
            Point #{activePoint.pointNumber}
            <span className="point-type-badge" style={{
              marginLeft: 'auto',
              background: activePoint.type === 'arc' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
              color: activePoint.type === 'arc' ? '#f59e0b' : '#10b981',
              border: `1px solid ${activePoint.type === 'arc' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'}`,
              borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              {activePoint.type}{activePoint.radius > 0 ? ` R${activePoint.radius.toFixed(0)}m` : ''}
            </span>
          </div>

          <div className="point-detail-row">
            <span className="point-detail-label">Chainage</span>
            <span className="point-detail-value">{activePoint.chainage.toFixed(3)} <span className="point-detail-unit">m</span></span>
          </div>
          <div className="point-detail-row">
            <span className="point-detail-label">Gauge</span>
            <span className="point-detail-value accent">{activePoint.gauge.toFixed(4)} <span className="point-detail-unit">m</span></span>
          </div>
          <div className="point-detail-row">
            <span className="point-detail-label">Cant</span>
            <span className="point-detail-value accent2">{(activePoint.cant * 1000).toFixed(2)} <span className="point-detail-unit">mm</span></span>
          </div>

          <div className="point-detail-divider" />

          <div className="point-detail-rail-row">
            <span className="point-rail-tag left">L</span>
            <span className="point-detail-coords">
              E {activePoint.leftEasting.toFixed(3)}
              &nbsp; N {activePoint.leftNorthing.toFixed(3)}
              &nbsp; H {activePoint.leftHeight.toFixed(3)}
            </span>
          </div>
          <div className="point-detail-rail-row">
            <span className="point-rail-tag center">C</span>
            <span className="point-detail-coords">
              E {activePoint.easting.toFixed(3)}
              &nbsp; N {activePoint.northing.toFixed(3)}
              &nbsp; H {activePoint.height.toFixed(3)}
            </span>
          </div>
          <div className="point-detail-rail-row">
            <span className="point-rail-tag right">R</span>
            <span className="point-detail-coords">
              E {activePoint.rightEasting.toFixed(3)}
              &nbsp; N {activePoint.rightNorthing.toFixed(3)}
              &nbsp; H {activePoint.rightHeight.toFixed(3)}
            </span>
          </div>
        </div>
      )}

      {/* Projects */}
      <div className="panel-section" style={{ padding: '8px 16px' }}>
        <div className="section-title">
          <span className="material-icons" style={{ fontSize: 14 }}>folder_open</span>
          Projects
          <button
            onClick={onSampleData}
            title="Load sample data"
            style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', fontSize: 9, fontWeight: 600,
              background: 'linear-gradient(135deg, var(--accent2), #6d28d9)',
              color: '#fff', border: 'none', borderRadius: 5,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: '0 1px 4px rgba(124,58,237,0.25)',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              letterSpacing: '0.3px',
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(124,58,237,0.35)'; }}
            onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(124,58,237,0.25)'; }}
          >
            <span className="material-icons" style={{ fontSize: 11 }}>auto_awesome</span>
            Sample
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PROJECTS.map(proj => {
            const isActive = activeProjectId === proj.id;
            return (
              <button
                key={proj.id}
                onClick={() => onLoadProject && onLoadProject(proj)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: isActive ? 'rgba(244,129,32,0.1)' : 'var(--bg-card)',
                  border: `1px solid ${isActive ? 'rgba(244,129,32,0.35)' : 'var(--border)'}`,
                  borderRadius: 7, padding: '8px 10px',
                  transition: 'all 0.15s',
                  outline: 'none',
                }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = 'rgba(244,129,32,0.3)'; e.currentTarget.style.background = 'rgba(244,129,32,0.05)'; } }}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)'; } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span className="material-icons" style={{ fontSize: 13, color: isActive ? 'var(--brand)' : 'var(--text-dim)', flexShrink: 0 }}>
                    {isActive ? 'folder' : 'folder_open'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? 'var(--brand)' : 'var(--text-primary)', letterSpacing: '0.2px' }}>
                    {proj.code}
                  </span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 9, fontWeight: 600,
                    color: isActive ? 'var(--brand)' : 'var(--text-dim)',
                    background: isActive ? 'rgba(244,129,32,0.12)' : 'var(--surface-muted)',
                    border: `1px solid ${isActive ? 'rgba(244,129,32,0.25)' : 'var(--border)'}`,
                    borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
                  }}>
                    {proj.points} pts
                  </span>
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4, paddingLeft: 19,
                  overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {proj.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom actions — Track Data + Settings */}
      <div
        ref={settingsRef}
        className="panel-section"
        style={{ padding: '8px 16px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}
      >
        {/* Settings dropdown panel — floating beside sidebar */}
        {settingsOpen && (
          <div style={{
            position: 'fixed',
            left: 284,
            top: settingsPos.top,
            zIndex: 200,
            width: 240,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            padding: '12px 13px',
            display: 'flex', flexDirection: 'column', gap: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
          }}>
            {/* Rail Gauge Type */}
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>
                <span className="material-icons" style={{ fontSize: 13 }}>train</span>
                Rail Gauge Type
              </div>
              <select
                value={gaugeTypeId}
                onChange={(e) => setGaugeTypeId && setGaugeTypeId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 7px',
                  borderRadius: 5,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-primary)',
                  fontSize: 10,
                  outline: 'none',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {GAUGE_TYPES.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({(g.gauge * 1000).toFixed(0)} mm)
                  </option>
                ))}
              </select>
              {gaugeType && (
                <div style={{ fontSize: 8.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                  {gaugeType.desc}
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border)', margin: '0 -2px' }} />

            {/* Distance Labels */}
            {onShowSegDistChange && onShowCumDistChange && (
              <div>
                <div className="section-title" style={{ marginBottom: 5 }}>
                  <span className="material-icons" style={{ fontSize: 13 }}>distance</span>
                  Distance Labels
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 3, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={showSegDist}
                    onChange={(e) => onShowSegDistChange(e.target.checked)}
                    style={{ accentColor: 'var(--brand)' }}
                  />
                  Segment distances
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={showCumDist}
                    onChange={(e) => onShowCumDistChange(e.target.checked)}
                    style={{ accentColor: 'var(--brand)' }}
                  />
                  Cumulative chainages
                </label>
              </div>
            )}
          </div>
        )}

        <button
          className="btn"
          onClick={onOpenTrackData}
          style={{ width: '100%', justifyContent: 'center', padding: '10px 14px' }}
        >
          <span className="material-icons" style={{ fontSize: 15 }}>table_view</span>
          Track Data
        </button>

        <button
          ref={settingsBtnRef}
          className={`btn${settingsOpen ? ' active' : ''}`}
          onClick={() => {
            if (!settingsOpen && settingsBtnRef.current) {
              const rect = settingsBtnRef.current.getBoundingClientRect();
              const panelH = 260;
              const vpH = window.innerHeight;
              const clampedTop = Math.max(12, Math.min(rect.top, vpH - panelH - 12));
              setSettingsPos({ top: clampedTop });
            }
            setSettingsOpen(v => !v);
          }}
          style={{ width: '100%', justifyContent: 'center', padding: '9px 14px', gap: 6 }}
        >
          <span className="material-icons" style={{ fontSize: 15 }}>settings</span>
          Settings
          <span className="material-icons" style={{ fontSize: 14, marginLeft: 'auto', opacity: 0.7 }}>
            {settingsOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>
      </div>
    </div>
  );
}
