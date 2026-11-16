// Verify live in-place topic renaming:
//   * the label echoes every keystroke while the editor is open;
//   * EVERY keystroke re-runs the backend layout, so the topic box grows and
//     wraps onto extra lines (and grows taller) as you type;
//   * a whole edit is one undo step and Escape restores the document.
// Drives the real app over CDP.
//
// Note: always create the scratch document through the app's own shortcut
// (Ctrl+N), never by invoking `doc_new` behind React's back — that leaves App
// state on the previous document and every later commit looks like a reset.
// Usage: node scripts/ui-rename.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/rename';
const PORT = process.env.CDP_PORT || 9223;
mkdirSync(outdir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    void send('Page.handleJavaScriptDialog', { accept: true });
    return;
  }
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, clip) => {
  const res = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
  return res.data;
};
const mouse = (type, x, y, clickCount = 1) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount,
});
const press = async (key, code, vk, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  await wait(250);
};
// Re-measure before every double click: live relayout moves the topic edges.
const center = (nodeId) => evaluate(`(() => {
  const n = document.querySelector('.node[data-id="${nodeId}"]');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width) };
})()`);
const dblclick = async (nodeId) => {
  const p = await center(nodeId);
  await mouse('mousePressed', p.x, p.y, 1); await mouse('mouseReleased', p.x, p.y, 1);
  await mouse('mousePressed', p.x, p.y, 2); await mouse('mouseReleased', p.x, p.y, 2);
  await wait(400);
};

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};

/** DOM geometry of the topic and its editor. */
const domState = (nodeId) => evaluate(`(() => {
  const n = document.querySelector('.node[data-id="${nodeId}"]');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  const i = n.querySelector('.node-title-input');
  return {
    nodeW: Math.round(r.width), nodeH: Math.round(r.height),
    title: (n.querySelector('.node-title')?.textContent || '').trim(),
    titleH: Math.round(n.querySelector('.node-title')?.getBoundingClientRect().height ?? 0),
    inputW: i ? Math.round(i.getBoundingClientRect().width) : 0,
    inputH: i ? Math.round(i.getBoundingClientRect().height) : 0,
    scrollW: i ? i.scrollWidth : 0, clientW: i ? i.clientWidth : 0,
    scrollH: i ? i.scrollHeight : 0, clientH: i ? i.clientHeight : 0,
    rows: i ? Number(i.rows) : 0,
    value: i ? i.value : null, focused: i ? document.activeElement === i : false,
  };
})()`).then((v) => (typeof v === 'string' ? JSON.parse(v) : v));

/** The authoritative backend layout: proves each keystroke really hit Rust. */
const backendState = (nodeId) => evaluate(`
  window.__TAURI_INTERNALS__.invoke('doc_layout').then((l) => {
    const n = l.nodes.find((v) => v.id === '${nodeId}');
    return n ? JSON.stringify({ title: n.title, width: Math.round(n.width),
      height: Math.round(n.height), lines: n.lines }) : null;
  })`).then((v) => (v ? JSON.parse(v) : null));

await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

await send('Page.enable');
// CDP screenshots can momentarily defocus the WebView, which would fire the
// editor's blur handler and commit the draft mid-test.
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
await send('Page.bringToFront').catch(() => '');
await press('Escape', 'Escape', 27);
// A fresh map through the app's own menu shortcut keeps React state in sync.
await press('n', 'KeyN', 78, 2);
await wait(900);

const root = await evaluate(`(() => {
  const n = [...document.querySelectorAll('.node[data-id]')]
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { id: n.getAttribute('data-id'), x: r.x + r.width / 2, y: r.y + r.height / 2,
    w: Math.round(r.width), h: Math.round(r.height),
    title: (n.querySelector('.node-title')?.textContent || '').trim() };
})()`);
ok('found a topic to rename', Boolean(root), root ? `"${root.title}"` : 'no .node');
if (!root) { console.log('\n1 failed: no topic'); ws.close(); process.exit(1); }
const originalTitle = root.title;

// Double-click enters the editor (React needs clickCount 2 for dblclick).
await dblclick(root.id);

const editor = () => evaluate(`(() => {
  const el = document.querySelector('.node-title-input');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { present: true, focused: document.activeElement === el, value: el.value,
    position: cs.position, zIndex: cs.zIndex, opacity: cs.opacity,
    color: cs.color, width: Math.round(r.width), height: Math.round(r.height),
    visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' };
})()`);

