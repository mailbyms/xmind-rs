const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID)) ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await wait(300);

const before = await evaluate(`(() => ({
  pops: [...document.querySelectorAll('.uk-pop')].map(p => ({ open: p.classList.contains('uk-open'), w: Math.round(p.getBoundingClientRect().width) })),
  aria: document.querySelector('button[title="选择骨架。"]')?.getAttribute('aria-expanded'),
  vis: document.visibilityState, focus: document.hasFocus(),
}))()`);
console.log('before', JSON.stringify(before));

// try a plain programmatic click first
const r1 = await evaluate(`(() => { const b = document.querySelector('button[title="选择骨架。"]'); b.click(); return b.getAttribute('aria-expanded'); })()`);
await wait(500);
const after1 = await evaluate(`(() => ({ aria: document.querySelector('button[title="选择骨架。"]')?.getAttribute('aria-expanded'), open: [...document.querySelectorAll('.uk-pop.uk-open')].length, txt: [...document.querySelectorAll('.uk-pop.uk-open')].map(p => p.innerText.replace(/\\s+/g,' ').slice(0, 40)) }))()`);
console.log('after click', r1, JSON.stringify(after1));
ws.close();
