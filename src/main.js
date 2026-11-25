import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { zipSync, strToU8 } from 'fflate';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { build, toSTL, defaultsFor } from './geometry.js';

// ------------------------------------------------------------------ state
const STORE = 'push-latch-web:v1';
let state = { variant: 'heart', view: 'asm', params: { heart: defaultsFor('heart'), rotary: defaultsFor('rotary') }, xray: false };
try {
  const s = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (s?.params) state = { ...state, ...s, params: { heart: { ...defaultsFor('heart'), ...s.params.heart }, rotary: { ...defaultsFor('rotary'), ...s.params.rotary } } };
} catch { /* ignore */ }
const q = new URLSearchParams(location.search);
if (q.get('variant') === 'rotary' || q.get('variant') === 'heart') state.variant = q.get('variant');
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* */ } };
const P = () => state.params[state.variant];

// ------------------------------------------------------------------ controls schema: [key, label, min, max, step, hint, variants]
const NUM = (key, label, min, max, step, hint = '', only = null) => ({ type: 'num', key, label, min, max, step, hint, only });
const SEL = (key, label, options, only = null) => ({ type: 'sel', key, label, options, only });
const GROUPS = [
  ['Ход', [
    NUM('stroke', 'Ход (разница верхнего и нижнего положения), мм', 2, 40, 0.5, 'Насколько толкатель утапливается в защёлкнутом состоянии относительно свободного.'),
    NUM('over', 'Перебег (дожим) не менее, мм', 1, 10, 0.1, 'Насколько надо нажать глубже защёлкнутого положения. Если для выбранного угла рампы нужно больше — увеличится автоматически.'),
    NUM('alpha', 'Угол рамп от оси нажатия, °', 30, 65, 1, 'Больше угол — короче перебег, но выше трение и риск заклинивания. Для печатного PLA/PETG 45–55°.'),
    NUM('run', 'Осевой участок после разворота, мм', 0.4, 3, 0.1, 'Прямой участок, который направляет штифт в правильную ветку.'),
  ]],
  ['Штифт и паз', [
    NUM('pin_d', 'Диаметр штифта (стержня), мм', 1.5, 6, 0.1),
    SEL('pin_type', 'Штифт', [['printed', 'Печатный (заодно с рычагом)'], ['metal', 'Металлический (отверстие под запрессовку)']], 'heart'),
    SEL('pin_type', 'Штифт', [['metal', 'Металлический (гвоздь, стальной пруток)'], ['printed', 'Печатный, со шляпкой']], 'rotary'),
    NUM('gd', 'Глубина паза, мм', 0.8, 4, 0.1),
    NUM('clr', 'Зазор подвижных посадок (погрешность печати), мм', 0.05, 0.6, 0.01, 'На сторону: паз шире штифта на 2×зазор, направляющие — так же. 0.2–0.3 для типичного FDM.'),
    NUM('hole_comp', 'Компенсация отверстий, мм', 0, 0.5, 0.01, 'Добавка к диаметру крепёжных отверстий (FDM обычно занижает отверстия).'),
    NUM('rib', 'Мин. перемычка между ветками паза, мм', 0.6, 3, 0.1),
  ]],
  ['Сердечко + рычаг', [
    NUM('lever_len', 'Длина рычага (ось — штифт), мм', 25, 150, 1, 'Длиннее рычаг — меньше угол качания и ровнее работа.'),
    NUM('lever_w', 'Ширина рычага у оси, мм', 4, 16, 0.5),
    NUM('lever_t', 'Толщина рычага, мм', 1.6, 8, 0.1),
    NUM('screw_d', 'Винт оси рычага, мм', 2, 5, 0.5, 'Саморез/винт в отверстие Ø0.8·d в бобышке, в рычаге — свободное отверстие.'),
    NUM('slider_t', 'Толщина ползуна (мин.), мм', 3, 15, 0.1),
    NUM('base_t', 'Толщина основания, мм', 1.6, 6, 0.1),
    NUM('wall', 'Стенка направляющих, мм', 1.2, 6, 0.1),
    NUM('lip', 'Губа направляющих (фаска 45°), мм', 0.8, 4, 0.1),
  ], 'heart'],
  ['Поворотный кулачок', [
    NUM('rod_d', 'Диаметр толкателя, мм', 6, 40, 0.5),
    NUM('periods', 'Число циклов на оборот (0 = макс.)', 0, 6, 1),
    NUM('wall', 'Стенка трубки, мм', 1.2, 6, 0.1),
    NUM('floor', 'Дно / фланец, мм', 1.2, 6, 0.1),
  ], 'rotary'],
  ['Пружина', [
    SEL('spring', 'Тип', [['metal', 'Металлическая пружина сжатия'], ['printed', 'Печатная змейка (заодно с ползуном)']], 'heart'),
    NUM('spr_d', 'Наружный диаметр пружины, мм', 2, 14, 0.1, '', 'metal'),
    NUM('spr_len', 'Длина в свободном состоянии, мм', 5, 80, 0.5, '', 'metal'),
    NUM('spr_solid', 'Длина сжатой до упора, мм', 1, 30, 0.1, '', 'metal'),
    NUM('spr_pre', 'Предварительное сжатие, мм', 0, 10, 0.1),
    NUM('folds', 'Число витков змейки', 3, 16, 1, '', 'printed'),
    NUM('beam', 'Толщина балки змейки, мм', 0.6, 3, 0.05, '', 'printed'),
  ]],
  ['Монтаж', [
    NUM('mount_d', 'Крепёжные отверстия, мм', 2, 6, 0.1),
    NUM('protrude', 'Вылет толкателя в защёлкнутом положении, мм', 0, 20, 0.5),
  ]],
];

