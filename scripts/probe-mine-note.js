(() => {
  const secs = [...document.querySelectorAll('.fp-scroll > .fp-section')];
  const s = secs[secs.length - 1];
  const f = s.querySelector('.fp-field');
  const b = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { cls: String(el.className).slice(0, 30), h: Math.round(r.height * 100) / 100, mt: cs.marginTop, mb: cs.marginBottom, pb: cs.paddingBottom, lh: cs.lineHeight };
  };
  return JSON.stringify({ field: b(f), kids: [...f.children].map(b) }, null, 1);
})()
