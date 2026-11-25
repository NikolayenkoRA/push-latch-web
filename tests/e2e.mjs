// Playwright e2e: builds the UI in a headless browser, takes screenshots, downloads all STLs + zips.
//   npm run build && npx vite preview --port 4174 &  node tests/e2e.mjs [url]
import { chromium } from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const URL_ = process.argv[2] || 'http://127.0.0.1:4174/';
const SHOTS = path.join(ROOT, 'screenshots'), OUT = path.join(ROOT, 'test-output', 'e2e');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(URL_);
const ready = async () => { await page.waitForFunction(() => window.__latch?.ready); await page.waitForTimeout(600); };
const grab = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, name) }); };
const status = () => page.evaluate(() => ({ sim: window.__latch.result.sim.ok, errors: window.__latch.result.errors }));
await ready();
console.log('heart', JSON.stringify(await status()));
await page.evaluate(() => window.__latch.setPhase(0.47)); await shot('heart-assembly-latched.png');
await page.evaluate(() => window.__latch.setPhase(0.25)); await shot('heart-assembly-pushed.png');
await page.check('#xray'); await page.evaluate(() => { const l = window.__latch, c = l.controls.target; l.camera.position.set(c.x + 5, c.y - 25, c.z + 110); l.controls.update(); l.setPhase(0.47); });
await shot('heart-xray-top-latched.png');
await page.screenshot({ path: path.join(SHOTS, 'heart-full-page.png'), fullPage: true }); await page.uncheck('#xray');
for (const s of ['#dl-housing', '#dl-slider', '#dl-lever', '#dl-zip']) console.log('dl', path.basename(await grab(s)));
await page.click('[data-view="print"]'); await shot('heart-print-layout.png');
await page.click('[data-view="asm"]');
await page.selectOption('#spring', 'printed'); await ready();
console.log('heart printed spring', JSON.stringify(await status()));
await page.click('[data-view="print"]'); await shot('heart-printed-spring-print.png'); await page.click('[data-view="asm"]');
// a too-small stroke must be reported
await page.fill('#stroke', '6'); await page.dispatchEvent('#stroke', 'change'); await ready();
const st = await status(); console.log('heart small stroke', JSON.stringify(st));
if (!st.errors.some((e) => e[0] === 'stroke_min')) throw new Error('stroke_min not reported');
await shot('heart-error-small-stroke.png');
await page.click('text=Сбросить параметры варианта'); await ready();
// rotary
await page.click('[data-variant="rotary"]'); await ready();
console.log('rotary', JSON.stringify(await status()));
await page.check('#xray'); await page.evaluate(() => window.__latch.setPhase(0.47)); await shot('rotary-assembly-xray.png');
for (const s of ['#dl-housing', '#dl-rod', '#dl-zip']) console.log('dl', path.basename(await grab(s)));
await page.click('[data-view="print"]'); await shot('rotary-print-layout.png'); await page.click('[data-view="asm"]');
await page.selectOption('#pin_type', 'printed'); await page.fill('#rod_d', '20'); await page.dispatchEvent('#rod_d', 'change'); await ready();
console.log('rotary d20 printed pin', JSON.stringify(await status()), await page.evaluate(() => window.__latch.result.info.N));
await page.evaluate(() => window.__latch.setPhase(0.3)); await shot('rotary-d20-3cycles.png');
const f = await grab('#dl-zip'); fs.renameSync(f, f.replace('.zip', '_d20.zip'));
await page.click('text=Сбросить параметры варианта'); await page.uncheck('#xray');
// mobile
await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-variant="heart"]'); await ready(); await shot('mobile-heart.png');
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
if (errs.length) process.exit(1);
