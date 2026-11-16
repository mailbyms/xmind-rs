// Probe the shipped 演说 tab: switch to it, list its controls, then open each
// dropdown (and 更换风格) and dump the option labels.
// Usage: node scripts/probe-pitch.mjs [step]
import { writeFileSync } from 'node:fs';

const step = process.argv[2] || 'all';
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
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await wait(300);
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await esc();

// 1. switch to the 演说 tab
const switched = await evaluate(`(() => {
  const tabs = [...document.querySelectorAll('.uk-tab a')]
    .filter((a) => a.getBoundingClientRect().width);
  const btn = tabs.find((a) => a.textContent.trim() === '演说');
  if (!btn) return 'no tab';
  btn.click();
  return 'ok';
})()`);
console.log('tab:', switched);
await wait(600);

// 2. list the controls of the panel
const controls = await evaluate(`(() => {
  const panel = document.querySelector('.uk-slide-panel') || document.querySelector('.uk-format-panel');
  if (!panel) return 'no panel';
  const out = [];
  for (const el of panel.querySelectorAll('button, [role="combobox"], input')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className.toString().slice(0, 70),
      text: el.textContent.trim().slice(0, 40),
      title: el.getAttribute('title') || el.getAttribute('aria-label') || '',
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return out;
})()`);
console.log('--- controls ---');
console.log(JSON.stringify(controls, null, 1));

// 3. open the popover of the n-th usable control and dump its contents
const openAndDump = async (index, label) => {
  await esc();
  const opened = await evaluate(`(() => {
    const panel = document.querySelector('.uk-slide-panel') || document.querySelector('.uk-format-panel');
    const all = [...panel.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width);
    const b = all[${index}];
    if (!b) return 'missing';
    b.scrollIntoView({ block: 'center' });
    b.click();
    return 'clicked:' + b.textContent.trim().slice(0, 20);
  })()`);
  await wait(600);
  const dump = await evaluate(`(() => {
    const pops = [...document.querySelectorAll('.uk-pop, .uk-popover, [class*="popover"], [class*="dialog"]')]
      .filter((el) => el.getBoundingClientRect().width > 40);
    return pops.map((el) => ({
      cls: el.className.toString().slice(0, 90),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      items: [...el.querySelectorAll('button, li, label, .uk-pop-item, [role="option"]')]
        .filter((n) => n.getBoundingClientRect().width)
        .map((n) => n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30))
        .filter((t, i, a) => t && a.indexOf(t) === i),
      html: el.innerHTML.replace(/\\s+/g, ' ').slice(0, 1400),
    }));
  })()`);
  console.log(`--- open[${index}] ${label}: ${opened} ---`);
  console.log(JSON.stringify(dump, null, 1));
};

if (step === 'all' || step === 'style') await openAndDump(0, '更换风格');
if (step === 'all' || step === 'ratio') await openAndDump(1, '长宽比');
if (step === 'all' || step === 'topic') await openAndDump(2, '主题幻灯片');
if (step === 'all' || step === 'list') await openAndDump(3, '列表幻灯片');
if (step === 'all' || step === 'method') await openAndDump(4, '演说方式');

await esc();
ws.close();
