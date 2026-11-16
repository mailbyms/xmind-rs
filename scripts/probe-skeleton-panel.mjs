// Dump the shipped 骨架 panel: its geometry, group headings, and every
// thumbnail card (label, tooltip, image src, size).
// Usage: node scripts/probe-skeleton-panel.mjs [out.json] [shot.png]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'research/skeleton-panel.json';
const SHOT = process.argv[3];
const PORT = process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url)) ?? list.find((t) => t.type === 'page');
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
  await wait(250);
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await esc();

const opened = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择骨架。"]');
  if (!b) return 'no toggle';
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return b.getAttribute('aria-expanded');
})()`);
if (opened !== 'true') { console.error('open failed', opened); process.exit(1); }
await wait(900);

const dump = await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].find((p) => p.innerText.includes('骨架') || p.innerText.includes('思维导图'));
  if (!pop) return { error: 'no popover', candidates: [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].map(p => p.innerText.slice(0, 80)) };
  const r = pop.getBoundingClientRect();
  const cs = getComputedStyle(pop);
  const groups = [];
  for (const h of pop.querySelectorAll('h5')) {
    const box = h.parentElement.parentElement;
    const cards = [...box.querySelectorAll('.uk-card-selectable')].map((c) => {
      const cr = c.getBoundingClientRect();
      const img = c.querySelector('img');
      const canvas = c.querySelector('canvas');
      return {
        label: (c.innerText || '').trim().slice(0, 40),
        title: c.getAttribute('title') || c.getAttribute('data-tooltip') || '',
        img: img ? img.getAttribute('src') : null,
        imgSize: img ? [img.naturalWidth, img.naturalHeight] : null,
        canvas: canvas ? [canvas.width, canvas.height, canvas.getAttribute('style')] : null,
        rect: [Math.round(cr.x - r.x), Math.round(cr.y - r.y), Math.round(cr.width), Math.round(cr.height)],
        cls: c.className.toString().slice(0, 120),
        html: c.innerHTML.replace(/\\s+/g, ' ').slice(0, 400),
      };
    });
    const br = box.getBoundingClientRect();
    groups.push({
      heading: h.innerText.trim(),
      headingRect: [Math.round(br.x - r.x), Math.round(br.y - r.y), Math.round(br.width), Math.round(br.height)],
      html: box.innerHTML.replace(/\\s+/g, ' ').slice(0, 500),
      cards,
    });
  }
  return {
    popRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    popCls: pop.className.toString(),
    popStyle: { pad: cs.padding, radius: cs.borderRadius, bg: cs.backgroundColor, maxH: cs.maxHeight, overflow: cs.overflowY },
    scrollH: pop.scrollHeight,
    innerHtmlHead: pop.innerHTML.replace(/\\s+/g, ' ').slice(0, 1200),
    groups,
  };
})()`);
writeFileSync(OUT, JSON.stringify(dump, null, 2));
console.log('groups:', dump.groups?.map((g) => `${g.heading}(${g.cards.length})`).join(' | '));
console.log('pop:', JSON.stringify(dump.popRect), 'scrollH', dump.scrollH);

if (SHOT) {
  const r = dump.popRect;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 2 },
    captureBeyondViewport: true,
  });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('shot ->', SHOT);
}
await esc();
ws.close();
