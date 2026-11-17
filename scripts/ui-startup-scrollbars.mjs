// Regression for two startup / canvas behaviours:
//
//   1. Every launch opens a clean, unsaved "未命名" map (central topic + four
//      main topics), even when recovery/document.json still holds the previous
//      session's file. XMind never silently reopens that document.
//   2. Both canvas scrollbars are always visible and always draggable — at
//      10% and 500% zoom just as much as at 100%.
//
//   CDP_PORT=9223 node scripts/ui-startup-scrollbars.mjs [sample.xmind]
//
// Launch the app with XMIND_RS_DATA_DIR pointing at a copied data directory
// that contains recovery/document.json (previous session) and settings.json
// with a recent list, plus WEBVIEW2_* isolation and --remote-debugging-port.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const sample = process.argv[2] || 'example2.xmind';
const dataDir = process.env.XMIND_RS_DATA_DIR || '';

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
const mouse = (type, x, y, { button = 'left', buttons = 0, clickCount = 1 } = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });
const clickAt = async (x, y) => {
  await mouse('mousePressed', x, y, { buttons: 1 });
  await mouse('mouseReleased', x, y);
  await wait(120);
};
const drag = async (x0, y0, dx, dy) => {
  await mouse('mouseMoved', x0, y0, { button: 'none' });
  await mouse('mousePressed', x0, y0, { buttons: 1 });
  for (let i = 1; i <= 6; i += 1) {
    await mouse('mouseMoved', x0 + dx * i / 6, y0 + dy * i / 6, { buttons: 1 });
  }
  await mouse('mouseReleased', x0 + dx, y0 + dy);
  await wait(160);
};
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const escape = async () => { await key('Escape', 'Escape', 27); await wait(180); };

let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
for (let i = 0; i < 40; i += 1) {
  if (await ev('!!document.querySelector(".node") && !!document.querySelector(".scroll-x")')) break;
  await wait(250);
}
await wait(350);

console.log('启动文档 + 常驻滚动条 真机验证');

// --- 0. the recovery snapshot really does contain a *different* document ---
if (dataDir) {
  try {
    const prior = JSON.parse(readFileSync(join(dataDir, 'recovery', 'document.json'), 'utf8'));
    ok('数据目录里存在上一次会话的恢复快照', Boolean(prior.title), `title=${prior.title}`);
  } catch {
    ok('数据目录里存在上一次会话的恢复快照', false, 'missing');
  }
}

// --- 1. clean startup document -------------------------------------------
const startup = await ev(`(() => ({
  name: document.querySelector('.doc-name')?.textContent ?? '',
  status: (document.querySelector('.doc-status')?.textContent ?? '').trim(),
  titles: [...document.querySelectorAll('.node-title')].map((n) => n.textContent ?? ''),
  nodes: document.querySelectorAll('.node').length,
  zoom: document.querySelector('.sb-zoom-label')?.textContent ?? '',
}))()`);
ok('启动文件名为「未命名」', startup.name === '未命名', startup.name);
ok('启动文档是干净的（无「已编辑」）', startup.status === '', `status="${startup.status}"`);
ok('启动显示 1 中心主题 + 4 分支主题', startup.nodes === 5
  && startup.titles.filter((t) => t === '中心主题').length === 1
  && startup.titles.filter((t) => /^分支主题\s*[1-4]$/.test(t)).length === 4,
  `nodes=${startup.nodes} titles=${JSON.stringify(startup.titles)}`);

