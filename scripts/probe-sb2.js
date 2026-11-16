(() => {
  const bar = document.querySelector('.workbench-status-bar');
  const row = bar.children[1];
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 46), x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, t: (el.textContent || '').trim().slice(0, 14), fs: cs.fontSize, fw: cs.fontWeight, pad: cs.padding, color: cs.color, br: cs.borderRadius };
  };
  const out = { bar: info(bar), row: info(row), kids: [...row.children].map((c) => ({ ...info(c), sub: [...c.children].map(info) })) };
  return JSON.stringify(out, null, 1);
})()
