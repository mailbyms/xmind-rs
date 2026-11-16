// Drive the real UI: open 画布 tab, open the 骨架 popover, pick a skeleton,
// then dump the rendered SVG facts and screenshot the window.
// Usage: node scripts/ui-skeleton.mjs "<骨架名>" [out.png]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const label = process.argv[2] || '括号图';
const out = process.argv[3] || 'target/shot-ui.png';
const PORT = process.env.CDP_PORT || 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
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
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});
await evaluate(`(() => { document.body.click(); return 1; })()`);

// 1. 画布 tab
const tab = await evaluate(`(() => {
  const b = [...document.querySelectorAll('.fp-tabs button')].find((x) => x.textContent.trim() === '画布');
  if (!b) return 'no tab';
  b.click(); return 'ok';
})()`);
await wait(400);

// 2. 骨架 card → popover
const bone = await evaluate(`(() => {
  const b = document.querySelector('.fp-bone');
  if (!b) return 'no card';
  b.click(); return 'ok';
})()`);
await wait(400);

// 3. pick the skeleton
const picked = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.pop-struct button')];
  const target = items.find((b) => b.textContent.trim() === ${JSON.stringify(label)});
  if (!target) return 'missing: ' + items.map((b) => b.textContent.trim()).join('/');
  target.click(); return 'ok';
})()`);
await wait(900);

// 4. what did the canvas actually draw?
const facts = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.canvas svg .node, svg .node')];
  const decor = [...document.querySelectorAll('.edges path.decor, .edges path')].map((p) => ({
    d: (p.getAttribute('d') || '').slice(0, 120), stroke: p.getAttribute('stroke'),
    w: p.getAttribute('stroke-width'),
  }));
  return {
    tab: ${JSON.stringify(tab)}, bone: ${JSON.stringify(bone)}, picked: ${JSON.stringify(picked)},
    skeletonLabel: document.querySelector('.fp-bone-name')?.textContent.trim(),
    nodeCount: nodes.length,
    decorCount: decor.length,
    decorSample: decor.slice(0, 3),
    cellNodes: [...document.querySelectorAll('.node.cell')].length,
    layoutInfo: (() => {
      const svg = document.querySelector('svg.map-svg, .canvas svg');
      return svg ? { viewBox: svg.getAttribute('viewBox'), w: svg.getBoundingClientRect().width } : null;
    })(),
  };
})()`);
console.log(JSON.stringify(facts, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('shot ->', out);
ws.close();
