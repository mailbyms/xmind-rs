// Real-app verification for box-selection and range-based 概要.
// Drives the shipped release over CDP; no direct document mutation.
// Usage: node scripts/ui-marquee-summary.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const outdir = 'target/verify';
mkdirSync(outdir, { recursive: true });
const dumpPath = resolve(outdir, 'summary-range.json');
const reportPath = resolve(outdir, 'marquee-summary.json');

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page on CDP port');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: ok, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

const ev = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(String(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  }
  return res.result.value;
};
const press = async (key, code, vk, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vk, modifiers,
    });
  }
  await wait(260);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, { button = 'left', buttons = 0, modifiers = 0, clickCount = 1 } = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount });
const click = async (x, y, modifiers = 0) => {
  await mouse('mousePressed', x, y, { buttons: buttonBits('left'), modifiers });
  await mouse('mouseReleased', x, y, { modifiers });
  await wait(260);
};
const buttonBits = (button) => (button === 'right' ? 2 : button === 'middle' ? 4 : 1);

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};
const report = {};

/** Native XMind 概要: the *parent* registers `summaries[].range = "(a,b)"`
 *  as literal indices into its own `children`, plus the 概要 `topicId`.
 *  Files written by this app used to keep `topic.__extra.summaryRange`
 *  instead, which real XMind ignores — that was the round-trip bug. */
function nativeRange(sheet, topicId) {
  const parent = sheet.root;
  const list = parent.__extra?.summaries ?? parent.extra?.summaries ?? [];
  const item = topicId ? list.find((s) => s.topicId === topicId) : list.at(-1);
  const match = typeof item?.range === 'string'
    ? item.range.match(/\((\d+)\s*,\s*(\d+)\)/) : null;
  if (!match) return null;
  const a = Math.min(Number(match[1]), Number(match[2]));
  const b = Math.max(Number(match[1]), Number(match[2]));
  return {
    range: item.range,
    topicId: item.topicId,
    startId: parent.children?.[a]?.id ?? null,
    endId: parent.children?.[b]?.id ?? null,
  };
}

const layout = () => ev(`window.__TAURI_INTERNALS__.invoke('doc_layout')`);
const nodeRects = () => ev(`(() => JSON.stringify(
  [...document.querySelectorAll('.node')].map(n => {
    const r = n.getBoundingClientRect();
    return { id: n.getAttribute('data-id'), title: n.querySelector('.node-title')?.textContent,
      x: r.x, y: r.y, w: r.width, h: r.height };
  })))()`).then((s) => JSON.parse(s));
const chrome = () => ev(`(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const band = document.querySelector('.marquee');
  const outlines = [...document.querySelectorAll('.topic-outline')];
  const first = outlines[0];
  const o = first ? cs(first) : null;
  const b = band ? cs(band) : null;
  const status = [...document.querySelectorAll('.sb-btn')]
    .map(el => el.textContent.trim()).find(t => t.startsWith('主题:')) || '';
  return JSON.stringify({
    band: band ? { fill: b.fill, stroke: b.stroke } : null,
    outlines: outlines.map(el => el.getAttribute('data-id')),
    outlineStyle: o ? { stroke: o.stroke, strokeWidth: o.strokeWidth,
      rx: first.getAttribute('rx') } : null,
    outlineBox: first ? (() => { const r = first.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null,
    status,
  });
})()`).then((s) => JSON.parse(s));

const intersects = (r, box) =>
  r.x0 < box.x + box.w && r.x1 > box.x && r.y0 < box.y + box.h && r.y1 > box.y;
const inside = (x, y, box) =>
  x >= box.x - 1 && x <= box.x + box.w + 1 && y >= box.y - 1 && y <= box.y + box.h + 1;

