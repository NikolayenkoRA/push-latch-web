// Groove path synthesis + kinematic check for push-push (push-to-open) latches.
// Path space: x = lateral (planar heart) or circumferential arc length (rotary cam), s = push depth
// (0 = released / extended, `stroke` = latched, `sMax` = end of push). All in mm.
//
// Design rule that makes the cycle deterministic without depth steps or a biased follower:
// every time the push direction reverses, the branch the pin must take starts with an AXIAL run
// (dx = 0), while the wrong branch is inclined by the ramp angle. A follower that is free laterally
// (swinging lever / freely rotating rod) moves straight and so always enters the correct branch.
// Turns happen only where the pin hits an inclined wall (ramp angle alpha from the push axis).

const rad = (d) => (d * Math.PI) / 180;

export function heartPath(p) {
  const gw = p.pin_d + 2 * p.clr;            // groove width
  const k = gw + p.rib;                       // lateral pitch between neighbouring channels
  const a = rad(p.alpha), di = k / Math.tan(a);
  const errors = [], notes = [];
  const over = Math.max(p.over, di + p.run);
  if (over > p.over + 1e-6) notes.push(['over_raised', over]);
  const st = p.stroke, sMax = st + over;
  // return branch must pass under the island below the latch notch C (x = -2k)
  const sa = st - 2 * di - gw / 2 - (gw / 2 + p.rib) / Math.sin(a);
  const strokeMin = st - sa;
  if (sa < 0) errors.push(['stroke_min', strokeMin]);
  const X = 1.5 * k; // centre the heart on the lever axis
  const P = {
    A: [0, 0], A1: [0, Math.max(sa, 0)], A2: [0, sMax - di], B: [-k, sMax], B1: [-k, st + di],
    C: [-2 * k, st], C1: [-2 * k, sMax - di], D: [-3 * k, sMax], D1: [-3 * k, Math.max(sa, 0) + 3 * di],
  };
  for (const key in P) P[key] = [P[key][0] + X, P[key][1]];
  const segs = [[P.A, P.A2], [P.A2, P.B], [P.B, P.B1], [P.B1, P.C], [P.C, P.C1], [P.C1, P.D], [P.D, P.D1], [P.D1, P.A1]];
  return { segs, points: P, k, di, gw, over, sMax, stroke: st, strokeMin, halfWidth: X, errors, notes, periodic: 0 };
}

export function rotaryPath(p) {
  const gw = p.pin_d + 2 * p.clr;
  const R = p.rod_d / 2, Rb = R - p.gd;
  const errors = [], notes = [];
  const kMin = gw + p.rib;
  let N = Math.floor((2 * Math.PI * Rb) / (4 * kMin));
  if (p.periods > 0) N = Math.min(N, p.periods);
  if (N < 1) { errors.push(['rod_thin', (4 * kMin) / Math.PI + 2 * p.gd]); N = 1; }
  const per = (2 * Math.PI * R) / N, a = rad(p.alpha), aRet = rad(Math.max(p.alpha, 60));
  // smallest lateral pitch k (shortest overtravel) for which the long return ramp still fits in height
  let k = kMin, di, over, sMax, hRet;
  for (; ; k += 0.05) {
    if (k >= per / 4) k = per / 4;
    di = k / Math.tan(a); over = Math.max(p.over, di + p.run); sMax = p.stroke + over;
    const room = sMax - p.run;
    if ((per - 3 * k) / Math.tan(aRet) <= room + 1e-9 || k >= per / 4) { hRet = Math.min(room, (per - 3 * k) / Math.tan(a)); break; }
  }
  const retAngle = Math.atan((per - 3 * k) / hRet) * 180 / Math.PI;
  if (over > p.over + 1e-6) notes.push(['over_raised', over]);
  const st = p.stroke;
  if (st < gw * 0.5 + 0.5) errors.push(['stroke_small', gw * 0.5 + 0.5]);
  const segs = [];
  for (let i = 0; i < N; i++) {
    const o = i * per, q = (x, s) => [o + x, s];
    const A = q(0, 0), A2 = q(0, sMax - di), B = q(k, sMax), B1 = q(k, st + di), C = q(2 * k, st),
      C1 = q(2 * k, sMax - di), D = q(3 * k, sMax), D1 = q(3 * k, hRet), A3 = q(per, 0);
    segs.push([A, A2], [A2, B], [B, B1], [B1, C], [C, C1], [C1, D], [D, D1], [D1, A3]);
  }
  return { segs, k, di, gw, over, sMax, stroke: st, N, retAngle, period: per, circ: 2 * Math.PI * R, errors, notes, periodic: 2 * Math.PI * R };
}

function segDist2(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

// Quasi-static simulation of the pin (laterally free follower) while the slider/rod is pushed and released.
// The pin centre may deviate from the groove centreline by `tol` (= running clearance). Moving s by ds,
// the pin takes the nearest lateral position that is still inside the groove; if the required lateral
// jump is steeper than maxAngle the motion is blocked (a stop).
export function simulate(path, { tol = 0.2, ds = 0.02, maxAngle = 72 } = {}) {
  tol = Math.max(0.05, Math.min(tol, 0.3));
  const P = path.periodic;
  const segs = P ? [-1, 0, 1].flatMap((m) => path.segs.map(([a, b]) => [[a[0] + m * P, a[1]], [b[0] + m * P, b[1]]])) : path.segs;
  const t2 = tol * tol;
  const inside = (x, s) => { for (const g of segs) if (segDist2(x, s, g) <= t2) return true; return false; };
  const w = ds * Math.tan(rad(maxAngle)), n = 60;
  let x = path.segs[0][0][0], s = path.segs[0][0][1];
  const trace = [[x, s]];
  const run = (dir) => {
    for (let i = 0; i < 20000; i++) {
      const s2 = s + dir * ds; let best = null;
      for (let j = 0; j <= n; j++) {
        const off = (j % 2 ? 1 : -1) * Math.ceil(j / 2) * (w / (n / 2));
        if (inside(x + off, s2)) { best = x + off; break; }
      }
      if (best === null) return;
      x = best; s = s2; trace.push([x, s]);
    }
  };
  const phases = [];
  for (const dir of [1, -1, 1, -1]) { run(dir); phases.push({ x, s, idx: trace.length - 1 }); }
  const e = 3 * tol + ds;
  const st = path.stroke, sm = path.sMax;
  const x0 = path.segs[0][0][0];
  const ok = [
    Math.abs(phases[0].s - sm) < e, Math.abs(phases[1].s - st) < e,
    Math.abs(phases[2].s - sm) < e, Math.abs(phases[3].s) < e,
  ];
  // planar: back to the stem; rotary: advanced by one period
  const xEnd = P ? x0 + path.period : x0;
  ok.push(Math.abs(phases[3].x - xEnd) < 0.5);
  return { ok: ok.every(Boolean), checks: ok, phases, trace };
}
