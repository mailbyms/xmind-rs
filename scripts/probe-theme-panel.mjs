// Dump the shipped 配色方案 panel: geometry, group headings, cards, and how
// each thumbnail is drawn (img / canvas / inline svg).
// Usage: node scripts/probe-theme-panel.mjs [out.json] [shot.png]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'research/theme-panel.json';
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

await evaluate(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布');
  a && a.click();
})()`);
await wait(500);

const opened = await evaluate(`(() => {
  const b = document.querySelector('button[title="选择配色方案。"]');
  if (!b) return 'no toggle';
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return String(b.getAttribute('aria-expanded'));
})()`);
if (opened !== 'true') { console.error('open failed', opened); process.exit(1); }
await wait(900);

const dump = await evaluate(`(() => {
  const pops = [...document.querySelectorAll('.uk-pop.uk-open')];
  const pop = pops.find((p) => /配色方案|经典|永恒/.test(p.innerText)) || pops[pops.length - 1];
  if (!pop) return { error: 'no popover', candidates: [...document.querySelectorAll('.uk-pop')].map(p => p.className.toString()).slice(0, 20) };
  const r = pop.getBoundingClientRect();
  const cs = getComputedStyle(pop);
  const walk = (el, depth) => {
    if (depth > 6) return '';
    let s = '';
    for (const c of el.children) {
      const cr = c.getBoundingClientRect();
      s += '  '.repeat(depth) + '<' + c.tagName.toLowerCase() + ' class="' + (c.className.toString() || '').slice(0, 90) + '"> '
        + Math.round(cr.width) + 'x' + Math.round(cr.height) + ' "' + (c.innerText || '').trim().slice(0, 30) + '"'
        + (c.tagName === 'IMG' ? ' src=' + (c.getAttribute('src') || '').slice(0, 60) : '')
        + (c.tagName === 'CANVAS' ? ' canvas=' + c.width + 'x' + c.height : '')
        + '\\n';
      s += walk(c, depth + 1);
    }
    return s;
  };
  const groups = [];
  for (const h of pop.querySelectorAll('h5')) {
    const box = h.closest('section, div');
    const cards = [...box.querySelectorAll('li, .uk-palette-item, button')].filter((c) => {
      const cr = c.getBoundingClientRect();
      return cr.width > 30 && cr.height > 20;
    }).map((c) => {
      const cr = c.getBoundingClientRect();
      const img = c.querySelector('img');
      const canvas = c.querySelector('canvas');
      const svg = c.querySelector('svg');
      return {
        label: (c.innerText || '').trim().slice(0, 40),
        title: c.getAttribute('title') || '',
        cls: c.className.toString().slice(0, 160),
        rect: [Math.round(cr.x - r.x), Math.round(cr.y - r.y), Math.round(cr.width), Math.round(cr.height)],
        img: img ? (img.getAttribute('src') || '').slice(0, 120) : null,
        canvas: canvas ? [canvas.width, canvas.height] : null,
        canvasData: canvas ? canvas.toDataURL('image/png').slice(0, 100) : null,
        svg: svg ? svg.outerHTML.slice(0, 400) : null,
        html: c.outerHTML.replace(/\\s+/g, ' ').slice(0, 600),
      };
    });
    const br = box.getBoundingClientRect();
    groups.push({
      heading: h.innerText.trim(),
      headingRect: [Math.round(br.x - r.x), Math.round(br.y - r.y), Math.round(br.width), Math.round(br.height)],
      cls: box.className.toString().slice(0, 120),
      cards,
    });
  }
  return {
    popRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    popCls: pop.className.toString(),
    popStyle: { pad: cs.padding, radius: cs.borderRadius, bg: cs.backgroundColor, maxH: cs.maxHeight, overflow: cs.overflowY, filter: cs.backdropFilter },
    scrollH: pop.scrollHeight,
    scrollW: pop.scrollWidth,
    tree: walk(pop, 0).slice(0, 6000),
    groups,
  };
})()`);
writeFileSync(OUT, JSON.stringify(dump, null, 2));
console.log('pop:', JSON.stringify(dump.popRect), 'cls', dump.popCls, 'scrollH', dump.scrollH, 'scrollW', dump.scrollW);
console.log('groups:', dump.groups?.map((g) => `${g.heading}(${g.cards.length})`).join(' | '));
console.log(dump.tree);

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