/** A rectangle that hits exactly `wanted` topics and starts on bare canvas. */
async function findMarquee(wanted) {
  const boxes = await nodeRects();
  const targets = boxes.filter((b) => wanted.includes(b.id));
  if (targets.length !== wanted.length) throw new Error('target topics not on canvas');
  const left = Math.min(...targets.map((b) => b.x));
  const right = Math.max(...targets.map((b) => b.x + b.w));
  const top = Math.min(...targets.map((b) => b.y));
  const bottom = Math.max(...targets.map((b) => b.y + b.h));
  for (const pad of [6, 10, 3, 14, 20, 26, 34]) {
    for (const extra of [0, 8, 16, 28]) {
      const r = {
        x0: left - pad - extra, y0: top - pad - extra,
        x1: right + pad, y1: bottom + pad,
      };
      const hits = boxes.filter((b) => intersects(r, b)).map((b) => b.id);
      if (hits.length !== wanted.length || !wanted.every((v) => hits.includes(v))) continue;
      if (boxes.some((b) => inside(r.x0, r.y0, b))) continue;
      const at = await ev(`(() => { const e = document.elementFromPoint(${r.x0}, ${r.y0});
        return e ? (e.className && typeof e.className === 'string' ? e.className : e.tagName) : 'none'; })()`);
      if (String(at).includes('node')) continue;
      return { ...r, hits };
    }
  }
  return null;
}

async function dragMarquee(r, beforeRelease) {
  await mouse('mousePressed', r.x0, r.y0, { buttons: 1 });
  for (let i = 1; i <= 10; i += 1) {
    await mouse('mouseMoved', r.x0 + (r.x1 - r.x0) * i / 10,
      r.y0 + (r.y1 - r.y0) * i / 10, { buttons: 1 });
    await wait(35);
  }
  await wait(120);
  const during = beforeRelease ? await beforeRelease() : null;
  await mouse('mouseReleased', r.x1, r.y0 <= r.y1 ? r.y1 : r.y0);
  await wait(320);
  return during;
}

const clickTool = (prefix) => ev(`(() => {
  const b = [...document.querySelectorAll('.toolbar button')]
    .find(el => el.title.startsWith(${JSON.stringify(prefix)}));
  if (!b) return 'missing';
  b.click(); return b.disabled ? 'disabled' : 'clicked';
})()`);

// ---------------------------------------------------------------------------
console.log('框选 / 范围概要 真机验证');

// Re-runnable: undo any earlier verification edits back to the pristine
// 5-topic document through the app's own keyboard map.
const undo = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2,
    });
  }
  await wait(200);
};
for (let i = 0; i < 20; i += 1) {
  const state = await layout();
  if (state.nodes.length === 5 && !state.nodes.some((n) => n.title === '概要')) break;
  await undo();
}
const clean = await layout();
ok('验证起点是干净的 5 主题文档', clean.nodes.length === 5
  && !clean.nodes.some((n) => n.title === '概要'), `${clean.nodes.length} 节点`);

// Pick two adjacent siblings on the same side (XMind only wraps a continuous
// run of siblings into one 概要).
const base = await layout();
const root = base.nodes.find((n) => !n.parentId);
const right = base.nodes
  .filter((n) => n.parentId === root.id && n.side === 'right' && !n.cell)
  .sort((a, b) => a.childIndex - b.childIndex);
const left = base.nodes
  .filter((n) => n.parentId === root.id && n.side === 'left' && !n.cell)
  .sort((a, b) => a.childIndex - b.childIndex);
const pair = (right.length >= 2 ? right : left).slice(0, 2);
const pairIds = pair.map((n) => n.id);
ok('存在两个同侧连续兄弟主题', pairIds.length === 2, pair.map((n) => n.title).join(' / '));

const rect = await findMarquee(pairIds);
ok('找到只命中这两个主题且起点在空白处的框选矩形', Boolean(rect),
  rect ? `${Math.round(rect.x0)},${Math.round(rect.y0)} → ${Math.round(rect.x1)},${Math.round(rect.y1)}` : 'none');
