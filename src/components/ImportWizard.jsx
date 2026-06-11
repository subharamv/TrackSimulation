/**
 * Reusable CSV import wizard (no modal wrapper — embed wherever needed).
 * Handles file selection, drag-drop, column mapping, gauge type, and import.
 */
import { useState, useRef, useCallback } from 'react';
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

// Dark palette matching the ProjectsModal theme
const C = {
  bg: 'rgba(22,23,24,0.98)', surface: 'rgba(255,255,255,0.04)', card: 'rgba(255,255,255,0.05)', cardHover: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.1)', borderFaint: 'rgba(255,255,255,0.06)',
  text: '#f1f5f9', textSub: 'rgba(203,213,225,0.8)', textDim: 'rgba(148,163,184,0.6)',
  accent: '#f48120', accentSoft: 'rgba(244,129,32,0.1)', accentBorder: 'rgba(244,129,32,0.35)',
  accentSolid: '#f48120', accentHover: 'rgba(244,129,32,0.15)',
  green: '#10b981', greenSoft: 'rgba(16,185,129,0.1)', greenBorder: 'rgba(16,185,129,0.3)',
  red: '#ef4444', redSoft: 'rgba(239,68,68,0.08)', redBorder: 'rgba(239,68,68,0.3)',
};

const sectionLabel = {
  fontSize: 10, fontWeight: 700, color: 'rgba(148,163,184,0.6)',
  textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8,
};
const selectStyle = {
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, borderRadius: 7,
  color: '#e2e8f0', fontSize: 12, padding: '7px 10px',
  width: '100%', cursor: 'pointer', outline: 'none',
  transition: 'border-color 0.15s', appearance: 'auto',
};

