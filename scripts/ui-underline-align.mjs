// Regression for FINDINGS §40: an 下划线 topic's rule is its *box bottom*,
// spans the whole box, and both ends of every branch land on it.
//
// Measured on the shipped XMind (CDP 9222, `target/verify/underline/
// orig-attach.json`): 126/126 attach points had `y == rect.bottom ==
// underlineY` and `dx <= 0.71` from the box's left/right edge, while
// `topic-node-border` was a zero-height stroke with `w == rect.w`.
//
//   CDP_PORT=9244 node scripts/ui-underline-align.mjs [outdir]
//
// Run after `open-sample.mjs example.xmind`.  Writes a report + screenshot,
// and exits non-zero if any assertion fails.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9244);
const OUT = resolve(process.argv[2] || 'target/verify/underline');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((done) => {
  const mid = ++id; pending.set(mid, done);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);

await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

/** First / last centreline coordinate pair of an SVG edge.
 *
 * The shipped example uses `line-tapered`, so most edges are closed wedge
 * polygons: the path runs parent→child along one bank and child→parent along
 * the other.  The visual endpoints are the midpoints of the two ends, not the
 * first/last numbers in the `d` string (which are two points on the parent
 * bank).  Split the polygon at its farthest point from the start to recover
 * the centreline. */
const ends = (d) => {
  const nums = (d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  const plain = () => ({ sx: nums[0], sy: nums[1], ex: nums[nums.length - 2], ey: nums[nums.length - 1] });
  if (!/Z\s*$/i.test(d.trim())) return plain();
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  if (pts.length < 4) return plain();
  let far = 1, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[0].x, dy = pts[i].y - pts[0].y;
    const dist = dx * dx + dy * dy;
    if (dist > best) { best = dist; far = i; }
  }
  const a = pts[0], b = pts[pts.length - 1];
  // The two banks meet at the far tip.  Depending on rounding, the farthest
  // vertex is either side of that join, so pick the shorter of the two
  // adjacent pairs: the wedge is ~1px thick there, versus ~5px between
  // consecutive samples along either bank.
  const pairA = [pts[Math.max(0, far - 1)], pts[far]];
  const pairB = [pts[far], pts[Math.min(pts.length - 1, far + 1)]];
  const gap = (p) => (p[0].x - p[1].x) ** 2 + (p[0].y - p[1].y) ** 2;
  const tipPair = gap(pairA) <= gap(pairB) ? pairA : pairB;
  return {
    sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2,
    ex: (tipPair[0].x + tipPair[1].x) / 2,
    ey: (tipPair[0].y + tipPair[1].y) / 2,
  };
};

const layout = await invoke('doc_layout');
const byId = new Map(layout.nodes.map((n) => [n.id, n]));
const under = layout.nodes.filter((n) => n.style.underline);
ok('example.xmind is open', layout.nodes.length > 50, `${layout.nodes.length} nodes`);
ok('most topics are underline shapes', under.length > 50, `${under.length}/${layout.nodes.length}`);

// --- backend geometry: both ends of a branch sit on the topic's box bottom.
let childOk = 0, parentOk = 0, childBad = [], parentBad = [];
for (const edge of layout.edges) {
  const node = byId.get(edge.to);
  if (!node || !node.style.underline) continue;
  const { ex, ey, sx, sy } = ends(edge.path);
  const onEndX = Math.abs(ex - node.x) < 0.6 || Math.abs(ex - (node.x + node.width)) < 0.6;
  const onEndY = Math.abs(ey - (node.y + node.height)) < 0.6;
  if (onEndX && onEndY) childOk++;
  else childBad.push(`${node.title}: end=(${ex},${ey}) box=${node.x},${node.y},${node.width},${node.height}`);

  const parent = byId.get(edge.from);
  if (parent?.style.underline) {
    const onStartX = Math.abs(sx - parent.x) < 0.6
      || Math.abs(sx - (parent.x + parent.width)) < 0.6;
    const onStartY = Math.abs(sy - (parent.y + parent.height)) < 0.6;
    if (onStartX && onStartY) parentOk++;
    else parentBad.push(`${parent.title}->${node.title}: start=(${sx},${sy})`);
  }
}
ok('branch ends on the underline (x + y)', childBad.length === 0 && childOk > 40,
  `${childOk} ok, ${childBad.length} bad: ${childBad.slice(0, 3).join(' | ')}`);
ok('underline parents send branches from their own rule',
  parentBad.length === 0 && parentOk > 10,
  `${parentOk} ok, ${parentBad.length} bad: ${parentBad.slice(0, 3).join(' | ')}`);

// --- DOM geometry: the rule is a full-width, box-bottom ::after stroke.
const dom = await ev(`(() => {
  const nodes = [...document.querySelectorAll('.node.underline')];
  const sample = nodes.slice(0, 40).map((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n, '::after');
    const title = n.querySelector('.node-title');
    return {
      title: (title?.textContent ?? '').trim().slice(0, 16),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      left: cs.left, right: cs.right, bottom: cs.bottom,
      height: cs.height, transform: cs.transform,
      color: cs.backgroundColor,
      titleBorder: title ? getComputedStyle(title).borderBottomStyle : null,
      shapeStroke: n.querySelector('.node-shape path')?.getAttribute('stroke') ?? null,
    };
  });
  return { count: nodes.length, sample };
})()`);
ok('DOM has underline topics', dom.count > 50, `${dom.count}`);
const spans = dom.sample.filter((s) => s.left === '0px' && s.right === '0px' && s.bottom === '0px');
ok('DOM rule spans the full box width at box.bottom', spans.length === dom.sample.length,
  `${spans.length}/${dom.sample.length}`);
const centered = dom.sample.filter((s) => /matrix/.test(s.transform));
ok('DOM rule is centred on box.bottom (translateY 50%)', centered.length === dom.sample.length,
  `${centered.length}/${dom.sample.length}`);
const inked = dom.sample.filter((s) => /^rgb\(/.test(s.color) && s.color !== 'rgba(0, 0, 0, 0)');
ok('DOM rule has a real colour', inked.length === dom.sample.length, `${inked.length}/${dom.sample.length}`);
const widths = [...new Set(dom.sample.map((s) => s.height))];
ok('DOM rule width follows the theme', widths.every((w) => ['1.5px', '2px'].includes(w)),
  widths.join(','));
ok('DOM label draws no second rule',
  dom.sample.every((s) => s.titleBorder === 'none' || s.titleBorder === null),
  [...new Set(dom.sample.map((s) => s.titleBorder))].join(','));
ok('DOM outline is not stroked (no duplicate rule)',
  dom.sample.every((s) => s.shapeStroke === 'none'),
  [...new Set(dom.sample.map((s) => s.shapeStroke))].join(','));

// --- exported SVG must use the same box-bottom rule (FINDINGS §40).
const exportPath = resolve(OUT, 'underline-align-export.svg').replace(/\\/g, '/');
try {
  await invoke('doc_export', { path: exportPath, format: 'svg' });
  const svg = readFileSync(exportPath, 'utf8');
  const lines = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)];
  let matched = 0;
  for (const m of lines) {
    const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const n = under.find((u) => Math.abs(u.x - x1) < 0.6
      && Math.abs(u.x + u.width - x2) < 0.6
      && Math.abs(u.y + u.height - y1) < 0.6 && Math.abs(y1 - y2) < 0.01);
    if (n) matched++;
  }
  ok('exported SVG rules match box.bottom + full box width',
    lines.length > 0 && matched === lines.length,
    `${matched}/${lines.length} lines matched`);
} catch (e) {
  ok('exported SVG rules match box.bottom + full box width', false, String(e));
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'app-underline-after.png'), Buffer.from(shot.data, 'base64'));
writeFileSync(resolve(OUT, 'ui-underline-align-report.json'), JSON.stringify({ port: PORT, checks }, null, 1));

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
ws.close();
process.exit(failed.length ? 1 : 0);