const panel = document.getElementById('panel');
function renderPanel() {
  const p = P(), v = state.variant;
  panel.innerHTML = '';
  for (const [title, items, only] of GROUPS) {
    if (only && only !== v) continue;
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<h2>${title}</h2>`;
    for (const it of items) {
      if (it.only && it.only !== v && !(it.only === 'metal' || it.only === 'printed')) continue;
      if ((it.only === 'metal' || it.only === 'printed') && (v === 'rotary' ? 'metal' : p.spring) !== it.only) continue;
      const row = document.createElement('div');
      if (it.type === 'num') {
        row.className = 'row num';
        row.innerHTML = `<label for="${it.key}">${it.label}</label><input type="range" id="r-${it.key}" min="${it.min}" max="${it.max}" step="${it.step}" value="${p[it.key]}" /><input type="number" id="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}" value="${p[it.key]}" />`;
        const r = row.querySelector('input[type=range]'), n = row.querySelector('input[type=number]');
        const set = (val, from) => { const x = Math.min(it.max, Math.max(it.min, +val)); if (!Number.isFinite(x)) return; p[it.key] = x; if (from !== r) r.value = x; if (from !== n) n.value = x; save(); schedule(); };
        r.addEventListener('input', () => set(r.value, r)); n.addEventListener('change', () => set(n.value, n));
      } else {
        row.className = 'row sel';
        row.innerHTML = `<label for="${it.key}">${it.label}</label><select id="${it.key}">${it.options.map(([k, l]) => `<option value="${k}" ${p[it.key] === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        row.querySelector('select').addEventListener('change', (e) => { p[it.key] = e.target.value; save(); renderPanel(); schedule(); });
      }
      card.appendChild(row);
      if (it.hint) { const h = document.createElement('p'); h.className = 'hint2'; h.textContent = it.hint; card.appendChild(h); }
    }
    panel.appendChild(card);
  }
  const reset = document.createElement('button'); reset.className = 'btn ghost'; reset.textContent = 'Сбросить параметры варианта';
  reset.onclick = () => { state.params[v] = defaultsFor(v); save(); renderPanel(); schedule(); };
  panel.appendChild(reset);
}

// ------------------------------------------------------------------ three.js
const viewer = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef2f7);
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000); camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(60, -80, 120); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-80, 60, 40); scene.add(fill);
const grid = new THREE.GridHelper(400, 40, 0xc7d0dd, 0xdde3ec); grid.rotation.x = Math.PI / 2; scene.add(grid);
const group = new THREE.Group(); scene.add(group);
function resize() { const w = viewer.clientWidth, h = viewer.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(viewer); resize();

const geomOf = (m) => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose(); return ng;
};

let result = null, objs = {}, springLine = null, frames = [], userMoved = false, lastKey = '';
controls.addEventListener('start', () => { userMoved = true; });

function clearGroup() {
  for (const c of [...group.children]) { group.remove(c); c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  objs = {}; springLine = null;
}
function populate() {
  clearGroup(); if (!result) return;
  const asm = state.view === 'asm';
  let xoff = 0;
  for (const part of result.parts) {
    if (!asm && (part.noExport || (part.id === 'pin' && !part.print))) continue;
    const m = asm ? part.mesh : (part.print || part.mesh);
    const mat = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.55, metalness: part.id.includes('metal') || (part.id === 'pin' && part.noExport) ? 0.6 : 0.05,
      transparent: asm && state.xray && (part.id === 'housing' || part.id === 'lever'), opacity: asm && state.xray && (part.id === 'housing' || part.id === 'lever') ? 0.3 : 1, depthWrite: !(asm && state.xray && (part.id === 'housing' || part.id === 'lever')), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geomOf(m), mat);
    const holder = new THREE.Group(); holder.add(mesh);
    if (!asm) { // print layout: each part on the bed, side by side
      mesh.geometry.computeBoundingBox(); const b = mesh.geometry.boundingBox;
      mesh.position.set(-b.min.x + xoff, -(b.min.y + b.max.y) / 2, -b.min.z); xoff += b.max.x - b.min.x + 10;
    } else if (part.base) holder.position.set(...part.base);
    group.add(holder); objs[part.id] = { holder, part };
  }
  if (asm && result.spring) {
    springLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x475569 }));
    group.add(springLine);
  }
  if (!asm) group.position.set(-xoff / 2 + 5, 0, 0); else group.position.set(-result.info.center[0], -result.info.center[1], 0);
  const key = state.variant + state.view;
  if (!userMoved || key !== lastKey) frame();
  lastKey = key;
  applyPhase();
}
function frame() {
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  const d = s * 1.35;
  if (state.variant === 'heart' && state.view === 'asm') camera.position.set(c.x + d * 0.3, c.y - d * 0.55, c.z + d * 0.85);
  else camera.position.set(c.x + d * 0.45, c.y - d * 0.75, c.z + d * 0.62);
  controls.update();
}
function springPoints(sp, len) {
  const pts = [], turns = 7, n = 200;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * 2 * Math.PI, along = sp.from + t * len;
    if (sp.axis === 'y') pts.push(new THREE.Vector3(sp.x + sp.r * Math.cos(a), along, sp.z + sp.r * Math.sin(a)));
    else pts.push(new THREE.Vector3(sp.x + sp.r * Math.cos(a), sp.y + sp.r * Math.sin(a), along));
  }
  return pts;
}

// ------------------------------------------------------------------ animation
let phase = 0, playing = true, lastT = performance.now();
const phaseEl = document.getElementById('phase'), phaseLabel = document.getElementById('phase-label');
function stateAt(f) {
  if (!frames.length) return { x: 0, s: 0, label: '' };
  const i = Math.min(frames.length - 1, Math.floor(f * (frames.length - 1)));
  return frames[i];
}
function buildFrames() {
  frames = [];
  if (!result?.sim) return;
  const tr = result.sim.trace, ph = result.sim.phases;
  const labels = ['Нажатие → защёлкивание', 'Отпускание: защёлкнуто', 'Повторное нажатие', 'Отпускание: свободно'];
  const step = Math.max(1, Math.floor(tr.length / 900));
  let k = 0;
  const hold = (x, s, label, n) => { for (let j = 0; j < n; j++) frames.push({ x, s, label }); };
  for (let i = 0; i < tr.length; i += step) {
    while (k < ph.length - 1 && i > ph[k].idx) k++;
    frames.push({ x: tr[i][0], s: tr[i][1], label: labels[k] });
    if (k === 1 && i + step > ph[1].idx && i <= ph[1].idx) hold(tr[ph[1].idx][0], tr[ph[1].idx][1], 'Защёлкнуто (держит)', 120);
  }
  hold(tr[tr.length - 1][0], tr[tr.length - 1][1], 'Свободно (исходное)', 90);
}
function applyPhase() {
  const f = stateAt(phase);
  phaseLabel.textContent = f.label + (frames.length ? ` · s = ${f.s.toFixed(1)} мм` : '');
  if (result && state.view === 'asm') {
    const info = result.info;
    for (const { holder, part } of Object.values(objs)) {
      if (part.anim === 'slider') holder.position.y = -f.s;
      if (part.anim === 'lever') holder.rotation.z = -Math.asin(Math.max(-1, Math.min(1, f.x / info.L)));
      if (part.anim === 'rod') { holder.position.z = part.base[2] - f.s; holder.rotation.z = -f.x / info.R; }
    }
    if (springLine) {
      const sp = result.spring, len = sp.toRest - sp.from - f.s;
      springLine.geometry.dispose(); springLine.geometry = new THREE.BufferGeometry().setFromPoints(springPoints(sp, len));
    }
  }
  drawGroove(f);
}
document.getElementById('play').onclick = () => { playing = !playing; document.getElementById('play').textContent = playing ? '⏸ Пауза' : '▶ Пуск'; };
phaseEl.addEventListener('input', () => { phase = phaseEl.value / 1000; playing = false; document.getElementById('play').textContent = '▶ Пуск'; applyPhase(); });
document.getElementById('xray').checked = state.xray;
document.getElementById('xray').onchange = (e) => { state.xray = e.target.checked; save(); populate(); };
function loop(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (playing && frames.length && state.view === 'asm') { phase = (phase + dt / 7) % 1; phaseEl.value = Math.round(phase * 1000); applyPhase(); }
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ 2D groove diagram
const gc = document.getElementById('groove'), g2 = gc.getContext('2d');
function drawGroove(f) {
  const W = gc.width, H = gc.height; g2.clearRect(0, 0, W, H);
  if (!result) return;
  const path = result.path, segs = path.segs;
  const xs = segs.flat().map((p) => p[0]), ss = segs.flat().map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = path.periodic ? x0 + path.periodic : Math.max(...xs), s0 = Math.min(...ss), s1 = Math.max(...ss);
  const pad = 26, sc = Math.min((W - 2 * pad) / (x1 - x0 + path.gw), (H - 2 * pad) / (s1 - s0 + path.gw));
  const ox = W / 2 - ((x0 + x1) / 2) * sc, oy = H / 2 + ((s0 + s1) / 2) * sc;
  const X = (x) => ox + x * sc, Y = (s) => oy - s * sc;
  g2.lineCap = 'round'; g2.lineJoin = 'round';
  g2.strokeStyle = '#fde68a'; g2.lineWidth = path.gw * sc;
  for (const [a, b] of segs) { g2.beginPath(); g2.moveTo(X(a[0]), Y(a[1])); g2.lineTo(X(b[0]), Y(b[1])); g2.stroke(); }
  g2.lineWidth = 2;
  for (const [a, b] of segs) { g2.strokeStyle = Math.abs(a[0] - b[0]) < 1e-6 ? '#2563eb' : '#b45309'; g2.beginPath(); g2.moveTo(X(a[0]), Y(a[1])); g2.lineTo(X(b[0]), Y(b[1])); g2.stroke(); }
  // levels
  g2.setLineDash([4, 4]); g2.strokeStyle = '#94a3b8'; g2.lineWidth = 1; g2.font = '12px system-ui'; g2.fillStyle = '#475569';
  for (const [s, t] of [[0, 'свободно s=0'], [path.stroke, `защёлка s=${path.stroke}`], [path.sMax, `упор s=${path.sMax.toFixed(1)}`]]) {
    g2.beginPath(); g2.moveTo(pad / 2, Y(s)); g2.lineTo(W - pad / 2, Y(s)); g2.stroke(); g2.fillText(t, 6, Y(s) - 4);
  }
  g2.setLineDash([]);
  if (frames.length) {
    let x = f.x; if (path.periodic) x = x0 + ((((x - x0) % path.periodic) + path.periodic) % path.periodic);
    g2.fillStyle = '#d9363e'; g2.beginPath(); g2.arc(X(x), Y(f.s), Math.max(3, (result.p.pin_d / 2) * sc), 0, 2 * Math.PI); g2.fill();
  }
  g2.fillStyle = '#64748b'; g2.fillText(path.periodic ? '← развёртка окружности толкателя →' : '← поперёк хода (качание рычага) →', W / 2 - 110, H - 6);
}

// ------------------------------------------------------------------ status
const MSG = {
  stroke_min: (v) => `Ход слишком мал для сердечка с такими штифтом/зазором/перемычкой: нужно ≥ ${v.toFixed(1)} мм. Уменьшите штифт, зазор или перемычку, увеличьте угол рамп — или возьмите поворотный кулачок.`,
  over_raised: (v) => `Перебег увеличен до ${v.toFixed(2)} мм (нужен для рамп и осевого участка).`,
  rod_thin: (v) => `Толкатель слишком тонкий для паза: нужно ≥ ${v.toFixed(1)} мм.`,
  stroke_small: (v) => `Ход слишком мал: нужно ≥ ${v.toFixed(1)} мм.`,
  spring_short: (v) => `Пружина коротка для такого хода: нужна длина в свободном состоянии ≥ ${v.toFixed(1)} мм (или меньше длина сжатой до упора).`,
  sim_fail: () => 'Симуляция цикла не прошла: штифт не попадает в нужные ветки. Измените параметры.',
  lever_short: (v) => `Рычаг слишком короткий для пружины и хода: нужно ≥ ${Math.ceil(v)} мм.`,
  lever_angle: (v) => `Угол качания рычага ${v.toFixed(1)}° — велик, удлините рычаг (желательно ≤ 15°).`,
  pin_thin: () => 'Печатный штифт тоньше 2.5 мм хрупкий — лучше металлический.',
  printed_spring: () => 'Печатная змейка: PETG/ABS/нейлон, не PLA (PLA «устаёт» и ползёт под постоянной нагрузкой). Сила невелика — подберите толщину балки.',
  ret_angle: (v) => `Обратная рампа крутая (${v.toFixed(0)}°): увеличьте ход/перебег или уменьшите диаметр.`,
  overhang_rot: () => 'Угол рамп > 50°: потолки паза на толкателе, печатаемом стоя, будут нависать сильнее 45°.',
  groove_deep: () => 'Паз глубже 35% радиуса — толкатель ослаблен.',
  spring_wide: () => 'Пружина не помещается в гнездо толкателя.',
  pin_top: () => 'Отверстие штифта слишком близко к верху трубки.',
};
const statusEl = document.getElementById('status');
function renderStatus(ms) {
  if (!result) return;
  const r = result, i = r.info, p = P();
  const line = (cls, t) => `<div class="${cls}">${t}</div>`;
  let h = r.sim.ok ? line('ok', '✓ Цикл проверен симуляцией: нажатие → защёлка → нажатие → свобода') : '';
  h += r.errors.map(([k, v]) => line('err', '✗ ' + MSG[k](v))).join('');
  h += r.warnings.map(([k, v]) => line('warn', '⚠ ' + MSG[k](v))).join('');
  h += r.notes.map(([k, v]) => line('muted', 'ℹ ' + MSG[k](v))).join('');
  const kv = [['Ход / перебег / полный ход', `${p.stroke} / ${i.over.toFixed(2)} / ${i.sMax.toFixed(2)} мм`], ['Ширина паза', `${(p.pin_d + 2 * p.clr).toFixed(2)} мм`]];
  if (r.variant === 'heart') {
    kv.push(['Мин. ход для этих параметров', `${i.strokeMin.toFixed(1)} мм`], ['Угол качания рычага', `±${i.leverAng.toFixed(1)}°`],
      ['Ползун Ш×Д×Т', `${i.Ws} × ${i.Ls.toFixed(1)} × ${i.Ts} мм`], ['Габарит корпуса', i.size.map((x) => x.toFixed(1)).join(' × ') + ' мм']);
    if (p.spring === 'metal') kv.push(['Пружина: гнездо в ползуне', `Ø${(p.spr_d + 2 * p.clr).toFixed(2)} × ${i.hd.toFixed(1)} мм`], ['Пружина: длина в сборке / при упоре', `${i.Li.toFixed(1)} / ${(i.Li - i.sMax).toFixed(1)} мм`]);
    else kv.push(['Змейка: шаг / длина', `${i.pitch.toFixed(2)} / ${(i.gap + p.spr_pre).toFixed(1)} мм`]);
  } else {
    kv.push(['Циклов на оборот', `${i.N} (поворот ${(180 / i.N).toFixed(0)}° за нажатие)`], ['Обратная рампа', `${i.retAngle.toFixed(0)}°`],
      ['Толкатель Ø×L', `${p.rod_d} × ${i.Lr.toFixed(1)} мм`], ['Трубка: высота / ось штифта', `${i.H.toFixed(1)} / ${i.zp.toFixed(1)} мм`],
      ['Штифт: вылет внутрь от наружной стенки', `${i.pinLen.toFixed(2)} мм`], ['Пружина: длина в сборке / при упоре', `${i.Li.toFixed(1)} / ${(i.Li - i.sMax).toFixed(1)} мм`]);
  }
  kv.push(['Расчёт', `${ms} мс`]);
  h += `<div class="kv">${kv.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>`;
  statusEl.innerHTML = h;
}

// ------------------------------------------------------------------ downloads
const NAMES = { housing: 'Корпус', slider: 'Ползун с пазом', lever: 'Рычаг', rod: 'Толкатель', pin: 'Штифт' };
const fileName = (id) => `push_latch_${state.variant}_${id}.stl`;
const download = (data, name, type = 'model/stl') => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const exportable = () => (result ? result.parts.filter((x) => !x.noExport) : []);
function renderDownloads() {
  const box = document.getElementById('dl-buttons'); box.innerHTML = '';
  for (const part of exportable()) {
    const b = document.createElement('button'); b.className = 'btn primary'; b.id = `dl-${part.id}`; b.textContent = `${NAMES[part.id]} .stl`;
    b.onclick = () => download(toSTL(part.print || part.mesh, part.id), fileName(part.id)); box.appendChild(b);
  }
  const z = document.createElement('button'); z.className = 'btn'; z.id = 'dl-zip'; z.textContent = 'Все детали .zip';
  z.onclick = () => {
    const files = {};
    for (const part of exportable()) files[fileName(part.id)] = toSTL(part.print || part.mesh, part.id);
    files['params.json'] = strToU8(JSON.stringify({ variant: state.variant, params: P(), info: result.info }, null, 2));
    files['README.txt'] = strToU8(document.getElementById('print-hint').innerText);
    download(zipSync(files), `push_latch_${state.variant}.zip`, 'application/zip');
  };
  box.appendChild(z);
  const p = P();
  document.getElementById('print-hint').innerText = state.variant === 'heart'
    ? `Печать без поддержек: корпус и ползун — основанием на стол (губы направляющих и гнездо пружины сделаны под 45°/каплей), рычаг — верхней стороной на стол, штифтом вверх. Сборка: пружину в гнездо ползуна, ползун вставить в направляющие спереди, рычаг штифтом в паз, ось — винт/саморез ${p.screw_d} мм в бобышку (не затягивать, рычаг должен качаться свободно). Паз смазать сухой смазкой/графитом. Если цикл «залипает» — увеличьте зазор на 0.05.`
    : `Печать без поддержек: трубка — фланцем на стол, толкатель — стоя (гнездо пружины снизу). Сборка: пружину в трубку, толкатель сверху, поворачивая, совместить паз с отверстием, вставить штифт Ø${p.pin_d} мм (${p.pin_type === 'metal' ? `гвоздь/пруток, вылет внутрь ${result?.info.pinLen.toFixed(1)} мм от наружной стенки, лишнее откусить` : 'печатный, на каплю клея'}). Толкатель должен свободно вращаться — проверьте до установки штифта.`;
}

// ------------------------------------------------------------------ build loop
let wasm = null, timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(regenerate, 120); }
function regenerate() {
  if (!wasm) { statusEl.textContent = 'Загрузка геометрического ядра…'; return; }
  const t0 = performance.now();
  try {
    const p = { ...P() };
    result = build(wasm, state.variant, p); result.p = p;
  } catch (e) { console.error(e); statusEl.innerHTML = `<div class="err">Ошибка построения: ${e.message}</div>`; return; }
  const ms = Math.round(performance.now() - t0);
  buildFrames(); populate(); renderStatus(ms); renderDownloads();
  window.__latch = { result, state, ready: true, camera, controls, group, setPhase: (f) => { phase = f; playing = false; applyPhase(); }, frame };
}
function syncSegs() {
  document.querySelectorAll('#variant-seg button').forEach((b) => b.classList.toggle('on', b.dataset.variant === state.variant));
  document.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
}
document.querySelectorAll('#variant-seg button').forEach((b) => b.onclick = () => { state.variant = b.dataset.variant; save(); syncSegs(); renderPanel(); userMoved = false; schedule(); });
document.querySelectorAll('#view-seg button').forEach((b) => b.onclick = () => { state.view = b.dataset.view; save(); syncSegs(); userMoved = false; populate(); });
syncSegs(); renderPanel();
Module({ locateFile: () => wasmUrl }).then((m) => { m.setup(); wasm = m; regenerate(); });
