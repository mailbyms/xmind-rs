// Regression for the toolbar / side-panel change (2026-11-17):
//
//   1. The toolbar no longer has ZEN / 演说 buttons; the 格式 side panel no
//      longer has a 演说 tab (only 样式 / 画布).
//   2. 标记 opens the official marker catalogue (7 groups / 58 icons) and
//      writes topic.markers through the Rust command; clicking the same id is
//      idempotent, another marker in the same group replaces it (FINDINGS §43).
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
let rootAt = await rectOf('.node', '中心主题');
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
const header = await ev(`(() => ({
  tabs: document.querySelectorAll('.tool-pop-marker .tp-tab').length,
  active: document.querySelectorAll('.tool-pop-marker .tp-tab.on').length,
  close: !!document.querySelector('.tool-pop-marker .tp-close'),
  width: Math.round(document.querySelector('.tool-pop-marker').getBoundingClientRect().width),
  tabIcons: [...document.querySelectorAll('.tool-pop-marker .tp-tab img')].map(i => i.getAttribute('src')),
}))()`);
ok('顶栏有三个官方图标页签且标记页签激活', header.tabs === 3 && header.active === 1, JSON.stringify(header));
ok('顶栏有可点击的关闭按钮', header.close);
ok('面板宽度与原版 268px 一致', header.width === 268, `width=${header.width}`);
ok('页签图标来自 app.asar 提取的官方 SVG', JSON.stringify(header.tabIcons) === JSON.stringify(['/markers/ui/marker.svg', '/markers/ui/sticker.svg', '/markers/ui/illustration.svg']), JSON.stringify(header.tabIcons));
const markerCount = await ev(`document.querySelectorAll('.tp-mark').length`);
ok('弹层列出 58 个官方标记', markerCount === 58, `count=${markerCount}`);
const groupTitles = await ev(`[...document.querySelectorAll('.tp-group .tp-title')].map(e => e.textContent.trim())`);
ok('分组顺序与官方一致', JSON.stringify(groupTitles) === JSON.stringify(['标签', '优先级', '任务', '旗帜', '星星', '人像', '符号']), JSON.stringify(groupTitles));
const iconsOk = await ev(`(() => {
  const imgs = [...document.querySelectorAll('.tp-mark-icon')];
  return imgs.length === 58 && imgs.every(i => i.getAttribute('src')?.startsWith('/markers/'));
})()`);
ok('每个入口使用官方 SVG 图标', iconsOk);
ok('标记按钮处于按下态', await ev(`[...document.querySelectorAll('.toolbar .tool-item.on .tool-label')].some(e => e.textContent.trim() === '标记')`));
await shot('toolbar-marker-pop');
await ev(`document.querySelector('.tp-mark[data-marker-id="tag-red"]').click()`);
await wait(400);
const chips = await ev(`document.querySelectorAll('.node-markers .marker-chip').length`);
ok('点击标记后画布出现官方图标角标', chips === 1 && await ev(`!!document.querySelector('.node-markers .marker-chip img')`), `chips=${chips}`);
const backendMarkers = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.markers ?? []))`);
ok('Rust doc_layout 已写入 tag-red', JSON.stringify(backendMarkers) === '["tag-red"]', JSON.stringify(backendMarkers));
ok('弹层保持打开且官方无选中高亮', await ev(`!!document.querySelector('.tool-pop-marker') && !document.querySelector('.tp-mark.on')`));
await ev(`document.querySelector('.tp-mark[data-marker-id="tag-red"]').click()`);
await wait(400);
ok('再次点击同一标记不会移除（与官方一致）', await ev(`document.querySelectorAll('.node-markers .marker-chip').length`) === 1);
await ev(`document.querySelector('.tp-mark[data-marker-id="priority-1"]').click()`);
await wait(400);
ok('可连续添加不同标记', await ev(`document.querySelectorAll('.node-markers .marker-chip').length`) === 2);
await ev(`document.querySelector('.tp-legend-btn').click()`);
ok('图例列出本图已用标记', await ev(`document.querySelectorAll('.tp-legend-row').length`) === 2);
await ev(`document.querySelector('.tp-close').click()`);
ok('关闭按钮关闭标记弹层', await ev(`!document.querySelector('.tool-pop')`));
await clickAt(markerAt.x, markerAt.y);

// 标记会加宽主题盒，之前记下的中心点可能已经落到盒外，重新量一次。
rootAt = await rectOf('.node', '中心主题');

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
ok('无选中时「笔记」条目被禁用', await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('笔记'))?.disabled`) === true);
await press('Escape', 'Escape', 27);
await clickAt(rootAt.x, rootAt.y);
ok('重新选中中心主题', await ev(`document.querySelectorAll('.topic-outline').length`) === 1);

