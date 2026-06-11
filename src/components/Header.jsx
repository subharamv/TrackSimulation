import { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { extractCSVHeaders, autoDetectMapping, parseCSVWithMapping, generateTemplate } from '../utils/csvParser';
import { GAUGE_TYPES } from '../utils/geometry';

const REQUIRED_FIELDS = [
  { key: 'point',  label: 'Point Number' },
  { key: 'leftE',  label: 'Left Easting' },
  { key: 'leftN',  label: 'Left Northing' },
  { key: 'leftH',  label: 'Left Height' },
  { key: 'rightE', label: 'Right Easting' },
  { key: 'rightN', label: 'Right Northing' },
  { key: 'rightH', label: 'Right Height' },
];
const OPTIONAL_FIELDS = [
  { key: 'type',   label: 'Type (straight / arc)' },
  { key: 'radius', label: 'Radius (m)' },
];

// Light palette — white bg, black text, orange/grey buttons
const C = {
  bg:            '#ffffff',
  surface:       '#ffffff',
  card:          '#f5f5f5',
  cardHover:     '#ebebeb',
  border:        '#d1d5db',
  borderFaint:   '#e5e7eb',
  text:          '#111111',
  textSub:       '#555555',
  textDim:       '#888888',
  accent:        '#f48120',
  accentSoft:    'rgba(244,129,32,0.08)',
  accentBorder:  'rgba(244,129,32,0.35)',
  accentHover:   'rgba(244,129,32,0.15)',
  accentSolid:   '#f48120',
  green:         '#16a34a',
  greenSoft:     'rgba(22,163,74,0.08)',
  greenBorder:   'rgba(22,163,74,0.25)',
  red:           '#dc2626',
  redSoft:       'rgba(220,38,38,0.07)',
  redBorder:     'rgba(220,38,38,0.3)',
};

const Header = forwardRef(function Header({ trackName, pointCount, onDataLoaded, onToggleInput, gaugeTypeId = 'tramway', onGaugeTypeChange, compactMode = false, onToggleCompactMode, hideUpload = false }, ref) {
  const [open, setOpen]               = useState(false);
  const [step, setStep]               = useState('upload');
  const [csvRaw, setCsvRaw]           = useState(null);
  const [mapping, setMapping]         = useState({});
  const [dragging, setDragging]       = useState(false);
  const [error, setError]             = useState('');
  const [selectedGaugeId, setSelectedGaugeId] = useState(gaugeTypeId);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useImperativeHandle(ref, () => ({ openImport: () => setOpen(true) }), []);

  const close = useCallback(() => {
    setOpen(false); setStep('upload'); setCsvRaw(null);
    setMapping({}); setError(''); setDragging(false);
  }, []);

  // Keep selectedGaugeId in sync if the app-level gauge changes externally
  useEffect(() => { setSelectedGaugeId(gaugeTypeId); }, [gaugeTypeId]);

  const readFile = useCallback((file) => {
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const { headers, preview, totalRows } = extractCSVHeaders(text);
        const detected = autoDetectMapping(headers);
        setCsvRaw({ text, headers, preview, totalRows, filename: file.name });
        setMapping(detected);
        setStep('mapping');
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = useCallback((e) => { readFile(e.target.files[0]); e.target.value = ''; }, [readFile]);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }, [readFile]);

  const handleImport = useCallback(() => {
    try {
      const data = parseCSVWithMapping(csvRaw.text, mapping);
      onGaugeTypeChange?.(selectedGaugeId);
      onDataLoaded(data);
      close();
    } catch (err) {
      setError(err.message);
    }
  }, [csvRaw, mapping, onDataLoaded, onGaugeTypeChange, selectedGaugeId, close]);

  const handleDownloadTemplate = useCallback(() => {
    const csv = generateTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rail_survey_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const allRequiredMapped = REQUIRED_FIELDS.every(f => mapping[f.key] >= 0);

  const sectionLabel = {
    fontSize: 10,
    fontWeight: 700,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: 8,
  };

  const selectStyle = {
    background: '#ffffff',
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    color: '#111111',
    fontSize: 12,
    padding: '7px 10px',
    width: '100%',
    cursor: 'pointer',
    outline: 'none',
    transition: 'border-color 0.15s',
    appearance: 'auto',
  };

  return (
    <>
      {/* ── Normal header bar (v1) ── */}
      {!compactMode && (
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon material-icons" style={{ fontSize: 22 }}>tram</span>
              RAIL<span className="logo-sub">SIM</span>
            </div>
            <div className="logo-legend">
              <span className="legend-dot" style={{ background: '#3b82f6' }}></span>
              <span className="legend-dot" style={{ background: '#10b981' }}></span>
              <span className="legend-dot" style={{ background: '#ef4444' }}></span>
            </div>
          </div>

          <div className="header-center">
            <span className="track-name">{trackName}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>|</span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{pointCount} points</span>
          </div>

          <div className="header-actions">
            {!hideUpload && (
              <button className={`btn btn-primary${open ? ' active' : ''}`} onClick={() => { setOpen(v => !v); setError(''); }}>
                <span className="material-icons" style={{ fontSize: 15 }}>upload_file</span>
                Upload CSV
              </button>
            )}
            {/* Toggle to compact mode */}
            <button
              onClick={onToggleCompactMode}
              title="Switch to immersive view"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', padding: '4px',
                display: 'flex', alignItems: 'center',
                borderRadius: 6, transition: 'color 0.15s',
                marginLeft: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <span className="material-icons" style={{ fontSize: 18 }}>fullscreen</span>
            </button>
          </div>
        </header>
      )}

      {/* ── Floating overlay toolbar (v2) ── */}
      {compactMode && (
        <div className="header-overlay">
          <div className="header-overlay-left">
            <span className="track-name">{trackName}</span>
            <span style={{ color: 'rgba(148,163,184,0.6)', fontSize: 11 }}>|</span>
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.7)' }}>{pointCount} points</span>
          </div>
          <div className="header-overlay-right">
            {!hideUpload && (
              <button className={`btn btn-primary${open ? ' active' : ''}`} onClick={() => { setOpen(v => !v); setError(''); }}>
                <span className="material-icons" style={{ fontSize: 14 }}>upload_file</span>
                Upload CSV
              </button>
            )}
            <button
              onClick={onToggleCompactMode}
              title="Switch to standard header"
              className="btn btn-icon"
              style={{
                width: 28, height: 28,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(148,163,184,0.7)',
                borderRadius: 6,
              }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>fullscreen_exit</span>
            </button>
          </div>
        </div>
      )}

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: step === 'mapping' ? 640 : 520,
              background: C.surface,
              borderRadius: 16,
              border: `1px solid ${C.border}`,
              boxShadow: '0 20px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              transition: 'width 0.2s ease',
            }}
          >
            {/* ── Title bar ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '16px 20px 14px',
              borderBottom: `1px solid ${C.border}`,
              background: C.card,
              flexShrink: 0,
            }}>
              {step === 'mapping' && (
                <button
                  onClick={() => { setStep('upload'); setError(''); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: C.textSub, padding: 0, display: 'flex', alignItems: 'center',
                    borderRadius: 6, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = C.text}
                  onMouseLeave={e => e.currentTarget.style.color = C.textSub}
                >
                  <span className="material-icons" style={{ fontSize: 18 }}>arrow_back</span>
                </button>
              )}
              <span className="material-icons" style={{ fontSize: 18, color: C.accent }}>
                {step === 'mapping' ? 'table_chart' : 'upload_file'}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text, flex: 1, letterSpacing: '-0.2px' }}>
                {step === 'mapping' ? 'Map CSV Columns' : 'Import Track Survey CSV'}
              </span>
              {step === 'mapping' && csvRaw && (
                <span style={{
                  fontSize: 11, color: C.textSub, maxWidth: 180,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 5, padding: '2px 8px',
                }}>
                  {csvRaw.filename}
                </span>
              )}
              <button
                onClick={close}
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 7, cursor: 'pointer', color: C.textSub,
                  padding: '4px 6px', lineHeight: 1, display: 'flex', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.color = C.text; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.textSub; }}
              >
                <span className="material-icons" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>

            {/* ── STEP 1: Upload ── */}
            {step === 'upload' && (
              <div style={{ padding: '20px 24px 24px', overflowY: 'auto' }}>

                {/* Required columns */}
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Required columns</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {['Point Number','Left Easting','Left Northing','Left Height',
                      'Right Easting','Right Northing','Right Height'].map(c => (
                      <span key={c} style={{
                        padding: '4px 10px', background: C.accentSoft,
                        border: `1px solid ${C.accentBorder}`, borderRadius: 6,
                        fontSize: 11, color: C.accent, fontFamily: 'monospace', whiteSpace: 'nowrap',
                      }}>
                        {c}
                      </span>
                    ))}
                  </div>

                  <div style={{ ...sectionLabel, marginTop: 14 }}>Optional columns</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {['Type (straight / arc)', 'Radius (m)'].map(c => (
                      <span key={c} style={{
                        padding: '4px 10px', background: C.card,
                        border: `1px solid ${C.border}`, borderRadius: 6,
                        fontSize: 11, color: C.textSub, fontFamily: 'monospace', whiteSpace: 'nowrap',
                      }}>
                        {c}
                      </span>
                    ))}
                  </div>

                  <div style={{
                    marginTop: 14, padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)',
                    fontSize: 12, color: '#15803d', lineHeight: 1.8,
                  }}>
                    Centre line · Gauge · Cant · Chainage · Gauge deviation · Status
                    <span style={{ color: '#888888' }}> — computed automatically</span>
                  </div>
                </div>

                {/* Template download */}
                <button
                  onClick={handleDownloadTemplate}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 14px', marginBottom: 16,
                    background: '#f5f5f5', border: `1px solid ${C.border}`,
                    borderRadius: 9, cursor: 'pointer', color: '#111111',
                    fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#ebebeb'; e.currentTarget.style.borderColor = C.accentBorder; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.borderColor = C.border; }}
                >
                  <span className="material-icons" style={{ fontSize: 17, color: C.accent }}>download</span>
                  Download CSV Template
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim, fontWeight: 400 }}>
                    rail_survey_template.csv
                  </span>
                </button>

                {/* Drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragging ? C.accent : '#d1d5db'}`,
                    borderRadius: 12, padding: '36px 24px', textAlign: 'center',
                    cursor: 'pointer',
                    background: dragging ? C.accentSoft : '#fafafa',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span className="material-icons" style={{
                    fontSize: 42, color: dragging ? C.accent : '#aaaaaa',
                    display: 'block', marginBottom: 12, transition: 'color 0.15s',
                  }}>
                    {dragging ? 'file_download' : 'upload_file'}
                  </span>
                  <div style={{ fontSize: 14, color: dragging ? C.accent : '#555555', fontWeight: 500 }}>
                    {dragging ? 'Drop to import' : 'Click or drag & drop a CSV file'}
                  </div>
                  <div style={{ fontSize: 11, color: '#999999', marginTop: 6 }}>
                    .csv &nbsp;·&nbsp; Excel: File → Save As → CSV
                  </div>
                </div>

                {error && <ErrorBox msg={error} />}
              </div>
            )}

            {/* ── STEP 2: Column Mapping ── */}
            {step === 'mapping' && csvRaw && (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ padding: '18px 24px 0' }}>

                  {/* File info bar */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 14px', borderRadius: 8, marginBottom: 18,
                    background: C.card, border: `1px solid ${C.border}`,
                    fontSize: 12,
                  }}>
                    <span className="material-icons" style={{ fontSize: 15, color: C.accent }}>description</span>
                    <span style={{ fontWeight: 600, color: C.text }}>{csvRaw.filename}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                      <span style={{
                        background: C.accentSoft, border: `1px solid ${C.accentBorder}`,
                        borderRadius: 5, padding: '2px 8px', fontSize: 11, color: C.accent, fontWeight: 600,
                      }}>
                        {csvRaw.totalRows} rows
                      </span>
                      <span style={{
                        background: C.surface, border: `1px solid ${C.borderFaint}`,
                        borderRadius: 5, padding: '2px 8px', fontSize: 11, color: C.textSub,
                      }}>
                        {csvRaw.headers.length} columns
                      </span>
                    </div>
                  </div>

                  {/* Preview table */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={sectionLabel}>Data preview</div>
                    <div style={{
                      overflowX: 'auto', borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: '#ffffff',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
                        <thead>
                          <tr style={{ background: '#f5f5f5' }}>
                            {csvRaw.headers.map((h, i) => (
                              <th key={i} style={{
                                padding: '7px 12px', color: C.accent, fontWeight: 700,
                                textAlign: 'left', borderBottom: `1px solid ${C.border}`,
                                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px',
                              }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRaw.preview.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? '#fafafa' : '#ffffff' }}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{
                                  padding: '6px 12px', color: '#444444',
                                  borderBottom: `1px solid ${C.borderFaint}`,
                                  fontFamily: 'monospace', fontSize: 11,
                                }}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Required mapping */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={sectionLabel}>Required column mapping</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                      {REQUIRED_FIELDS.map(f => {
                        const mapped = mapping[f.key] >= 0;
                        return (
                          <div key={f.key}>
                            <div style={{
                              fontSize: 11, fontWeight: 600, marginBottom: 5,
                              color: mapped ? C.text : C.red,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              {!mapped && (
                                <span className="material-icons" style={{ fontSize: 12, color: C.red }}>error_outline</span>
                              )}
                              {mapped && (
                                <span className="material-icons" style={{ fontSize: 12, color: C.green }}>check_circle_outline</span>
                              )}
                              {f.label}
                            </div>
                            <select
                              value={mapping[f.key] >= 0 ? mapping[f.key] : ''}
                              onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? -1 : Number(e.target.value) }))}
                              style={{
                                ...selectStyle,
                                borderColor: mapped ? C.border : C.redBorder,
                              }}
                            >
                              <option value="">— Not mapped —</option>
                              {csvRaw.headers.map((h, i) => (
                                <option key={i} value={i}>{h}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Optional mapping */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={sectionLabel}>Optional column mapping</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                      {OPTIONAL_FIELDS.map(f => (
                        <div key={f.key}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSub, marginBottom: 5 }}>
                            {f.label}
                          </div>
                          <select
                            value={mapping[f.key] >= 0 ? mapping[f.key] : ''}
                            onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? -1 : Number(e.target.value) }))}
                            style={selectStyle}
                          >
                            <option value="">— Skip —</option>
                            {csvRaw.headers.map((h, i) => (
                              <option key={i} value={i}>{h}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {error && <ErrorBox msg={error} />}
                </div>

                {/* Footer */}
                <div style={{
                  flexShrink: 0,
                  borderTop: `1px solid ${C.border}`,
                  background: '#f5f5f5',
                  marginTop: 18,
                }}>
                  {/* Gauge type selector */}
                  <div style={{ padding: '12px 24px 0' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 9,
                      background: '#ffffff', border: `1px solid ${C.border}`,
                    }}>
                      <span className="material-icons" style={{ fontSize: 16, color: C.accent, flexShrink: 0 }}>train</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 5 }}>
                          Rail Gauge Type
                        </div>
                        <select
                          value={selectedGaugeId}
                          onChange={(e) => setSelectedGaugeId(e.target.value)}
                          style={{ ...selectStyle, fontSize: 11 }}
                        >
                          {GAUGE_TYPES.map(g => (
                            <option key={g.id} value={g.id}>
                              {g.name} — {(g.gauge * 1000).toFixed(0)} mm
                            </option>
                          ))}
                        </select>
                        <div style={{ fontSize: 9, color: C.textDim, marginTop: 3 }}>
                          {GAUGE_TYPES.find(g => g.id === selectedGaugeId)?.desc}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px 16px' }}>
                  {!allRequiredMapped && (
                    <span style={{ fontSize: 11, color: C.red, flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className="material-icons" style={{ fontSize: 13 }}>info_outline</span>
                      Map all required fields to continue
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setStep('upload'); setError(''); }}
                      style={{
                        padding: '8px 18px', fontSize: 12, borderRadius: 8,
                        border: `1px solid ${C.border}`, background: '#e5e7eb',
                        color: '#111111', cursor: 'pointer', fontWeight: 500,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#d1d5db'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#e5e7eb'; }}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={!allRequiredMapped}
                      style={{
                        padding: '8px 22px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                        border: 'none',
                        background: allRequiredMapped ? C.accentSolid : '#d1d5db',
                        color: '#000000',
                        cursor: allRequiredMapped ? 'pointer' : 'not-allowed',
                        transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', gap: 6,
                        boxShadow: allRequiredMapped ? '0 2px 8px rgba(244,129,32,0.3)' : 'none',
                      }}
                      onMouseEnter={e => { if (allRequiredMapped) e.currentTarget.style.background = '#d97010'; }}
                      onMouseLeave={e => { if (allRequiredMapped) e.currentTarget.style.background = C.accentSolid; }}
                    >
                      <span className="material-icons" style={{ fontSize: 14 }}>check_circle</span>
                      Import {csvRaw.totalRows} rows
                    </button>
                  </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
    </>
  );
});

export default Header;

function ErrorBox({ msg }) {
  return (
    <div style={{
      marginTop: 12, fontSize: 12, color: '#b91c1c',
      background: 'rgba(220,38,38,0.06)',
      border: '1px solid rgba(220,38,38,0.22)',
      borderRadius: 8, padding: '9px 12px',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span className="material-icons" style={{ fontSize: 14 }}>error_outline</span>
      {msg}
    </div>
  );
}
