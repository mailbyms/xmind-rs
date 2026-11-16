(() => {
  const pick = (el, depth) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      d: depth,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 70),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, color: cs.color, bg: cs.backgroundColor,
      pad: cs.padding, mar: cs.margin, ta: cs.textAlign,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  };
  // find nodes whose class hints at outliner
  const hits = [...document.querySelectorAll('[class*="outline" i]')].slice(0, 25).map((el) => pick(el, 0));
  return JSON.stringify(hits, null, 1);
})()
