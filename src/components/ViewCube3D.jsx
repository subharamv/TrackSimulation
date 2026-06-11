import { useMemo, useState } from 'react';

const SZ   = 56;
const H    = SZ / 2;
const STEP = Math.PI / 12;

// ── Face definitions ──────────────────────────────────────────────────────────
const FACES = [
  { id: 'top',    label: 'T',   t: `rotateX(-90deg) translateZ(${H}px)`,  az: -0.55,         elev:  1.52, bg: 'linear-gradient(135deg, #6366f1, #818cf8)' },
  { id: 'bottom', label: 'B',   t: `rotateX(90deg)  translateZ(${H}px)`,  az: -0.55,         elev: -1.52, bg: 'linear-gradient(135deg, #475569, #64748b)' },
  { id: 'front',  label: 'F',   t: `translateZ(${H}px)`,                  az:  0,            elev:  0.1,  bg: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  { id: 'back',   label: 'BK',  t: `rotateY(180deg) translateZ(${H}px)`,  az:  Math.PI,      elev:  0.1,  bg: 'linear-gradient(135deg, #2563eb, #3b82f6)' },
  { id: 'right',  label: 'R',   t: `rotateY(90deg)  translateZ(${H}px)`,  az:  Math.PI / 2,  elev:  0.1,  bg: 'linear-gradient(135deg, #0ea5e9, #38bdf8)' },
  { id: 'left',   label: 'L',   t: `rotateY(-90deg) translateZ(${H}px)`,  az: -Math.PI / 2,  elev:  0.1,  bg: 'linear-gradient(135deg, #2563eb, #3b82f6)' },
];

const CORNERS = [
  { az: -2.35, elev: -0.85 }, { az: -0.85, elev: -0.85 },
  { az: -2.35, elev:  0.95 }, { az: -0.85, elev:  0.95 },
  { az:  2.35, elev: -0.85 }, { az:  0.85, elev: -0.85 },
  { az:  2.35, elev:  0.95 }, { az:  0.85, elev:  0.95 },
];

const EDGES = [
  { v1: 1, v2: 3, az: -0.4, elev:  0.85 },
  { v1: 5, v2: 7, az:  0.4, elev:  0.85 },
  { v1: 1, v2: 5, az:  0.4, elev:  0.0  },
  { v1: 3, v2: 7, az:  0.4, elev:  0.0  },
];

// ── Orbit arrow ───────────────────────────────────────────────────────────────
function OrbitArrow({ dir, onClick }) {
  const [hov, setHov] = useState(false);
  const d =
    dir === 'up'    ? 'M6,22 L16,6  L26,22Z' :
    dir === 'down'  ? 'M6,10 L16,26 L26,10Z' :
    dir === 'left'  ? 'M22,6 L6,16  L22,26Z' :
                      'M10,6 L26,16 L10,26Z';
  return (
    <svg width={30} height={30} style={{ display: 'block', cursor: 'pointer', flexShrink: 0 }}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}>
      {hov && <circle cx={15} cy={15} r={13} fill="rgba(99,102,241,0.15)" />}
      <path d={d}
        fill={hov ? '#818cf8' : 'rgba(210,225,245,0.7)'}
        stroke={hov ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.12)'}
        strokeWidth="1"
        style={{ transition: 'fill 0.15s, stroke 0.15s' }} />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ViewCube3D({ az, elev, onSnap }) {
  const azDeg    = az   * 180 / Math.PI;
  const elevDeg  = elev * 180 / Math.PI;
  const cubeXfrm = `rotateX(${-elevDeg}deg) rotateY(${-azDeg}deg)`;

  // Project cube vertices for corner/edge click zones
  const proj = useMemo(() => {
    const verts = [];
    for (let x = -1; x <= 1; x += 2)
      for (let y = -1; y <= 1; y += 2)
        for (let z = -1; z <= 1; z += 2)
          verts.push({ x: x * H, y: y * H, z: z * H });

    const a = -azDeg * Math.PI / 180;
    const e = -elevDeg * Math.PI / 180;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const cosE = Math.cos(e), sinE = Math.sin(e);
    const persp = SZ * 3.5, ctr = SZ / 2;

    return verts.map(v => {
      const xRy = v.x * cosA + v.z * sinA;
      const zRy = -v.x * sinA + v.z * cosA;
      const yR  = v.y * cosE - zRy * sinE;
      const zR  = v.y * sinE + zRy * cosE;
      const w   = persp / (persp + zR);
      return { sx: ctr + xRy * w, sy: ctr + yR * w };
    });
  }, [azDeg, elevDeg]);

  const PAD   = 24;
  const boxSz = SZ + PAD * 2;

  return (
    <div
      style={{
        position: 'absolute', bottom: 12, right: 8, zIndex: 10,
        userSelect: 'none', pointerEvents: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* ── Cube + directional orbit arrows ── */}
      <div style={{ position: 'relative', width: boxSz, height: boxSz }}>

        {/* UP arrow */}
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
          <OrbitArrow dir="up" onClick={() => onSnap(az, Math.min(1.5, elev + STEP))} />
        </div>
        {/* DOWN arrow */}
        <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
          <OrbitArrow dir="down" onClick={() => onSnap(az, Math.max(-1.5, elev - STEP))} />
        </div>
        {/* LEFT arrow */}
        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
          <OrbitArrow dir="left" onClick={() => onSnap(az - STEP, elev)} />
        </div>
        {/* RIGHT arrow */}
        <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
          <OrbitArrow dir="right" onClick={() => onSnap(az + STEP, elev)} />
        </div>

        {/* 3D cube */}
        <div style={{
          position: 'absolute', top: PAD, left: PAD,
          width: SZ, height: SZ,
          perspective: `${SZ * 3.5}px`,
          perspectiveOrigin: '50% 50%',
        }}>
          <div style={{
            width: SZ, height: SZ,
            position: 'relative',
            transformStyle: 'preserve-3d',
            transform: cubeXfrm,
          }}>
            {FACES.map(f => (
              <div
                key={f.id}
                onClick={() => onSnap(f.az, f.elev)}
                title={`View: ${f.label}`}
                style={{
                  position: 'absolute', inset: 0,
                  width: SZ, height: SZ,
                  background: f.bg,
                  border: '1px solid rgba(255,255,255,0.15)',
                  boxShadow: 'inset 0 0 20px rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  transform: f.t,
                  fontSize: 8,
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '0.05em',
                  fontFamily: "'Segoe UI', sans-serif",
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  transition: 'filter 0.15s',
                  filter: 'brightness(1)',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)'; }}
              >
                {f.label}
              </div>
            ))}
          </div>

          {/* Corner + edge click zones (SVG overlay) */}
          <svg width={SZ} height={SZ}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            {proj.map((p, i) => (
              <g key={`c${i}`}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onClick={e => { e.stopPropagation(); if (CORNERS[i]) onSnap(CORNERS[i].az, CORNERS[i].elev); }}>
                <circle cx={p.sx} cy={p.sy} r={6} fill="transparent" style={{ pointerEvents: 'auto' }} />
                <circle cx={p.sx} cy={p.sy} r={2.5} fill="rgba(255,255,255,0.7)" stroke="rgba(99,102,241,0.4)" strokeWidth="0.8" style={{ pointerEvents: 'none' }} />
              </g>
            ))}
            {EDGES.map((ed, i) => {
              const p1 = proj[ed.v1], p2 = proj[ed.v2];
              if (!p1 || !p2) return null;
              const mx = (p1.sx + p2.sx) / 2, my = (p1.sy + p2.sy) / 2;
              return (
                <g key={`e${i}`}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={ev => { ev.stopPropagation(); onSnap(ed.az, ed.elev); }}>
                  <circle cx={mx} cy={my} r={5} fill="transparent" style={{ pointerEvents: 'auto' }} />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
