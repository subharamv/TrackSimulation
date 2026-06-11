import { useEffect, useRef, useState } from 'react';
import { PROJECTS } from '../data/projects';
import ImportWizard from './ImportWizard';

export default function ProjectsModal({
  onClose,
  onLoadProject,
  activeProjectId,
  onSampleData,
  onToggleInput,
  // Import tab props
  onDataLoaded,
  gaugeTypeId,
  onGaugeTypeChange,
  defaultTab = 'projects', // 'projects' | 'import'
}) {
  const [tab, setTab] = useState(defaultTab);
  const overlayRef = useRef(null);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleLoad = (proj) => {
    onLoadProject?.(proj);
    onClose();
  };

  const typeColor = (type) => {
    if (type === 'Arc') return { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' };
    return { bg: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'rgba(16,185,129,0.25)' };
  };

  const TABS = [
    { id: 'projects', icon: 'folder_open', label: 'Projects' },
    { id: 'import',   icon: 'upload_file', label: 'Import CSV' },
  ];

  return (
    <div
      className="pm-backdrop"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="pm-modal">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="pm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'rgba(244,129,32,0.12)',
              border: '1px solid rgba(244,129,32,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-icons" style={{ fontSize: 18, color: 'var(--brand)' }}>
                {tab === 'import' ? 'upload_file' : 'folder_open'}
              </span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                {tab === 'import' ? 'Import Track Survey CSV' : 'Projects'}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.7)', marginTop: 1 }}>
                {tab === 'import'
                  ? 'Upload and map your CSV columns'
                  : `${PROJECTS.length} project${PROJECTS.length !== 1 ? 's' : ''} available`}
              </div>
            </div>
          </div>
          <button className="pm-close-btn" onClick={onClose}>
            <span className="material-icons" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* ── Tab switcher ────────────────────────────────────────────── */}
        <div className="pm-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`pm-tab${tab === t.id ? ' pm-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}

          {/* Action buttons — right side of tab bar */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              className="pm-sample-btn"
              disabled
              title="Input panel (coming soon)"
              style={{ background: 'rgba(148,163,184,0.04)', borderColor: 'rgba(148,163,184,0.1)', color: 'rgba(148,163,184,0.3)', cursor: 'not-allowed', opacity: 0.5 }}
            >
              <span className="material-icons" style={{ fontSize: 13 }}>tune</span>
              Input
            </button>
            {tab === 'projects' && (
              <button
                className="pm-sample-btn"
                onClick={() => { onSampleData?.(); onClose(); }}
                title="Load sample data"
              >
                <span className="material-icons" style={{ fontSize: 13 }}>auto_awesome</span>
                Sample Data
              </button>
            )}
          </div>
        </div>

        {/* ── Projects tab ─────────────────────────────────────────────── */}
        {tab === 'projects' && (
          <>
            <div style={{
              padding: '0 20px 10px',
              fontSize: 10, color: 'rgba(148,163,184,0.5)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span className="material-icons" style={{ fontSize: 12 }}>info_outline</span>
              Click a project to load its track data
            </div>

            <div className="pm-grid">
              {PROJECTS.map(proj => {
                const isActive = activeProjectId === proj.id;
                const tc = typeColor(proj.type);
                return (
                  <button
                    key={proj.id}
                    className={`pm-card${isActive ? ' pm-card--active' : ''}`}
                    onClick={() => handleLoad(proj)}
                  >
                    {isActive && (
                      <div className="pm-active-badge">
                        <span className="material-icons" style={{ fontSize: 11 }}>check_circle</span>
                        Loaded
                      </div>
                    )}
                    <div className="pm-card-icon">
                      <span className="material-icons" style={{ fontSize: 22, color: isActive ? 'var(--brand)' : 'rgba(148,163,184,0.5)' }}>
                        {isActive ? 'folder' : 'folder_open'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span className="pm-card-code">{proj.code}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                        background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
                      }}>{proj.type}</span>
                    </div>
                    <div className="pm-card-name">{proj.name}</div>
                    <div className="pm-card-footer">
                      <div className="pm-card-stat">
                        <span className="material-icons" style={{ fontSize: 11 }}>place</span>
                        {proj.points} pts
                      </div>
                      <div className={`pm-card-load${isActive ? ' pm-card-load--active' : ''}`}>
                        <span className="material-icons" style={{ fontSize: 12 }}>
                          {isActive ? 'check' : 'arrow_forward'}
                        </span>
                        {isActive ? 'Loaded' : 'Load'}
                      </div>
                    </div>
                  </button>
                );
              })}

              {PROJECTS.length === 0 && (
                <div style={{
                  gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px',
                  color: 'rgba(148,163,184,0.4)', fontSize: 12,
                }}>
                  <span className="material-icons" style={{ fontSize: 36, display: 'block', marginBottom: 8 }}>folder_off</span>
                  No projects available
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Import tab ───────────────────────────────────────────────── */}
        {tab === 'import' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
            <ImportWizard
              onDataLoaded={onDataLoaded}
              gaugeTypeId={gaugeTypeId}
              onGaugeTypeChange={onGaugeTypeChange}
              onDone={onClose}
            />
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="pm-footer">
          <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: 10 }}>
            Press{' '}
            <kbd style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 9,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            }}>Esc</kbd>
            {' '}to close
          </span>
          <button className="pm-close-text-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