// ------------------------------------------------------------------ 5. insert rows
await clickAt(insertAt.x, insertAt.y);
const rows = await ev(`[...document.querySelectorAll('.tp-row')].map(e => e.textContent.trim())`);
ok('插入下拉严格保留原版 5 项', JSON.stringify(rows) === JSON.stringify(['笔记', '标签', '贴纸', '插画', '本地图片']), JSON.stringify(rows));
ok('不实现 链接 / 附件 / 语音备注 / 方程', !['链接', '附件', '语音备注', '方程'].some((s) => rows.includes(s)), JSON.stringify(rows));
await shot('toolbar-insert-pop');

// 笔记：主题下方的浮层写入 note，再打开时值被回读
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('笔记')).click()`);
await wait(300);
ok('插入 > 笔记 打开主题下方浮层', await ev(`!!document.querySelector('.topic-inline-editor.editor-note')`));
const noteAt = await rectOf('.topic-inline-editor.editor-note .tie-input');
if (!noteAt) throw new Error('note input missing');
await clickAt(noteAt.x, noteAt.y);
await send('Input.insertText', { text: '工具栏回归写入的笔记' });
await wait(150);
await ev(`[...document.querySelectorAll('.topic-inline-editor .tie-actions button')].find(b => b.textContent.includes('确定')).click()`);
await wait(400);
await clickAt(insertAt.x, insertAt.y);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('笔记')).click()`);
await wait(300);
ok('笔记已写入文档并可回读', await ev(`document.querySelector('.topic-inline-editor.editor-note .tie-input')?.value`) === '工具栏回归写入的笔记');
await ev(`[...document.querySelectorAll('.topic-inline-editor .tie-actions button')].find(b => b.textContent.includes('取消')).click()`);
await wait(200);
ok('有笔记的主题右上角显示纸页角标', await ev(`(() => {
  const badge = document.querySelector('.node-note');
  return !!badge && (badge.getAttribute('title') ?? '').includes('工具栏回归写入的笔记');
})()`));
await ev(`document.querySelector('.node-note').click()`);
await wait(250);
ok('点击纸页角标重新打开笔记浮层', await ev(`document.querySelector('.topic-inline-editor.editor-note .tie-input')?.value`) === '工具栏回归写入的笔记');
await ev(`[...document.querySelectorAll('.topic-inline-editor .tie-actions button')].find(b => b.textContent.includes('取消')).click()`);
await wait(150);

// 标签：半角逗号分隔，写回 labels 数组
await clickAt(insertAt.x, insertAt.y);
await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.includes('标签')).click()`);
await wait(300);
ok('插入 > 标签 打开主题下方浮层', await ev(`!!document.querySelector('.topic-inline-editor.editor-label')`));
ok('标签浮层提示半角逗号', await ev(`document.querySelector('.topic-inline-editor.editor-label .tie-hint')?.textContent.includes('半角逗号')`) === true);
const labelAt = await rectOf('.topic-inline-editor.editor-label .tie-input');
if (!labelAt) throw new Error('label input missing');
await clickAt(labelAt.x, labelAt.y);
await send('Input.insertText', { text: '甲, 乙' });
await ev(`[...document.querySelectorAll('.topic-inline-editor .tie-actions button')].find(b => b.textContent.includes('确定')).click()`);
await wait(400);
const labels = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.labels ?? []))`);
ok('标签写入 Rust 文档', JSON.stringify(labels) === JSON.stringify(['甲', '乙']), JSON.stringify(labels));

