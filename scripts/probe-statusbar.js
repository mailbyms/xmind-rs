(() => {
  const pick = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 90),
      x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
      text: (el.textContent || '').trim().slice(0, 40),
      bg: cs.backgroundColor, color: cs.color, fs: cs.fontSize, fw: cs.fontWeight,
      pad: cs.padding, pos: cs.position, disp: cs.display, ga: cs.gap,
    };
  };
  // find elements pinned near the bottom of the viewport
  const vh = innerHeight, vw = innerWidth;
  const cands = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 12 && r.height < 60 && r.bottom > vh - 60 && r.bottom <= vh + 2 && r.width > 100;
  });
  const out = cands.slice(0, 12).map((el) => {
    const info = pick(el);
    info.kids = [...el.children].slice(0, 30).map(pick);
    return info;
  });
  return JSON.stringify({ vw, vh, out }, null, 1);
})()
