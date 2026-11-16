// Build a small deterministic map in the running app, apply a structure,
// then dump layout facts and screenshot the window.
// Usage: node scripts/check-layout.mjs <structure> [out.png] [--compact] [--no-align]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const structure = process.argv[2] || 'braceRight';
const out = process.argv[3] || `target/shot-${structure}.png`;
const compact = process.argv.includes('--compact');
const align = !process.argv.includes('--no-align');
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

const built = await evaluate(`(async () => {
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  let snap = await inv('doc_new');
  const rootId = snap.document.sheets[0].root.id;
  await inv('doc_rename', { id: rootId, title: 'XMind RS' });
  const plan = {
    '产品': ['需求分析', '交互设计', '视觉稿'],
    '技术': ['前端渲染', 'Rust 排版'],
    '运营': ['内容', '增长实验', '数据看板'],
  };
  const findChild = (topic, title) => (topic.children || []).find((c) => c.title === title);
  for (const [branch, kids] of Object.entries(plan)) {
    let next = await inv('doc_add_child', { id: rootId, title: branch });
    const branchNode = findChild(next.document.sheets[0].root, branch);
    for (const kid of kids) {
      next = await inv('doc_add_child', { id: branchNode.id, title: kid });
    }
  }
  await inv('doc_set_canvas', { compact: ${compact}, siblingAlign: ${align} });
  snap = await inv('doc_set_structure', { structure: '${structure}' });
  const layout = await inv('doc_layout');
  return { structure: layout.structure, nodes: layout.nodes.length, edges: layout.edges.length,
    decor: (layout.decor || []).length, size: [Math.round(layout.width), Math.round(layout.height)],
    decorSample: (layout.decor || []).slice(0, 2).map((d) => ({ color: d.color, w: d.width, path: d.path.slice(0, 160) })),
    levels: [...new Set(layout.nodes.map((n) => n.depth))].map((depth) => ({
      depth,
      widths: [...new Set(layout.nodes.filter((n) => n.depth === depth).map((n) => Math.round(n.width)))],
      ys: layout.nodes.filter((n) => n.depth === depth).map((n) => Math.round(n.y)),
      xs: layout.nodes.filter((n) => n.depth === depth).map((n) => Math.round(n.x)),
    })),
  };
})()`);
console.log(JSON.stringify(built, null, 1));

await wait(700);
await evaluate(`(() => { const w = window; return w.innerWidth; })()`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('shot ->', out);
ws.close();
