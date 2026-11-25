// Collision check over the whole push cycle: moving parts must not overlap the housing / each other.
//   node tests/interference.mjs
import Module from 'manifold-3d';
import { build, defaultsFor } from '../src/geometry.js';
const wasm = await Module(); wasm.setup();
const { Manifold, Mesh } = wasm;
const M = (m) => new Manifold(new Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
const sets = [['heart', {}], ['heart', { spring: 'printed' }], ['heart', { pin_d: 2.5, stroke: 11, rib: 1.0, lever_len: 45, pin_type: 'metal' }],
  ['rotary', {}], ['rotary', { rod_d: 20, stroke: 10, spr_len: 35, spr_solid: 7, pin_type: 'printed' }], ['rotary', { rod_d: 9, stroke: 4, spr_d: 4, spr_len: 20, spr_solid: 4 }]];
let worst = 0;
for (const [v, o] of sets) {
  const r = build(wasm, v, { ...defaultsFor(v), ...o });
  const parts = Object.fromEntries(r.parts.map((p) => [p.id, { m: M(p.mesh), p }]));
  const tr = r.sim.trace, n = 60; let maxV = 0, at = '';
  for (let i = 0; i <= n; i++) {
    const [x, s] = tr[Math.floor((i / n) * (tr.length - 1))];
    const placed = {};
    for (const [id, { m, p }] of Object.entries(parts)) {
      if (p.anim === 'slider') placed[id] = m.translate([0, -s, 0]);
      else if (p.anim === 'lever') placed[id] = m.rotate([0, 0, -Math.asin(x / r.info.L) * 180 / Math.PI]);
      else if (p.anim === 'rod') placed[id] = m.rotate([0, 0, (-x / r.info.R) * 180 / Math.PI]).translate([0, 0, p.base[2] - s]);
      else placed[id] = m;
    }
    const ids = Object.keys(placed);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      if (ids[a] === 'lever' && ids[b] === 'pin_metal') continue;
      let I = placed[ids[a]].intersect(placed[ids[b]]);
      // printed serpentine spring is drawn uncompressed: ignore its own region (behind the slider body)
      if (r.info.pitch && ids.includes('slider')) I = I.intersect(Manifold.cube([1e3, 1e3, 1e3]).translate([-500, r.info.Y0 - s, -500]));
      const vol = I.volume();
      if (vol > maxV) { maxV = vol; at = `${ids[a]}×${ids[b]} s=${s.toFixed(2)}`; }
    }
  }
  worst = Math.max(worst, maxV);
  console.log(`${v} ${JSON.stringify(o)}: max overlap ${maxV.toFixed(4)} mm3 ${at}`);
}
console.log(worst < 0.05 ? 'NO INTERFERENCE' : 'INTERFERENCE'); process.exit(worst < 0.05 ? 0 : 1);
