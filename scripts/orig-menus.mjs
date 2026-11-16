// Batch-probe shipped popovers: open each toggle by selector, record the item
// list, close with Esc, move on. Keeps one CDP session so state stays fresh.
// Usage: node scripts/orig-menus.mjs specs.json
import { readFileSync, writeFileSync } from 'node:fs';

const specs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
  ?? list.find((t) => t.type === 'page');

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
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
};
const esc = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await new Promise((r) => setTimeout(r, 120));
};
await new Promise((r) => ws.addEventListener('open', r));

const report = [];
for (const spec of specs) {
  await esc();
  const opened = await evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(spec.selector)})]
      .filter((e) => e.getBoundingClientRect().width > 0);
    const el = els[${spec.index ?? 0}];
    if (!el) return { error: 'missing', n: els.length };
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { ok: true, cls: String(el.className).slice(0, 70), r: (() => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() };
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const pop = await evaluate(`(() => {
    const vis = [...document.querySelectorAll('[class*="uk-pop"], [class*="uk-menu"]')]
      .map((e) => ({ e, b: e.getBoundingClientRect() }))
      .filter(({ e, b }) => b.width > 30 && b.height > 16 && !/overlay/.test(String(e.className)));
    if (!vis.length) return { error: 'no popover' };
    vis.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
    const { e, b } = vis[0];
    const cs = getComputedStyle(e);
    const items = [...e.querySelectorAll('li')].map((li) => {
      const btn = li.querySelector('button') || li;
      const bb = btn.getBoundingClientRect();
      const ics = btn.querySelector('.uk-icon, svg, img');
      return {
        t: (btn.innerText || '').trim().slice(0, 26),
        r: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)],
        cls: String(btn.className).slice(0, 46).replace(/uk-button|uk-padding-remove|uk-border-rounded/g, '').trim(),
        active: /uk-active|is-checked|checked/.test(String(btn.className)) || btn.getAttribute('aria-checked') === 'true',
        icon: ics ? String(ics.className || ics.tagName).slice(0, 40) : '',
        iconHtml: ics && ics.tagName === 'svg' ? ics.outerHTML.slice(0, 300) : '',
        bg: getComputedStyle(btn).backgroundColor,
      };
    });
    return {
      cls: String(e.className),
      r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, shadow: cs.boxShadow.slice(0, 80),
      text: (e.innerText || '').replace(/\\n+/g, ' | ').slice(0, 700),
      items: items.slice(0, 40),
    };
  })()`);
  report.push({ name: spec.name, toggle: opened, pop });
}
writeFileSync(process.argv[3] || 'target/menus.json', JSON.stringify(report, null, 1));
console.log('probed', report.length, '->', process.argv[3] || 'target/menus.json');
await esc();
ws.close();
process.exit();