// --- 2. both bars are always present --------------------------------------
const bars = () => ev(`(() => {
  const x = document.querySelector('.scroll-x');
  const y = document.querySelector('.scroll-y');
  const corner = document.querySelector('.scroll-corner');
  const tx = document.querySelector('.scroll-x .scroll-thumb');
  const ty = document.querySelector('.scroll-y .scroll-thumb');
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const rx = rect(x), ry = rect(y), rtx = rect(tx), rty = rect(ty);
  return {
    x: !!x, y: !!y, corner: !!corner,
    thumbX: !!tx, thumbY: !!ty,
    w: rx?.width ?? 0, h: ry?.height ?? 0,
    thumbW: rtx?.width ?? 0, thumbH: rty?.height ?? 0,
    hostRight: rx?.right ?? 0, hostLeft: rx?.left ?? 0,
    hostBottom: ry?.bottom ?? 0, hostTop: ry?.top ?? 0,
    thumbXRight: rtx?.right ?? 0, thumbXLeft: rtx?.left ?? 0,
    thumbYBottom: rty?.bottom ?? 0, thumbYTop: rty?.top ?? 0,
    thumbXMidY: rtx ? rtx.y + rtx.height / 2 : 0,
    thumbYMidX: rty ? rty.x + rty.width / 2 : 0,
    thumbXMidX: rtx ? rtx.x + rtx.width / 2 : 0,
    thumbYMidY: rty ? rty.y + rty.height / 2 : 0,
  };
})()`);
const view = () => ev(`(() => {
  const stage = document.querySelector('.stage');
  if (!stage) return null;
  const m = new DOMMatrix(getComputedStyle(stage).transform);
  const tx = document.querySelector('.scroll-x .scroll-thumb');
  const ty = document.querySelector('.scroll-y .scroll-thumb');
  const mx = tx ? new DOMMatrix(getComputedStyle(tx).transform) : null;
  const my = ty ? new DOMMatrix(getComputedStyle(ty).transform) : null;
  return { tx: m.m41, ty: m.m42, scale: m.a, posX: mx?.m41 ?? 0, posY: my?.m42 ?? 0 };
})()`);

let b = await bars();
ok('水平 + 垂直滚动条 + 角块常驻', b.x && b.y && b.corner && b.thumbX && b.thumbY,
  `x=${b.x} y=${b.y} corner=${b.corner}`);
ok('两个滑块都有可见尺寸', b.thumbW > 20 && b.thumbH > 20,
  `thumb=${b.thumbW.toFixed(0)}x${b.thumbH.toFixed(0)}`);

