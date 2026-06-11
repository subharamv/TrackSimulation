/**
 * UploadModal — drag & drop CSV import (legacy V1 path, shown from Header).
 * Uses dark theme to match the rest of the application.
 */
import { useRef, useCallback, useState } from 'react';
import { parseCSV, generateTemplate } from '../utils/csvParser';

// Dark palette matching the app modals
const C = {
  bg: 'rgba(22,23,24,0.98)',
  card: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  text: '#f1f5f9',
  textSub: 'rgba(203,213,225,0.8)',
  textDim: 'rgba(148,163,184,0.6)',
  accent: '#f48120',
  accentSoft: 'rgba(244,129,32,0.1)',
  accentBorder: 'rgba(244,129,32,0.35)',
  green: '#10b981',
  greenSoft: 'rgba(16,185,129,0.1)',
  greenBorder: 'rgba(16,185,129,0.3)',
};

export default function UploadModal({ visible, onClose, onDataLoaded }) {
  const fileInputRef = useRef(null);

  const loadFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = parseCSV(evt.target.result);
        onDataLoaded(data);
        onClose();
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsText(file);
  }, [onDataLoaded, onClose]);

  const handleFileChange  = useCallback((e) => { loadFile(e.target.files[0]); e.target.value = ''; }, [loadFile]);
  const [zoneHover, setZoneHover] = useState(false);
  const handleZoneClick   = useCallback(() => fileInputRef.current?.click(), []);
  const handleDragOver    = useCallback((e) => { e.preventDefault(); setZoneHover(true); }, []);
  const handleDragLeave   = useCallback((e) => { setZoneHover(false); }, []);
  const handleDrop        = useCallback((e) => {
    e.preventDefault(); setZoneHover(false);
    loadFile(e.dataTransfer.files[0]);
  }, [loadFile]);

  const handleDownloadTemplate = useCallback(() => {
    const csv  = generateTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'rail_survey_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!visible) return null;

  const colStyle = { padding: '3px 7px', background: C.accentSoft, borderRadius: 4, fontSize: 10, color: C.accent, fontFamily: 'monospace', border: `1px solid ${C.accentBorder}` };
  const optStyle = { ...colStyle, background: C.card, color: C.textSub, border: `1px solid ${C.border}` };

  return (
    <div
      className="upload-overlay active"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="upload-modal" style={{
        maxWidth: 540, background: C.bg, border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 18, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{ padding: '28px 28px 0' }}>
          <h2 style={{ color: C.text, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
            Import Track Survey Data
          </h2>

          {/* Format spec */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.textSub, marginBottom: 8, lineHeight: 1.6 }}>
              Upload a <b style={{ color: C.text }}>CSV file</b> containing Left and Right rail survey coordinates.
              Centre line is <b style={{ color: C.green }}>calculated automatically</b>.
              Gauge is set from the side panel — do not include it in the file.
            </div>

            {/* Required columns */}
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>
              Required columns (flexible column name matching):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {['Point Number', 'Left Easting', 'Left Northing', 'Left Height',
                'Right Easting', 'Right Northing', 'Right Height'].map(c => (
                <span key={c} style={colStyle}>{c}</span>
              ))}
            </div>

            {/* Optional columns */}
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>
              Optional columns:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
              {['Type (straight/arc)', 'Radius (m)'].map(c => (
                <span key={c} style={optStyle}>{c}</span>
              ))}
            </div>

            {/* Computed by app */}
            <div style={{
              fontSize: 10, padding: '7px 10px', borderRadius: 5,
              background: C.greenSoft, border: `1px solid ${C.greenBorder}`,
              color: '#6ee7b7', lineHeight: 1.6,
            }}>
              ✓ Centre line E/N/H &nbsp;·&nbsp; ✓ Gauge &nbsp;·&nbsp; ✓ Cant &nbsp;·&nbsp; ✓ Chainage &nbsp;·&nbsp; ✓ Gauge deviation &nbsp;·&nbsp; ✓ Status
              <br />
              <span style={{ color: C.textDim }}>— all computed from your Left/Right coordinates + selected gauge type</span>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onClick={handleZoneClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${zoneHover ? C.accent : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 12, padding: '36px', textAlign: 'center',
              cursor: 'pointer', background: zoneHover ? C.accentSoft : 'rgba(255,255,255,0.02)',
              transition: 'all 0.15s',
            }}
          >
            <div className="icon" style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
            <div className="text" style={{ fontSize: 14, color: C.textSub, fontWeight: 500 }}>
              Click or drag &amp; drop CSV file here
            </div>
            <div className="sub" style={{ fontSize: 10, color: C.textDim, marginTop: 6, lineHeight: 1.5 }}>
              Supports .csv files · Excel users: <i>File → Save As → CSV</i>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: '16px 28px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            className="btn"
            style={{
              padding: '7px 16px', fontSize: 11.5, borderRadius: 8, fontFamily: 'inherit',
              border: `1px solid ${C.accentBorder}`, background: 'rgba(244,129,32,0.06)',
              color: C.accent, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
            onClick={handleDownloadTemplate}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,129,32,0.12)'; e.currentTarget.style.borderColor = C.accentBorder; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,129,32,0.06)'; e.currentTarget.style.borderColor = C.accentBorder; }}
            title="Download a blank CSV template with the correct column headers"
          >
            <span className="material-icons" style={{ fontSize: 13 }}>download</span>
            Template CSV
          </button>
          <button
            className="btn"
            onClick={onClose}
            style={{
              padding: '7px 16px', fontSize: 11.5, borderRadius: 8, fontFamily: 'inherit',
              border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.06)',
              color: C.textSub, cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          >
            Cancel
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  );
}
