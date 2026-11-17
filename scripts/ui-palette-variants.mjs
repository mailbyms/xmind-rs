// Regression for FINDINGS §39: the six cards under 画布 > 配色方案 belong to
// whichever scheme the drop-down shows.  Choosing a different scheme must
// replace all six, and picking a card must persist its index.
//
//   node scripts/new-doc.mjs && node scripts/ui-palette-variants.mjs
//
// Writes target/verify/palette-variants-report.json, exits non-zero on failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const OUT = resolve('target/verify');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The WebView can lag a busy backend by several seconds; poll the DOM state
 *  instead of assuming one fixed delay is enough on a cold machine. */
const waitFor = async (expression, label, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await ev(expression)) return;
    await wait(250);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail: String(detail) });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});

const doc = async () => {
  const path = resolve(OUT, 'palette-variants-doc.json').replace(/\\/g, '/');
  await invoke('doc_export', { path, format: 'json' });
  return JSON.parse(readFileSync(path, 'utf8'));
};
const strip = () => ev(`(() => {
  const grid = document.querySelector('.fp-bone-grid[data-scheme]');
  if (!grid) return null;
  const cards = [...grid.querySelectorAll('.fp-bone-card')];
  return {
    scheme: grid.getAttribute('data-scheme'),
    count: cards.length,
    active: cards.findIndex((c) => c.classList.contains('on')),
    titles: cards.map((c) => c.getAttribute('title') || ''),
    srcs: cards.map((c) => c.querySelector('img')?.getAttribute('src') || ''),
    variants: cards.map((c) => c.getAttribute('data-variant')),
  };
})()`);

// ------------------------------------------------------------------ 0. panel
if (!(await ev('!!document.querySelector(".fp")'))) {
  await ev(`(() => {
    const b = [...document.querySelectorAll('.toolbar .tool-item')].find((i) =>
      (i.querySelector('.tool-label')?.textContent ?? '').trim() === '格式');
    b?.querySelector('button')?.click(); return 1;
  })()`);
  await wait(900);
}
await ev(`(() => { [...document.querySelectorAll('.fp-tabs button')]
  .find((b) => b.textContent.trim() === '画布')?.click(); return 1; })()`);
await wait(400);
ok('侧面板「画布」tab 已打开', await ev('!!document.querySelector(".fp-palette")'));

const initial = await strip();
ok('配色方案下方有 6 张卡片', initial?.count === 6, JSON.stringify(initial?.count));
ok('卡片带方案 id（默认彩虹）', initial?.scheme === 'vivid-rainbow', initial?.scheme);
ok('6 张卡片都归属该方案', initial?.srcs.every((s) => s.includes('vivid-rainbow')),
  initial?.srcs.join(' '));
ok('卡片编号 0..5', initial?.variants.join(',') === '0,1,2,3,4,5', initial?.variants.join(','));
ok('默认选中第 1 张', initial?.active === 0, initial?.active);

// ------------------------------------------------- 1. drop-down: 缤纷 > 活力
await ev('document.querySelector(".fp-palette")?.click()');
await wait(900);
ok('下拉打开配色方案画廊', await ev('!!document.querySelector(".pal-board")'));
const energyPicked = await ev(`(() => {
  const g = [...document.querySelectorAll('.pal-group')]
    .find((e) => (e.querySelector('.pal-name')?.textContent ?? '').trim() === '活力');
  g?.querySelector('.pal-cell')?.click(); return !!g;
})()`);
await waitFor("document.querySelector('.fp-bone-grid')?.getAttribute('data-scheme') === 'vivid-energy'", '活力方案卡片');
ok('画廊里能选「活力」', energyPicked);
const afterEnergy = await strip();
const docEnergy = await doc();
ok('方案写入 document.palette', docEnergy.palette === 'vivid-energy', docEnergy.palette);
ok('6 张卡片切换到「活力」', afterEnergy?.scheme === 'vivid-energy', afterEnergy?.scheme);
ok('切换后仍是 6 张', afterEnergy?.count === 6, afterEnergy?.count);
ok('6 张缩略图全部换掉', afterEnergy?.srcs.every((s) => s.includes('vivid-energy'))
  && afterEnergy.srcs.join('|') !== initial.srcs.join('|'), afterEnergy?.srcs.join(' '));
ok('卡片标题跟随方案名', afterEnergy?.titles.every((t) => t.startsWith('活力')),
  afterEnergy?.titles.join('/'));
ok('第 1 张是方案整图', afterEnergy?.srcs[0].includes('/tiles/palettes/vivid-energy.svg'),
  afterEnergy?.srcs[0]);
ok('第 2..6 张是单色方案',
  afterEnergy?.srcs.slice(1).every((s, i) => s.includes(`/tiles/palette-variants/vivid-energy-${i + 1}.svg`)),
  afterEnergy?.srcs.slice(1).join(' '));
ok('选方案后重置到第 1 张', afterEnergy?.active === 0, afterEnergy?.active);

// ------------------------------------------------- 2. drop-down: 经典 > 永恒
await ev(`(() => { [...document.querySelectorAll('.pal-tabs button')]
  .find((b) => b.textContent.trim() === '经典')?.click(); return 1; })()`);