// 标签渲染：13px / 23px 胶囊，挂在盒下方，后端已为它预留纵向空间。
ok('标签渲染为 13px/23px 胶囊', await ev(`(() => {
  const chips = [...document.querySelectorAll('.label-chip')];
  if (chips.length !== 2) return false;
  const s = getComputedStyle(chips[0]);
  return s.height === '23px' && s.fontSize === '13px';
})()`));
ok('标签不与任何主题盒重叠', await ev(`(() => {
  const chips = [...document.querySelectorAll('.label-chip')].map(c => c.getBoundingClientRect());
  if (!chips.length) return false;
  const top = Math.min(...chips.map(c => c.top));
  const bottom = Math.max(...chips.map(c => c.bottom));
  const left = Math.min(...chips.map(c => c.left));
  const right = Math.max(...chips.map(c => c.right));
  return ![...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect())
    .some(b => b.top < bottom && b.bottom > top && b.left < right && b.right > left);
})()`));
ok('标签宽度不超过所属主题盒', await ev(`(() => {
  const chip = document.querySelector('.label-chip');
  if (!chip) return false;
  const box = chip.closest('.node').getBoundingClientRect();
  const r = chip.getBoundingClientRect();
  return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
})()`));

// 点击标签 → 就地编辑器；可改名、可删除（原版没有入口，这里补上）。
const chip0 = await rectOf('.label-chip');
await clickAt(chip0.x, chip0.y);
await wait(250);
ok('点击标签打开就地编辑器', await ev(`document.querySelector('.le-input')?.value`) === '甲');
await ev(`(() => { const i = document.querySelector('.le-input'); i.focus(); i.select(); return true; })()`);
await send('Input.insertText', { text: '丙' });
await ev(`[...document.querySelectorAll('.label-editor .le-actions button')].find(b => b.textContent === '确定').click()`);
await wait(400);
const renamed = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.labels ?? []))`);
ok('标签可就地改名', JSON.stringify(renamed) === JSON.stringify(['丙', '乙']), JSON.stringify(renamed));
const chip1 = await rectOf('.label-chip', '乙');
await clickAt(chip1.x, chip1.y);
await wait(250);
await ev(`document.querySelector('.label-editor .le-del').click()`);
await wait(400);
const afterDelete = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.labels ?? []))`);
ok('标签可就地删除', JSON.stringify(afterDelete) === JSON.stringify(['丙']), JSON.stringify(afterDelete));
ok('删除后画布只剩一个标签', await ev(`document.querySelectorAll('.label-chip').length`) === 1);

// 贴纸 / 插画：同一图标面板的另两个页签，点击后写 topic.image 资源
for (const [label, tabSrc, dir] of [
  ['贴纸', '/markers/ui/sticker.svg', '/stickers/'],
  ['插画', '/markers/ui/illustration.svg', '/illustrations/'],
]) {
  await clickAt(insertAt.x, insertAt.y);
  await ev(`[...document.querySelectorAll('.tp-row')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click()`);
  await wait(250);
  const panel = await ev(`(() => {
    const p = document.querySelector('.tool-pop-marker.icon-mode');
    if (!p) return null;
    return {
      active: p.querySelector('.tp-tab.on img')?.getAttribute('src'),
      category: p.querySelector('.tp-category select')?.value,
      icons: p.querySelectorAll('.tp-icon-item').length,
    };
  })()`);
  ok(`插入 > ${label} 打开图标面板对应页签`, panel?.active === tabSrc && panel?.category === '全部' && panel?.icons > 0, JSON.stringify(panel));
  await ev(`(() => {
    const s = document.querySelector('.tp-category select');
    const value = s.options[1].value;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return value;
  })()`);
  await wait(150);
  ok(`${label}「类别」筛选只显示所选分组`, await ev(`document.querySelectorAll('.tool-pop-marker.icon-mode .tp-group .tp-title').length`) === 1);
  await shot(`toolbar-icon-panel-${label === '贴纸' ? 'sticker' : 'illustration'}`);
  await ev(`document.querySelector('.tp-icon-item:not(:disabled)').click()`);
  await wait(1000);
  const image = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => (l.nodes.find(n => n.depth === 0)?.image ?? null))`);
  const toast = await ev(`document.querySelector('.toast')?.textContent ?? ''`);
  ok(`点击${label}写入主题图片资源`, typeof image === 'string' && image.endsWith('.svg'), `${image} toast=${toast}`);
  ok(`插入${label}后面板保持打开（与官方一致）`, await ev(`!!document.querySelector('.tool-pop-marker.icon-mode')`));
  await ev(`document.querySelector('.tp-close').click()`);
  await wait(150);
}
await clickAt(insertAt.x, insertAt.y);
ok('本地图片行存在且可用', await ev(`(() => {
  const row = [...document.querySelectorAll('.tp-row')].find(e => e.textContent.trim() === '本地图片');
  return !!row && !row.disabled;
})()`));
await press('Escape', 'Escape', 27);

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
