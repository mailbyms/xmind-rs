// Regression guard for the test.xmind render alignment + in-topic interactions
// (FINDINGS §46 / §47 / §48).
// Run against an isolated app instance that has test.xmind open:
//   CDP_PORT=9230 node scripts/ui-render-align.mjs
// Static reference numbers come from the shipped XMind 23.07 DOM at
// 1280x820 / 100% (scripts/probe-orig-geom.mjs / probe-orig-interact.mjs).
// NOTE: test.xmind's central topic now carries FOUR markers, so the central
// box is 324 wide (one-marker builds of this fixture measured 228 / 230).
const PORT = process.env.CDP_PORT || 9230;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener('open', r));

const checks = [];
const check = (name, actual, expected, tolerance = 0) => {
  const ok = tolerance
    ? Math.abs(Number(actual) - Number(expected)) <= tolerance
    : String(actual) === String(expected);
  checks.push({ name, actual, expected, ok });
};

const layout = JSON.parse(await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => JSON.stringify({ bg: l.theme.bg, nodes: l.nodes.map(n => ({ t: n.title, x: n.x, y: n.y, w: n.width, h: n.height, iw: n.imageWidth, ih: n.imageHeight, align: n.style.align, markerSize: n.markerSize, markerPad: n.markerPad })) }))`));
const dom = JSON.parse(await ev(`JSON.stringify({
  bg: getComputedStyle(document.querySelector('.canvas')).backgroundColor,
  images: [...document.querySelectorAll('.node-image')].map(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]),
  notes: document.querySelectorAll('.node-note').length,
  labels: document.querySelectorAll('.label-chip').length,
  markerIcons: [...document.querySelectorAll('.marker-chip img')].map(e => Math.round(e.getBoundingClientRect().width)),
  markerChips: document.querySelectorAll('.marker-chip[data-marker-id]').length,
  central: (() => {
    const n = [...document.querySelectorAll('.node')].find(e => e.querySelector('.node-title')?.textContent?.trim() === '中心主题');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const chips = [...n.querySelectorAll('.marker-chip')].map(c => c.getBoundingClientRect());
    const title = n.querySelector('.node-title').getBoundingClientRect();
    return {
      w: Math.round(r.width), padL: getComputedStyle(n).paddingLeft, padR: getComputedStyle(n).paddingRight,
      firstMarkerX: Math.round(chips[0].x - r.x),
      lastMarkerRight: Math.round(chips[chips.length - 1].right - r.x),
      titleX: Math.round(title.x - r.x),
      titleRightGap: Math.round(r.right - title.right),
      titleAlign: getComputedStyle(n.querySelector('.node-title')).textAlign,
      cursor: getComputedStyle(chips[0] ? n.querySelector('.marker-chip') : n).cursor,
    };
  })(),
  branchAlign: [...document.querySelectorAll('.node')]
    .map(n => ({ t: n.querySelector('.node-title')?.textContent?.trim(), ta: getComputedStyle(n.querySelector('.node-title') ?? n).textAlign }))
    .filter(n => n.t === '分支主题 1' || n.t === '分支主题 2').map(n => n.ta),
})`));

const by = (t) => layout.nodes.find((n) => n.t === t);
const cy = (n) => n.y + n.h / 2;
const root = by('中心主题');
const b1 = by('分支主题 1');
const b2 = by('分支主题 2');
const b3 = by('分支主题 3');
const b4 = by('分支主题 4');

// §46: canvas, topic boxes, image cards, note buttons, labels.
check('canvas background (layout)', layout.bg, '#f4f8f2');
check('canvas background (DOM)', dom.bg, 'rgb(244, 248, 242)');
check('central topic width (4 markers)', Math.round(root.w), 324, 3);
check('central topic height', Math.round(root.h), 70, 2);
check('branch 1 width', Math.round(b1.w), 150, 4);
check('branch 1 height', Math.round(b1.h), 46, 4);
check('140px image card width', Math.round(b3.w), 178, 3);
check('140px image card height', Math.round(b3.h), 198, 3);
check('60px image card width', Math.round(b4.w), 128, 4);
check('60px image card height', Math.round(b4.h), 118, 3);
check('140px artwork measured', b3.iw, 140);
check('60px artwork measured', b4.iw, 60);
check('artwork drawn at intrinsic size', dom.images.length, 2);
check('note buttons inside boxes', dom.notes, 2);
check('label chip', dom.labels, 1);

// §47: 30px markers, left-aligned branch labels, symmetric branch centres.
check('central marker icon size (layout)', root.markerSize, 30);
check('central marker icon size (DOM)', dom.markerIcons[0], 30);
check('branch label alignment (layout)', b1.align, 'left');
check('branch label alignment (DOM)', dom.branchAlign[0], 'left');
check('right branch pitch', Math.round(cy(b2) - cy(b1)), 130, 3);
check('left branch pitch', Math.round(cy(b3) - cy(b4)), 195, 3);
check('right branches centred on root', Math.round((cy(b1) + cy(b2)) / 2 - cy(root)), 0, 2);
check('left branches centred on root', Math.round((cy(b4) + cy(b3)) / 2 - cy(root)), 0, 2);

// §48.1: marker row padding — original measured 34px lead, 15px gap to the
// label, and 29px of content inset on each side of the shape.
check('markerPad from layout', Math.round(root.markerPad), 29);
check('central left content inset (CSS)', dom.central.padL, '29px');
check('central right content inset (CSS)', dom.central.padR, '29px');
check('first marker x from box edge', dom.central.firstMarkerX, 34, 4);
check('marker row to label gap', dom.central.titleX - dom.central.lastMarkerRight, 15, 4);
check('label right inset', dom.central.titleRightGap, 29, 3);
check('marker topic label left-aligned', dom.central.titleAlign, 'left');
check('marker chips are clickable', dom.central.cursor, 'pointer');
check('4 marker chips rendered', dom.markerChips, 4);

// §48.2: clicking a marker opens the same-group popover, replacing works,
// and the trash button removes it (both edits are undone afterwards).
const fire = (selector, type = 'click', init = {}) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e) return false;
  e.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true,
    clientX: 400, clientY: 400, ...${JSON.stringify(init)} }));
  return true;
})()`);
const markerState = () => ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => JSON.stringify(l.nodes.find(n => n.title === '中心主题').markers))`);
// Use the real Ctrl+Z shortcut: calling `doc_undo` over IPC directly would
// leave the React snapshot stale (the shell owns commit()), so the DOM would
// still show the pre-undo marker while the layout already says otherwise.
const undo = async () => {
  await ev(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'z', ctrlKey: true, bubbles: true })); return true; })()`);
  await wait(260);
};

