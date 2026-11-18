// Drive the shipped XMind's marker panel over CDP 9222 and record how markers
// are laid out inside a topic box, plus whether picking a second marker in the
// same group replaces the first one.
//
//   node scripts/probe-orig-marker-layout.mjs [outdir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/marker-layout');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
if (!page) throw new Error('no editor page');
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
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok, rej) => {
  const mid = ++id;
  pending.set(mid, { resolve: ok, reject: rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const waitFor = async (expression, label, timeout = 6000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await ev(expression)) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timeout waiting for ${label}`);
};
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const result = { steps: [] };
const snapshot = async (step) => {
  const info = await ev(`(() => {
    const topics = [...document.querySelectorAll('[data-view-id^="topic-node:"]')].map((g) => {
      const id = g.getAttribute('data-view-id').slice('topic-node:'.length);
      const r = g.getBoundingClientRect();
      const content = g.querySelector('[data-view-id^="topic-content:"]');
      const title = g.querySelector('[data-view-id^="topic-title:"]');
      const cr = content?.getBoundingClientRect();
      const tr = title?.getBoundingClientRect();
      const children = [...(content?.children || [])].map((c) => ({
        tag: c.tagName,
        id: c.getAttribute('data-view-id') || '',
        type: c.getAttribute('data-view-type') || '',
        transform: c.getAttribute('transform') || '',
        html: c.outerHTML.slice(0, 900),
      }));
      return {
        id,
        rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
        contentRect: cr ? { x: +cr.x.toFixed(2), y: +cr.y.toFixed(2), w: +cr.width.toFixed(2), h: +cr.height.toFixed(2) } : null,
        titleRect: tr ? { x: +tr.x.toFixed(2), y: +tr.y.toFixed(2), w: +tr.width.toFixed(2), h: +tr.height.toFixed(2) } : null,
        title: (title?.textContent || '').trim().slice(0, 30),
        childTypes: children.map((c) => c.type || c.tag),
        children,
      };
    });
    const changed = topics.filter((t) => t.children.length > 1 || /marker|image/i.test(t.children.map((c) => c.id).join(' ')));
    return { changed, all: topics.length };
  })()`);
  result.steps.push({ step, ...info });
  console.log(step, 'topics', info.all, 'with-content-children', info.changed.length);
  for (const t of info.changed.slice(0, 3)) {
    console.log(' TOPIC', t.id, t.title, 'box', JSON.stringify(t.rect), 'content', JSON.stringify(t.contentRect), 'title', JSON.stringify(t.titleRect));
    console.log(' children', t.childTypes.join(' | '));
    console.log(' html', t.children.map((c) => c.html.slice(0, 420)).join('\n    '));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(OUT, `${step}.png`), Buffer.from(shot.data, 'base64'));
};

// 1. Select the central topic (its box is the biggest one on the canvas).
const root = await ev(`(() => {
  const g = [...document.querySelectorAll('[data-view-id^="topic-node:"]')]
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const r = g.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
})()`);
await click(root.x, root.y);
await waitFor(`!!document.querySelector('[data-view-id^="topic-node:"]')`, 'topic');

// 2. Open the marker panel.
const btn = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /标记/.test(x.title || ''));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
if (!btn) throw new Error('marker toolbar button not found');
await click(btn.x, btn.y);
await waitFor(`!!document.querySelector('.marker-module .icon-image-item')`, 'marker panel');
const groups = await ev(`[...document.querySelectorAll('.marker-module .group')].map((g) => ({
  title: (g.querySelector('.group-title')?.textContent || '').trim(),
  items: [...g.querySelectorAll('.icon-image-item')].map((i) => ({
    html: i.outerHTML.slice(0, 300),
    rect: (() => { const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })(),
  })),
}))`);
result.groups = groups.map((g) => ({ title: g.title, count: g.items.length }));
console.log('groups', JSON.stringify(result.groups));
writeFileSync(resolve(OUT, 'groups.json'), JSON.stringify(groups, null, 1));

const clickItem = async (groupIndex, itemIndex) => {
  const g = groups[groupIndex];
  if (!g?.items[itemIndex]) throw new Error(`item ${groupIndex}/${itemIndex} missing`);
  const p = g.items[itemIndex].rect;
  await click(p.x, p.y);
  await new Promise((r) => setTimeout(r, 450));
};
await snapshot('00-before');
await clickItem(0, 0);
await snapshot('01-tag-red');
await clickItem(0, 1);
await snapshot('02-tag-orange');
await clickItem(1, 0);
await snapshot('03-priority-1');
await clickItem(1, 1);
await snapshot('04-priority-2');

writeFileSync(resolve(OUT, 'probe.json'), JSON.stringify(result, null, 1));
console.log('written', OUT);
ws.close();
