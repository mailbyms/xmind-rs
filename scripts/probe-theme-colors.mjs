// Read every 配色方案 swatch (both tabs) out of the shipped panel, including
// the computed paint of each of the six cells, plus the selected state.
// Usage: node scripts/probe-theme-colors.mjs [out.json]
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'research/theme-palettes.json';
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
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  return String(b.getAttribute('aria-expanded'));
})()`);
if (opened !== 'true') { console.error('open failed', opened); process.exit(1); }
await wait(900);

const readTab = async () => evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  if (!pop) return { error: 'no panel' };
  const r = pop.getBoundingClientRect();
  const groups = [...pop.querySelectorAll('.smart-color-theme-group')].map((g) => {
    const gr = g.getBoundingClientRect();
    const head = g.querySelector('h5');
    const cell = g.querySelector('.smart-color-theme-group-cell');
    const cr = cell.getBoundingClientRect();
    const swatches = [...cell.children].map((c) => {
      const cs = getComputedStyle(c);
      return { bg: cs.backgroundColor, img: cs.backgroundImage.slice(0, 80), style: c.getAttribute('style'), w: Math.round(c.getBoundingClientRect().width) };
    });
    return {
      name: head ? head.innerText.trim() : '',
      title: cell.getAttribute('title') || '',
      rect: [Math.round(gr.x - r.x), Math.round(gr.y - r.y), Math.round(gr.width), Math.round(gr.height)],
      cellRect: [Math.round(cr.x - r.x), Math.round(cr.y - r.y), Math.round(cr.width), Math.round(cr.height)],
      cls: cell.className.toString().slice(0, 200),
      swatches,
    };
  });
  const grid = pop.querySelector('.uk-flex.uk-flex-column.uk-width-1-1:last-child');
  const gcs = grid ? getComputedStyle(grid) : null;
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    tabs: [...pop.querySelectorAll('.uk-tab a')].map((a) => ({ label: a.innerText.trim(), active: !!a.closest('.uk-active') })),
    grid: gcs ? { display: gcs.display, cols: gcs.gridTemplateColumns, gap: gcs.gap, wrap: gcs.flexWrap, pad: gcs.padding } : null,
    groups,
  };
})()`);

const vivid = await readTab();
console.log('vivid groups:', vivid.groups.map((g) => `${g.name}[${g.swatches.map((s) => s.bg).join(' ')}]`).join('\n'));

// switch to the second capsule tab (经典)
await evaluate(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-open')].find((p) => p.querySelector('.smart-color-theme-group'));
  const tabs = [...pop.querySelectorAll('.uk-tab a')];
  const second = tabs[1];
  if (second) second.click();
})()`);
await wait(800);
const classic = await readTab();
console.log('\nclassic groups:', classic.groups.map((g) => `${g.name}[${g.swatches.map((s) => s.bg).join(' ')}]`).join('\n'));

writeFileSync(OUT, JSON.stringify({ vivid, classic }, null, 2));
console.log('\nsaved ->', OUT);
await esc();
ws.close();
