(() => {
  const panel = document.querySelector('.uk-format-panel');
  const f = (v) => Math.round(v * 100) / 100;
  const info = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 60),
      x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height),
      fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, lh: cs.lineHeight,
      html: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 500),
      kids: [...el.children].slice(0, 10).map((c) => {
        const cr = c.getBoundingClientRect();
        return [c.tagName.toLowerCase(), String(c.getAttribute('class') || '').slice(0, 30), f(cr.width), f(cr.height), getComputedStyle(c).backgroundColor];
      }),
    };
  };
  const sub = (kw) => [...panel.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes(kw));
  const bg = sub('背景颜色');
  const label = bg ? bg.querySelector('span, label, div') : null;
  const paletteBtn = panel.querySelector('button[class*="popover"]');
  const rainbow = sub('彩虹分支');
  return JSON.stringify({
    bgLabel: info(label),
    bgSection: info(bg),
    paletteButton: info(paletteBtn),
    rainbow: info(rainbow),
    rainbowBtn: info(rainbow ? rainbow.querySelector('button') : null),
  }, null, 1);
})()
