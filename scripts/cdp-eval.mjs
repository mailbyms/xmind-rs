// Ad-hoc CDP eval: node scripts/cdp-eval.mjs "<expression>"
const PORT = process.env.CDP_PORT || 9223;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const out = await new Promise((resolve, reject) => {
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) {
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    expression: process.argv[2], returnByValue: true, awaitPromise: true,
  } }));
});
if (out.exceptionDetails) console.error(out.exceptionDetails.exception?.description ?? out.exceptionDetails);
else console.log(typeof out.result.value === 'string' ? out.result.value : JSON.stringify(out.result.value, null, 2));
ws.close();