export default function ImportWizard({ onDataLoaded, gaugeTypeId = 'tramway', onGaugeTypeChange, onDone }) {
  const [step, setStep]         = useState('upload');
  const [csvRaw, setCsvRaw]     = useState(null);
  const [mapping, setMapping]   = useState({});
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState('');
  const [selectedGaugeId, setSelectedGaugeId] = useState(gaugeTypeId);
  const fileInputRef = useRef(null);

  const reset = () => {
    setStep('upload'); setCsvRaw(null);
    setMapping({}); setError(''); setDragging(false);
  };

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
      } catch (err) { setError(err.message); }
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
      reset();
      onDone?.();
    } catch (err) { setError(err.message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvRaw, mapping, onDataLoaded, onGaugeTypeChange, selectedGaugeId, onDone]);

  const handleDownloadTemplate = useCallback(() => {
    const csv = generateTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rail_survey_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const allRequiredMapped = REQUIRED_FIELDS.every(f => mapping[f.key] >= 0);

  /* ── Step 1: Upload ─────────────────────────────────────────────────── */
  if (step === 'upload') {
    return (
      <div style={{ padding: '18px 22px 22px' }}>
        {/* Required columns */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Required columns</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['Point Number','Left Easting','Left Northing','Left Height',
              'Right Easting','Right Northing','Right Height'].map(c => (
              <span key={c} style={{
                padding: '3px 9px', background: C.accentSoft,
                border: `1px solid ${C.accentBorder}`, borderRadius: 5,
                fontSize: 10.5, color: C.accent, fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}>{c}</span>
            ))}
          </div>
          <div style={{ ...sectionLabel, marginTop: 12 }}>Optional columns</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {['Type (straight / arc)', 'Radius (m)'].map(c => (
              <span key={c} style={{
                padding: '3px 9px', background: C.card,
                border: `1px solid ${C.border}`, borderRadius: 5,
                fontSize: 10.5, color: C.textSub, fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}>{c}</span>
            ))}
          </div>
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 7,
            background: C.greenSoft, border: `1px solid ${C.greenBorder}`,
            fontSize: 11, color: '#6ee7b7', lineHeight: 1.7,
          }}>
            Centre line · Gauge · Cant · Chainage · Gauge deviation · Status
            <span style={{ color: 'rgba(148,163,184,0.6)' }}> — computed automatically</span>
          </div>
        </div>

        {/* Template download */}
        <button
          onClick={handleDownloadTemplate}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 14,
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: 'pointer', color: C.text,
            fontSize: 12, fontWeight: 500, transition: 'all 0.15s', fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = C.accentBorder; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = C.border; }}
        >
          <span className="material-icons" style={{ fontSize: 16, color: C.accent }}>download</span>
          Download CSV Template
          <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim, fontWeight: 400 }}>rail_survey_template.csv</span>
        </button>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragging ? C.accent : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 11, padding: '32px 20px', textAlign: 'center',
            cursor: 'pointer', background: dragging ? C.accentSoft : 'rgba(255,255,255,0.02)',
            transition: 'all 0.15s',
          }}
        >
          <span className="material-icons" style={{
            fontSize: 38, color: dragging ? C.accent : 'rgba(148,163,184,0.5)',
            display: 'block', marginBottom: 10, transition: 'color 0.15s',
          }}>
            {dragging ? 'file_download' : 'upload_file'}
          </span>
          <div style={{ fontSize: 13, color: dragging ? C.accent : 'rgba(203,213,225,0.6)', fontWeight: 500 }}>
            {dragging ? 'Drop to import' : 'Click or drag & drop a CSV file'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.5)', marginTop: 5 }}>
            .csv &nbsp;·&nbsp; Excel: File → Save As → CSV
          </div>
        </div>

        {error && <ErrBox msg={error} />}
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>
    );
  }

  /* ── Step 2: Column mapping ──────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ overflowY: 'auto', flex: 1, padding: '16px 22px 0' }}>
        {/* Back + file info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => { setStep('upload'); setError(''); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textSub, padding: 0, display: 'flex', alignItems: 'center',
              borderRadius: 6, transition: 'color 0.15s', fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = C.textSub}
          >
            <span className="material-icons" style={{ fontSize: 18 }}>arrow_back</span>
          </button>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 12px', borderRadius: 7,
            background: C.card, border: `1px solid ${C.border}`, fontSize: 11,
          }}>
            <span className="material-icons" style={{ fontSize: 14, color: C.accent }}>description</span>
            <span style={{ fontWeight: 600, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {csvRaw.filename}
            </span>
            <span style={{ background: C.accentSoft, border: `1px solid ${C.accentBorder}`, borderRadius: 4, padding: '1px 7px', fontSize: 10, color: C.accent, fontWeight: 600 }}>
              {csvRaw.totalRows} rows
            </span>
            <span style={{ background: C.surface, border: `1px solid ${C.borderFaint}`, borderRadius: 4, padding: '1px 7px', fontSize: 10, color: C.textSub }}>
              {csvRaw.headers.length} cols
            </span>
          </div>
        </div>

        {/* Preview table */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Data preview</div>
          <div style={{ overflowX: 'auto', borderRadius: 7, border: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.3)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {csvRaw.headers.map((h, i) => (
                    <th key={i} style={{
                      padding: '6px 10px', color: C.accent, fontWeight: 700,
                      textAlign: 'left', borderBottom: `1px solid ${C.border}`,
                      fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.4px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvRaw.preview.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: '5px 10px', color: 'rgba(203,213,225,0.7)',
                        borderBottom: `1px solid ${C.borderFaint}`,
                        fontFamily: 'monospace', fontSize: 10.5,
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Required mapping */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Required column mapping</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
            {REQUIRED_FIELDS.map(f => {
              const mapped = mapping[f.key] >= 0;
              return (
                <div key={f.key}>
                  <div style={{
                    fontSize: 10.5, fontWeight: 600, marginBottom: 4,
                    color: mapped ? C.text : C.red,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span className="material-icons" style={{ fontSize: 11, color: mapped ? C.green : C.red }}>
                      {mapped ? 'check_circle_outline' : 'error_outline'}
                    </span>
                    {f.label}
                  </div>
                  <select
                    value={mapping[f.key] >= 0 ? mapping[f.key] : ''}
                    onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? -1 : Number(e.target.value) }))}
                    style={{ ...selectStyle, borderColor: mapped ? C.border : C.redBorder }}
                  >
                    <option value="">— Not mapped —</option>
                    {csvRaw.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Optional mapping */}
        <div style={{ marginBottom: 6 }}>
          <div style={sectionLabel}>Optional column mapping</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
            {OPTIONAL_FIELDS.map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textSub, marginBottom: 4 }}>{f.label}</div>
                <select
                  value={mapping[f.key] >= 0 ? mapping[f.key] : ''}
                  onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? -1 : Number(e.target.value) }))}
                  style={selectStyle}
                >
                  <option value="">— Skip —</option>
                  {csvRaw.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {error && <ErrBox msg={error} />}
      </div>

      {/* Footer */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.3)', padding: '10px 22px 14px' }}>
        {/* Gauge type */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 12px', borderRadius: 8, marginBottom: 10,
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
        }}>
          <span className="material-icons" style={{ fontSize: 15, color: C.accent }}>train</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(148,163,184,0.6)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
              Rail Gauge Type
            </div>
            <select value={selectedGaugeId} onChange={(e) => setSelectedGaugeId(e.target.value)} style={{ ...selectStyle, fontSize: 11 }}>
              {GAUGE_TYPES.map(g => <option key={g.id} value={g.id}>{g.name} — {(g.gauge * 1000).toFixed(0)} mm</option>)}
            </select>
            <div style={{ fontSize: 8.5, color: C.textDim, marginTop: 2 }}>
              {GAUGE_TYPES.find(g => g.id === selectedGaugeId)?.desc}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!allRequiredMapped && (
            <span style={{ fontSize: 10.5, color: C.red, flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-icons" style={{ fontSize: 12 }}>info_outline</span>
              Map all required fields to continue
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
            <button
              onClick={() => { setStep('upload'); setError(''); }}
              style={{
                padding: '7px 16px', fontSize: 11.5, borderRadius: 7, fontFamily: 'inherit',
                border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.06)',
                color: C.textSub, cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            >Back</button>
            <button
              onClick={handleImport}
              disabled={!allRequiredMapped}
              style={{
                padding: '7px 20px', fontSize: 11.5, fontWeight: 700, borderRadius: 7, fontFamily: 'inherit',
                border: 'none',
                background: allRequiredMapped ? C.accentSolid : 'rgba(255,255,255,0.06)',
                color: allRequiredMapped ? '#000' : C.textSub, cursor: allRequiredMapped ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
                boxShadow: allRequiredMapped ? '0 2px 8px rgba(244,129,32,0.3)' : 'none',
              }}
              onMouseEnter={e => { if (allRequiredMapped) e.currentTarget.style.background = '#d97010'; }}
              onMouseLeave={e => { if (allRequiredMapped) e.currentTarget.style.background = C.accentSolid; }}
            >
              <span className="material-icons" style={{ fontSize: 13 }}>check_circle</span>
              Import {csvRaw.totalRows} rows
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrBox({ msg }) {
  return (
    <div style={{
      marginTop: 10, fontSize: 11.5, color: C.red,
      background: C.redSoft, border: `1px solid ${C.redBorder}`,
      borderRadius: 7, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 7,
    }}>
      <span className="material-icons" style={{ fontSize: 13 }}>error_outline</span>
      {msg}
    </div>
  );
}
