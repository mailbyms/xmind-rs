// Diagnostic: where does the shipped XMind put its 折叠/展开 disc?
// Opens the editor target that shows the requested topic, brings it to front,
// hovers it over CDP, then reports every element whose class mentions "fold"
// plus the topic box.
//
//   node scripts/probe-orig-fold.mjs 演示/展示
const needle = process.argv[2] || '演示/展示';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => t.type === 'page' && t.url.includes('editor.html')
  && !t.url.includes('editor-frame'));

const connect = async (page) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result.value;
  };
  return { ev, send, close: () => ws.close() };
};

for (const page of pages) {
  const c = await connect(page);
  const found = await c.ev(`(() => {
    const all = [...document.querySelectorAll('[data-view-id^="topic-title:"]')];
    const hit = all.find((e) => (e.textContent || '').trim() === ${JSON.stringify(needle)})
      ?? all.find((e) => (e.textContent || '').includes(${JSON.stringify(needle)}));
    if (!hit) return null;
    const uid = hit.getAttribute('data-view-id').slice(12);
    const node = [...document.querySelectorAll('[data-view-id^="topic-node:"]')]
      .find((e) => uid.startsWith(e.getAttribute('data-view-id').slice(11)));
    const bb = (e) => { const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height]; };
    return { uid, title: bb(hit), node: node ? bb(node) : null,
      nodeId: node ? node.getAttribute('data-view-id') : null };
  })()`);
  if (!found) { c.close(); continue; }
  console.log('target ', page.url.slice(-50));
  console.log('found  ', JSON.stringify(found));

  await c.send('Page.bringToFront');
  const r = found.node ?? found.title;
  const cx = Math.round(r[0] + r[2] / 2);
  const cy = Math.round(r[1] + r[3] / 2);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' });
  await new Promise((r2) => setTimeout(r2, 700));

  const report = await c.ev(`(() => {
    const bb = (e) => { const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    const folded = [...document.querySelectorAll('svg *')].filter((e) => {
      const c = e.getAttribute('class') || '';
      const v = e.getAttribute('data-view-id') || '';
      return /fold|unfold|collapse|expand/i.test(c + ' ' + v);
    }).map((e) => ({ tag: e.tagName, cls: (e.getAttribute('class') || '').slice(0, 70),
      id: (e.getAttribute('data-view-id') || '').slice(0, 45),
      transform: e.getAttribute('transform'), opacity: getComputedStyle(e).opacity,
      rect: bb(e), d: (e.getAttribute('d') || '').slice(0, 70) }));
    const circles = [...document.querySelectorAll('circle')].slice(0, 12)
      .map((e) => ({ r: e.getAttribute('r'), rect: bb(e), parent: (e.parentElement?.getAttribute('class') || '').slice(0, 50) }));
    return JSON.stringify({ folded: folded.slice(0, 20), circles }, null, 1);
  })()`);
  console.log(report);
  c.close();
  break;
}