if (!rect) throw new Error('cannot build a clean marquee; aborting');

const during = await dragMarquee(rect, chrome);
report.during = during;
ok('拖动时出现蓝色半透明框选矩形', Boolean(during?.band));
ok('框选矩形填充为 rgba(46,189,255,.1)',
  during?.band?.fill.replace(/\s/g, '') === 'rgba(46,189,255,0.1)',
  during?.band?.fill ?? '-');
ok('框选矩形描边为 rgba(46,189,255,.5)',
  during?.band?.stroke.replace(/\s/g, '') === 'rgba(46,189,255,0.5)',
  during?.band?.stroke ?? '-');
ok('拖动过程中实时出现 2 个主题外框', during?.outlines?.length === 2,
  `${during?.outlines?.length ?? 0}`);
ok('主题外框描边为 rgb(46,189,255) / 2px / 圆角 5',
  during?.outlineStyle?.stroke.replace(/\s/g, '') === 'rgb(46,189,255)'
    && during?.outlineStyle?.strokeWidth === '2px'
    && during?.outlineStyle?.rx === '5',
  JSON.stringify(during?.outlineStyle));

const after = await chrome();
report.after = after;
ok('松手后框选矩形消失', after.band === null);
ok('松手后保留 2 个主题外框', after.outlines?.length === 2);
ok('状态栏显示「主题: 2 / 总数」', /^主题:\s*2\s*\/\s*\d+/.test(after.status ?? ''), after.status);
const firstBox = (await nodeRects()).find((b) => b.id === pairIds[0]);
if (firstBox && after.outlineBox) {
  ok('外框比主题盒四边各外扩 2px',
    Math.abs((firstBox.x - after.outlineBox.x) - 2) <= 1.5
      && Math.abs((firstBox.y - after.outlineBox.y) - 2) <= 1.5,
    `dx=${(firstBox.x - after.outlineBox.x).toFixed(1)} dy=${(firstBox.y - after.outlineBox.y).toFixed(1)}`);
} else ok('外框比主题盒四边各外扩 2px', false, 'boxes missing');

// Ctrl+click adds / removes one topic (XMind's additive selection).
const third = (right.length >= 3 ? right : left).find((n) => !pairIds.includes(n.id))
  ?? base.nodes.find((n) => n.parentId === root.id && !pairIds.includes(n.id));
if (third) {
  const box = (await nodeRects()).find((b) => b.id === third.id);
  await click(box.x + box.w / 2, box.y + box.h / 2, 2);
  const added = await chrome();
  report.additive = added;
  ok('Ctrl+点击增量选择后状态栏为「主题: 3 / 总数」',
    /^主题:\s*3\s*\/\s*\d+/.test(added.status ?? ''), added.status);
  ok('Ctrl+点击后主题外框为 3 个', added.outlines?.length === 3);
  // Remove it again so the 概要 covers exactly the two original siblings.
  await click(box.x + box.w / 2, box.y + box.h / 2, 2);
  const removed = await chrome();
  ok('再次 Ctrl+点击取消选择，回到 2 个', removed.outlines?.length === 2
    && removed.outlines.every((v) => pairIds.includes(v)), removed.status);
}

// 概要 must use the box-selected run, not the old "all siblings" fallback.
const beforeSummary = await layout();
const tool = await clickTool('概要');
await wait(450);
const afterSummary = await layout();
ok('工具栏「概要」可用并生成概要主题', tool === 'clicked'
  && afterSummary.nodes.some((n) => n.title === '概要' && !beforeSummary.nodes.some((b) => b.id === n.id)));
const summaryFrames = (afterSummary.frames ?? []).filter((f) => f.kind === 'summary');
ok('布局生成概要括号线', summaryFrames.length === 1, `${summaryFrames.length}`);

await ev(`window.__TAURI_INTERNALS__.invoke('doc_export', {
  path: ${JSON.stringify(dumpPath)}, format: 'json' })`);
