// Regression for "切换骨架时第二级及以下的线条样式不会发生变化".
//
// Drives the *real* UI: Ctrl+N-equivalent new document → add two more levels
// → click 骨架 cards in the shipped-style board → read `doc_layout` after each
// click.  This covers the whole chain App.setSkeleton → api.applySkeleton →
// doc_apply_skeleton (camelCase IPC) → ops::apply_skeleton_styles → layout.
//
//   node scripts/ui-skeleton-lines.mjs
//
// Output: target/verify/skeleton-lines-report.json + skeleton-lines.png
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
const OUT = 'target/verify';
mkdirSync(OUT, { recursive: true });
const presets = JSON.parse(readFileSync('research/skeleton-presets.json', 'utf8'));

// A clean document with known React state (never invoke doc_new directly).
execFileSync(process.execPath, ['scripts/new-doc.mjs'], { stdio: 'pipe' });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { done, fail } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? fail(new Error(JSON.stringify(message.error))) : done(message.result);
  }
});
const send = (method, params = {}) => new Promise((done, fail) => {
  const id = ++seq;
  pending.set(id, { done, fail });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (command, args = {}) => evaluate(
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
);
await new Promise((r) => ws.addEventListener('open', r));
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});
await wait(300);

const results = [];
let failures = 0;
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 220) });
  if (!pass) failures += 1;
};
const shapeOf = (layout) => {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  return layout.edges.map((e) => ({
    depth: byId.get(e.to)?.depth ?? -1,
    to: e.to,
    tapered: e.tapered,
    path: e.path,
    width: e.width,
    dash: e.dash,
  }));
};

// Three levels, so "level 2 and below" is actually observable.  Two siblings
// per branch give the connectors a vertical offset — otherwise every elbow /
// fold degenerates into a straight horizontal line on screen.
let layout = await invoke('doc_layout');
const first = layout.nodes.filter((n) => n.depth === 1).map((n) => n.id);
for (const id of first) {
  await invoke('doc_add_child', { id, title: '二级 A' });
  await invoke('doc_add_child', { id, title: '二级 B' });
}
layout = await invoke('doc_layout');
const second = layout.nodes.filter((n) => n.depth === 2).map((n) => n.id);
for (const id of second) await invoke('doc_add_child', { id, title: '三级' });
layout = await invoke('doc_layout');
const snap = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.data, 'base64'));
};
const before = shapeOf(layout);
await snap('skeleton-lines-before');
ok('test map has three connector levels',
  [1, 2, 3].every((d) => before.some((e) => e.depth === d)),
  `edges=${before.length}`);
ok('fresh map still uses the default tapered wedge',
  before.length > 0 && before.every((e) => e.tapered),
  `tapered=${before.filter((e) => e.tapered).length}/${before.length}`);

// Open the 骨架 board once; the shipped panel stays open and applies on each click.
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '样式')?.click();
  return 1;
})()`);
await wait(300);
const opened = await evaluate(`(() => {
  if (document.querySelector('.pop.is-skeleton')) return 'already';
  const b = document.querySelector('button[title="设置主题结构。"]')
    ?? [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '思维导图');
  if (!b) return 'no trigger';
  b.click(); return 'ok';
})()`);
await wait(500);
ok('skeleton board opened', opened !== 'no trigger', opened);

const pick = async (index) => {
  const label = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.pop.is-skeleton .bone-card')];
    const card = cards[${index}];
    if (!card) return null;
    card.click();
    return card.getAttribute('aria-label');
  })()`);
  await wait(700);
  return { label, layout: shapeOf(await invoke('doc_layout')) };
};

// Mind Map #1: central=curve, main=sub=roundedElbow, line-tapered=none.
const p1 = await pick(0);
await snap('skeleton-lines-after');
const preset1 = presets[0];
ok('preset 1 is the elbow / non-tapered one',
  preset1.mainLine === 'roundedElbow' && preset1.tapered === 'none',
  `${preset1.centralLine}/${preset1.mainLine}/${preset1.subLine} taper=${preset1.tapered}`);
