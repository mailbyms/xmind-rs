// Real-app verification for the full menu system: the hamburger application
// menu, the blank-canvas context menu and the topic context menus.
// Labels / order / separators / enabled states are diffed against the trees
// captured from the running XMind 23.07 (target/app-menu-full.json,
// target/ctx-menus.json). Usage: node scripts/ui-menus.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
mkdirSync('target/verify', { recursive: true });
const origMain = JSON.parse(readFileSync('target/app-menu-full.json', 'utf8'));
const origCtx = JSON.parse(readFileSync('target/ctx-menus.json', 'utf8'));

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, { button = 'left', buttons = 0 } = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
const clickAt = async (x, y, button = 'left') => {
  const bits = button === 'right' ? 2 : 1;
  await mouse('mousePressed', x, y, { button, buttons: bits });
  await mouse('mouseReleased', x, y, { button, buttons: 0 });
  await wait(240);
};
const press = async (key, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk });
  }
  await wait(180);
};

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};
const norm = (s) => String(s ?? '').replace(/折叠子主题|展开子主题/g, '折叠/展开子主题')
  .replace(/CmdOrCtrl/g, 'Ctrl').replace(/Ctrl\+Plus/g, 'Ctrl++');
const labels = (items) => items.map((i) => i.type === 'separator' || i.sep ? '---' : norm(i.label));
const expectedCtx = (key) => origCtx[key].flat();

/** All currently open menu columns, each as a list of rows. */
const readMenus = () => ev(`(() => JSON.stringify(
  [...document.querySelectorAll('.xm-panel')].map(p =>
    [...p.children].map(el => el.classList.contains('xm-sep') ? { sep: true } : {
      label: el.querySelector('.xm-label')?.textContent ?? '',
      shortcut: el.querySelector('.xm-shortcut')?.textContent ?? null,
      disabled: !!el.disabled,
      checked: !!el.querySelector('.xm-tick')?.textContent.trim(),
      submenu: !!el.querySelector('.xm-arrow'),
    }))))()`).then((s) => JSON.parse(s));
const one = async () => (await readMenus())[0] ?? [];

