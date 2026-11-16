// End-to-end regression for the four official-resource follow-ups
// (research/FINDINGS.md §29).  Run against an isolated app on CDP 9223:
//
//   node scripts/ui-official-resources.mjs
//
// Writes target/verify/official-resources/report.json and an embedded-font SVG.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const OUT = resolve('target/verify/official-resources');
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
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(150);
};
const menuCentre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const rows = [...document.querySelectorAll('.xm-item')]
    .filter((el) => el.offsetParent !== null && !el.disabled);
  const label = (el) => (el.querySelector('.xm-label')?.textContent ?? '').trim();
  const hit = rows.find((el) => label(el) === want) ?? rows.find((el) => label(el).includes(want));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});
await wait(350);

/* ------------------------------------------------ 1. bundled fonts -------- */
const fonts = await ev(`(async () => {
  // @font-face rules are lazy: explicitly load the ones no topic currently
  // uses before checking them, otherwise document.fonts.check() is false.
  await Promise.all([
    document.fonts.load('700 28px Montserrat'),
    document.fonts.load('400 14px NeverMind'),
    document.fonts.load('400 14px NeverMindHand'),
    document.fonts.load('400 14px "NeverMind Condensed"'),
  ]);
  const node = document.querySelector('.node');
  return {
    montserrat: document.fonts.check('700 28px Montserrat'),
    nevermind: document.fonts.check('400 14px NeverMind'),
    hand: document.fonts.check('400 14px NeverMindHand'),
    condensed: document.fonts.check('400 14px "NeverMind Condensed"'),
    computed: node ? getComputedStyle(node).fontFamily : '',
    faces: [...document.fonts].map((f) => f.family),
  };
})()`);
ok('Montserrat 已在 WebView 加载', fonts.montserrat, fonts.faces.join(','));
ok('NeverMind 已在 WebView 加载', fonts.nevermind, fonts.faces.join(','));
ok('NeverMindHand / Condensed 已在 WebView 加载', fonts.hand && fonts.condensed,
  `hand=${fonts.hand} condensed=${fonts.condensed}`);
ok('.node 使用官方字体栈',
  /Montserrat/.test(fonts.computed) && /NeverMind/.test(fonts.computed)
    && /Microsoft YaHei/.test(fonts.computed) && /PingFang SC/.test(fonts.computed),
  fonts.computed);
const fontAsset = await ev(`fetch('/fonts/Montserrat-latin.woff2').then(async (r) => ({
  ok: r.ok, size: (await r.arrayBuffer()).byteLength,
}))`);
ok('静态字体资源可访问', fontAsset.ok && fontAsset.size > 10000, `${fontAsset.size} bytes`);