const opened = await editor();
ok('editor opened and focused', opened.present && opened.focused, JSON.stringify(opened));
// The shape layer is an absolutely positioned <svg>; a static-flow editor
// paints underneath it, which is exactly what made the echo invisible.
ok('editor stacks above the shape layer', opened.position !== 'static' && opened.zIndex !== 'auto',
  `position=${opened.position} z-index=${opened.zIndex}`);
ok('editor has a painted box', opened.visible, `${opened.width}×${opened.height}`);

const vp = await evaluate(`({ w: innerWidth, h: innerHeight })`);
const clip = {
  x: Math.max(0, root.x - 450), y: Math.max(0, root.y - 160),
  width: 900, height: 340, scale: 2,
};
clip.width = Math.min(clip.width, vp.w - clip.x);
clip.height = Math.min(clip.height, vp.h - clip.y);
await shot('1-editor-open', clip);
// Re-enter if a screenshot still stole focus (blur commits and closes it).
const editorAlive = await evaluate(`Boolean(document.querySelector('.node[data-id="${root.id}"] .node-title-input'))`);
if (!editorAlive) { console.log('  note: re-entered editor after focus loss'); await dblclick(root.id); }

const before = await domState(root.id);
const backendBefore = await backendState(root.id);
ok('backend layout starts at the original title', backendBefore?.title === originalTitle,
  JSON.stringify(backendBefore));

// Type one character at a time: each one must produce a new backend layout.
// The first pass stays inside XMind's 340px default topic width — the range
// where "the box grows as you type" is observable without wrapping.
const shortText = '逐字变宽测试啊';
const widths = [];
const backendWidths = [];
for (const ch of shortText) {
  await send('Input.insertText', { text: ch });
  await wait(110);
  widths.push((await domState(root.id))?.nodeW ?? 0);
  backendWidths.push((await backendState(root.id))?.width ?? 0);
}
console.log('  widths:', widths.join(','));
console.log('  backend widths:', backendWidths.join(','));
const shortState = await domState(root.id);
const shortBackend = await backendState(root.id);
ok('keystrokes reach the editor', shortState.value === shortText, `value="${shortState.value}"`);
ok('backend title tracks every keystroke', shortBackend?.title === shortText,
  `backend="${shortBackend?.title}"`);
ok('topic box grew while typing', shortState.nodeW > before.nodeW + 60,
  `${before.nodeW} → ${shortState.nodeW}px`);
ok('backend relayouts on multiple keystrokes', new Set(backendWidths).size >= 4,
  `${new Set(backendWidths).size} distinct widths`);
ok('DOM width matches the backend layout', Math.abs(shortState.nodeW - shortBackend.width) <= 2,
  `dom=${shortState.nodeW} backend=${shortBackend.width}`);
ok('editor width follows the box', shortState.inputW > before.inputW + 40,
  `${before.inputW} → ${shortState.inputW}px`);
ok('text is not clipped while the box grows', shortState.scrollW <= shortState.clientW + 4,
  `scroll=${shortState.scrollW} client=${shortState.clientW}`);
ok('editor keeps focus through relayouts', shortState.focused === true);

const pixelTyped = await shot('2-typed-while-editing', clip);

// Past 340px the label wraps onto more lines and the topic grows taller.
const longText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cappedWidths = [];
const cappedHeights = [];
for (const ch of longText) {
  await send('Input.insertText', { text: ch });
  await wait(90);
  const b = await backendState(root.id);
  cappedWidths.push(b?.width ?? 0);
  cappedHeights.push(b?.height ?? 0);
}
console.log('  backend heights:', cappedHeights.join(','));
const capped = await domState(root.id);
const cappedBackend = await backendState(root.id);
ok('width stops at the preset 340px maximum',
  capped.nodeW === 340 && cappedWidths.every((w) => w <= 340),
  `width=${capped.nodeW}, backend max=${Math.max(...cappedWidths)}`);
ok('long text wraps into several lines', (cappedBackend?.lines ?? 0) >= 2,
  `lines=${cappedBackend?.lines}`);
ok('topic grows taller to fit the wrapped lines',
  capped.nodeH > before.nodeH + 30 && Math.abs(capped.nodeH - cappedBackend.height) <= 2,
  `${before.nodeH} → ${capped.nodeH}px (backend ${cappedBackend.height})`);
ok('backend relayouts the height when wrapping', new Set(cappedHeights).size >= 2,
  `${new Set(cappedHeights).size} distinct heights`);
