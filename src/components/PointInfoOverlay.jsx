import { useState } from 'react';

export default function PointInfoOverlay({ activePoint, visible = true }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!visible || !activePoint) return null;

  const cant    = activePoint.cant * 1000;
  const cSign   = cant >= 0 ? '+' : '';
  const cDir    = cant >  0.05 ? 'L high' : cant < -0.05 ? 'R high' : 'level';
  const diffMM  = activePoint.gaugeDiff * 1000;

  const gColor  = activePoint.gaugeStatus === 'fail' ? '#ef4444'
                : activePoint.gaugeStatus === 'warn' ? '#f97316'
                : '#10b981';
  const gBadge  = activePoint.gaugeStatus === 'fail' ? 'FAIL'
                : activePoint.gaugeStatus === 'warn' ? 'WARN'
                : 'OK';
  const cColor  = activePoint.cantStatus  === 'fail' ? '#ef4444'
                : activePoint.cantStatus  === 'warn' ? '#f97316'
                : '#10b981';
  const tColor  = activePoint.type === 'arc' ? '#f59e0b' : '#10b981';

  return (
    <div className="pio-panel">
      {/* Header */}
      <div className="pio-header" onClick={() => setCollapsed(v => !v)}>
        <span className="material-icons" style={{ fontSize: 13, color: tColor }}>radio_button_checked</span>
        <span className="pio-title">Point #{activePoint.pointNumber}</span>
        <span style={{
          marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
          background: activePoint.type === 'arc' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
          color: tColor,
          border: `1px solid ${activePoint.type === 'arc' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'}`,
          textTransform: 'uppercase', letterSpacing: '0.4px',
        }}>
          {activePoint.type}{activePoint.radius > 0 && activePoint.radius < 99999
            ? ` R${activePoint.radius.toFixed(0)}m` : ''}
        </span>
        <span className="material-icons" style={{ fontSize: 13, color: 'rgba(148,163,184,0.4)', marginLeft: 'auto' }}>
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </div>

      {!collapsed && (
        <div className="pio-body">
          {/* Chainage */}
          <div className="pio-row">
            <span className="pio-lbl">Chainage</span>
            <span className="pio-val">{activePoint.chainage.toFixed(3)} <span className="pio-unit">m</span></span>
          </div>

          {/* Gauge */}
          <div className="pio-row">
            <span className="pio-lbl">Gauge</span>
            <span className="pio-val" style={{ color: '#f59e0b' }}>{activePoint.gauge.toFixed(4)} <span className="pio-unit">m</span></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                background: `${gColor}18`, color: gColor, border: `1px solid ${gColor}40`,
              }}>{gBadge}</span>
              <span style={{ fontSize: 9, color: diffMM >= 0 ? '#fb923c' : '#60a5fa' }}>
                Δ{diffMM >= 0 ? '+' : ''}{diffMM.toFixed(2)} mm
              </span>
            </span>
          </div>

          {/* Cant */}
          <div className="pio-row">
            <span className="pio-lbl">Cant</span>
            <span className="pio-val" style={{ color: '#a78bfa' }}>
              {cSign}{cant.toFixed(2)} <span className="pio-unit">mm</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={{ fontSize: 9, color: 'rgba(148,163,184,0.5)' }}>{cDir}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                background: `${cColor}18`, color: cColor, border: `1px solid ${cColor}40`,
              }}>{activePoint.cantStatus?.toUpperCase()}</span>
            </span>
          </div>

          <div className="pio-divider" />

          {/* Coordinates table */}
          <div className="pio-coords-header">
            <span />
            <span>Easting</span>
            <span>Northing</span>
            <span>Height</span>
          </div>
          {[
            { tag: 'L', color: '#3b82f6', e: activePoint.leftEasting,  n: activePoint.leftNorthing,  h: activePoint.leftHeight },
            { tag: 'C', color: '#10b981', e: activePoint.easting,       n: activePoint.northing,      h: activePoint.height },
            { tag: 'R', color: '#ef4444', e: activePoint.rightEasting,  n: activePoint.rightNorthing, h: activePoint.rightHeight },
          ].map(r => (
            <div key={r.tag} className="pio-coords-row">
              <span style={{ color: r.color, fontWeight: 700 }}>{r.tag}</span>
              <span>{r.e.toFixed(3)}</span>
              <span>{r.n.toFixed(3)}</span>
              <span>{r.h.toFixed(3)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
