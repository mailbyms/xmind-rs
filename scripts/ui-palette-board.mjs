// Open the 配色方案 board in our app, measure it, flip both tabs, apply a
// palette, and verify the canvas repaint + the board staying open.
// Usage: node scripts/ui-palette-board.mjs <out-prefix> [groupName]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'target/palette-check';
const PICK = process.argv[3] || '活力';
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
const shot = async (file) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});

// 1. 画布 tab → open the board
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布')?.click();
  return 1;
})()`);
await wait(300);
const opened = await evaluate(`(() => {
  if (document.querySelector('.pop.is-themes')) return 'already';
  const b = document.querySelector('button[title="选择配色方案。"]')
    ?? [...document.querySelectorAll('button')].find((x) => x.textContent.includes('配色方案'));
  if (!b) return 'no trigger';
  b.click();
  return 'ok';
})()`);
await wait(600);
console.log('open:', opened);

const measure = () => evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  if (!pop) return { error: 'no panel' };
  const r = pop.getBoundingClientRect();
  const cs = getComputedStyle(pop);
  const tabs = [...pop.querySelectorAll('.pal-tabs button')].map((b) => {
    const br = b.getBoundingClientRect();
    const bc = getComputedStyle(b);
    return { label: b.textContent.trim(), on: b.className.includes('on'), w: Math.round(br.width), h: Math.round(br.height),
      fs: bc.fontSize, fw: bc.fontWeight, color: bc.color, bg: bc.backgroundColor };
  });
  const groups = [...pop.querySelectorAll('.pal-group')].map((g) => {
    const gr = g.getBoundingClientRect();
    const cell = g.querySelector('.pal-cell');
    const cr = cell.getBoundingClientRect();
    const cc = getComputedStyle(cell);
    return {
      name: g.querySelector('.pal-name').textContent.trim(),
      group: [Math.round(gr.x - r.x), Math.round(gr.y - r.y), Math.round(gr.width), Math.round(gr.height)],
      cell: [Math.round(cr.width), Math.round(cr.height)],
      radius: cc.borderRadius,
      on: cell.className.includes('on'),
      segments: cell.querySelectorAll('span').length,
      paints: [...cell.querySelectorAll('span')].map((s) => getComputedStyle(s).backgroundImage !== 'none'
        ? getComputedStyle(s).backgroundImage.slice(0, 46) : getComputedStyle(s).backgroundColor),
    };
  });
  const trigger = document.querySelector('button[title="选择配色方案。"]');
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    radius: cs.borderRadius, bg: cs.backgroundColor, pad: cs.padding,
    tabs, groups, trigger: trigger ? trigger.innerText.trim() : null,
    scroll: (() => { const s = pop.querySelector('.pal-scroll'); return s ? { h: Math.round(s.getBoundingClientRect().height), sh: s.scrollHeight } : null; })(),
    canvas: [...document.querySelectorAll('.node')].slice(0, 6).map((n) => {
      const p = n.querySelector('.node-shape path');
      return { text: (n.querySelector('.node-title')?.textContent || '').trim().slice(0, 10), fill: p?.getAttribute('fill'), color: getComputedStyle(n).color };
    }),
  };
})()`);

const vivid = await measure();
console.log('vivid:', JSON.stringify(vivid.rect), 'tabs', JSON.stringify(vivid.tabs));
console.log('groups:', vivid.groups.length, vivid.groups.slice(0, 4).map((g) => `${g.name}(${g.segments})`).join(' '));
console.log('on:', vivid.groups.filter((g) => g.on).map((g) => g.name), 'trigger:', vivid.trigger);
await shot(`${OUT}-vivid.png`);

// 2. classic tab
await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  [...pop.querySelectorAll('.pal-tabs button')].find((b) => b.textContent.trim() === '经典')?.click();
  return 1;
})()`);
await wait(350);
const classic = await measure();
console.log('classic groups:', classic.groups.length, classic.groups.map((g) => g.name).join(' '));
await shot(`${OUT}-classic.png`);

// 3. back to vivid and apply one palette
await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  [...pop.querySelectorAll('.pal-tabs button')].find((b) => b.textContent.trim() === '缤纷')?.click();
  return 1;
})()`);
await wait(300);
const clicked = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-themes');
  if (!pop) return 'panel gone';
  const group = [...pop.querySelectorAll('.pal-group')].find((g) => g.querySelector('.pal-name').textContent.trim() === ${JSON.stringify(PICK)});
  if (!group) return 'no group';
  group.querySelector('.pal-cell').click();
  return 'ok';
})()`);
await wait(900);
const after = await measure();
console.log('click:', clicked, '| still open:', !!after.rect, '| trigger:', after.trigger,
  '| on:', after.groups.filter((g) => g.on).map((g) => g.name));
console.log('canvas:', JSON.stringify(after.canvas));
await shot(`${OUT}-applied.png`);

writeFileSync(`${OUT}.json`, JSON.stringify({ vivid, classic, after }, null, 2));
console.log('saved', `${OUT}.json`);
ws.close();
