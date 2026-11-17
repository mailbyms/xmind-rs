// Regression for FINDINGS §26 option A: a real `sheet.theme` must reach both
// the Rust layout and the WebView DOM.  Run after `open-sample.mjs
// example.xmind` on CDP 9223:
//
//   node scripts/open-sample.mjs example.xmind
//   node scripts/ui-theme-style.mjs
//
// Writes target/verify/theme-style-report.json and exits non-zero on failure.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const layout = await invoke('doc_layout');
const root = layout.nodes.find((n) => n.depth === 0);
const mains = layout.nodes.filter((n) => n.depth === 1);
const subs = layout.nodes.filter((n) => n.depth === 2);

ok('example.xmind is open', layout.nodes.length > 50, `${layout.nodes.length} nodes`);
ok('sheet.theme reached the layout', layout.theme.sheetTheme?.hasTheme === true,
  JSON.stringify(layout.theme.sheetTheme?.map ?? {}));
ok('map canvas colour', layout.theme.bg.toLowerCase() === '#f7f7fa', layout.theme.bg);
ok('branch cycle comes from multi-line-colors', layout.theme.branches[0].toLowerCase() === '#f04137',
  layout.theme.branches.join(' '));
ok('central topic is a white plate', root?.style.fill === '#FFFFFF', root?.style.fill);
ok('central ink is the theme black', root?.style.color === '#000000', root?.style.color);
ok('central weight follows the theme', root?.style.fontWeight === 700, String(root?.style.fontWeight));
// example.xmind sets `fo:font-size: 36pt` on the root topic itself.  The
// user layer sits *above* the theme in the official cascade, so 36 must win.
ok('explicit topic font-size still beats the theme', root?.style.fontSize === 36,
  `${root?.style.fontSize} (theme says 28pt)`);
ok('theme font family keeps a CJK fallback',
  /Montserrat/.test(root?.style.fontFamily ?? '') && /sans-serif/.test(root?.style.fontFamily ?? ''),
  root?.style.fontFamily);

ok('every main topic drops its plate', mains.length > 0 && mains.every((n) => n.style.fill === 'none'),
  `${mains.length} mains, fills=${[...new Set(mains.map((n) => n.style.fill))].join(',')}`);
ok('every main topic is an underline shape',
  mains.every((n) => n.style.underline && n.style.shape === 'underline' && !n.shapeClosed));
ok('main ink is the theme navy', mains.every((n) => n.style.color.toLowerCase() === '#091c34'),
  mains[0]?.style.color);
ok('main rule uses the branch hue',
  mains.every((n) => n.style.underlineColor === layout.theme.branches[n.branch % layout.theme.branches.length]),
  mains[0]?.style.underlineColor);
ok('main rule width follows border-line-width', mains.every((n) => n.style.underlineWidth === 2),
  String(mains[0]?.style.underlineWidth));
ok('the SVG outline does not draw a second rule', mains.every((n) => n.style.stroke === 'none'));
ok('sub topics inherit defaultStyles underline',
  subs.length > 0 && subs.every((n) => n.style.underline && n.style.shape === 'underline'),
  `${subs.length} subs`);
ok('line-tapered survives', layout.edges.some((e) => e.tapered));

const dom = await ev(`(() => {
  const nodes = [...document.querySelectorAll('.node')];
  const underlined = nodes.filter((n) => n.classList.contains('underline'));
  const first = underlined[0];
  const title = first?.querySelector('.node-title');
  const path = first?.querySelector('.node-shape path');
  // The rule is a box-bottom, full-width ::after stroke (FINDINGS §40), not
  // a border-bottom on the label: a label-width rule cannot meet the branch.
  const cs = first ? getComputedStyle(first, '::after') : null;
  return {
    nodes: nodes.length,
    underlined: underlined.length,
    ruleColor: cs?.backgroundColor ?? null,
    ruleHeight: cs?.height ?? null,
    ruleLeft: cs?.left ?? null,
    ruleRight: cs?.right ?? null,
    ruleBottom: cs?.bottom ?? null,
    ruleTransform: cs?.transform ?? null,
    titleBorder: title ? getComputedStyle(title).borderBottomStyle : null,
    pathFill: path?.getAttribute('fill') ?? null,
    pathStroke: path?.getAttribute('stroke') ?? null,
    canvasBg: getComputedStyle(document.querySelector('.canvas')).backgroundColor,
  };
})()`);

ok('DOM marks underline topics', dom.underlined > 10, `${dom.underlined}/${dom.nodes}`);
ok('DOM rule has a real colour', /^rgb\(/.test(dom.ruleColor ?? '') && dom.ruleColor !== 'rgba(0, 0, 0, 0)',
  String(dom.ruleColor));
ok('DOM rule width matches the theme', ['1.5px', '2px'].includes(dom.ruleHeight), String(dom.ruleHeight));
ok('DOM rule spans the whole box bottom',
  dom.ruleLeft === '0px' && dom.ruleRight === '0px' && dom.ruleBottom === '0px'
    && /matrix/.test(dom.ruleTransform ?? ''),
  `left=${dom.ruleLeft} right=${dom.ruleRight} bottom=${dom.ruleBottom} transform=${dom.ruleTransform}`);
ok('DOM label draws no second rule', dom.titleBorder === 'none', String(dom.titleBorder));
ok('DOM outline is not filled', dom.pathFill === 'none' && dom.pathStroke === 'none',
  `${dom.pathFill} / ${dom.pathStroke}`);
ok('DOM canvas uses the theme background', dom.canvasBg === 'rgb(247, 247, 250)', String(dom.canvasBg));

writeFileSync(resolve('target/verify/theme-style-report.json'), JSON.stringify({ checks, dom, summary: {
  nodes: layout.nodes.length, mains: mains.length, subs: subs.length,
  bg: layout.theme.bg, branches: layout.theme.branches,
} }, null, 2));

for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} assertions passed`);
ws.close();
if (failed.length) process.exit(1);