// --- 3. setting an exact zoom through the status bar ----------------------
const centre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('.xm-item')].filter((n) => n.offsetParent !== null);
  const hit = all.find((n) => (n.querySelector('.xm-label')?.textContent ?? '').trim() === want);
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
const setZoom = async (percent) => {
  await escape();
  const btn = await ev(`(() => {
    const el = document.querySelector('.sb-zoom');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!btn) throw new Error('no zoom button');
  await clickAt(btn.x, btn.y);
  await wait(220);
  const item = await ev(`(() => {
    const want = ${JSON.stringify(`${percent}%`)};
    const el = [...document.querySelectorAll('.zoom-item')]
      .find((n) => (n.textContent ?? '').trim() === want);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!item) throw new Error(`zoom option ${percent}% not found`);
  await clickAt(item.x, item.y);
  await wait(300);
  return ev('document.querySelector(".sb-zoom-label")?.textContent ?? ""');
};

// --- 4. drag both thumbs at every zoom level ------------------------------
for (const percent of [10, 50, 100, 300, 500]) {
  await setZoom(percent);
  const label = await ev('document.querySelector(".sb-zoom-label")?.textContent ?? ""');
  b = await bars();
  if (!b.x || !b.y || !b.thumbX || !b.thumbY) {
    ok(`${percent}% 缩放两条滚动条仍在`, false, `x=${b.x} y=${b.y}`);
    continue;
  }
  const before = await view();
  const dx = b.thumbXRight + 80 < b.hostRight ? 80 : -80;
  await drag(b.thumbXMidX, b.thumbXMidY, dx, 0);
  const afterX = await view();
  const xMoved = dx > 0 ? afterX.tx < before.tx - 1 : afterX.tx > before.tx + 1;
  ok(`${percent}% 缩放水平滑块可拖动`, xMoved && Math.abs(afterX.posX - before.posX) > 1,
    `label=${label} tx ${before.tx.toFixed(1)}→${afterX.tx.toFixed(1)} posX ${before.posX.toFixed(1)}→${afterX.posX.toFixed(1)}`);

  const mid = await view();
  const dy = b.thumbYBottom + 70 < b.hostBottom ? 70 : -70;
  await drag(b.thumbYMidX, b.thumbYMidY, 0, dy);
  const afterY = await view();
  const yMoved = dy > 0 ? afterY.ty < mid.ty - 1 : afterY.ty > mid.ty + 1;
  ok(`${percent}% 缩放垂直滑块可拖动`, yMoved && Math.abs(afterY.posY - mid.posY) > 1,
    `ty ${mid.ty.toFixed(1)}→${afterY.ty.toFixed(1)} posY ${mid.posY.toFixed(1)}→${afterY.posY.toFixed(1)}`);
}

// --- 5. clicking the track jumps, and the wheel keeps the thumb in sync ----
await setZoom(100);
b = await bars();
const trackBefore = await view();
await clickAt(b.hostLeft + 6, b.thumbXMidY);
const trackAfter = await view();
ok('点击水平轨道可跳转', Math.abs(trackAfter.tx - trackBefore.tx) > 1,
  `tx ${trackBefore.tx.toFixed(1)}→${trackAfter.tx.toFixed(1)}`);

const wheelBefore = await view();
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel', x: Math.round(viewW / 2), y: Math.round(viewH / 2),
  deltaX: 0, deltaY: 120,
});
await wait(220);
const wheelAfter = await view();
ok('滚轮平移时垂直滑块同步', Math.abs(wheelAfter.ty - wheelBefore.ty) > 1
  && Math.abs(wheelAfter.posY - wheelBefore.posY) > 0.1,
  `ty ${wheelBefore.ty.toFixed(1)}→${wheelAfter.ty.toFixed(1)} posY ${wheelBefore.posY.toFixed(1)}→${wheelAfter.posY.toFixed(1)}`);

// --- 6. same bars on a real, much larger document -------------------------
const openRecent = async () => {
  await escape();
  const burger = await ev(`(() => {
    const r = document.querySelector('.menu-btn').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await clickAt(burger.x, burger.y);
  await wait(250);
  for (const label of ['文件', '最近打开']) {
    const at = await centre(label);
    if (!at) throw new Error(`menu item not found: ${label}`);
    await mouse('mouseMoved', at.x, at.y, { button: 'none' });
    await wait(220);
  }
  const item = await centre(sample) ?? await ev(`(() => {
    const all = [...document.querySelectorAll('.xm-item')].filter((n) => n.offsetParent !== null);
    const hit = all.find((n) => /\\.xmind$/i.test((n.querySelector('.xm-label')?.textContent ?? '').trim()));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!item) throw new Error(`recent item ${sample} not found`);
  await clickAt(item.x, item.y);
  await wait(900);
};
try {
  await openRecent();
  const big = await bars();
  const bigView = await view();
  ok('打开真实文件后滚动条仍常驻', big.x && big.y && big.corner && big.thumbW > 20,
    `name=${await ev('document.querySelector(".doc-name")?.textContent ?? ""')} thumbW=${big.thumbW.toFixed(0)}`);
  const dx2 = big.thumbXRight + 60 < big.hostRight ? 60 : -60;
  await drag(big.thumbXMidX, big.thumbXMidY, dx2, 0);
  const bigAfter = await view();
  ok('打开真实文件后水平滑块仍可拖动', Math.abs(bigAfter.tx - bigView.tx) > 1,
    `tx ${bigView.tx.toFixed(1)}→${bigAfter.tx.toFixed(1)}`);
} catch (error) {
  ok('打开真实文件后滚动条仍常驻', false, String(error));
}

ws.close();
console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
process.exit(failures ? 1 : 0);