ok('switching clears every tapered wedge',
  p1.layout.length > 0 && p1.layout.every((e) => !e.tapered),
  `tapered=${p1.layout.filter((e) => e.tapered).length}`);
const d1 = p1.layout.filter((e) => e.depth === 1);
const d2 = p1.layout.filter((e) => e.depth === 2);
const d3 = p1.layout.filter((e) => e.depth === 3);
ok('root → level 1 follows centralTopic (curve)',
  d1.length > 0 && d1.every((e) => e.path.includes('C')),
  d1[0]?.path);
ok('level 1 → 2 follows mainTopic (roundedElbow)',
  d2.length > 0 && d2.every((e) => e.path.includes('Q')),
  d2[0]?.path);
ok('level 2 → 3 follows subTopic (roundedElbow)',
  d3.length > 0 && d3.every((e) => e.path.includes('Q')),
  d3[0]?.path);
ok('level 2+ connectors actually changed',
  d2.length > 0 && d2.every((e, i) => before.filter((b) => b.depth === 2)[i]?.path !== e.path),
  `${before.filter((b) => b.depth === 2)[0]?.path?.slice(0, 30)} → ${d2[0]?.path?.slice(0, 30)}`);
const nodesAfter1 = await invoke('doc_layout');
const deepStyle = nodesAfter1.nodes.find((n) => n.depth === 3)?.style;
ok('subTopic layer is written to level 3 topics',
  /roundedElbow$/.test(deepStyle?.lineClass ?? ''),
  deepStyle?.lineClass);

// Mind Map #5: straight elbow (no rounded knees) — must differ from #1.
const p5 = await pick(4);
await snap('skeleton-lines-elbow');
const preset5 = presets[4];
ok('preset 5 uses the plain elbow', preset5.mainLine === 'elbow', preset5.mainLine);
const d2b = p5.layout.filter((e) => e.depth === 2);
ok('plain elbow has no quadratic knee',
  d2b.length > 0 && d2b.every((e) => !e.path.includes('Q') && !e.path.includes('C')),
  d2b[0]?.path);
ok('switching presets changes level 2+ geometry again',
  d2b.length > 0 && d2b.every((e, i) => d2[i]?.path !== e.path),
  `${d2[0]?.path?.slice(0, 28)} → ${d2b[0]?.path?.slice(0, 28)}`);

// Mind Map #4: fold lines at every layer.
const p4 = await pick(3);
await snap('skeleton-lines-fold');
ok('preset 4 uses fold lines', presets[3].mainLine === 'fold', presets[3].mainLine);
const d2c = p4.layout.filter((e) => e.depth === 2);
ok('fold geometry is a polyline, not the old curve',
  d2c.length > 0 && d2c.every((e) => !e.path.includes('Q') && e.path.split('L').length >= 3),
  d2c[0]?.path);

// Mind Map #2: tapered + bight. The wedge must come back with an arc spine.
const p2 = await pick(1);
ok('preset 2 is tapered with bight branches',
  presets[1].tapered === 'tapered' && presets[1].mainLine === 'bight',
  `${presets[1].tapered}/${presets[1].mainLine}`);
ok('tapered switch returns', p2.layout.some((e) => e.tapered),
  `tapered=${p2.layout.filter((e) => e.tapered).length}`);

// Dismiss the board so the final shot shows the whole map.
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', {
    type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
}
await wait(300);
await snap('skeleton-lines-final');
writeFileSync(`${OUT}/skeleton-lines-report.json`, JSON.stringify({
  failures, total: results.length, results,
  baseline: before.slice(0, 3).map((e) => ({ depth: e.depth, tapered: e.tapered, path: e.path.slice(0, 60) })),
}, null, 2));
console.log(`${results.length - failures}/${results.length} assertions passed`);
for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL ${r.name} — ${r.detail}`);
ws.close();
if (failures) process.exit(1);
