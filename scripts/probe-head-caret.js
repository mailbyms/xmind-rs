(() => {
  const btns = [...document.querySelectorAll('.uk-format-panel-section-collapse button')];
  const out = btns.slice(0, 3).map((b) => {
    const cs = getComputedStyle(b, '::after');
    const r = b.getBoundingClientRect();
    return { cls: b.className.slice(0, 60), w: r.width, h: r.height, content: cs.content, bg: cs.backgroundImage.slice(0, 600), right: cs.right, top: cs.top, ww: cs.width, hh: cs.height };
  });
  return JSON.stringify(out, null, 1);
})()
