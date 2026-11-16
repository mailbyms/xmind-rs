(() => {
  const bar = document.querySelector('.workbench-status-bar');
  const row = bar.children[1];
  const right = row.children[1];
  const info = (el, depth) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      d: depth,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 100),
      x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
      text: (el.textContent || '').trim().slice(0, 30),
      fs: cs.fontSize, fw: cs.fontWeight, color: cs.color,
      pad: cs.padding, mar: cs.margin, ga: cs.gap, br: cs.borderRadius,
      bg: cs.backgroundColor, sh: cs.boxShadow.slice(0, 60),
      cur: cs.cursor,
    };
  };
  const walk = (el, depth, out) => {
    out.push(info(el, depth));
    if (depth < 4) [...el.children].forEach((c) => walk(c, depth + 1, out));
  };
  const out = [];
  walk(right, 0, out);
  return JSON.stringify(out, null, 1);
})()
