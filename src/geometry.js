// Parametric push-push latch geometry (manifold-3d). Units: mm. Two variants:
//  heart  — slider with a heart-shaped cam groove + swinging follower lever + housing with rails (as in the photo)
//  rotary — "ballpoint pen" style: rod with a closed zig-zag groove around it rotates freely in a tube,
//           a fixed radial pin rides in the groove (cabinet push latch style).
import { heartPath, rotaryPath, simulate } from './path.js';

export const DEFAULTS = {
  common: { stroke: 14, over: 3, pin_d: 3, clr: 0.25, hole_comp: 0.15, rib: 1.2, alpha: 55, run: 0.8, gd: 2,
    spring: 'metal', spr_d: 5, spr_len: 30, spr_solid: 6, spr_pre: 2, mount_d: 3.5, protrude: 3 },
  heart: { lever_len: 55, lever_t: 3, lever_w: 7, slider_t: 6, base_t: 3, wall: 2.5, lip: 1.6, screw_d: 3,
    pin_type: 'printed', folds: 8, beam: 1.0 },
  rotary: { stroke: 6, pin_d: 2, alpha: 45, gd: 1.5, rod_d: 14, periods: 0, wall: 2.5, floor: 2.5,
    pin_type: 'metal', spr_d: 6, spr_len: 25, spr_solid: 5 },
};
export const defaultsFor = (variant) => ({ ...DEFAULTS.common, ...DEFAULTS[variant] });

const SEG = 40;