/* ------------------------------------------------ clean document ----------- */
const resetDocument = async () => {
  await esc();
  await clickAt(120, 475);
  await wait(220);
  const burger = await ev(`(() => {
    const el = document.querySelector('.menu-btn');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await clickAt(burger.x, burger.y);
  await wait(260);
  for (const label of ['文件', '新建']) {
    const at = await menuCentre(label);
    if (!at) throw new Error(`menu item not found: ${label}`);
    await move(at.x, at.y);
    await wait(200);
    if (label === '新建') await clickAt(at.x, at.y);
  }
  await wait(900);
  await esc();
  await clickAt(120, 475);
  await wait(250);
};
await resetDocument();
let layout = await invoke('doc_layout');
const root = layout.nodes.find((n) => !n.parentId);
const children = layout.nodes.filter((n) => n.parentId === root.id);
ok('干净 5 主题文档', layout.nodes.length === 5, `${layout.nodes.length} nodes`);

/* ------------------------------------------------ 2. widths / font stack -- */
await invoke('doc_set_style', {
  id: root.id, style: { lineWidth: '3pt', fontFamily: 'Montserrat' },
});
layout = await invoke('doc_layout');
let rootNode = layout.nodes.find((n) => n.id === root.id);
ok('3pt 线宽按官方语义为 3px（不做 4/3 换算）', rootNode.style.lineWidth === 3,
  String(rootNode.style.lineWidth));
ok('edge 继承父层线宽', layout.edges.every((e) => e.width === 3),
  [...new Set(layout.edges.map((e) => e.width))].join(','));
ok('用户字族也补齐 CJK 回退', /Microsoft YaHei/.test(rootNode.style.fontFamily ?? ''),
  rootNode.style.fontFamily);

/* ------------------------------------------------ 3. arrows + dashes ------ */
await invoke('doc_set_style', {
  id: root.id,
  style: { linePattern: 'dash-dot-dot', lineTapered: false },
});
for (const child of children) {
  await invoke('doc_set_style', {
    id: child.id, style: { arrowEnd: 'org.xmind.arrowShape.ring' },
  });
}
await wait(260);
layout = await invoke('doc_layout');
ok('dash-dot-dot 传到 edge', layout.edges.every((e) => e.dash === 'dash-dot-dot'),
  [...new Set(layout.edges.map((e) => e.dash))].join(','));
ok('ring 箭头传到 edge', layout.edges.every((e) => e.arrow === 'ring'),
  [...new Set(layout.edges.map((e) => e.arrow))].join(','));
const arrowDom = await ev(`(() => {
  const path = document.querySelector('.edges path[marker-end]');
  return {
    marker: Boolean(path),
    def: Boolean(document.querySelector('#arrow-ring')),
    dash: path?.getAttribute('stroke-dasharray') ?? '',
  };
})()`);
ok('画布渲染 ring marker', arrowDom.marker && arrowDom.def, JSON.stringify(arrowDom));
ok('画布 dash-dot-dot 为 6 3 1.5 3 1.5 3', arrowDom.dash === '6 3 1.5 3 1.5 3', arrowDom.dash);

await invoke('doc_set_style', { id: root.id, style: { linePattern: 'round-dot' } });
await wait(220);
layout = await invoke('doc_layout');
const roundDom = await ev(`document.querySelector('.edges path[stroke-dasharray]')?.getAttribute('stroke-dasharray') ?? ''`);
ok('round-dot 使用圆点 dash', layout.edges.every((e) => e.dash === 'round-dot') && roundDom === '0 4',
  `${layout.edges[0]?.dash} / ${roundDom}`);

/* ------------------------------------------------ 4. structural classes --- */
// arrowedCurve supplies its own arrow head, so clear the child-level arrows
// from the previous section first.
for (const child of children) {
  await invoke('doc_set_style', {
    id: child.id, style: { arrowEnd: 'org.xmind.arrowShape.none' },
  });
}
const setClass = async (name) => {
  await invoke('doc_set_style', {
    id: root.id,
    style: { lineClass: `org.xmind.branchConnection.${name}`, linePattern: 'solid' },
  });
  await wait(120);
  return invoke('doc_layout');
};
const brace = await setClass('brace');
const brace3 = await setClass('brace3');
const matrix = await setClass('matrix');
const timeline = await setClass('timeline');
const arrowed = await setClass('arrowedCurve');
const none = await setClass('none');
ok('brace / brace3 几何不同', brace.edges[0]?.path !== brace3.edges[0]?.path,
  `${brace.edges[0]?.path?.slice(0, 40)} vs ${brace3.edges[0]?.path?.slice(0, 40)}`);
ok('matrix / timeline 画折线骨架',
  matrix.edges.every((e) => e.path.includes(' L '))
    && timeline.edges.every((e) => e.path.includes(' L ')),
  `${matrix.edges[0]?.path?.slice(0, 40)} | ${timeline.edges[0]?.path?.slice(0, 40)}`);
ok('arrowedCurve 自带三角箭头', arrowed.edges.every((e) => e.arrow === 'triangle'),
  arrowed.edges[0]?.arrow);
ok('arrowedCurve 保留三次曲线', arrowed.edges[0]?.path.includes('C'), arrowed.edges[0]?.path?.slice(0, 50));
ok('none 不画连线', none.edges.length === 0, `${none.edges.length} edges`);

/* ------------------------------------------------ SVG font embedding ------ */
await invoke('doc_set_style', {
  id: root.id,
  style: { lineClass: 'org.xmind.branchConnection.curve', lineTapered: true },
});
await invoke('doc_set_style', {
  id: children[0].id, style: { arrowEnd: 'org.xmind.arrowShape.triangle' },
});
await wait(150);
const svgPath = resolve(OUT, 'embedded.svg');
rmSync(svgPath, { force: true });
await esc();
await ev(`window.__XM_SAVE_PATH__ = ${JSON.stringify(svgPath)}`);
const nodeAt = await ev(`(() => {
  const el = [...document.querySelectorAll('.node')].find((n) => (n.textContent ?? '').includes('中心主题'))
    ?? document.querySelector('.node');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
await clickAt(nodeAt.x, nodeAt.y);
await wait(150);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nodeAt.x, y: nodeAt.y, button: 'right', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nodeAt.x, y: nodeAt.y, button: 'right', clickCount: 1 });
await wait(320);
const parentRow = await menuCentre('导出分支为');
if (parentRow) {
  await move(parentRow.x, parentRow.y);
  await wait(380);
  const svgRow = await menuCentre('SVG...');
  if (svgRow) {
    await move(svgRow.x, svgRow.y);
    await wait(160);
    await clickAt(svgRow.x, svgRow.y);
  }
}
for (let i = 0; i < 12 && !existsSync(svgPath); i += 1) await wait(250);
await ev('delete window.__XM_SAVE_PATH__');
let svgText = '';
if (existsSync(svgPath)) svgText = readFileSync(svgPath, 'utf8');
ok('SVG 菜单导出已落地', svgText.length > 1000, `${svgText.length} bytes`);
ok('SVG 内嵌 woff2 字体', svgText.includes('data:font/woff2;base64,'),
  `${(svgText.match(/data:font\/woff2;base64,/g) ?? []).length} faces`);
ok('SVG 带官方字体栈', svgText.includes('NeverMind') && svgText.includes('Microsoft YaHei'));
ok('SVG 带箭头 marker defs', svgText.includes('<marker id="arrow-'),
  `${(svgText.match(/<marker id="arrow-/g) ?? []).length} markers`);

/* ------------------------------------------------ report ------------------ */
const failed = checks.filter((c) => !c.pass);
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ checks, failed: failed.length }, null, 2));
console.log(`官方资源 4 项回归：${checks.length - failed.length}/${checks.length} 通过`);
for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
ws.close();
if (failed.length) process.exit(1);