await waitFor("[...document.querySelectorAll('.pal-tabs button')].some((b) => b.textContent.trim() === '经典' && b.classList.contains('on'))", '经典 tab');
const classicPicked = await ev(`(() => {
  const g = [...document.querySelectorAll('.pal-group')]
    .find((e) => (e.querySelector('.pal-name')?.textContent ?? '').trim() === '永恒');
  g?.querySelector('.pal-cell')?.click(); return !!g;
})()`);
await waitFor("document.querySelector('.fp-bone-grid')?.getAttribute('data-scheme') === 'classic-classic'", '永恒方案卡片');
ok('经典 tab 里能选「永恒」', classicPicked);
const afterClassic = await strip();
ok('6 张卡片切换到「永恒」', afterClassic?.scheme === 'classic-classic', afterClassic?.scheme);
ok('经典方案的缩略图也全部换掉',
  afterClassic?.srcs.every((s) => s.includes('classic-classic'))
  && afterClassic.srcs.join('|') !== afterEnergy.srcs.join('|'));
ok('经典方案标题跟随', afterClassic?.titles.every((t) => t.startsWith('永恒')),
  afterClassic?.titles.join('/'));

// ---------------------------------------------------------- 3. pick card #3
await ev('document.querySelector(\'.fp-bone-card[data-variant="2"]\')?.click()');
await waitFor("document.querySelector('.fp-bone-card[data-variant=\"2\"]')?.classList.contains('on') === true", '第 3 张卡片选中态');
const afterPick = await strip();
const docPick = await doc();
ok('点第 3 张后选中态移动', afterPick?.active === 2, afterPick?.active);
ok('选中的方案索引写进 document', docPick.paletteVariant === 2, docPick.paletteVariant);
ok('配色方案名不变（仍是永恒）', docPick.palette === 'classic-classic', docPick.palette);
ok('单色方案的中心色 = 第 3 个色板',
  String(docPick.centerColor).toUpperCase() === '#C0CA33', docPick.centerColor);
ok('单色方案的分支色是 6 个不同色',
  Array.isArray(docPick.branchColors) && docPick.branchColors.length === 6
  && new Set(docPick.branchColors.map((c) => c.toUpperCase())).size === 6,
  JSON.stringify(docPick.branchColors));

// ------------------------------------------------------ 4. switch back resets
await ev(`(() => { [...document.querySelectorAll('.pal-tabs button')]
  .find((b) => b.textContent.trim() === '缤纷')?.click(); return 1; })()`);
await waitFor("[...document.querySelectorAll('.pal-tabs button')].some((b) => b.textContent.trim() === '缤纷' && b.classList.contains('on'))", '缤纷 tab');
await ev(`(() => {
  const g = [...document.querySelectorAll('.pal-group')]
    .find((e) => (e.querySelector('.pal-name')?.textContent ?? '').trim() === '彩虹');
  g?.querySelector('.pal-cell')?.click(); return 1;
})()`);
await waitFor("document.querySelector('.fp-bone-grid')?.getAttribute('data-scheme') === 'vivid-rainbow' && document.querySelector('.fp-bone-card[data-variant=\"0\"]')?.classList.contains('on') === true", '彩虹方案卡片');
const afterRainbow = await strip();
const docRainbow = await doc();
ok('切回「彩虹」后 6 张卡片全部回归', afterRainbow?.scheme === 'vivid-rainbow'
  && afterRainbow?.srcs.every((s) => s.includes('vivid-rainbow')), afterRainbow?.scheme);
ok('换方案后方案索引重置为 0', afterRainbow?.active === 0 && docRainbow.paletteVariant === 0,
  `${afterRainbow?.active}/${docRainbow.paletteVariant}`);
ok('卡片数量在整个流程恒为 6', [initial, afterEnergy, afterClassic, afterPick, afterRainbow]
  .every((s) => s?.count === 6));

// ------------------------------------------------------ 5. save/reopen
await ev(`(() => { [...document.querySelectorAll('.pal-tabs button')]
  .find((b) => b.textContent.trim() === '经典')?.click(); return 1; })()`);
await waitFor("[...document.querySelectorAll('.pal-tabs button')].some((b) => b.textContent.trim() === '经典' && b.classList.contains('on'))", '经典 tab（第二轮）');
await ev(`(() => {
  const g = [...document.querySelectorAll('.pal-group')]
    .find((e) => (e.querySelector('.pal-name')?.textContent ?? '').trim() === '永恒');
  g?.querySelector('.pal-cell')?.click(); return 1;
})()`);
await waitFor("document.querySelector('.fp-bone-grid')?.getAttribute('data-scheme') === 'classic-classic'", '永恒方案卡片（第二轮）');
await ev('document.querySelector(\'.fp-bone-card[data-variant="2"]\')?.click()');
await waitFor("document.querySelector('.fp-bone-card[data-variant=\"2\"]')?.classList.contains('on') === true", '第 3 张卡片选中态（第二轮）');
const roundtripPath = resolve(OUT, 'palette-variants-roundtrip.xmind').replace(/\\/g, '/');
await invoke('doc_export', { path: roundtripPath, format: 'xmind' });
await invoke('doc_open', { path: roundtripPath });
await wait(600);
const docReopened = await doc();
ok('存盘重开后配色方案名保持', docReopened.palette === 'classic-classic', docReopened.palette);
ok('存盘重开后选中的方案索引保持', docReopened.paletteVariant === 2, docReopened.paletteVariant);
ok('存盘重开后单色中心色保持',
  String(docReopened.centerColor).toUpperCase() === '#C0CA33', docReopened.centerColor);

const report = { port: PORT, checks, initial, afterEnergy, afterClassic, afterPick, afterRainbow,
  docReopened: { palette: docReopened.palette, paletteVariant: docReopened.paletteVariant } };
writeFileSync(resolve(OUT, 'palette-variants-report.json'), JSON.stringify(report, null, 1));
const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
ws.close();
if (failed.length) process.exit(1);
