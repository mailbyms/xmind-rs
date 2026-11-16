// Screenshot the 骨架 × 配色 combinations that used to paint white on white.
// Drives the real panel (not IPC), so React re-renders the canvas.
// Usage: node scripts/shot-contrast.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/contrast';
mkdirSync(outdir, { recursive: true });
const PORT = process.env.CDP_PORT || 9223;
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? 'eval failed'));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
  console.log('  shot', name);
};
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
  }
  await wait(320);
};

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await key('Escape', 'Escape', 27);
await evaluate(`window.__TAURI_INTERNALS__.invoke('doc_new')`);
await wait(600);

// ------------------------------------------------ build a three-level tree
await evaluate(`(() => {
  const root = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.node-title')?.textContent.trim() === '中心主题');
  root?.click();
  return root ? 'ok' : 'missing';
})()`);
await wait(250);
await key('Tab', 'Tab', 9);      // 分支主题 1
await key('Enter', 'Enter', 13); // 分支主题 2
await key('Enter', 'Enter', 13); // 分支主题 3
await key('Enter', 'Enter', 13); // 分支主题 4
await evaluate(`(() => {
  const b = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.node-title')?.textContent.trim() === '分支主题 1');
  b?.click(); return b ? 'ok' : 'missing';
})()`);
await wait(250);
await key('Tab', 'Tab', 9);
await key('Tab', 'Tab', 9);
await wait(300);

// 骨架/配色 live on the 画布 tab.
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布')?.click();
  return 1;
})()`);
await wait(400);

const pickSkeleton = async (title) => {
  await evaluate(`(() => { document.querySelector('.fp-bone')?.click(); return 1; })()`);
  await wait(400);
  const res = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.pop.is-skeleton .bone-card')]
      .find((c) => c.getAttribute('aria-label') === ${JSON.stringify(title)});
    if (!card) return 'missing';
    card.scrollIntoView({ block: 'center' });
    card.click();
    return card.getAttribute('aria-label');
  })()`);
  await wait(900);
  await key('Escape', 'Escape', 27);
  return res;
};

const pickPalette = async (name, tab) => {
  await evaluate(`(() => { document.querySelector('button[title="选择配色方案。"]')?.click(); return 1; })()`);
  await wait(400);
  const res = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.pop.is-themes .pal-tabs button')];
    const t = tabs.find((b) => b.textContent.trim() === ${JSON.stringify(tab)});
    t?.click();
    return tabs.map((b) => b.textContent.trim());
  })()`);
  await wait(250);
  const picked = await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.pop.is-themes .pal-cell')]
      .find((c) => c.getAttribute('title') === ${JSON.stringify(name)});
    if (!cell) return 'missing';
    cell.scrollIntoView({ block: 'center' });
    cell.click();
    return cell.getAttribute('title');
  })()`);
  await wait(700);
  await key('Escape', 'Escape', 27);
  return `${picked} of ${JSON.stringify(res)}`;
};

const cases = [
  ['01-underline-energy', '思维导图 2', '活力', '缤纷'],
  ['02-underline-rainbow', '逻辑图 3', '彩虹', '缤纷'],
  ['03-doubleunderline-classic', '括号图 2', '复古', '缤纷'],
  ['04-hachure-energy', '思维导图 6', '活力', '缤纷'],
  ['05-hachure-crossing', '逻辑图 5', '樱花', '缤纷'],
  ['06-solid-candy', '思维导图 1', '糖果', '缤纷'],
  ['07-underline-org', '组织结构图 4', '海洋', '缤纷'],
  ['08-doubleunderline-classic2', '树形图 2', '禅心', '经典'],
];
for (const [file, skeleton, palette, tab] of cases) {
  console.log(file, '→', await pickSkeleton(skeleton), '|', await pickPalette(palette, tab));
  await shot(file);
}
ws.close();
