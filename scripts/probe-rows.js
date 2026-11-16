(() => {
  const secs = [...document.querySelectorAll('.fp-section')];
  const s = secs[1];
  if (!s) return 'no section';
  const b = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.y), Math.round(r.height)]; };
  return {
    section: b(s),
    head: b(s.querySelector('.fp-head')),
    content: b(s.querySelector('.fp-content')),
    rows: [...s.querySelectorAll('.fp-row')].map((el) => ({ y: b(el), kids: [...el.children].map((k) => [k.className.slice(0, 20), ...b(k)]) })),
  };
})()
