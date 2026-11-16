(() => {
  const root = document.querySelector('.outliner-container');
  const info = (el, depth) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return {
      d: depth,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 80),
      x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing,
      color: cs.color, bg: cs.backgroundColor,
      pad: cs.padding, mar: cs.margin, ta: cs.textAlign, tt: cs.textTransform,
      own: own.slice(0, 24),
    };
  };
  const out = [];
  const walk = (el, d) => {
    if (d > 7) return;
    out.push(info(el, d));
    [...el.children].forEach((c) => walk(c, d + 1));
  };
  walk(root, 0);
  return JSON.stringify(out, null, 1);
})()