export function build(wasm, variant, p) {
  const { Manifold, CrossSection } = wasm;
  const pool = [];
  const T = (o) => { pool.push(o); return o; };
  const errors = [], warnings = [], notes = [];
  const circle = (r, x = 0, y = 0, n = 28) => T(T(CrossSection.circle(r, n)).translate([x, y]));
  const poly = (pts) => T(new CrossSection([pts], 'NonZero'));
  const box = (x0, y0, z0, x1, y1, z1) => T(T(Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
  const cyl = (r, z0, z1, x = 0, y = 0, n = SEG) => T(T(Manifold.cylinder(z1 - z0, r, r, n)).translate([x, y, z0]));
  const union = (arr) => T(Manifold.union(arr.filter(Boolean)));
  // XZ profile (pts = [x, z]) extruded along Y between y0..y1
  const alongY = (cs, y0, y1) => T(T(T(cs.extrude(y1 - y0)).rotate([90, 0, 0])).translate([0, y1, 0]));
  const teardrop = (r, n = 24) => { // apex at +y of the 2D section, for support-free horizontal holes
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = Math.PI / 4 - (i * 1.5 * Math.PI) / n; pts.push([r * Math.cos(t), r * Math.sin(t)]); }
    pts.push([0, r * Math.SQRT2]); return pts;
  };
  const toMesh = (m0) => {
    const m = T(m0.simplify(1e-4)); const mesh = m.getMesh();
    return { positions: Float32Array.from(mesh.vertProperties.filter((_, i) => i % mesh.numProp < 3)),
      indices: Uint32Array.from(mesh.triVerts), volume: m.volume(), genus: m.genus(), status: m.status(), empty: m.isEmpty() };
  };
  const msg = (arr, list) => list.forEach((e) => arr.push(e));

  try {
    // ---------------------------------------------------------------- spring checks (common)
    const springCheck = (sMax) => {
      if (p.spring !== 'metal') return 0;
      const Li = p.spr_len - p.spr_pre;
      if (Li - sMax < p.spr_solid + 0.3) errors.push(['spring_short', sMax + p.spr_solid + 0.3 + p.spr_pre]);
      return Li;
    };

    if (variant === 'heart') {
      const path = heartPath(p); msg(errors, path.errors); msg(notes, path.notes);
      const sim = simulate(path, { tol: p.clr });
      if (!sim.ok) errors.push(['sim_fail']);
      const L = p.lever_len, gw = path.gw, rg = gw / 2, X = path.halfWidth;
      const leverAng = Math.asin(Math.min(1, (X) / L)) * 180 / Math.PI;
      if (leverAng > 20) warnings.push(['lever_angle', leverAng]);
      const cw = p.lip, lwt = Math.max(p.pin_d + 2.4, p.lever_w * 0.6), lw0 = Math.max(p.lever_w, p.screw_d + 4.8);
      const Ws = Math.ceil((Math.max(2 * (X + rg + 2.5), 2 * (X + lwt / 2 + 1.2)) + 2 * cw) * 10) / 10;
      const Rb = p.spr_d / 2 + p.clr;
      let Ts = Math.max(p.slider_t, p.gd + 1.6);
      if (p.spring === 'metal') Ts = Math.max(Ts, 1.6 + Rb * (1 + Math.SQRT2));
      Ts = Math.ceil(Ts * 10) / 10;
      const z0 = p.base_t, z1 = z0 + Ts, gapL = 0.4, zl0 = z1 + gapL, zl1 = zl0 + p.lever_t;
      // groove samples (slider at rest, housing coordinates): y = sqrt(L^2 - x^2) + s
      const samples = path.segs.map(([a, b]) => {
        const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4) + 1);
        return Array.from({ length: n }, (_, i) => { const t = i / (n - 1), x = a[0] + (b[0] - a[0]) * t, s = a[1] + (b[1] - a[1]) * t;
          return [x, Math.sqrt(L * L - x * x) + s]; });
      });
      const allY = samples.flat().map((q) => q[1]);
      const yMin = Math.min(...allY) - rg, yMax = Math.max(...allY) + rg;
      const Li = springCheck(path.sMax);
      let gap, hd = 0, pitch = 0, Lp = 0;
      if (p.spring === 'metal') {
        hd = Math.min(Li - path.sMax - 0.8, Li * 0.6);
        if (hd < 2) { errors.push(['spring_short', path.sMax + 2.8 + p.spr_pre]); hd = 2; }
        gap = Li - hd;
      } else {
        pitch = p.beam + (p.spr_pre + path.sMax) / (0.7 * p.folds);
        Lp = p.folds * pitch + p.beam; gap = Lp - p.spr_pre;
      }
      const boreTop = z0 + 0.8 + Rb * (1 + Math.SQRT2);
      const margin = p.spring === 'metal' && boreTop > z1 - p.gd - 0.8 ? hd + 1 : 3;
      const Y0 = yMin - margin, Yb = Y0 - gap;
      const rb = Math.max(p.screw_d * 1.4, lw0 / 2);
      if (Yb < rb + 0.5) errors.push(['lever_short', L + (rb + 0.5 - Yb)]);
      const Yf = Math.max(L + lwt / 2 + 1, yMax + 2 - p.protrude - path.stroke, Y0 + 12);
      const Ls = Yf + p.protrude + path.stroke - Y0;
      const Wi = Ws / 2 + p.clr, Wo = Wi + p.wall;

      // ---- slider (yellow), at rest
      const sliderProf = poly([[-Ws / 2, z0], [Ws / 2, z0], [Ws / 2, z1 - cw], [Ws / 2 - cw, z1], [-Ws / 2 + cw, z1], [-Ws / 2, z1 - cw]]);
      let slider = alongY(sliderProf, Y0, Y0 + Ls);
      const hulls = [];
      for (const seg of samples) for (let i = 1; i < seg.length; i++)
        hulls.push(T(CrossSection.hull([circle(rg, ...seg[i - 1]), circle(rg, ...seg[i])])));
      const grooveCS = T(CrossSection.union(hulls));
      const groove = T(T(grooveCS.extrude(p.gd + 1)).translate([0, 0, z1 - p.gd]));
      slider = T(slider.subtract(groove));
      if (p.spring === 'metal') {
        const bore = alongY(poly(teardrop(Rb)), Y0 - 1, Y0 + hd);
        slider = T(slider.subtract(T(bore.translate([0, 0, z0 + 0.8 + Rb]))));
      } else {
        const Wsp = Ws - 2 * cw - 1 - 2 * p.clr, bt = p.beam, parts = [];
        parts.push(box(-bt, Y0 - pitch + bt / 2, z0, bt, Y0 + 0.5, z1));
        for (let i = 1; i <= p.folds; i++) {
          const yi = Y0 - i * pitch;
          parts.push(box(-Wsp / 2, yi, z0, Wsp / 2, yi + bt, z1));
          if (i < p.folds) { const sx = i % 2 ? 1 : -1, xa = sx > 0 ? Wsp / 2 - bt : -Wsp / 2;
            parts.push(box(xa, yi - pitch + bt / 2, z0, xa + bt, yi + bt / 2, z1)); }
        }
        slider = union([slider, ...parts]);
      }

      // ---- housing (red)
      const Wb = Wo + 2.6 * p.mount_d, yB0 = -rb - 2;
      let housing = box(-Wb, yB0, 0, Wb, Yf, z0);
      const zr = z1 + p.clr + p.lip;
      const railCut = alongY(T(sliderProf.offset(p.clr, 'Miter')), Yb - 4, Yf + 1);
      const rails = union([box(-Wo, Yb - 3, z0 - 0.01, -Ws / 2 + cw + 0.6, Yf, zr), box(Ws / 2 - cw - 0.6, Yb - 3, z0 - 0.01, Wo, Yf, zr)]);
      const channel = box(-Wi, Yb, z0, Wi, Yf + 1, zr + 1);
      const back = box(-Wi, Yb - 3, z0 - 0.01, Wi, Yb, z1);
      const boss = cyl(rb, 0, zl0);
      housing = union([housing, T(rails.subtract(railCut)).subtract(channel), back, boss]);
      const hy = [yB0 + 1.3 * p.mount_d + 0.5, Yf - 1.3 * p.mount_d - 0.5];
      const holes = [];
      for (const sx of [-1, 1]) for (const y of hy) holes.push(cyl((p.mount_d + p.hole_comp) / 2, -1, z0 + 1, sx * (Wo + 1.3 * p.mount_d), y));
      holes.push(cyl(p.screw_d * 0.4, 0.8, zl0 + 1, 0, 0, 24));
      housing = T(housing.subtract(union(holes)));
      // keep the pivot boss clear of the channel walls; slider must not hit the back wall: checked by gap

      // ---- lever (white), built pointing +Y, pivot at origin
      let lever = T(T(CrossSection.hull([circle(lw0 / 2, 0, 0, 40), circle(lwt / 2, 0, L, 32)])).extrude(p.lever_t));
      lever = T(lever.translate([0, 0, zl0]));
      lever = T(lever.subtract(cyl((p.screw_d + p.hole_comp + 0.2) / 2, zl0 - 1, zl1 + 1, 0, 0, 32)));
      const pinZ0 = z1 - p.gd + 0.4;
      let pinMetal = null;
      if (p.pin_type === 'printed') lever = union([lever, cyl(p.pin_d / 2, pinZ0, zl0 + 0.5, 0, L, 32)]);
      else {
        lever = T(lever.subtract(cyl((p.pin_d + p.hole_comp - 0.15) / 2, zl0 - 1, zl1 + 1, 0, L, 32)));
        pinMetal = cyl(p.pin_d / 2, pinZ0, zl1, 0, L, 24);
      }
      const leverPrint = T(T(lever.rotate([180, 0, 0])).translate([0, 0, zl1]));
      if (p.pin_d < 2.5 && p.pin_type === 'printed') warnings.push(['pin_thin']);
      if (p.spring === 'printed') warnings.push(['printed_spring']);

      return {
        variant, path, sim,
        parts: [
          { id: 'housing', color: 0xd9363e, mesh: toMesh(housing), anim: 'fixed' },
          { id: 'slider', color: 0xf5c518, mesh: toMesh(slider), anim: 'slider' },
          { id: 'lever', color: 0xf3f4f6, mesh: toMesh(lever), print: toMesh(leverPrint), anim: 'lever' },
          ...(pinMetal ? [{ id: 'pin_metal', color: 0x9ca3af, mesh: toMesh(pinMetal), anim: 'lever', noExport: true }] : []),
        ],
        spring: p.spring === 'metal' ? { axis: 'y', x: 0, z: z0 + 0.8 + Rb, from: Yb, toRest: Y0 + hd, r: p.spr_d / 2 - 0.25, wire: 0.5 } : null,
        info: { L, leverAng, Ws, Ts, Ls, size: [2 * Wb, Yf - yB0, zl1], sMax: path.sMax, over: path.over, strokeMin: path.strokeMin,
          heartW: 3 * path.k + gw, Li, hd, gap, pitch, Y0, Yb, center: [0, (Yf + yB0) / 2, zl1 / 2] },
        errors, warnings, notes,
      };
    }

    // ================================================================ rotary (pen style)
    const path = rotaryPath(p); msg(errors, path.errors); msg(notes, path.notes);
    const sim = simulate(path, { tol: p.clr });
    if (!sim.ok) errors.push(['sim_fail']);
    const R = p.rod_d / 2, rg = path.gw / 2, Rbore = R + p.clr, Rh = Rbore + p.wall, fl = p.floor;
    if (path.retAngle > 62) warnings.push(['ret_angle', path.retAngle]);
    if (p.alpha > 50) warnings.push(['overhang_rot']);
    if (p.gd > R * 0.35) warnings.push(['groove_deep']);
    const pr = p.spr_d / 2 + p.clr + 0.1;
    if (pr + 1 > R) errors.push(['spring_wide']);
    const Li = springCheck(path.sMax) || (p.spr_len - p.spr_pre);
    const hp = Math.max(0, Math.min(5, Li - path.sMax - 0.5));
    const zA = Math.max(hp + 1.5 + rg, rg + 2);
    const zb = fl + Li - hp;
    const zp = zb + zA;
    const Lr = Math.max(zA + p.pin_d / 2 + 3 + path.stroke + p.protrude, zA + path.sMax + rg + 2);
    const H = zb - path.stroke + Lr - p.protrude;
    // rod (in its own frame: z = 0 bottom), groove points u -> angle u/R, z = zA + s
    let rod = cyl(R, 0, Lr, 0, 0, 64);
    rod = T(rod.subtract(cyl(pr, -1, hp, 0, 0, 32)));
    const ch = 0.8; // top chamfer
    rod = T(rod.subtract(T(T(Manifold.cylinder(ch + 1, R - ch, R + 1, 64)).translate([0, 0, Lr - ch])).subtract(cyl(R - ch, Lr - ch - 1, Lr + 2, 0, 0, 64))));
    const rIn = R - p.gd, rOut = R + 1, disc = (u, z, rr) => {
      const phi = u / R, c = Math.cos(phi), s = Math.sin(phi), tx = -s, ty = c, pts = [];
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 2 * Math.PI, du = Math.cos(a) * rg, dz = Math.sin(a) * rg;
        pts.push([c * rr + tx * du, s * rr + ty * du, z + dz]); }
      return pts;
    };
    const hullsR = [];
    for (const [a, b] of path.segs) {
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5) + 1);
      let prev = null;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), u = a[0] + (b[0] - a[0]) * t, z = zA + a[1] + (b[1] - a[1]) * t;
        const cur = [...disc(u, z, rIn), ...disc(u, z, rOut)];
        if (prev) hullsR.push(T(Manifold.hull([...prev, ...cur])));
        prev = cur;
      }
    }
    rod = T(rod.subtract(union(hullsR)));
    // housing tube with flange; radial pin hole along +X at height zp
    const rf = Rh + 2.8 * p.mount_d;
    let housing = union([cyl(Rh, 0, H, 0, 0, 64), cyl(rf, 0, fl, 0, 0, 64)]);
    housing = T(housing.subtract(cyl(Rbore, fl, H + 1, 0, 0, 64)));
    const ph = (p.pin_type === 'metal' ? p.pin_d : p.pin_d + p.hole_comp + 0.1) / 2;
    const tdPts = teardrop(ph).map(([a, b]) => [-b, a]); // section (x=-Z, y=Y) -> apex up after rotate
    const pinHole = T(T(T(poly(tdPts).extrude(Rh + 2)).rotate([0, 90, 0])).translate([0, 0, zp]));
    const holes = [pinHole];
    for (const sy of [-1, 1]) holes.push(cyl((p.mount_d + p.hole_comp) / 2, -1, fl + 1, 0, sy * (Rh + 1.4 * p.mount_d)));
    housing = T(housing.subtract(union(holes)));
    if (zp + ph * Math.SQRT2 + 1.5 > H) warnings.push(['pin_top']);
    // pin: from the outside of the tube to 0.3 mm above the groove floor
    const pinLen = Rh - (rIn + 0.3);
    const pinAsm = T(T(T(Manifold.cylinder(pinLen + (p.pin_type === 'printed' ? 0 : 1), p.pin_d / 2, p.pin_d / 2, 24)).rotate([0, 90, 0])).translate([rIn + 0.3, 0, zp]));
    let pinPrint = null, pinHead = null;
    if (p.pin_type === 'printed') {
      pinHead = T(T(T(Manifold.cylinder(1.2, p.pin_d / 2 + 1.2, p.pin_d / 2 + 1.2, 32)).rotate([0, 90, 0])).translate([Rh, 0, zp]));
      pinPrint = union([cyl(p.pin_d / 2 + 1.2, 0, 1.2, 0, 0, 32), cyl(p.pin_d / 2, 0, 1.2 + pinLen, 0, 0, 24)]);
      if (p.pin_d < 2.5) warnings.push(['pin_thin']);
    }
    return {
      variant, path, sim,
      parts: [
        { id: 'housing', color: 0xd9363e, mesh: toMesh(housing), anim: 'fixed', transparent: true },
        { id: 'rod', color: 0xf5c518, mesh: toMesh(rod), anim: 'rod', base: [0, 0, zb] },
        { id: 'pin', color: p.pin_type === 'printed' ? 0xf3f4f6 : 0x9ca3af, mesh: toMesh(pinHead ? union([pinAsm, pinHead]) : pinAsm),
          print: pinPrint ? toMesh(pinPrint) : null, anim: 'fixed', noExport: p.pin_type !== 'printed' },
      ],
      spring: { axis: 'z', x: 0, y: 0, from: fl, toRest: zb + hp, r: p.spr_d / 2 - 0.3, wire: 0.6 },
      info: { R, N: path.N, k: path.k, sMax: path.sMax, over: path.over, retAngle: path.retAngle, Lr, H, zp, zb, hp, Li,
        pinLen, size: [2 * rf, 2 * rf, H], center: [0, 0, H / 2] },
      errors, warnings, notes,
    };
  } finally {
    for (const o of pool) { try { o.delete(); } catch (e) { /* freed */ } }
  }
}

export function toSTL(mesh, name = 'part') {
  const pos = mesh.positions, idx = mesh.indices, n = idx.length / 3;
  let zmin = Infinity, xs = 0, ys = 0;
  for (let i = 0; i < pos.length; i += 3) { zmin = Math.min(zmin, pos[i + 2]); }
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const hdr = `binary STL ${name}`.slice(0, 80);
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  const P = (i) => [pos[3 * i] - xs, pos[3 * i + 1] - ys, pos[3 * i + 2] - zmin];
  for (let t = 0; t < n; t++) {
    const a = P(idx[3 * t]), b = P(idx[3 * t + 1]), c = P(idx[3 * t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const val of [nx / l, ny / l, nz / l, ...a, ...b, ...c]) { dv.setFloat32(o, val, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