await fire('.marker-chip[data-marker-id="star-red"]');
await wait(180);
const pop = JSON.parse(await ev(`JSON.stringify({
  open: !!document.querySelector('.marker-chip-pop'),
  icons: document.querySelectorAll('.mcp-icon').length,
  trash: !!document.querySelector('[data-marker-delete]'),
  active: document.querySelector('.mcp-icon.on')?.getAttribute('data-marker-id'),
  overlay: !!document.querySelector('.marker-pop-overlay'),
  centreOffset: (() => {
    const p = document.querySelector('.marker-chip-pop')?.getBoundingClientRect();
    const n = [...document.querySelectorAll('.node')]
      .find(e => e.querySelector('.node-title')?.textContent?.trim() === '中心主题')?.getBoundingClientRect();
    return p && n ? Math.round(p.left + p.width / 2 - (n.left + n.width / 2)) : 999;
  })(),
  belowBox: (() => {
    const p = document.querySelector('.marker-chip-pop')?.getBoundingClientRect();
    const n = [...document.querySelectorAll('.node')]
      .find(e => e.querySelector('.node-title')?.textContent?.trim() === '中心主题')?.getBoundingClientRect();
    return p && n ? Math.round(p.top - n.bottom) : -999;
  })(),
})`));
check('marker popover opens', pop.open, true);
check('same-group alternatives (star group)', pop.icons, 7);
check('popover has delete button', pop.trash, true);
check('clicked marker is active', pop.active, 'star-red');
check('popover has overlay', pop.overlay, true);
check('popover centred under topic box', pop.centreOffset, 0, 3);
check('popover sits below the box', pop.belowBox, 16, 4);

await fire('.mcp-icon[data-marker-id="star-blue"]');
await wait(260);
const replaced = JSON.parse(await markerState());
check('replacement applied', replaced.includes('star-blue'), true);
check('old marker gone', replaced.includes('star-red'), false);
check('marker count preserved', replaced.length, 4);
await undo();
await wait(220);

await fire('.marker-chip[data-marker-id="star-red"]');
await wait(200);
await fire('[data-marker-delete]');
await wait(260);
const removed = JSON.parse(await markerState());
check('trash removes the marker', removed.length, 3);
check('correct marker removed', removed.includes('star-red'), false);
await undo();
await wait(220);
const restored = JSON.parse(await markerState());
check('undo restores all markers', restored.length, 4);

// §48.3: artwork is a separate selectable object with its own context menu.
await fire('.node.has-image .node-image');
await wait(180);
const imageSel = JSON.parse(await ev(`JSON.stringify({
  selected: document.querySelectorAll('.node-image.selected').length,
  handles: document.querySelectorAll('.image-handle').length,
  outline: getComputedStyle(document.querySelector('.node-image.selected') ?? document.body).outlineColor,
})`));
check('artwork selected independently', imageSel.selected, 1);
check('four resize handles', imageSel.handles, 4);
check('blue selection outline', imageSel.outline, 'rgb(46, 189, 255)');

await fire('.node.has-image .node-image', 'contextmenu');
await wait(180);
const menu = JSON.parse(await ev(`JSON.stringify({
  text: [...document.querySelectorAll('.xm-panel')].map(e => e.innerText).join(' | '),
  panels: document.querySelectorAll('.xm-panel').length,
})`));
check('image context menu opens', menu.panels, 1);
check('menu has 替换图片', menu.text.includes('替换图片'), true);
check('menu has 删除图片', menu.text.includes('删除图片'), true);
await ev(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown',
  { key: 'Escape', bubbles: true })); return true; })()`);
await wait(120);

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.actual} (want ${c.expected})`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `${failed} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
ws.close();
process.exit(failed ? 1 : 0);
