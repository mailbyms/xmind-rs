// Force a fixed CSS viewport on the shipped editor so geometry is reproducible
// even when the OS window is not maximised.
// Usage: node scripts/set-viewport.mjs [width] [height] [clear]
const PORT = process.env.CDP_PORT || 9222;
const width = Number(process.argv[2] || 1470);
const height = Number(process.argv[3] || 858);
const clear = process.argv[4] === 'clear';

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
await new Promise((r) => ws.addEventListener('open', r));
if (clear) {
  await send('Emulation.clearDeviceMetricsOverride');
} else {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
    screenWidth: width, screenHeight: height,
  });
}
const res = await send('Runtime.evaluate', { expression: 'innerWidth + "x" + innerHeight', returnByValue: true });
console.log('viewport', res.result.value);
ws.close();
process.exit();
