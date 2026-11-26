// Probe how the shipped XMind sizes in-topic marker icons at every depth.
// Usage: node scripts/probe-orig-marker-size.mjs [port]
// Prints one row per topic: depth, box, font size, marker icon box, gap.
const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9222);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === 'page');

async function evalOn(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const out = await new Promise((resolve, reject) => {
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) {
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  ws.close();
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? 'eval failed');
  return out.result.value;
}

const EXPR = String.raw`(() => {
  const nodes = [...document.querySelectorAll('.topic-node')];
  if (!nodes.length) return null;
  const round = (v) => Math.round(v * 100) / 100;
  const rows = nodes.map((n) => {
    const box = n.getBoundingClientRect();
    const shape = n.querySelector('.topic-shape, .topic-shape-outline, svg, .topic-g') || n;
    const sr = shape.getBoundingClientRect();
    const cs = getComputedStyle(n);
    const title = n.querySelector('.topic-title');
    const tr = title ? title.getBoundingClientRect() : null;
    const tcs = title ? getComputedStyle(title) : null;
    const icons = [...n.querySelectorAll('img')]
      .filter((i) => (i.className || '').toString().length >= 0)
      .map((i) => {
        const r = i.getBoundingClientRect();
        return {
          cls: String(i.className), w: round(r.width), h: round(r.height),
          x: round(r.x - box.x), y: round(r.y - box.y),
        };
      });
    return {
      text: (n.innerText || '').slice(0, 10).replace(/\n/g, ' '),
      w: round(box.width), h: round(box.height),
      shapeW: round(sr.width), shapeH: round(sr.height),
      fs: cs.fontSize, titleFs: tcs ? tcs.fontSize : null,
      titleW: tr ? round(tr.width) : null,
      titleX: tr ? round(tr.x - box.x) : null,
      icons,
    };
  });
  // depth = distance from the root topic
  const depthOf = (n) => {
    let d = 0, cur = n;
    while (cur && cur.classList && !cur.classList.contains('central-topic')) {
      const parent = cur.parentElement?.closest('.topic-node');
      if (!parent) break;
      cur = parent; d += 1;
    }
    return d;
  };
  return JSON.stringify({ rows: rows.map((r, i) => ({ depth: depthOf(nodes[i]), ...r })) }, null, 1);
})()`;

for (const page of pages) {
  try {
    const value = await evalOn(page, EXPR);
    if (value) {
      console.log(value);
      process.exit(0);
    }
  } catch (err) {
    // Page without the editor DOM / not ready yet — try the next one.
  }
}
console.error('no page with .topic-node found');
process.exit(1);
