// Build a self-contained side-by-side comparison page for the render-alignment
// work.  Usage: node scripts/compare-render.mjs out.html orig.png before.png after.png [data.json]
import { readFileSync, writeFileSync } from 'node:fs';

const [out, orig, before, after, dataFile, overlay] = process.argv.slice(2);
const img = (p) => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}">`;
let data = null;
try { if (dataFile) data = JSON.parse(readFileSync(dataFile, 'utf8')); } catch {}

const rows = data?.rows ?? [];
const meta = data ?? {};
const headers = meta.headers ?? ['项目', '原版 XMind', '修复前', '修复后'];
const table = rows.length ? `
<h2>关键几何 / 样式对照（1280×820，100% 缩放）</h2>
<table>
  <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody>
</table>` : '';

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>test.xmind 渲染效果对照</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 48px; background: #f7f8fa; color: #1d2129;
         font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #6b7280; margin: 0 0 24px; font-size: 13px; }
  h2 { font-size: 16px; margin: 30px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .card header { padding: 10px 14px; border-bottom: 1px solid #eef0f3; font-weight: 600; font-size: 13px; }
  .card header span { font-weight: 400; color: #8b909a; font-size: 12px; margin-left: 6px; }
  .card img { display: block; width: 100%; height: auto; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 20px; margin-left: 8px; }
  .tag.ref { background: #e8f0fe; color: #1a56b0; }
  .tag.bad { background: #fdeaea; color: #b42318; }
  .tag.ok { background: #e6f4ea; color: #137333; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 5px 0; }
  code { background: #f1f3f5; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #eef0f3; text-align: left; font-size: 13px; }
  th { background: #f3f5f8; font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .overlay { margin-top: 18px; }
  .overlay img { width: 100%; max-width: 1000px; border: 1px solid #e5e7eb; border-radius: 8px; display: block; }
  .muted { color: #6b7280; font-size: 13px; }
  .callout { margin-top: 26px; background: #fff; border: 1px solid #e5e7eb; border-left: 3px solid #2e8b8b;
             border-radius: 8px; padding: 14px 18px; }
</style></head><body>
<h1>test.xmind 渲染效果对照</h1>
<p class="sub">${meta.subtitle ?? '原版 XMind 23.07 与 xmind-rs 打开同一文件 · 视口 1280×820 · 100% 缩放<br>画布平移量不同，未做位置对齐。'}</p>
<div class="grid">
  <div class="card"><header>原版 XMind<span class="tag ref">基准</span></header>${img(orig)}</div>
  <div class="card"><header>修复前<span class="tag bad">差异明显</span></header>${img(before)}</div>
  <div class="card"><header>修复后<span class="tag ok">已对齐</span></header>${img(after)}</div>
</div>
${table}
${overlay ? `<h2>位置对齐后的 50% 叠加对照</h2>
<p class="muted">${meta.overlayNote ?? '把修复后截图按中心主题平移后与原版各取 50% 叠加。重合的元素清晰，未重合处出现重影；工具栏差异属于两套应用外壳，不计入导图渲染。'}</p>
<div class="overlay">${img(overlay)}</div>` : ''}
${(meta.extra ?? []).length ? `<h2>新增交互（本应用实拍）</h2>
<div class="grid" style="grid-template-columns:repeat(2,1fr)">
${meta.extra.map((e) => `<div class="card"><header>${e.title}</header>${img(e.path)}</div>`).join('')}
</div>` : ''}
<div class="callout">
  <strong>${meta.fixTitle ?? '本轮修复'}</strong>
  <ul>${(meta.fixes ?? [
    '画布背景：外来主题的 <code>map/properties/svg:fill</code> 照常生效。',
    '图片主题：按资源原生尺寸绘制为「图在上、标题在下」的卡片。',
    '笔记角标与标签：角标移入盒内右缘，标签改为白底浅描边并挂在盒外。',
  ]).map((s) => `<li>${s}</li>`).join('')}</ul>
  <p style="margin:12px 0 0"><strong>仍存在的差异（如实记录，未声称像素级一致）：</strong>
  ${meta.remaining ?? '叠加图里的重影主要来自字体渲染与两套应用工具栏。'}</p>
</div>
</body></html>`;
writeFileSync(out, html);
console.log('wrote', out);
