import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { GAUGE_TYPES } from '../utils/geometry';
import ProjectsModal from './ProjectsModal';

export default function SidebarV2({
  trackData = [],
  onOpenTrackData,
  gaugeType,
  gaugeTypeId,
  setGaugeTypeId,
  onLoadProject,
  activeProjectId,
  showSegDist,
  showCumDist,
  onShowSegDistChange,
  onShowCumDistChange,
  onSampleData,
  onClearData,
  onToggleInput,
  onSwitchToV1,
  activeView = '2d',
  showElevProfile = true,
  onElevProfileChange,
  // Import wiring
  onDataLoaded,
  onGaugeTypeChange,
}) {
  const [flyout, setFlyout] = useState(null);        // 'settings' | 'clear' | null
  const [projectsTab, setProjectsTab] = useState(null); // null | 'projects' | 'import'
  const [flyoutY, setFlyoutY] = useState(0);
  const sidebarRef = useRef(null);
  const btnRefs = useRef({});

  const openFlyout = (name, btnId) => {
    if (flyout === name) { setFlyout(null); return; }
    const btn = btnRefs.current[btnId];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setFlyoutY(rect.top);
    }
    setFlyout(name);
  };

  // Close flyouts when clicking outside sidebar or flyout
  useEffect(() => {
    if (!flyout) return;
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target) &&
          !e.target.closest('.sv2-flyout')) {
        setFlyout(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [flyout]);

  const BUTTONS = [
    {
      id: 'projects',
      icon: 'folder_open',
      label: 'Projects',
      action: () => { setFlyout(null); setProjectsTab('projects'); },
    },
    {
      id: 'import',
      icon: 'upload_file',
      label: 'Import CSV',
      action: () => { setFlyout(null); setProjectsTab('import'); },
    },
    {
      id: 'trackdata',
      icon: 'table_view',
      label: 'Track Data',
      action: () => { setFlyout(null); onOpenTrackData?.(); },
    },
    null, // divider
    {
      id: 'settings',
      icon: 'tune',
      label: 'Settings',
      action: (btnId) => openFlyout('settings', btnId),
      hasPanel: true,
    },
    {
      id: 'clear',
      icon: 'delete_outline',
      label: 'Clear Data',
      action: (btnId) => openFlyout('clear', btnId),
      hasPanel: true,
      danger: true,
    },
  ];

  return (
    <>
      <div ref={sidebarRef} className="sidebar-v2">
        {/* V1 toggle button */}
        <button
          className="sv2-toggle-v1"
          onClick={onSwitchToV1}
          title="Switch to Classic sidebar"
        >
          <span className="material-icons" style={{ fontSize: 13 }}>view_sidebar</span>
        </button>

        <div className="sv2-divider" />

        {BUTTONS.map((btn, i) =>
          btn === null ? (
            <div key={`div-${i}`} className="sv2-divider" />
          ) : (
            <button
              key={btn.id}
              ref={el => { btnRefs.current[btn.id] = el; }}
              className={`sv2-btn${flyout === btn.id ? ' sv2-btn--active' : ''}${btn.danger ? ' sv2-btn--danger' : ''}`}
              onClick={() => btn.action(btn.id)}
              title={btn.label}
            >
              <span className="material-icons" style={{ fontSize: 19 }}>{btn.icon}</span>
            </button>
          )
        )}

      </div>

      {/* Flyouts rendered OUTSIDE sidebar-v2 so position:fixed works relative to viewport */}
      {flyout === 'settings' && (
        <FlyoutPanel top={flyoutY} title="Settings" onClose={() => setFlyout(null)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="sv2-flyout-label">
                  <span className="material-icons" style={{ fontSize: 12 }}>train</span>
                  Rail Gauge Type
                </div>
                <select
                  value={gaugeTypeId}
                  onChange={(e) => setGaugeTypeId?.(e.target.value)}
                  className="sv2-select"
                >
                  {GAUGE_TYPES.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({(g.gauge * 1000).toFixed(0)} mm)
                    </option>
                  ))}
                </select>
                {gaugeType && (
                  <div style={{ fontSize: 8.5, color: 'rgba(148,163,184,0.6)', marginTop: 3, lineHeight: 1.4 }}>
                    {gaugeType.desc}
                  </div>
                )}
              </div>

              {onShowSegDistChange && onShowCumDistChange && (
                <div>
                  <div className="sv2-flyout-label">
                    <span className="material-icons" style={{ fontSize: 12 }}>straighten</span>
                    Distance Labels
                  </div>
                  <label className="sv2-checkbox-row">
                    <input
                      type="checkbox"
                      checked={showSegDist}
                      onChange={(e) => onShowSegDistChange(e.target.checked)}
                      style={{ accentColor: 'var(--brand)' }}
                    />
                    <span>Segment distances</span>
                  </label>
                  <label className="sv2-checkbox-row" style={{ marginTop: 5 }}>
                    <input
                      type="checkbox"
                      checked={showCumDist}
                      onChange={(e) => onShowCumDistChange(e.target.checked)}
                      style={{ accentColor: 'var(--brand)' }}
                    />
                    <span>Cumulative chainages</span>
                  </label>
                </div>
              )}

              <div>
                <div className="sv2-flyout-label">
                  <span className="material-icons" style={{ fontSize: 12 }}>show_chart</span>
                  Elevation Profile
                </div>
                <label className="sv2-checkbox-row">
                  <input
                    type="checkbox"
                    checked={showElevProfile}
                    onChange={(e) => onElevProfileChange?.(e.target.checked)}
                    style={{ accentColor: 'var(--brand)' }}
                  />
                  <span>Show elevation strip</span>
                </label>
                <div style={{ fontSize: 8, color: 'rgba(148,163,184,0.45)', marginTop: 3, lineHeight: 1.4 }}>
                  Visible in 2D &amp; 3D views
                </div>
              </div>
            </div>
          </FlyoutPanel>
        )}

        {/* Clear confirm flyout */}
        {flyout === 'clear' && (
          <FlyoutPanel top={flyoutY} title="Clear All Data" onClose={() => setFlyout(null)} width={220}>
            <p style={{ fontSize: 11, color: 'rgba(148,163,184,0.8)', marginBottom: 12, lineHeight: 1.5 }}>
              This will remove all loaded track data. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="sv2-flyout-btn sv2-flyout-btn--danger"
                onClick={() => { onClearData?.(); setFlyout(null); }}
              >
                <span className="material-icons" style={{ fontSize: 13 }}>delete</span>
                Clear
              </button>
              <button className="sv2-flyout-btn" onClick={() => setFlyout(null)}>
                Cancel
              </button>
            </div>
          </FlyoutPanel>
        )}

      {/* Projects / Import modal */}
      {projectsTab !== null && (
        <ProjectsModal
          onClose={() => setProjectsTab(null)}
          onLoadProject={onLoadProject}
          activeProjectId={activeProjectId}
          onSampleData={onSampleData}
          onToggleInput={onToggleInput}
          onDataLoaded={onDataLoaded}
          gaugeTypeId={gaugeTypeId}
          onGaugeTypeChange={onGaugeTypeChange}
          defaultTab={projectsTab}
        />
      )}
    </>
  );
}

/* ── Flyout panel helper ──────────────────────────────────────────────────── */
function FlyoutPanel({ top, title, onClose, width = 270, children }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const panelH = ref.current.offsetHeight;
    const vpH = window.innerHeight;
    const clamped = Math.max(12, Math.min(top, vpH - panelH - 12));
    ref.current.style.top = clamped + 'px';
    ref.current.style.visibility = 'visible';
  }, [top]);

  return (
    <div ref={ref} className="sv2-flyout" style={{ width, top, visibility: 'hidden' }}>
      <div className="sv2-flyout-header">
        <span>{title}</span>
        <button className="sv2-flyout-close" onClick={onClose}>
          <span className="material-icons" style={{ fontSize: 14 }}>close</span>
        </button>
      </div>
      <div className="sv2-flyout-body">{children}</div>
    </div>
  );
}