const doc = JSON.parse(readFileSync(dumpPath, 'utf8'));
const sheet = doc.sheets[doc.activeSheet ?? 0];
const summaryTopic = (sheet.root.summary ?? []).at(-1);
report.summaryRegistration = nativeRange(sheet, summaryTopic?.id) ?? null;
const range = report.summaryRegistration;
ok('父主题写入 XMind 原生 summaries[] 注册',
  Boolean(range?.startId && range?.endId) && range.topicId === summaryTopic?.id,
  JSON.stringify(range));
ok('原生 range 恰好是框选的两个兄弟（非全部兄弟）',
  Boolean(range) && [range.startId, range.endId].every((v) => pairIds.includes(v))
    && range.startId !== range.endId,
  `${range?.range} → ${range?.startId} → ${range?.endId}`);
ok('概要主题挂在父的 children.summary 且不再依赖自研扩展',
  Boolean(summaryTopic) && !summaryTopic.__extra?.summaryRange
    && !summaryTopic.extra?.summaryRange, String(summaryTopic?.id));

const brace = await ev(`(() => {
  const p = document.querySelector('.decor-frame[data-kind="summary"] > path:first-child');
  if (!p) return null;
  const b = p.getBBox();
  return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height });
})()`).then((s) => (s ? JSON.parse(s) : null));
report.brace = brace;
if (brace) {
  const two = afterSummary.nodes.filter((n) => pairIds.includes(n.id));
  const others = afterSummary.nodes.filter((n) => n.parentId === root.id
    && !pairIds.includes(n.id) && n.title !== '概要');
  const minY = Math.min(...two.map((n) => n.y));
  const maxY = Math.max(...two.map((n) => n.y + n.height));
  ok('括号线纵向覆盖且只覆盖这两个兄弟',
    brace.y <= minY + 2 && brace.y + brace.h >= maxY - 2,
    `brace ${brace.y.toFixed(0)}..${(brace.y + brace.h).toFixed(0)} vs topics ${minY.toFixed(0)}..${maxY.toFixed(0)}`);
  ok('括号线不包含另一侧兄弟',
    others.every((n) => n.x + n.width <= brace.x + 2 || n.x >= brace.x + brace.w - 2),
    `brace.x=${brace.x.toFixed(0)} w=${brace.w.toFixed(0)}`);
} else ok('括号线纵向覆盖且只覆盖这两个兄弟', false, 'brace missing');

// ---------------------------------------------------------------------------
// "任意连续几个主题": add a third sibling, box-select all three, and check
// that 概要 / 外框 both carry that exact inclusive range.
await undo();
await wait(220);
const secondBox = (await nodeRects()).find((b) => b.id === pairIds[1]);
await click(secondBox.x + secondBox.w / 2, secondBox.y + secondBox.h / 2);
await press('Enter', 'Enter', 13);
const grown = await layout();
const groups = new Map();
for (const node of grown.nodes.filter((n) => n.parentId === root.id && !n.cell)) {
  const key = node.side;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(node);
}
const three = [...groups.values()]
  .map((list) => list.sort((a, b) => a.childIndex - b.childIndex))
  .find((list) => list.length >= 3)?.slice(0, 3) ?? [];
ok('可以构造三个连续兄弟主题', three.length === 3,
  three.map((n) => n.title).join(' / '));
