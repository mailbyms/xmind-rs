// End-to-end UI drive: build topics with the keyboard, then walk the 画布 tab
// (骨架 / 紧凑型布局 / 同级主题对齐 / 分支配色), dumping a metric + screenshot at
// every step. ZEN 与演说模式已整体移除，末尾只确认它们不再出现。
// Usage: node scripts/ui-verify.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/verify';
const PORT = process.env.CDP_PORT || 9223;
mkdirSync(outdir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await wait(220);
};
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
  }
  await wait(320);
};
/** Ctrl+Alt+P — kept only to prove the removed 演说 entry no longer fires. */
const chord = async (k, code, vk, modifiers) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key: k, code, windowsVirtualKeyCode: vk, modifiers,
    });
  }
  await wait(420);
};
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
  console.log('  shot', name);
};
const metrics = () => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.node')];
  const boxes = nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return { t: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 8),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cell: n.classList.contains('cell') };
  });
  return {
    count: boxes.length,
    decor: document.querySelectorAll('.edges path').length,
    nodes: boxes.slice(0, 14),
  };
})()`);

await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

await send('Page.bringToFront').catch(() => {});
await esc();

// ---------------------------------------------------------------- build tree
const clicked = await evaluate(`(() => {
  const root = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.node-title')?.textContent.trim() === '中心主题');
  if (!root) return 'no root';
  root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 300 }));
  root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 300 }));
  root.click();
  return 'ok';
})()`);
console.log('select root:', clicked);
await wait(300);
// one child (Tab), then two more branches as siblings (Enter twice)
await key('Tab', 'Tab', 9);
await key('Enter', 'Enter', 13);
await key('Enter', 'Enter', 13);
// add two children under the first branch: select it back and Tab twice
await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.node')];
  const branch = nodes.find((n) => (n.querySelector('.node-title')?.textContent || '').trim() === '分支主题 1');
  branch?.click();
  return branch ? 'ok' : 'missing';
})()`);
await wait(250);
await key('Tab', 'Tab', 9);
await key('Tab', 'Tab', 9);
await wait(400);
console.log('after build:', JSON.stringify(await metrics()));

// ---------------------------------------------------------------- 画布 tab
await evaluate(`(() => { [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布')?.click(); return 1; })()`);
await wait(350);
await shot('00-canvas-tab');

const pickSkeleton = async (group) => {
  await evaluate(`(() => {
    if (!document.querySelector('.pop.is-skeleton')) document.querySelector('.fp-bone')?.click();
    return 1;
  })()`);
  await wait(320);
  const ok = await evaluate(`(() => {
    const head = [...document.querySelectorAll('.pop.is-skeleton .bone-head')]
      .find((h) => h.textContent.trim() === ${JSON.stringify(group)});
    if (!head) return 'missing';
    head.scrollIntoView({ block: 'center' });
    const card = head.parentElement.querySelector('.bone-card');
    if (!card) return 'no card';
    card.click();
    return card.getAttribute('aria-label');
  })()`);
  await wait(900);
  // The board stays open after a pick (like the original) — close it for the shot.
  await key('Escape', 'Escape', 27);
  await wait(250);
  return ok;
};

for (const label of ['树型表格', '矩阵图', '括号图']) {
  const ok = await pickSkeleton(label);
  console.log(`skeleton ${label}:`, ok, JSON.stringify(await metrics()));
  await shot(`01-${label}`);
}

// ---------------------------------------------------------------- 紧凑型布局
const compactBox = await evaluate(`(() => {
  const label = [...document.querySelectorAll('.fp-check-label')].find((l) => l.textContent.trim() === '紧凑型布局');
  const box = label?.parentElement?.querySelector('input');
  if (!box) return 'missing';
  box.click();
  return String(box.checked);
})()`);
await wait(800);
console.log('compact toggle ->', compactBox, JSON.stringify(await metrics()));
await shot('02-compact');

// ---------------------------------------------------------------- 同级主题对齐
const alignBox = await evaluate(`(() => {
  const label = [...document.querySelectorAll('.fp-check-label')].find((l) => l.textContent.trim() === '同级主题对齐');
  const box = label?.parentElement?.querySelector('input');
  if (!box) return 'missing';
  box.click();
  return String(box.checked);
})()`);
await wait(800);
console.log('sibling align ->', alignBox, JSON.stringify(await metrics()));
await shot('03-no-align');

// turn both back off / on to leave a stable state
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-check-label')].find((l) => l.textContent.trim() === '同级主题对齐')?.parentElement?.querySelector('input')?.click();
  [...document.querySelectorAll('.fp-check-label')].find((l) => l.textContent.trim() === '紧凑型布局')?.parentElement?.querySelector('input')?.click();
  return 1;
})()`);
await wait(700);

// ---------------------------------------------------------------- 分支配色
await evaluate(`(() => { document.querySelector('.fp-rainbow')?.click(); return 1; })()`);
await wait(500);
const pal = await evaluate(`(() => {
  const discs = [...document.querySelectorAll('.pal-disc')];
  discs[5]?.click();
  return { count: discs.length, titles: discs.map((d) => d.title) };
})()`);
await wait(900);
console.log('branch palette:', JSON.stringify(pal));
await shot('04-branch-palette');

// --------------------------------------------------- present mode (removed)
// 演说模式已整体删除：Ctrl+Alt+P 不应再打开任何播放层。
await chord('p', 'KeyP', 80, 3); // Alt=1 + Ctrl=2
await wait(800);
console.log('present:', await evaluate(`(() => document.querySelector('.present') ? 'still present' : 'removed')()`));
await shot('09-present-removed');

ws.close();
