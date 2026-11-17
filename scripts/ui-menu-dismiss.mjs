// Regression: activating a leaf menu item must dismiss the WHOLE menu tree.
//
//   CDP_PORT=9223 node scripts/ui-menu-dismiss.mjs [recent-file-name]
//
// Bug: MenuLevel.activate() called onClose(), which for a submenu level only
// closed that one column, so 最近打开 > foo.xmind opened the document but left
// the parent panels + backdrop on screen. Needs the app's recent list to
// contain at least one .xmind file (settings.json).
// 「最近打开」is now a first-level row directly below 打开 (2026-11-17).
const PORT = process.env.CDP_PORT || 9223;
const preferred = process.argv[2] || 'example2.xmind';

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const escape = async () => { await key('Escape', 'Escape', 27); await wait(180); };

const centre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('.xm-item')].filter((b) => b.offsetParent !== null);
  const hit = all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').trim() === want)
    ?? all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').includes(want));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

const menuState = () => ev(`(() => ({
  panels: document.querySelectorAll('.xm-panel').length,
  backdrop: !!document.querySelector('.xm-backdrop'),
  doc: document.querySelector('.doc-name')?.textContent ?? '',
}))()`);

let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};
const clear = async () => {
  await escape();
  if ((await menuState()).backdrop) { await clickAt(120, 760); await wait(150); }
};
const openMain = async () => {
  const burger = await ev(`(() => {
    const r = document.querySelector('.menu-btn').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await clickAt(burger.x, burger.y);
  await wait(220);
};
const hover = async (label) => {
  const at = await centre(label);
  if (!at) throw new Error(`menu item not found: ${label}`);
  await move(at.x, at.y);
  await wait(180);
  return at;
};

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
await wait(350);
console.log('菜单动作后自动隐藏 真机验证');

// --- 1. 最近打开 > <file> -------------------------------------------------
await clear();
await openMain();
await hover('最近打开');
const sample = await ev(`(() => {
  const want = ${JSON.stringify(preferred)};
  const all = [...document.querySelectorAll('.xm-item')].filter((b) => b.offsetParent !== null);
  const labels = all.map((b) => (b.querySelector('.xm-label')?.textContent ?? '').trim());
  const hit = labels.find((l) => l === want) ?? labels.find((l) => /\\.xmind$/i.test(l));
  return hit || null;
})()`);
if (!sample) throw new Error('no recent .xmind item visible under 最近打开');
ok('最近打开子菜单里有可点的文件', true, sample);
const item = await centre(sample);
await move(item.x, item.y);
await clickAt(item.x, item.y);
await wait(900);
let state = await menuState();
ok('点击最近打开项后文档已打开', state.doc === sample, state.doc);
ok('点击最近打开项后所有菜单面板消失', state.panels === 0, `panels=${state.panels}`);
ok('点击最近打开项后遮罩消失', !state.backdrop, `backdrop=${state.backdrop}`);

// --- 2. 另一个子菜单叶子动作（编辑 > 全选）--------------------------------
await clear();
await openMain();
const edit = await centre('编辑');
if (edit) {
  await hover('编辑');
  const selectAll = await centre('全选');
  if (selectAll) {
    await move(selectAll.x, selectAll.y);
    await clickAt(selectAll.x, selectAll.y);
    await wait(500);
    state = await menuState();
    ok('另一子菜单叶子动作同样关闭整个菜单', state.panels === 0 && !state.backdrop,
      `panels=${state.panels} backdrop=${state.backdrop}`);
  } else ok('编辑子菜单含「全选」', false, 'not found');
} else ok('主菜单含「编辑」', false, 'not found');

// --- 3. Escape 仍能关掉整个菜单树 -----------------------------------------
await clear();
await openMain();
await hover('最近打开');
const beforeEsc = await menuState();
await escape();
const afterEsc = await menuState();
ok('Escape 关闭整个菜单树', beforeEsc.panels > 1 && afterEsc.panels === 0 && !afterEsc.backdrop,
  `before=${beforeEsc.panels} after=${afterEsc.panels}`);

ws.close();
console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
process.exit(failures ? 1 : 0);