if (three.length === 3) {
  const ids3 = three.map((n) => n.id);
  const rect3 = await findMarquee(ids3);
  ok('找到只命中这三个主题的框选矩形', Boolean(rect3));
  if (rect3) {
    await dragMarquee(rect3);
    const status3 = (await chrome()).status;
    ok('框选三个主题后状态栏为「主题: 3 / 总数」', /^主题:\s*3\s*\/\s*\d+/.test(status3), status3);

    await clickTool('概要');
    await wait(420);
    await ev(`window.__TAURI_INTERNALS__.invoke('doc_export', {
      path: ${JSON.stringify(dumpPath)}, format: 'json' })`);
    const doc3 = JSON.parse(readFileSync(dumpPath, 'utf8'));
    const sheet3 = doc3.sheets[doc3.activeSheet ?? 0];
    const topic3 = (sheet3.root.summary ?? []).at(-1);
    const range3 = nativeRange(sheet3, topic3?.id);
    report.summaryRange3 = range3 ?? null;
    ok('三个主题的原生 range 取首尾、覆盖中间主题',
      Boolean(range3) && range3.startId === ids3[0] && range3.endId === ids3[2]
        && ids3[1] !== range3.startId && ids3[1] !== range3.endId,
      `${range3?.range} → ${range3?.startId} → ${range3?.endId}`);
    const frame3 = (await layout()).frames.filter((f) => f.kind === 'summary');
    ok('三个主题只生成一条概要括号线', frame3.length === 1, `${frame3.length}`);

    // 外框 uses the very same explicit range path on the backend.
    await undo();
    await wait(200);
    await clickTool('外框');
    await wait(420);
    await ev(`window.__TAURI_INTERNALS__.invoke('doc_export', {
      path: ${JSON.stringify(dumpPath)}, format: 'json' })`);
    const doc4 = JSON.parse(readFileSync(dumpPath, 'utf8'));
    const sheet4 = doc4.sheets[doc4.activeSheet ?? 0];
    const boundary = (sheet4.__extra?.boundaries ?? sheet4.extra?.boundaries ?? []).at(-1);
    report.boundaryRange = boundary?.range ?? null;
    ok('外框同样按这三个主题的真实范围创建',
      Boolean(boundary?.range) && boundary.range.startId === ids3[0]
        && boundary.range.endId === ids3[2],
      JSON.stringify(boundary?.range));
  }
}

// ---------------------------------------------------------------------------
// 概要范围手柄 (XMind's summary-resize-handle-start/end): selecting the brace
// exposes two tips; dragging one snaps the range to whole siblings.
/** A client point on the brace's own stroke (its bbox' top-left corner). */
const bracePoint = () => ev(`(() => {
  const p = document.querySelector('.decor-frame[data-kind="summary"] > path');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return JSON.stringify({ x: r.x + 1.5, y: r.y + 1.5 });
})()`).then((s) => (s ? JSON.parse(s) : null));

/** Centre of one range handle, in client coordinates. */
const braceHandle = (which) => ev(`(() => {
  const el = document.querySelector('.summary-handle[data-handle="${which}"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`).then((s) => (s ? JSON.parse(s) : null));

async function dragHandle(which, dy, dx = 0) {
  const at = await braceHandle(which);
  if (!at) return null;
  await mouse('mousePressed', at.x, at.y, { buttons: 1 });
  for (let i = 1; i <= 8; i += 1) {
    await mouse('mouseMoved', at.x + (dx * i) / 8, at.y + (dy * i) / 8, { buttons: 1 });
    await wait(40);
  }
  const preview = await ev(`document.querySelector('.range-preview') !== null`);
  await mouse('mouseReleased', at.x + dx, at.y + dy);
  await wait(420);
  return { at, preview };
}

// Back to the pristine 5-topic map, then a 概要 over two siblings.
for (let i = 0; i < 24; i += 1) {
  const state = await layout();
  if (state.nodes.length === 5 && !state.nodes.some((n) => n.title === '概要')
    && !(state.frames ?? []).length) break;
  await undo();
}
const fresh = await layout();
const root2 = fresh.nodes.find((n) => !n.parentId);
const rightStack = () => layout().then((state) => state.nodes
  .filter((n) => n.parentId === root2.id && !n.cell && n.side === 'right')
  .sort((a, b) => a.childIndex - b.childIndex));