const openMain = async () => {
  await ev(`document.querySelector('.menu-btn').click()`);
  await wait(180);
};
const closeAll = async () => { await press('Escape', 'Escape', 27); await wait(120); };
const rowPos = (label, panel = 0, button = 'left') => ev(`(() => {
  const p = [...document.querySelectorAll('.xm-panel')][${panel}];
  const b = p && [...p.querySelectorAll('.xm-item')]
    .find(el => el.querySelector('.xm-label')?.textContent === ${JSON.stringify(label)});
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled });
})()`).then((s) => (s ? JSON.parse(s) : null));
const hover = async (label, panel = 0) => {
  const p = await rowPos(label, panel);
  if (!p) return null;
  await mouse('mouseMoved', p.x, p.y);
  await wait(220);
  return readMenus();
};
const clickRow = async (label, panel = 0) => {
  const p = await rowPos(label, panel);
  if (!p) return false;
  await clickAt(p.x, p.y);
  return true;
};
const nodeCentre = (which) => ev(`(() => {
  const all = [...document.querySelectorAll('.node')];
  const n = ${which === 'root' ? 'all[0]' : `all.find(el => el.querySelector('.node-title')?.textContent?.includes('分支主题'))`};
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, id: n.getAttribute('data-id') });
})()`).then((s) => (s ? JSON.parse(s) : null));
const emptyPoint = () => ev(`(() => {
  const c = document.querySelector('.canvas').getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect());
  for (let y = c.top + 60; y < c.bottom - 40; y += 24) {
    for (let x = c.left + 40; x < c.right - 40; x += 24) {
      if (boxes.every(b => x < b.left - 10 || x > b.right + 10 || y < b.top - 10 || y > b.bottom + 10)) {
        return JSON.stringify({ x, y });
      }
    }
  }
  return null;
})()`).then((s) => (s ? JSON.parse(s) : null));
const countNodes = () => ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l => l.nodes.length)`);
const statusText = () => ev(`[...document.querySelectorAll('.sb-btn')]
  .map(e => e.textContent.trim()).find(t => t.startsWith('主题:')) || ''`);

console.log('完整菜单系统 真机验证');

// ---------------------------------------------------------------- 主菜单
await openMain();
const top = await one();
ok('汉堡菜单打开为 xm-panel 面板', top.length > 0, `${top.length} 行`);
const expTop = labels(origMain);
const gotTop = labels(top);
ok('主菜单顶层条目与分隔线顺序 == 原版', JSON.stringify(gotTop) === JSON.stringify(expTop),
  JSON.stringify(gotTop) === JSON.stringify(expTop) ? `${gotTop.length} 行` : `got ${gotTop.join('|')}`);
ok('主菜单 撤销/重做 快捷键', top[0]?.shortcut === 'Ctrl+Z' && top[1]?.shortcut === 'Ctrl+Y',
  `${top[0]?.shortcut} / ${top[1]?.shortcut}`);
ok('主菜单含全部 6 个分组子菜单',
  ['文件', '编辑', '插入', '工具', '查看', '帮助'].every((l) => top.some((r) => r.label === l && r.submenu)));

for (const group of ['文件', '编辑', '插入', '工具', '查看', '帮助']) {
  const panels = await hover(group);
  const sub = panels?.[1];
  const actual = labels(sub ?? []);
  if (group === '帮助') {
    // Deliberate departure from the shipped menu: this offline rebuild keeps
    // only the two real help commands (see FINDINGS §31.3).
    ok('主菜单「帮助」子菜单只保留两项',
      JSON.stringify(actual) === JSON.stringify(['快捷键命令', '关于 xmind-rs']),
      `got ${actual.join('|')}`);
  } else {
    const expected = labels(origMain.find((i) => i.label === group)?.sub ?? []);
    ok(`主菜单「${group}」子菜单条目 == 原版`, JSON.stringify(actual) === JSON.stringify(expected),
      JSON.stringify(actual) === JSON.stringify(expected) ? `${actual.length} 行` : `got ${actual.join('|')}`);
  }
  await mouse('mouseMoved', 4, 4);
  await wait(120);
}
// 帮助菜单按产品要求精简；工具栏切换是勾选态。
const helpPanels = await hover('帮助');
const helpRows = helpPanels?.[1] ?? [];
ok('帮助菜单第一项为「快捷键命令」且快捷键正确',
  helpRows[0]?.label === '快捷键命令' && helpRows[0]?.shortcut === 'Ctrl+Shift+/',
  `${helpRows[0]?.label} / ${helpRows[0]?.shortcut}`);
ok('帮助菜单只有两项且都可用',
  helpRows.length === 2 && helpRows.every((r) => !r.disabled)
    && helpRows[1]?.label === '关于 xmind-rs',
  helpRows.map((r) => `${r.label}:${r.disabled}`).join(' | '));

const viewPanels = await hover('查看');
const toolPanels = await hover('工具栏', 1);
const toolbarRows = toolPanels?.[2] ?? [];
ok('查看 > 工具栏 有且仅有一个勾选项',
  toolbarRows.filter((r) => r.checked).length === 1,
  toolbarRows.map((r) => `${r.label}:${r.checked}`).join(' '));
await closeAll();
ok('Escape 关闭整个菜单树', (await readMenus()).length === 0);

// ------------------------------------------------------------ 画布右键菜单
const blank = await emptyPoint();
await clickAt(blank.x, blank.y, 'right');
const canvasRows = await one();
const expBlank = labels(expectedCtx('blank'));
ok('画布空白处右键菜单条目 == 原版', JSON.stringify(labels(canvasRows)) === JSON.stringify(expBlank),
  labels(canvasRows).join('|'));
ok('画布右键「展开所有子分支」按禁用态显示',
  canvasRows.some((r) => r.label === '展开所有子分支' && r.disabled));
ok('画布右键「插入联系」快捷键 Ctrl+Shift+R',
  canvasRows.some((r) => r.label === '插入联系' && r.shortcut === 'Ctrl+Shift+R'));

// Real action: 插入自由主题 adds a node.
const beforeAdd = await countNodes();
await clickRow('插入自由主题');
const afterAdd = await countNodes();
ok('画布右键「插入自由主题」真实新增主题', afterAdd === beforeAdd + 1, `${beforeAdd} → ${afterAdd}`);
await closeAll();

// ------------------------------------------------------------ 主题右键菜单
const branch = await nodeCentre('branch');
await clickAt(branch.x, branch.y, 'right');
const branchRows = await one();
const expBranch = labels(expectedCtx('branch'));
ok('分支主题右键菜单条目 == 原版', JSON.stringify(labels(branchRows)) === JSON.stringify(expBranch),
  labels(branchRows).join('|'));
const disabledOf = (rows, label) => rows.find((r) => r.label === label)?.disabled;
ok('分支主题右键 剪切/复制/删除 均可用',
  ['剪切', '复制', '删除'].every((l) => disabledOf(branchRows, l) === false));
ok('分支主题右键 重设样式/重设位置 禁用',
  disabledOf(branchRows, '重设样式') === true && disabledOf(branchRows, '重设位置') === true);
ok('分支主题右键 导出分支为/打印分支 可用（与原版一致）',
  disabledOf(branchRows, '导出分支为') === false && disabledOf(branchRows, '打印分支...') === false);
const insertPanels = await hover('插入');
const insertRows = insertPanels?.[1] ?? [];
const expInsert = labels(expectedCtx('branch')[0].submenu);
ok('主题右键「插入」子菜单条目 == 原版',
  JSON.stringify(labels(insertRows)) === JSON.stringify(expInsert), labels(insertRows).join('|'));
ok('主题右键「插入」十项全部可用（含附件/贴纸/方程）',
  insertRows.filter((r) => !r.sep).length === 10
    && insertRows.filter((r) => !r.sep).every((r) => !r.disabled),
  `${insertRows.filter((r) => !r.sep).length} 行`);

// Real action: 复制 duplicates the selected branch.
await closeAll();
await clickAt(branch.x, branch.y, 'right');
const beforeDup = await countNodes();
await clickRow('复制');
const afterDup = await countNodes();
ok('主题右键「复制」真实复制主题', afterDup === beforeDup + 1, `${beforeDup} → ${afterDup}`);

// ------------------------------------------------------------ 中心主题右键
const root = await nodeCentre('root');
await clickAt(root.x, root.y, 'right');
const rootRows = await one();
const expTopic = labels(expectedCtx('topic'));
ok('中心主题右键菜单条目 == 原版', JSON.stringify(labels(rootRows)) === JSON.stringify(expTopic),
  labels(rootRows).join('|'));
ok('中心主题右键 剪切/复制/删除/删除单个主题 禁用',
  ['剪切', '复制', '删除', '删除单个主题'].every((l) => disabledOf(rootRows, l) === true));
ok('中心主题右键没有 展开子主题 行', !rootRows.some((r) => /子主题/.test(r.label ?? '')));
await closeAll();

// ------------------------------------------------------------ 主菜单动作
await openMain();
const editPanels = await hover('编辑');
ok('主菜单「编辑」子菜单展开', (editPanels?.[1] ?? []).length > 10);
await clickRow('全选', 1);
const status = await statusText();
ok('主菜单「编辑 > 全选」选中全部主题', /^主题:\s*\d+\s*\/\s*\d+/.test(status)
  && status.split('/')[0].replace(/\D/g, '') === status.split('/')[1].replace(/\D/g, ''), status);
await closeAll();

// -------------------------------------------------- 键盘导航与视口约束
await openMain();
await press('ArrowDown', 'ArrowDown', 40);
ok('ArrowDown 聚焦菜单行', await ev(`document.querySelectorAll('.xm-item.focus').length`) === 1);
for (let i = 0; i < 25; i += 1) {
  const label = await ev(`document.querySelector('.xm-item.focus .xm-label')?.textContent || ''`);
  if (label === '文件') break;
  await press('ArrowDown', 'ArrowDown', 40);
}
ok('方向键可导航到「文件」行',
  (await ev(`document.querySelector('.xm-item.focus .xm-label')?.textContent || ''`)) === '文件');
await press('ArrowRight', 'ArrowRight', 39);
ok('ArrowRight 展开子菜单', (await readMenus()).length >= 2);
await press('ArrowLeft', 'ArrowLeft', 37);
ok('ArrowLeft 收起子菜单', (await readMenus()).length === 1);
await closeAll();

const blank2 = await emptyPoint();
await clickAt(blank2.x, blank2.y, 'right');
const inViewport = await ev(`(() => {
  const p = document.querySelector('.xm-panel'); if (!p) return false;
  const r = p.getBoundingClientRect();
  return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
})()`);
ok('右键菜单始终留在视口内', inViewport === true);
await closeAll();

writeFileSync('target/verify/menus.json', JSON.stringify({
  top: gotTop, canvas: labels(canvasRows), branch: labels(branchRows), root: labels(rootRows),
}, null, 2));
console.log(`\n${fail.length ? `FAILED: ${fail.length}` : 'ALL PASS'} — target/verify/menus.json`);
if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; }
ws.close();
