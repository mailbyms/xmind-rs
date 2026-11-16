// Read the real branch-connector geometry out of the running XMind app.
// Open a map in XMind, launch it with --remote-debugging-port=9222, then:
//   node scripts/probe-connector-geometry.mjs
// Prints, for every curve connector, the gap and the two control-point offsets.
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /editor\.html/.test(t.url));
const page = pages.find((t) => /xmind/i.test(decodeURIComponent(t.url))) ?? pages[0];
if (!page) throw new Error('no editor page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed');
  return res.result?.value;
};

console.log(JSON.stringify(await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find((s) => s.querySelectorAll('path').length > 40);
  if (!svg) return { error: 'open a map first' };
  const curves = [], wedges = [];
  for (const p of svg.querySelectorAll('path')) {
    const d = p.getAttribute('d') || '';
    const c = d.match(/^M ([\\d.-]+) ([\\d.-]+) C ([\\d.-]+) ([\\d.-]+), ([\\d.-]+) ([\\d.-]+), ([\\d.-]+) ([\\d.-]+)$/);
    if (c) {
      const n = c.slice(1).map(Number);
      const dx = n[6] - n[0];
      curves.push({ dx: +dx.toFixed(1), dy: +(n[7] - n[1]).toFixed(1),
        c1: +((n[2] - n[0]) / dx).toFixed(3), c2: +((n[4] - n[6]) / dx).toFixed(3),
        level1: +(n[3] - n[1]).toFixed(2), level2: +(n[5] - n[7]).toFixed(2) });
    }
    const q = d.match(/^M ([\\d.-]+) ([\\d.-]+) Q ([\\d.-]+) ([\\d.-]+), ([\\d.-]+) ([\\d.-]+)$/);
    if (q) {
      const n = q.slice(1).map(Number);
      const dx = n[4] - n[0];
      wedges.push({ dx: +dx.toFixed(1), dy: +(n[5] - n[1]).toFixed(1),
        cpX: +((n[2] - n[0]) / dx).toFixed(3), cpToEndY: +(n[3] - n[5]).toFixed(2) });
    }
  }
  return { curves: curves.slice(0, 6), wedges: wedges.slice(0, 6) };
})()`), null, 2));
ws.close();