ok('editor rows follow the backend line count', capped.rows === cappedBackend.lines,
  `rows=${capped.rows} lines=${cappedBackend.lines}`);
ok('no horizontal scrolling after wrapping', capped.scrollW <= capped.clientW + 4,
  `scroll=${capped.scrollW} client=${capped.clientW}`);
ok('no vertical clipping in the editor', capped.scrollH <= capped.clientH + 4,
  `scroll=${capped.scrollH} client=${capped.clientH}`);

await send('Input.insertText', { text: 'HIJ' });
await wait(300);
const pixelMore = await shot('3-more-keystrokes', clip);
ok('each keystroke repaints the canvas', pixelTyped !== pixelMore, 'screenshot changed');
const finalText = `${shortText}${longText}HIJ`;

// Commit with Enter: the topic label itself must now carry the new text.
await press('Enter', 'Enter', 13);
await wait(700);
const after = await domState(root.id);
ok('Enter closes the editor', after.value === null);
ok('committed label shows the typed text', after.title === finalText, `"${after.title}"`);
ok('committed label is drawn on several lines', after.titleH >= 76,
  `title height=${after.titleH}px`);
await shot('4-after-commit');

// One Ctrl+Z must undo the WHOLE edit, not one character at a time.
await press('z', 'KeyZ', 90, 2);
await wait(600);
const undone = await domState(root.id);
ok('one undo reverts the entire edit', undone.title === originalTitle, `"${undone.title}"`);
await press('z', 'KeyZ', 90, 2 | 8);
await wait(600);
const redone = await domState(root.id);
ok('redo restores the edit', redone.title === finalText, `"${redone.title}"`);

// Escape must discard the draft — including the backend document and layout,
// which were already changed by the live keystrokes.
const beforeEscape = await domState(root.id);
const committedBackend = await backendState(root.id);
await dblclick(root.id);
await send('Input.insertText', { text: '不要保存的草稿文字很长很长' });
await wait(400);
const escapeBackend = await backendState(root.id);
ok('live keystrokes reach the backend before Escape',
  escapeBackend?.title === '不要保存的草稿文字很长很长', JSON.stringify(escapeBackend));
ok('live draft also relayouts the topic height',
  escapeBackend?.height !== committedBackend?.height,
  `${committedBackend?.height} → ${escapeBackend?.height}px`);
await press('Escape', 'Escape', 27);
await wait(600);
const escaped = await domState(root.id);
const escapedBackend = await backendState(root.id);
ok('Escape closes the editor', escaped.value === null);
ok('Escape keeps the old label', escaped.title === finalText, `"${escaped.title}"`);
ok('Escape rolls the backend document back', escapedBackend?.title === finalText,
  JSON.stringify(escapedBackend));
ok('Escape restores the whole topic size',
  Math.abs(escaped.nodeW - beforeEscape.nodeW) <= 2 &&
  Math.abs(escaped.nodeH - beforeEscape.nodeH) <= 2,
  `${beforeEscape.nodeW}×${beforeEscape.nodeH} → ${escaped.nodeW}×${escaped.nodeH}`);

// Blur must commit too (clicking empty canvas).
await dblclick(root.id);
await send('Input.insertText', { text: '失焦提交' });
await wait(300);
await mouse('mousePressed', 24, 200, 1); await mouse('mouseReleased', 24, 200, 1);
await wait(700);
const blurred = await domState(root.id);
ok('blur closes the editor', blurred.value === null);
ok('blur commits the label', blurred.title === '失焦提交', `"${blurred.title}"`);
await shot('5-after-blur-commit');

// Shift+Enter (and pasted newlines) must become real lines, not clipped text.
await dblclick(root.id);
await send('Input.insertText', { text: '第一行\n第二行' });
await wait(450);
const multi = await domState(root.id);
const multiBackend = await backendState(root.id);
ok('explicit line breaks reach the backend',
  Boolean(multi.value?.includes('\n')) && (multiBackend?.lines ?? 0) >= 2,
  `lines=${multiBackend?.lines} value=${JSON.stringify(multi.value)}`);
ok('editor has a row for every line',
  multi.rows >= 2 && multi.scrollH <= multi.clientH + 4,
  `rows=${multi.rows} scroll=${multi.scrollH} client=${multi.clientH}`);
await shot('6-multiline-edit');
await press('Escape', 'Escape', 27);
await wait(400);

console.log(fail.length === 0 ? '\nall checks passed' : `\n${fail.length} failed: ${fail.join(', ')}`);
ws.close();
process.exit(fail.length === 0 ? 0 : 1);