let stack = await rightStack();
if (stack.length < 3) {
  // The shipped document has two right-hand branches; the app's own
  // "add sibling after" keeps the new one in the same stack.
  await ev(`window.__TAURI_INTERNALS__.invoke('doc_add_sibling',
    { id: ${JSON.stringify(stack[stack.length - 1].id)}, title: '新主题' })`);
  await wait(360);
  stack = await rightStack();
}
const trio = stack.slice(0, 3);
ok('手柄验证起点有三个同侧兄弟', trio.length === 3, trio.map((n) => n.title).join(' / '));

if (trio.length === 3) {
  const rectH = await findMarquee([trio[0].id, trio[1].id]);
  ok('框选前两个兄弟用于创建概要', Boolean(rectH));
  if (rectH) {
    await dragMarquee(rectH);
    await clickTool('概要');
    await wait(420);

    const pt = await bracePoint();
    ok('概要括号线存在且可取到起点坐标', Boolean(pt));
    if (pt) await click(pt.x, pt.y);
    const handles = await ev(`[...document.querySelectorAll('.summary-handle')]
      .map(el => el.getAttribute('data-handle')).join(',')`);
    ok('选中概要后出现 start / end 两个范围手柄', handles === 'start,end', handles || 'none');

    const frameBefore = (await layout()).frames.find((f) => f.kind === 'summary');
    const startBefore = await braceHandle('start');
    const endBefore = await braceHandle('end');
    ok('手柄锚在括号线两端（end 在下、start 在上）',
      Boolean(startBefore) && Boolean(endBefore) && Boolean(frameBefore)
        && endBefore.y > startBefore.y + 8,
      JSON.stringify({ start: startBefore, end: endBefore }));

    // Drag the lower tip past the third sibling's centre.
    const thirdBox = (await nodeRects()).find((b) => b.id === trio[2].id);
    const secondBox = (await nodeRects()).find((b) => b.id === trio[1].id);
    const pitch = Math.max(24, (thirdBox.y - secondBox.y) + (thirdBox.h - secondBox.h) / 2);
    const drag = await dragHandle('end', pitch + 10);
    ok('拖动时出现待吸附范围的虚线预览', drag?.preview === true);
    const frameAfter = (await layout()).frames.find((f) => f.kind === 'summary');
    ok('拖动 end 手柄后括号线覆盖到第三个兄弟',
      Boolean(frameAfter) && frameAfter.endId === trio[2].id,
      `${frameBefore?.endId} → ${frameAfter?.endId}`);
    ok('括号线随之变长', Boolean(frameAfter) && Boolean(frameBefore)
      && frameAfter.endY > frameBefore.endY + 4,
      `${frameBefore?.endY?.toFixed(0)} → ${frameAfter?.endY?.toFixed(0)}`);

    await ev(`window.__TAURI_INTERNALS__.invoke('doc_export', {
      path: ${JSON.stringify(dumpPath)}, format: 'json' })`);
    const docH = JSON.parse(readFileSync(dumpPath, 'utf8'));
    const sheetH = docH.sheets[docH.activeSheet ?? 0];
    const topicH = (sheetH.root.summary ?? []).at(-1);
    const rangeH = nativeRange(sheetH, topicH?.id);
    report.handleRange = rangeH ?? null;
    ok('原生 range 写回为新的首尾兄弟',
      rangeH?.startId === trio[0].id && rangeH?.endId === trio[2].id,
      `${rangeH?.range} → ${rangeH?.startId} → ${rangeH?.endId}`);

    // Now shrink from the top: drag start down onto the second sibling.
    await dragHandle('start', pitch + 10);
    const shrunk = (await layout()).frames.find((f) => f.kind === 'summary');
    ok('拖动 start 手柄后范围收缩到第二、第三个兄弟',
      shrunk?.startId === trio[1].id && shrunk?.endId === trio[2].id,
      `${shrunk?.startId} → ${shrunk?.endId}`);

    // Range handles must never cross to the other side of the map.
    const leftNode = (await layout()).nodes
      .find((n) => n.parentId === root2.id && n.side === 'left' && !n.cell);
    if (leftNode) {
      const bad = await ev(`window.__TAURI_INTERNALS__.invoke('doc_set_decor_range', {
        kind: 'summary', id: ${JSON.stringify(topicH?.id ?? '')},
        startId: ${JSON.stringify(trio[1].id)}, endId: ${JSON.stringify(leftNode.id)} })
        .then(() => 'accepted').catch((e) => 'rejected:' + String(e))`);
      ok('拒绝跨到另一侧的非法范围', String(bad).startsWith('rejected'), String(bad));
    }
  }
}

