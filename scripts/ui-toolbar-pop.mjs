// Regression for the toolbar / side-panel change (2026-11-17):
//
//   1. The toolbar no longer has ZEN / 演说 buttons; the 格式 side panel no
//      longer has a 演说 tab (only 样式 / 画布).
//   2. 标记 opens a real marker picker that writes topic.markers through the
//      Rust command (canvas chip + doc_layout agree), and toggles off.
//   3. 插入 opens a real dropdown whose rows perform the corresponding insert
//      actions (子主题 / 笔记 / 主题属性…), not just an attrs-panel toggle.
//   4. Esc and outside clicks dismiss the popovers; ZEN / 演说 are gone for
//      good (Ctrl+Alt+F / Ctrl+Alt+P do nothing).
//
//   Run against a clean document:  node scripts/new-doc.mjs
//   CDP_PORT=9223 node scripts/ui-toolbar-pop.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
const outdir = process.argv[2] || 'target/verify';
mkdirSync(outdir, { recursive: true });

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
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1, ...extra });
const clickAt = async (x, y) => {
  await mouse('mousePressed', x, y);
  await mouse('mouseReleased', x, y);
  await wait(180);
};
const rectOf = (selector, text = '') => ev(`(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const hit = all.find((e) => !${JSON.stringify(text)} || (e.textContent ?? '').includes(${JSON.stringify(text)}))
    ?? all[0];
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
const press = async (k, code, vk, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
  }
  await wait(280);
};
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
};
const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
// CDP endpoint can be up before React has painted its first snapshot.
for (let i = 0; i < 40; i += 1) {
  const ready = await ev(`document.querySelectorAll('.node').length >= 1 && document.querySelectorAll('.toolbar .tool-label').length > 0`);
  if (ready) break;
  await wait(250);
}
await wait(300);
// Clear any leftover menu / dialog / popover.
await press('Escape', 'Escape', 27);
await clickAt(120, Math.round(viewH / 2));
await wait(200);

console.log('工具栏按钮 / 侧面板 / 标记 / 插入 真机验证');

// ------------------------------------------------------------------ 1. chrome
const toolLabels = await ev(`[...document.querySelectorAll('.toolbar .tool-label')].map(e => e.textContent.trim())`);
ok('工具栏不再有 ZEN 按钮', !toolLabels.includes('ZEN'), toolLabels.join('/'));
ok('工具栏不再有 演说 按钮', !toolLabels.includes('演说'), toolLabels.join('/'));
ok('工具栏保留 标记 / 插入', toolLabels.includes('标记') && toolLabels.includes('插入'));
// 上一轮可能把侧面板留在「主题属性」或关闭状态；先确保「格式」面板打开。
if (!(await ev(`!!document.querySelector('.fp')`))) {
  await ev(`(() => {
    const b = [...document.querySelectorAll('.toolbar .tool-item')].find((i) =>
      (i.querySelector('.tool-label')?.textContent ?? '').trim() === '格式');
    b?.querySelector('button')?.click();
    return 1;
  })()`);
  await wait(350);
}
const tabs = await ev(`[...document.querySelectorAll('.fp-tabs button')].map(e => e.textContent.trim())`);
ok('侧面板只剩 样式 / 画布 两个 tab', tabs.length === 2 && tabs.includes('样式') && tabs.includes('画布'), tabs.join('/'));
ok('侧面板无 演说 tab', !tabs.includes('演说'));

// ------------------------------------------------------------------ 2. selection
const rootAt = await rectOf('.node', '中心主题');
if (!rootAt) throw new Error('no central topic on canvas');
await clickAt(rootAt.x, rootAt.y);
ok('中心主题已选中', await ev(`document.querySelectorAll('.topic-outline').length`) === 1);

const toolAt = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('.toolbar .tool-item')].find((i) =>
    (i.querySelector('.tool-label')?.textContent ?? '').trim() === ${JSON.stringify(label)});
  if (!b) return null;
  const r = b.querySelector('button').getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

// ------------------------------------------------------------------ 3. marker
const markerAt = await toolAt('标记');
await clickAt(markerAt.x, markerAt.y);
ok('标记按钮打开标记弹层', await ev(`!!document.querySelector('.tool-pop-marker')`));
const markerCount = await ev(`document.querySelectorAll('.tp-mark').length`);
ok('弹层列出 11 个原生标记', markerCount === 11, `count=${markerCount}`);
ok('标记按钮处于按下态', await ev(`[...document.querySelectorAll('.toolbar .tool-item.on .tool-label')].some(e => e.textContent.trim() === '标记')`));
await shot('toolbar-marker-pop');
await ev(`document.querySelectorAll('.tp-mark')[0].click()`);
await wait(400);
const chips = await ev(`document.querySelectorAll('.node-markers .marker-chip').length`);
ok('点击标记后画布出现角标', chips === 1, `chips=${chips}`);
const backendMarkers = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.markers ?? []))`);
ok('Rust doc_layout 已写入 priority-1', JSON.stringify(backendMarkers) === '["priority-1"]', JSON.stringify(backendMarkers));
ok('弹层保持打开且该标记高亮', await ev(`!!document.querySelector('.tp-mark.on') && !!document.querySelector('.tool-pop-marker')`));
await ev(`document.querySelectorAll('.tp-mark')[0].click()`);
await wait(400);
ok('再次点击取消标记', await ev(`document.querySelectorAll('.node-markers .marker-chip').length`) === 0);

