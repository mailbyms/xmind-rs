// Audit every 骨架 × 配色方案 combination for text/background contrast on the
// white canvas. Text that sits on a fill which is `none` (下划线 skeletons) or
// a white-based hatch tile is the failure mode this catches: the palette ink is
// computed from the branch colour, so a dark palette paints white-on-white.
//
// Usage: node --experimental-strip-types scripts/audit-contrast.mjs [outdir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { PALETTE_TABS, paletteBranches, paletteCenter } from '../src/inspector/palettes.ts';
import { ALL_SKELETONS } from '../src/inspector/skeletons.ts';

const outdir = process.argv[2] || 'target/audit';
mkdirSync(outdir, { recursive: true });
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
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

const invoke = (cmd, args = {}) => send('Runtime.evaluate', {
  expression: `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`,
  returnByValue: true, awaitPromise: true,
}).then((r) => {
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'ipc failed');
  return r.result.value;
});

/* ---------- colour maths, mirroring crates/xmind-core/src/layout.rs ------ */
const rgb = (hex) => {
  const raw = String(hex).trim().replace(/^#/, '');
  if (/^black$/i.test(raw)) return [0, 0, 0];
  if (/^white$/i.test(raw)) return [255, 255, 255];
  if (raw.length === 3) return raw.split('').map((c) => parseInt(c + c, 16));
  if (raw.length === 6 || raw.length === 8) {
    return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  }
  return null;
};
const lum = (hex) => {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [la, lb] = [lum(a), lum(b)];
  if (la === null || lb === null) return 21;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg, bg, alpha) => {
  const [f, b] = [rgb(fg), rgb(bg)];
  if (!f || !b) return bg;
  const mix = (x, y) => Math.round(x * alpha + y * (1 - alpha));
  return `#${[0, 1, 2].map((i) => mix(f[i], b[i]).toString(16).padStart(2, '0')).join('')}`;
};
const isStrokeFill = (p) => /hachure|crossing|zigzag/.test(p || '');
/** The colour the label really sits on + whether the topic paints it.
 *  Mirrors `text_surface()` in layout.rs. */
const surface = (style, canvas, fallback = '#ffffff') => {
  if (style.underline || !style.fill || style.fill === 'none' || style.fill === 'transparent') {
    return { bg: canvas, onPlate: false };
  }
  if (isStrokeFill(style.fillPattern)) return { bg: blend(style.fill, fallback, 0.22), onPlate: false };
  return { bg: style.fill, onPlate: true };
};

/* ---------------------------------- setup -------------------------------- */
await send('Page.bringToFront').catch(() => {});
await invoke('doc_new');
// A three-level tree: the audit needs a central topic, a main branch and a
// sub-branch, because each depth is inked differently.
const snapshot = await invoke('doc_layout');
const root = snapshot.nodes.find((n) => !n.parentId);
const mains = snapshot.nodes.filter((n) => n.parentId === root.id);
const child = await invoke('doc_add_child', { id: mains[0].id, title: '第二级' });
const first = child.document.sheets[child.document.activeSheet].root.children[0].children[0];
await invoke('doc_add_child', { id: first.id, title: '第三级' });

const palettes = PALETTE_TABS.flatMap((tab) => tab.groups);
console.log(`skeletons ${ALL_SKELETONS.length} × palettes ${palettes.length} = ${ALL_SKELETONS.length * palettes.length} combos`);

const failures = [];
const worst = [];
const perSkeleton = [];
/** matrix[骨骼索引][配色索引] = 该组合里最差的一条 {ratio, ink, bg, title} */
const matrix = [];

for (const preset of ALL_SKELETONS) {
  await invoke('doc_apply_skeleton', {
    structure: preset.structure,
    central: preset.central,
    main: preset.main,
    shape: preset.shape,
    mainShape: preset.mainShape,
    line: preset.line,
    centralLine: preset.centralLine,
    pattern: preset.pattern,
    fillPattern: preset.fill,
    layers: preset.layers,
  });
  let bad = 0;
  const cells = [];
  for (const palette of palettes) {
    await invoke('doc_set_canvas', {
      background: null, fontFamily: null, lineWidth: null, rainbow: true,
      compact: null, siblingAlign: null,
      branchColors: paletteBranches(palette),
      palette: palette.id,
      centerColor: paletteCenter(palette),
    });
    const layout = await invoke('doc_layout');
    const canvas = layout.theme.bg || '#ffffff';
    let combo = null;
    for (const node of layout.nodes) {
      const { bg, onPlate } = surface(node.style, canvas);
      const ratio = contrast(node.style.color, bg);
      const floor = onPlate ? 2.0 : 4.5;
      const row = {
        skeleton: preset.title, structure: preset.structure, palette: palette.name,
        title: node.title, depth: node.depth, ink: node.style.color, bg,
        ratio: Number(ratio.toFixed(2)), floor,
        shape: node.style.shape, pattern: node.style.fillPattern,
      };
      if (ratio < floor) { failures.push(row); bad += 1; }
      worst.push(row);
      if (!combo || ratio < combo.ratio) combo = row;
    }
    if (combo) cells.push(combo);
  }
  matrix.push({ skeleton: preset.title, structure: preset.structure, cells });
  perSkeleton.push({ skeleton: preset.title, structure: preset.structure, lowContrastNodes: bad });
  process.stdout.write(bad === 0 ? '.' : 'x');
}
console.log('');

worst.sort((a, b) => a.ratio - b.ratio);
const summary = {
  combos: ALL_SKELETONS.length * palettes.length,
  nodesChecked: worst.length,
  failingNodes: failures.length,
  skeletonsWithFailures: perSkeleton.filter((s) => s.lowContrastNodes > 0).length,
  worst: worst.slice(0, 12),
};
writeFileSync(`${outdir}/summary.json`, JSON.stringify(summary, null, 2));
if (failures.length) {
  const byKey = new Map();
  for (const f of failures) {
    const key = `${f.structure}·${f.shape}·${f.pattern}·d${f.depth}`;
    const entry = byKey.get(key) || { ...f, count: 0 };
    entry.count += 1;
    byKey.set(key, entry);
  }
  writeFileSync(`${outdir}/failures.json`, JSON.stringify([...byKey.values()], null, 2));
}

writeFileSync(`${outdir}/matrix.json`, JSON.stringify({ palettes: palettes.map((p) => p.name), rows: matrix }));

/* ------------------------- self-contained HTML report ------------------- */
const tone = (ratio) => (ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'mid' : ratio >= 2 ? 'low' : 'bad');
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>骨架 × 配色 · 文字对比度</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 32px 60px; background: #fff; color: #1f2733;
    font: 13px/1.5 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p.lede { margin: 0 0 18px; color: #64707f; max-width: 900px; }
  .legend { display: flex; gap: 14px; margin: 0 0 18px; font-size: 12px; color: #4b5563; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px;
    vertical-align: -2px; }
  table { border-collapse: separate; border-spacing: 2px; }
  th { font-weight: 600; font-size: 12px; color: #4b5563; padding: 4px 6px; }
  th.rot { writing-mode: vertical-rl; text-orientation: mixed; height: 96px; vertical-align: bottom;
    font-weight: 500; white-space: nowrap; }
  th.row { text-align: left; white-space: nowrap; position: sticky; left: 0; background: #fff;
    padding-right: 10px; z-index: 1; }
  td { width: 26px; height: 22px; text-align: center; font-size: 10px; border-radius: 3px;
    font-variant-numeric: tabular-nums; cursor: default; }
  td.ok { background: #e7f6ec; color: #1a7f45; }
  td.mid { background: #fff3d6; color: #8a5a00; }
  td.low { background: #ffe0c7; color: #8a3b00; }
  td.bad { background: #ffd7d5; color: #9b1c1c; }
  tr:hover td { outline: 1px solid #94a3b8; }
  .foot { margin-top: 22px; color: #64707f; font-size: 12px; max-width: 900px; }
  code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
</style></head><body>
<h1>骨架 × 配色 · 文字对比度</h1>
<p class="lede">白底画布下逐一渲染 ${String(summary.combos)} 个组合（${String(matrix.length)} 个骨架模板 × ${String(palettes.length)} 个配色方案），
格子里是该组合<strong>最差</strong>那个主题的 WCAG 对比度（文字色 vs 文字实际压着的面）。悬停看具体主题。</p>
<div class="legend">
  <span><i style="background:#e7f6ec"></i>≥ 4.5 正常</span>
  <span><i style="background:#fff3d6"></i>3–4.5 偏弱</span>
  <span><i style="background:#ffe0c7"></i>2–3 偏低</span>
  <span><i style="background:#ffd7d5"></i>&lt; 2 不可读</span>
</div>
<table><thead><tr><th class="row">骨架</th>
${palettes.map((p) => `<th class="rot">${p.name}</th>`).join('')}
</tr></thead><tbody>
${matrix.map((line) => `<tr><th class="row">${line.skeleton}</th>${line.cells.map((c) =>
  `<td class="${tone(c.ratio)}" title="${line.skeleton} × ${c.palette}: ${c.ink} on ${c.bg} = ${c.ratio}（${c.title}）">${c.ratio.toFixed(1)}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>
<p class="foot">实心色块沿用原版 XMind 的墨色（按色块亮度翻转，红底白字 WCAG 3.6 也保留）；
无填充骨架（下划线 / 双下划线）与手绘纹理（hachure / crossing / zigzag，白底描线）会在低于 4.5 时改挑黑白。
明细：<code>summary.json</code> / <code>matrix.json</code>。</p>
</body></html>`;
writeFileSync(`${outdir}/report.html`, html);


console.log(`\nnodes checked: ${summary.nodesChecked}`);
console.log(`low-contrast nodes: ${summary.failingNodes} across ${summary.skeletonsWithFailures} skeletons`);
for (const row of perSkeleton.filter((s) => s.lowContrastNodes > 0)) {
  console.log(`  x ${row.skeleton} (${row.structure}) — ${row.lowContrastNodes} nodes`);
}
console.log('worst cases:', JSON.stringify(summary.worst.slice(0, 5), null, 2));
ws.close();
