import { useState } from 'react';
import { computeStats } from '../utils/geometry';

export default function StatsOverlay({ trackData = [], designGauge, gaugeType, compactMode, activePoint, activeView, sidebarV2 = true, leftCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(true);
  const stats = trackData.length >= 2 ? computeStats(trackData, designGauge) : null;

  const topOffset = 68;

  // Position adjusts based on sidebar mode:
  // V2 sidebar → left:66px (right of floating icon bar)
  // V1 expanded → left:290px (right of the 280px LeftPanel)
  // V1 collapsed → left:50px (right of collapsed 36px LeftPanel)
  const leftOffset = sidebarV2 ? 66 : (leftCollapsed ? 50 : 290);

  if (activeView === 'analytics' || activeView === 'compare') return null;

  if (!stats) {
    return (
      <div className="stats-overlay stats-overlay--empty" style={{ top: topOffset, left: leftOffset }}>
        <span className="material-icons" style={{ fontSize: 14, color: 'rgba(148,163,184,0.3)' }}>bar_chart</span>
        <span style={{ fontSize: 9, color: 'rgba(148,163,184,0.35)', letterSpacing: '0.5px' }}>NO DATA</span>
      </div>
    );
  }

  const gaugeOk   = stats.okCount;
  const gaugeWarn = stats.warnCount;
  const gaugeFail = stats.failCount;
  const total     = gaugeOk + gaugeWarn + gaugeFail;
  const okPct     = total > 0 ? (gaugeOk   / total * 100) : 0;
  const warnPct   = total > 0 ? (gaugeWarn / total * 100) : 0;
  const failPct   = total > 0 ? (gaugeFail / total * 100) : 0;

  return (
    <div className="stats-overlay" style={{ top: topOffset, left: leftOffset }}>

      {/* ── Track Statistics header ────────────────────────────────────── */}
      <div className="so-header" onClick={() => setCollapsed(v => !v)}>
        <span className="material-icons" style={{ fontSize: 13, color: 'var(--brand)' }}>bar_chart</span>
        <span className="so-title">Track Statistics</span>
        <span className="material-icons" style={{ fontSize: 13, color: 'rgba(148,163,184,0.5)', marginLeft: 'auto' }}>
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </div>

      {!collapsed && (
        <>
          <div className="so-quality-bar">
            {failPct > 0 && <div style={{ width: `${failPct}%`, background: '#ef4444' }} title={`${gaugeFail} FAIL`} />}
            {warnPct > 0 && <div style={{ width: `${warnPct}%`, background: '#f97316' }} title={`${gaugeWarn} WARN`} />}
            {okPct   > 0 && <div style={{ width: `${okPct}%`,   background: '#10b981' }} title={`${gaugeOk} OK`} />}
          </div>

          <div className="so-grid">
            <StatCard label="Length"    value={stats.totalLength.toFixed(1)}      unit="m"   color="#f48120" />
            <StatCard label="Points"    value={trackData.length}                   unit="pts" color="#94a3b8" />
            <StatCard label="Avg Gauge" value={stats.avgGauge.toFixed(4)}         unit="m"   color="#f59e0b" />
            <StatCard label="Elev Δ"   value={stats.elevationDelta.toFixed(2)}   unit="m"   color="#10b981" />
            <StatCard
              label="Cant"
              value={`${(stats.minCant * 1000).toFixed(1)}→${(stats.maxCant * 1000).toFixed(1)}`}
              unit="mm" color="#a78bfa" wide
            />
          </div>

          <div className="so-badges">
            <span className="so-badge so-badge--ok">
              <span className="material-icons" style={{ fontSize: 10 }}>check_circle</span>
              {gaugeOk} OK
            </span>
            {gaugeWarn > 0 && (
              <span className="so-badge so-badge--warn">
                <span className="material-icons" style={{ fontSize: 10 }}>warning</span>
                {gaugeWarn}
              </span>
            )}
            {gaugeFail > 0 && (
              <span className="so-badge so-badge--fail">
                <span className="material-icons" style={{ fontSize: 10 }}>error</span>
                {gaugeFail}
              </span>
            )}
            {gaugeType && <span className="so-gauge-type">{gaugeType.name}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, unit, color, wide = false }) {
  return (
    <div className={`so-stat${wide ? ' so-stat--wide' : ''}`}>
      <div className="so-stat-label">{label}</div>
      <div className="so-stat-value" style={{ color }}>
        {value} <span className="so-stat-unit">{unit}</span>
      </div>
    </div>
  );
}
