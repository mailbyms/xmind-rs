(() => {
  const f = (v) => Math.round(v * 100) / 100;
  const strip = document.querySelector('.uk-format-panel .color-list-preview');
  if (!strip) return JSON.stringify({ error: 'no strip' });
  const cs = getComputedStyle(strip);
  const r = strip.getBoundingClientRect();
  return JSON.stringify({
    box: [f(r.width), f(r.height)], cls: strip.getAttribute('class'),
    gap: cs.gap, padding: cs.padding, margin: cs.marginRight, radius: cs.borderRadius,
    kids: [...strip.children].map((c) => {
      const cr = c.getBoundingClientRect();
      const ccs = getComputedStyle(c);
      return [f(cr.width), f(cr.height), ccs.backgroundImage.slice(0, 150), ccs.borderRadius, ccs.flex];
    }),
  }, null, 1);
})()