// ---------------------------------------------------------------------------
// 外框 shares the exact same two tips (XMind resizes a boundary by dragging a
// corner), so the range drag must work there too — and land in sheet.extra,
// not in a summary topic.
for (let i = 0; i < 24; i += 1) {
  const state = await layout();
  if (!(state.frames ?? []).length) break;
  await undo();
}
const cleanB = await layout();
const rootB = cleanB.nodes.find((n) => !n.parentId);
const bStack = async () => layout().then((state) => state.nodes
  .filter((n) => n.parentId === rootB.id && !n.cell && n.side === 'right')
  .sort((a, b) => a.childIndex - b.childIndex));
let bSiblings = await bStack();
while (bSiblings.length < 3) {
  await ev(`window.__TAURI_INTERNALS__.invoke('doc_add_sibling',
    { id: ${JSON.stringify(bSiblings[bSiblings.length - 1].id)}, title: '新主题' })`);
  await wait(360);
  bSiblings = await bStack();
}
const btrio = bSiblings.slice(0, 3);
const rectB = await findMarquee([btrio[0].id, btrio[1].id]);
ok('外框手柄验证起点有三个同侧兄弟', Boolean(rectB), btrio.map((n) => n.title).join(' / '));

if (rectB) {
  await dragMarquee(rectB);
  await clickTool('外框');
  await wait(420);
  const bFrame = (await layout()).frames.find((f) => f.kind === 'boundary');
  ok('外框按这两个兄弟的真实范围创建',
    bFrame?.startId === btrio[0].id && bFrame?.endId === btrio[1].id,
    `${bFrame?.startId} → ${bFrame?.endId}`);

  // The dashed outline is a closed rect, so its left edge midpoint is a
  // guaranteed hit for the 14px transparent `decor-hit` stroke on top of it.
  const bPt = await ev(`(() => {
    const p = document.querySelector('.decor-frame[data-kind="boundary"] > path');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + 1.5 });
  })()`).then((s) => (s ? JSON.parse(s) : null));
  if (bPt) await click(bPt.x, bPt.y);
  const bHandles = await ev(`[...document.querySelectorAll('.summary-handle')]
    .filter(el => el.getAttribute('data-frame') === ${JSON.stringify(bFrame?.id ?? '')})
    .map(el => el.getAttribute('data-handle')).sort().join(',')`);
  ok('选中外框后同样出现两端范围手柄', bHandles === 'end,start', bHandles || 'none');

  const bStartAnchor = await braceHandle('start');
  const bEndAnchor = await braceHandle('end');
  ok('外框手柄锚在矩形左上 / 左下两角',
    Boolean(bStartAnchor) && Boolean(bEndAnchor) && bEndAnchor.y > bStartAnchor.y + 8,
    JSON.stringify({ start: bStartAnchor, end: bEndAnchor }));
  const bBox2 = (await nodeRects()).find((b) => b.id === btrio[1].id);
  const bBox3 = (await nodeRects()).find((b) => b.id === btrio[2].id);
  const bPitch = Math.max(24, (bBox3.y - bBox2.y) + (bBox3.h - bBox2.h) / 2);
  const bDrag = await dragHandle('end', bPitch + 10);
  ok('拖动外框手柄时同样出现待吸附范围的虚线预览', bDrag?.preview === true);
  const bAfter = (await layout()).frames.find((f) => f.kind === 'boundary');
  ok('拖动外框 end 手柄后范围覆盖到第三个兄弟',
    Boolean(bAfter) && bAfter.endId === btrio[2].id,
    `${bFrame?.endId} → ${bAfter?.endId}`);
  ok('外框随之变高',
    Boolean(bFrame) && Boolean(bAfter) && bAfter.endY > bFrame.endY + 4,
    `${bFrame?.endY?.toFixed(0)} → ${bAfter?.endY?.toFixed(0)}`);

  await ev(`window.__TAURI_INTERNALS__.invoke('doc_export', {
    path: ${JSON.stringify(dumpPath)}, format: 'json' })`);
  const docB = JSON.parse(readFileSync(dumpPath, 'utf8'));
  const sheetB = docB.sheets[docB.activeSheet ?? 0];
  const rangeB = (sheetB.extra ?? sheetB.__extra)?.boundaries?.[0]?.range;
  report.boundaryRange = rangeB ?? null;
  ok('外框范围写回 sheet.extra.boundaries',
    rangeB?.startId === btrio[0].id && rangeB?.endId === btrio[2].id,
    `${rangeB?.startId} → ${rangeB?.endId}`);

  await undo(); // drop the 外框 again so the Space section starts on a clean map
  await wait(300);
}