// ------------------------------------------------------------------ 4. Esc / outside
await press('Escape', 'Escape', 27);
ok('Esc 关闭标记弹层', await ev(`!document.querySelector('.tool-pop')`));
const insertAt = await toolAt('插入');
await clickAt(insertAt.x, insertAt.y);
ok('Esc 之后插入按钮仍能打开下拉', await ev(`!!document.querySelector('.tool-pop-insert')`));
await clickAt(120, Math.round(viewH / 2));
ok('点击画布空白处关闭下拉', await ev(`!document.querySelector('.tool-pop')`));
// 空白点击会清空选中；插入下拉里 needsTopic 的条目此时应处于禁用态。
await clickAt(insertAt.x, insertAt.y);
ok('无选中时「子主题」条目被禁用', await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('子主题'))?.disabled`) === true);
await press('Escape', 'Escape', 27);
await clickAt(rootAt.x, rootAt.y);
ok('重新选中中心主题', await ev(`document.querySelectorAll('.topic-outline').length`) === 1);

// ------------------------------------------------------------------ 5. insert rows
await clickAt(insertAt.x, insertAt.y);
const rows = await ev(`[...document.querySelectorAll('.tp-row')].map(e => e.textContent.trim())`);
ok('插入下拉含 19 个真实条目', rows.length === 19, `count=${rows.length}`);
ok('插入下拉含 子主题 / 笔记 / 主题属性', ['子主题', '笔记', '主题属性'].every((s) => rows.some((r) => r.includes(s))));
await shot('toolbar-insert-pop');
const beforeNodes = await ev(`document.querySelectorAll('.node').length`);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('子主题')).click()`);
await wait(500);
const afterNodes = await ev(`document.querySelectorAll('.node').length`);
ok('插入 > 子主题 真正新增主题', afterNodes === beforeNodes + 1, `${beforeNodes} → ${afterNodes}`);
ok('执行后下拉自动关闭', await ev(`!document.querySelector('.tool-pop')`));

// 笔记：输入弹窗写入 note，再打开时值被回读
await clickAt(insertAt.x, insertAt.y);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('笔记')).click()`);
await wait(300);
ok('插入 > 笔记 打开输入弹窗', await ev(`document.querySelector('.rename-title')?.textContent`) === '插入笔记');
const noteAt = await rectOf('.rename-input');
if (!noteAt) throw new Error('note input missing');
await clickAt(noteAt.x, noteAt.y);
await send('Input.insertText', { text: '工具栏回归写入的笔记' });
await wait(150);
await ev(`[...document.querySelectorAll('.rename-actions button')].find(b => b.textContent.includes('确定')).click()`);
await wait(400);
await clickAt(insertAt.x, insertAt.y);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('笔记')).click()`);
await wait(300);
ok('笔记已写入文档并可回读', await ev(`document.querySelector('.rename-input')?.value`) === '工具栏回归写入的笔记');
await ev(`[...document.querySelectorAll('.rename-actions button')].find(b => b.textContent.includes('取消')).click()`);
await wait(200);

// 主题属性：插入下拉里保留侧面板入口
await clickAt(insertAt.x, insertAt.y);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('主题属性')).click()`);
await wait(400);
ok('插入 > 主题属性… 打开侧面板', await ev(`!!document.querySelector('.panel .panel-head h3')`));
ok('打开侧面板后下拉已关闭', await ev(`!document.querySelector('.tool-pop')`));
await ev(`document.querySelector('.panel-close')?.click()`);
await wait(200);

// ------------------------------------------------- 6. ZEN / 演说 fully removed
await press('f', 'KeyF', 70, 3);
ok('Ctrl+Alt+F 不再进入 ZEN', await ev(`!document.querySelector('.app').classList.contains('zen')`));
ok('无 ZEN 退出按钮', await ev(`!document.querySelector('.zen-exit')`));
await press('p', 'KeyP', 80, 3);
await wait(800);
ok('Ctrl+Alt+P 不再进入演说模式', await ev(`!document.querySelector('.present')`));

console.log(fail.length === 0 ? '\nALL PASS' : `\n${fail.length} FAILED: ${fail.join(', ')}`);
ws.close();
if (fail.length > 0) process.exit(1);
