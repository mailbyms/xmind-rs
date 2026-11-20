// Regression: every 折叠/展开 disc must sit at the START of the topic's first
// branch, never on top of the topic.  The old |dx| vs |dy| heuristic broke on
// tall 贴纸 cards and 下划线 topics (their children sit far above the anchor),
// so e.g. 「演示/展示」 in example.xmind showed its disc above the sticker.
//
//   CDP_PORT=9230 node scripts/check-fold-anchor.mjs [--horizontal-only]
//   CDP_PORT=9230 node scripts/check-fold-anchor.mjs --vertical=down
//
// Requires the app on CDP with the document already open.  `--horizontal-only`
// forbids vertical discs (correct for 思维导图 / 逻辑图 layouts);
// `--vertical=down|up` asserts every disc grows in that direction.
const PORT = process.env.CDP_PORT || 9223;
const horizontalOnly = process.argv.includes('--horizontal-only');
// `--vertical=down` / `--vertical=up` asserts every disc grows that way.
const expectVertical = (process.argv.find((a) => a.startsWith('--vertical=')) || '').split('=')[1];

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

const rows = await ev(`(() => [...document.querySelectorAll('.node')].map((n) => {
  const b = n.querySelector('.fold-badge');
  if (!b) return null;
  const s = n.style, bs = b.style;
  return {
    title: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 24),
    image: n.classList.contains('has-image'),
    underline: n.classList.contains('underline'),
    w: parseFloat(s.width), h: parseFloat(s.height),
    left: parseFloat(bs.left), top: parseFloat(bs.top),
  };
}).filter(Boolean))()`);

if (!rows.length) throw new Error('no topics with a fold disc found');

// Inline left/top are computed in MapCanvas as:
//   left = fold.x - node.x + (h ? dir*12 : 0) - 8
//   top  = fold.y - node.y + (v ? dir*12 : 0) - 8
// with the horizontal Y taken from branchAnchorY (box centre, or box bottom
// for 下划线 / 双下划线).
const EPS = 1.6;
let failures = 0;
const summary = { 'h+': 0, 'h-': 0, 'v+': 0, 'v-': 0 };
const stickers = [];
for (const r of rows) {
  const horizY = r.underline ? r.h - 8 : r.h / 2 - 8;
  const cases = [
    { axis: 'h+', left: r.w + 4, top: horizY },
    { axis: 'h-', left: -20, top: horizY },
    { axis: 'v+', left: r.w / 2 - 8, top: r.h + 4 },
    { axis: 'v-', left: r.w / 2 - 8, top: -20 },
  ];
  const hit = cases.find((c) => Math.abs(c.left - r.left) <= EPS && Math.abs(c.top - r.top) <= EPS);
  if (!hit) {
    failures += 1;
    console.log('FAIL    ', JSON.stringify(r), 'expected one of', JSON.stringify(cases));
    continue;
  }
  summary[hit.axis] += 1;
  if (r.image) stickers.push({ title: r.title, axis: hit.axis, left: r.left, top: r.top });
  if (horizontalOnly && hit.axis.startsWith('v')) {
    failures += 1;
    console.log('FAIL    ', JSON.stringify(r), `vertical disc (${hit.axis}) on a horizontal layout`);
  }
  if (expectVertical && hit.axis !== (expectVertical === 'up' ? 'v-' : 'v+')) {
    failures += 1;
    console.log('FAIL    ', JSON.stringify(r), `expected vertical-${expectVertical}, got ${hit.axis}`);
  }
}

console.log('topics  ', rows.length);
console.log('anchors ', JSON.stringify(summary));
console.log('stickers', JSON.stringify(stickers, null, 1));
ws.close();
if (failures) throw new Error(`${failures} fold disc(s) off their branch anchor`);
console.log('ALL PASS');
