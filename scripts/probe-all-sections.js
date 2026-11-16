(() => {
  const panel = document.querySelector('.uk-format-panel') || document.querySelector('.fp');
  if (!panel) return JSON.stringify({ error: 'no panel' });
  const f = (v) => Math.round(v * 100) / 100;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 40),
      y: f(r.y), h: f(r.height), mt: f(parseFloat(cs.marginTop) || 0), mb: f(parseFloat(cs.marginBottom) || 0),
      pt: f(parseFloat(cs.paddingTop) || 0), pb: f(parseFloat(cs.paddingBottom) || 0),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 10),
    };
  };
  const sections = [...panel.querySelectorAll('.uk-format-panel-section, .fp-section')];
  return JSON.stringify(sections.map((s) => ({ sec: box(s), kids: [...s.children].map(box), grand: [...s.querySelectorAll('label,input,button')].slice(0, 10).map(box) })), null, 1);
})()
