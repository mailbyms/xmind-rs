(() => {
  const secs = [...document.querySelectorAll('.fp-scroll > .fp-section')];
  const s = secs[secs.length - 1];
  const b = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 36), h: Math.round(r.height * 100) / 100, y: Math.round(r.y * 100) / 100, pb: cs.paddingBottom, mt: cs.marginTop };
  };
  return JSON.stringify({ sec: b(s), kids: [...s.children].map(b) }, null, 1);
})()
