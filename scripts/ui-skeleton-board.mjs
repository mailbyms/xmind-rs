// Open the 骨架 board in our app, measure it, and (optionally) click a card.
// Usage: node scripts/ui-skeleton-board.mjs <out-prefix> [cardIndex]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'target/skeleton-check';
const PICK = process.argv[3] ? Number(process.argv[3]) : null;
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

// 1. switch to the 样式 tab and open the board
await evaluate(`(() => {
  [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '样式')?.click();
  return 1;
})()`);
await wait(250);
const opened = await evaluate(`(() => {
  if (document.querySelector('.pop.is-skeleton')) return 'already';
  const b = document.querySelector('button[title="设置主题结构。"]')
    ?? [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '思维导图');
  if (!b) return 'no trigger';
  b.click();
  return 'ok';
})()`);
await wait(500);

const info = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-skeleton');
  if (!pop) return { error: 'no panel' };
  const cs = getComputedStyle(pop);
  const r = pop.getBoundingClientRect();
  const groups = [...pop.querySelectorAll('.bone-group')].map((g) => ({
    title: g.querySelector('.bone-head')?.textContent.trim(),
    cards: g.querySelectorAll('.bone-card').length,
  }));
  const card = pop.querySelector('.bone-card');
  const cr = card?.getBoundingClientRect();
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    scrollH: pop.scrollHeight,
    pad: cs.padding, radius: cs.borderRadius,
    groups,
    cardBox: cr ? [Math.round(cr.width), Math.round(cr.height)] : null,
    active: pop.querySelector('.bone-card.on')?.getAttribute('aria-label'),
    thumbsLoaded: [...pop.querySelectorAll('.bone-card img')].filter((i) => i.naturalWidth > 0).length,
    thumbsTotal: pop.querySelectorAll('.bone-card img').length,
  };
})()`);
console.log('open:', opened, JSON.stringify(info));
await shot(`${OUT}-board.png`);

if (PICK !== null) {
  const picked = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.pop.is-skeleton .bone-card')];
    const card = cards[${PICK}];
    if (!card) return 'missing';
    card.click();
    return card.getAttribute('aria-label');
  })()`);
  await wait(900);
  console.log('picked:', picked);
  const stays = await evaluate(`(() => ({
    open: !!document.querySelector('.pop.is-skeleton'),
    active: document.querySelector('.pop.is-skeleton .bone-card.on')?.getAttribute('aria-label'),
    structure: [...document.querySelectorAll('.fp-select')].map((b) => b.textContent.trim()).slice(0, 6),
  }))()`);
  console.log('after-pick:', JSON.stringify(stays));
  await shot(`${OUT}-picked.png`);
  const state = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.node')].slice(0, 6).map((n) => {
      const r = n.getBoundingClientRect();
      const svg = n.querySelector('svg path');
      return { text: n.querySelector('.node-title')?.textContent.trim().slice(0, 8),
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        d: svg?.getAttribute('d')?.slice(0, 40) };
    });
    const edges = [...document.querySelectorAll('.edges path')].slice(0, 3).map((p) => ({
      d: p.getAttribute('d').slice(0, 50),
      dash: p.getAttribute('stroke-dasharray'),
      w: p.getAttribute('stroke-width'),
    }));
    return { nodes, edges };
  })()`);
  console.log('state:', JSON.stringify(state, null, 1));
}
ws.close();
