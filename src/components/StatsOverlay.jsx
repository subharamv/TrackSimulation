import { useState, useRef, useCallback, useEffect } from 'react';
import { computeStats } from '../utils/geometry';

export default function StatsOverlay({ trackData = [], designGauge, gaugeType, activePoint, activeView }) {
  const [collapsed, setCollapsed] = useState(true);
  const [position, setPosition] = useState({ top: 68, left: 66 });
  const stats = trackData.length >= 2 ? computeStats(trackData, designGauge) : null;
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);
  const posRef = useRef({ top: 68, left: 66 });

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = true;
    dragMovedRef.current = false;
  }, []);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    const t = e.touches[0];
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    dragOffsetRef.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    dragStartRef.current = { x: t.clientX, y: t.clientY };
    draggingRef.current = true;
    dragMovedRef.current = false;
  }, []);

  useEffect(() => {
    const updatePos = (cx, cy) => {
      const newPos = { top: cy - dragOffsetRef.current.y, left: cx - dragOffsetRef.current.x };
      posRef.current = newPos;
      setPosition(newPos);
      if (Math.abs(cx - dragStartRef.current.x) > 6 || Math.abs(cy - dragStartRef.current.y) > 6) {
        dragMovedRef.current = true;
      }
    };
    const onMove = (e) => { if (draggingRef.current) updatePos(e.clientX, e.clientY); };
    const onUp = () => { draggingRef.current = false; };
    const onTouchMove = (e) => { if (draggingRef.current) { e.preventDefault(); const t = e.touches[0]; updatePos(t.clientX, t.clientY); } };
    const onTouchEnd = () => { draggingRef.current = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  if (activeView === 'analytics' || activeView === 'compare') return null;

  if (!stats) {
    return (
      <div className="stats-overlay stats-overlay--empty" style={{ top: position.top, left: position.left }}>
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
    <div className="stats-overlay" style={{ top: position.top, left: position.left }}>

      {/* ── Track Statistics header ────────────────────────────────────── */}
      <div className="so-header" onClick={() => { if (!dragMovedRef.current) setCollapsed(v => !v); }} onMouseDown={handleMouseDown} onTouchStart={handleTouchStart}>
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
