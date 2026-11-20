// Regression: a 贴纸 / 插画 topic must not squeeze its label into two lines.
// The card already has 20/18 content padding; adding the underline topic's
// `--text-pad` left inset on top of it left only ~70px for a 4-glyph label,
// so 「演示/展示」 rendered as two lines while the same topic without artwork
// was fine (and the SVG export had always drawn one line).
//
//   CDP_PORT=9236 node scripts/check-image-label.mjs
//   CDP_PORT=9236 node scripts/check-image-label.mjs --remove-sticker
//
// Requires the app on CDP with example.xmind open.  `--remove-sticker` also
// deletes 「演示/展示」's artwork through the real context menu and asserts the
// label stays on one line afterwards (the user's own comparison case).
// It changes the in-memory document; do not save afterwards.
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

const rows = await ev(`(() => [...document.querySelectorAll('.node.has-image')].map((n) => {
  const t = n.querySelector('.node-title');
  if (!t) return null;
  const cs = getComputedStyle(t);
  // Range client rects give the actual rendered line count, not a guess from
  // clientHeight (the 下划线 rule adds 2px of bottom padding).
  const range = document.createRange();
  range.selectNodeContents(t);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
  const tops = new Set(rects.map((r) => Math.round(r.top)));
  const ink = range.getBoundingClientRect();
  const box = t.getBoundingClientRect();
  return {
    title: (t.textContent || '').trim(),
    lines: tops.size,
    explicitBreak: (t.textContent || '').includes('\\n'),
    padL: cs.paddingLeft,
    inkW: Math.round(ink.width * 100) / 100,
    boxW: Math.round(box.width * 100) / 100,
  };
}).filter(Boolean))()`);

if (!rows.length) throw new Error('no image topics found');
let failures = 0;
for (const r of rows) {
  const problems = [];
  // Only demand a single line when the label's natural width fits the card.
  if (!r.explicitBreak && r.inkW <= r.boxW + 1 && r.lines !== 1) {
    problems.push(`wrapped into ${r.lines} lines`);
  }
  if (r.padL !== '0px') problems.push(`extra left inset ${r.padL}`);
  if (problems.length) { failures += 1; console.log('FAIL    ', JSON.stringify(r), problems.join('; ')); }
  else console.log('PASS    ', JSON.stringify(r));
}
ws.close();
if (failures) throw new Error(`${failures} image topic label(s) mis-rendered`);
console.log('ALL PASS');

if (process.argv.includes('--remove-sticker')) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Re-open a CDP session: `send` still works after the read-only pass above,
  // but keep the removal in its own explicit sequence.
  const ws2 = new WebSocket(page.webSocketDebuggerUrl);
  let id2 = 0;
  const pending2 = new Map();
  ws2.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending2.has(m.id)) { pending2.get(m.id)(m.result); pending2.delete(m.id); }
  });
  await new Promise((r) => ws2.addEventListener('open', r));
  const ev2 = async (expression) => {
    const res = await new Promise((done) => {
      const mid = ++id2; pending2.set(mid, done);
      ws2.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
    return res.result.value;
  };
  const opened = await ev2(`(() => {
    const n = [...document.querySelectorAll('.node.has-image')].find((e) =>
      (e.querySelector('.node-title')?.textContent || '').includes('演示/展示'));
    const img = n && n.querySelector('.node-image');
    if (!img) return false;
    img.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, clientX: 400, clientY: 400 }));
    return true;
  })()`);
  if (!opened) throw new Error('could not open the artwork context menu');
  await wait(200);
  const removed = await ev2(`(() => {
    const hit = [...document.querySelectorAll('.xm-panel .xm-label')]
      .find((e) => (e.textContent || '').trim() === '删除图片');
    if (!hit) return false;
    (hit.parentElement || hit).dispatchEvent(new MouseEvent('click',
      { bubbles: true, cancelable: true }));
    return true;
  })()`);
  if (!removed) throw new Error('删除图片 menu item not found');
  await wait(450);
  const after = await ev2(`(() => {
    const n = [...document.querySelectorAll('.node')].find((e) =>
      (e.querySelector('.node-title')?.textContent || '').includes('演示/展示'));
    if (!n) return null;
    const t = n.querySelector('.node-title');
    const range = document.createRange(); range.selectNodeContents(t);
    return {
      text: t.textContent.trim(),
      hasImage: n.classList.contains('has-image'),
      lines: new Set([...range.getClientRects()].filter((r) => r.width > 0)
        .map((r) => Math.round(r.top))).size,
    };
  })()`);
  console.log('removed ', JSON.stringify(after));
  ws2.close();
  if (!after || after.hasImage || after.text !== '演示/展示' || after.lines !== 1) {
    throw new Error('label broke after removing the sticker');
  }
  console.log('REMOVE PASS');
}
