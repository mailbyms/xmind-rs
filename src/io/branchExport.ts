/**
 * 「导出分支为…」/「打印分支…」.
 *
 * XMind crops the export to the selected branch, so the backend rebuilds a
 * one-branch document (that topic becomes the central topic) and hands back
 * either the vector/text file or the SVG source. PNG and PDF need a raster,
 * and only the WebView knows the installed fonts — so those two are produced
 * here: the SVG is drawn onto a canvas, PNG is encoded by the browser, and the
 * PDF is a one-page image XObject whose RGB scanlines are deflated with
 * `CompressionStream` (no third-party PDF library, no extra dependency).
 */
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/api';
import { buildPdfFromRgb } from './pdf';
import { embedFonts } from './fontEmbed';

export type BranchFormat = 'png' | 'svg' | 'pdf' | 'md';

const META: Record<BranchFormat, { label: string; ext: string }> = {
  png: { label: 'PNG 图片', ext: 'png' },
  svg: { label: 'SVG 矢量图', ext: 'svg' },
  pdf: { label: 'PDF 文档', ext: 'pdf' },
  md: { label: 'Markdown 大纲', ext: 'md' },
};

const safeName = (title: string) => (title || '分支').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

/** Rasterise the branch SVG at `scale`x; returns the canvas it was drawn on. */
async function rasterize(svg: string, scale: number): Promise<HTMLCanvasElement> {
  // A Blob URL is its own document: only fonts embedded in the SVG itself are
  // available to the rasteriser.
  const blob = new Blob([await embedFonts(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('分支渲染失败'));
      image.src = url;
    });
    const natural = {
      w: image.naturalWidth || 960,
      h: image.naturalHeight || 640,
    };
    // 2x keeps text crisp on HiDPI without blowing past the canvas limits.
    const ratio = Math.min(scale, 8000 / Math.max(natural.w, natural.h));
    const width = Math.max(1, Math.round(natural.w * ratio));
    const height = Math.max(1, Math.round(natural.h * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建绘图上下文');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** Flatten the canvas to RGB and wrap it in a one-page PDF. */
async function canvasToPdf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法读取画布');
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];
    rgb[j++] = rgba[i + 1];
    rgb[j++] = rgba[i + 2];
  }
  return buildPdfFromRgb(rgb, width, height);
}

/**
 * Pre-answer the native file picker. The OS dialog cannot be driven from the
 * DevTools protocol, so `scripts/ui-export-raster.mjs` sets
 * `window.__XM_SAVE_PATH__` to exercise the whole export path unattended.
 * Leave it `undefined` for the real dialog; `null` simulates "user cancelled".
 */
const dialogOverride = (): string | null | undefined =>
  (globalThis as { __XM_SAVE_PATH__?: string | null }).__XM_SAVE_PATH__;

/** Export one branch. Returns the chosen path, or `null` when cancelled. */
export async function exportBranch(
  id: string, title: string, format: BranchFormat,
): Promise<string | null> {
  const meta = META[format];
  const override = dialogOverride();
  const path = override === undefined ? await save({
    title: `导出分支：${title}`,
    defaultPath: `${safeName(title)}.${meta.ext}`,
    filters: [{ name: meta.label, extensions: [meta.ext] }],
  }) : override;
  if (!path) return null;
  if (format === 'md') {
    await api.exportBranch(path, format, id);
    return path;
  }
  const svg = await api.branchSvg(id);
  if (format === 'svg') {
    // Write the vector file from here too, so a standalone SVG opened on a
    // machine without Montserrat/NeverMind still renders like the canvas.
    const withFonts = await embedFonts(svg);
    await api.writeBytes(path, toBase64(new TextEncoder().encode(withFonts)));
    return path;
  }
  const canvas = await rasterize(svg, 2);
  if (format === 'png') {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG 编码失败'))), 'image/png');
    });
    await api.writeBytes(path, toBase64(new Uint8Array(await blob.arrayBuffer())));
  } else {
    await api.writeBytes(path, toBase64(await canvasToPdf(canvas)));
  }
  return path;
}

/** 打印分支: print just this branch through the OS print dialog. */
export async function printBranch(id: string, title: string): Promise<void> {
  const svg = await embedFonts(await api.branchSvg(id));
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  document.body.appendChild(frame);
  const view = frame.contentDocument;
  if (!view) { frame.remove(); throw new Error('无法创建打印视图'); }
  const escaped = title.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch));
  view.open();
  view.write('<!doctype html><html><head><meta charset="utf-8">'
    + `<title>${escaped}</title>`
    + '<style>@page{margin:12mm}html,body{margin:0;padding:0;background:#fff}'
    + 'svg{width:100%;height:auto}</style></head><body>'
    + svg
    + '</body></html>');
  view.close();
  // Give the SVG a frame to lay out before the print preview snapshots it.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const cleanup = () => frame.remove();
  frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 120_000);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
}
