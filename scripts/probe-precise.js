(() => {
  const f = (v) => Math.round(v * 100) / 100;
  const parts = ['.uk-format-panel-section', '.uk-format-panel-sub-section', 'form', '.uk-card.uk-card-selectable'];
  const out = {};
  for (const sel of parts) {
    out[sel] = [...document.querySelectorAll(sel)].slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      return [f(r.y), f(r.height), f(r.width)];
    });
  }
  const grid = document.querySelector('.uk-format-panel form > div > div[style*="grid"]');
  if (grid) out.gridStyle = grid.getAttribute('style');
  return JSON.stringify(out, null, 1);
})()
