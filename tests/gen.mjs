// Node smoke test: builds both variants for several parameter sets, writes STLs, checks manifold status.
//   node tests/gen.mjs test-output   (then: python3 tests/check_stl.py test-output)
import fs from 'node:fs'; import path from 'node:path';
import Module from 'manifold-3d';
import { build, toSTL, defaultsFor } from '../src/geometry.js';
const out = process.argv[2] || 'test-output'; fs.mkdirSync(out, { recursive: true });
const wasm = await Module(); wasm.setup();
const sets = [
  ['heart_default', 'heart', {}],
  ['heart_printedspring', 'heart', { spring: 'printed' }],
  ['heart_pin2_s10', 'heart', { pin_d: 2.5, stroke: 11, rib: 1.0, lever_len: 45, pin_type: 'metal' }],
  ['heart_big', 'heart', { pin_d: 4, stroke: 20, clr: 0.35, lever_len: 70, spr_len: 40, spr_d: 6, spr_solid: 8 }],
  ['rotary_default', 'rotary', {}],
  ['rotary_printedpin', 'rotary', { pin_type: 'printed', pin_d: 3, rod_d: 16, stroke: 8 }],
  ['rotary_small', 'rotary', { rod_d: 9, stroke: 4, spr_d: 4, spr_len: 20, spr_solid: 4 }],
  ['rotary_n2', 'rotary', { rod_d: 20, stroke: 10, spr_len: 35, spr_solid: 7 }],
];
let bad = 0;
for (const [name, v, over] of sets) {
  const p = { ...defaultsFor(v), ...over };
  const t0 = Date.now(); const r = build(wasm, v, p);
  const info = Object.fromEntries(Object.entries(r.info).filter(([, x]) => typeof x === 'number').map(([k, x]) => [k, +x.toFixed(2)]));
  console.log(`${name}: ${Date.now() - t0} ms sim=${r.sim.ok} errors=${JSON.stringify(r.errors)} warn=${JSON.stringify(r.warnings)} notes=${JSON.stringify(r.notes.map(n => [n[0], +n[1].toFixed(2)]))}`);
  console.log('   ', JSON.stringify(info));
  for (const part of r.parts) {
    if (part.noExport) continue;
    const m = part.print || part.mesh;
    if (m.status !== 'NoError' || m.empty) { bad++; console.log('   BAD', part.id, m.status); }
    fs.writeFileSync(path.join(out, `${name}_${part.id}.stl`), toSTL(m, part.id));
  }
  if (r.errors.length && !name.includes('err')) bad++;
}
console.log(bad ? `FAIL ${bad}` : 'ALL OK'); process.exit(bad ? 1 : 0);