// ---------------------------------------------------------------------------
// Space is XMind's hold-to-pan modifier: it must pan, never draw a marquee or
// fold a topic (the old app-local "space folds" shortcut is gone).
const key = (type, k, code, vk, modifiers = 0) =>
  send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
const blank = await ev(`(() => {
  const c = document.querySelector('.canvas').getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect());
  for (let y = c.top + 45; y < c.bottom - 55; y += 18) {
    for (let x = c.left + 40; x < c.right - 40; x += 18) {
      if (boxes.every(b => x < b.left - 8 || x > b.right + 8 || y < b.top - 8 || y > b.bottom + 8)) {
        return JSON.stringify({ x, y });
      }
    }
  }
  return null;
})()`).then((s) => (s ? JSON.parse(s) : null));
if (blank) {
  const beforePan = await ev(`document.querySelector('.stage').style.transform`);
  const foldedBefore = (await layout()).nodes.filter((n) => n.folded).length;
  await key('keyDown', ' ', 'Space', 32);
  await wait(90);
  ok('按住空格进入临时平移模式',
    await ev(`document.querySelector('.canvas').classList.contains('space-pan')`) === true);
  await mouse('mousePressed', blank.x, blank.y, { buttons: 1 });
  for (let i = 1; i <= 6; i += 1) {
    await mouse('mouseMoved', blank.x + i * 18, blank.y + i * 10, { buttons: 1 });
    await wait(35);
  }
  const bandDuringPan = await ev(`document.querySelector('.marquee') !== null`);
  await mouse('mouseReleased', blank.x + 108, blank.y + 60);
  await wait(240);
  const afterPan = await ev(`document.querySelector('.stage').style.transform`);
  ok('Space+拖动平移画布而不是框选',
    bandDuringPan === false && afterPan !== beforePan, `${beforePan} → ${afterPan}`);
  const foldedAfter = (await layout()).nodes.filter((n) => n.folded).length;
  ok('空格不再触发折叠', foldedAfter === foldedBefore);
  await key('keyUp', ' ', 'Space', 32);
  await wait(120);
  ok('松开空格退出平移模式',
    await ev(`document.querySelector('.canvas').classList.contains('space-pan')`) === false);
} else ok('Space+拖动平移画布而不是框选', false, 'no blank point');

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${fail.length ? `FAILED: ${fail.length}` : 'ALL PASS'} — ${reportPath}`);
if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; }
ws.close();
