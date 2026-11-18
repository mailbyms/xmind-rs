// Inspect the shipped XMind's toolbar buttons and selected topic DOM so the
// marker-layout probe can drive the real UI without guessing selectors.
import { writeFileSync, mkdirSync } from 'node:fs';
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

const data = await ev(`(() => {
  const btns = [...document.querySelectorAll('button,[role="button"],.uk-button,a')]
    .map((e) => ({
      tag: e.tagName,
      cls: typeof e.className === 'string' ? e.className.slice(0, 120) : '',
      title: e.getAttribute('title') || '',
      text: (e.textContent || '').trim().slice(0, 30),
      rect: (() => { const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })(),
    }))
    .filter((b) => /标记|marker|image/i.test(b.title + b.cls + b.text))
    .slice(0, 40);
  const topics = [...document.querySelectorAll('[data-view-id^="topic-node:"]')].slice(0, 6).map((g) => {
    const r = g.getBoundingClientRect();
    return {
      id: g.getAttribute('data-view-id'),
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      cls: String(g.getAttribute('class') || ''),
      html: g.outerHTML.slice(0, 5000),
    };
  });
  return { btns, topics, body: document.body.innerText.slice(0, 600) };
})()`);

writeFileSync(resolve(OUT, 'dom-overview.json'), JSON.stringify(data, null, 1));
console.log('buttons', data.btns.length, 'topics', data.topics.length);
console.log(JSON.stringify(data.btns, null, 1));
console.log('TOPIC0', data.topics[0]?.html?.slice(0, 2500));
ws.close();
