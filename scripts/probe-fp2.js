(function () {
  const out = {};
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  };
  const txt = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14);

  out.panel = r(document.querySelector('.fp'));
  out.tabs = [...document.querySelectorAll('.fp-tabs > li')].map((li) => ({
    t: txt(li), r: r(li), bar: li.classList.contains('bar'),
    a: r(li.querySelector('button')),
    bg: getComputedStyle(li.querySelector('button')).backgroundColor,
    fw: getComputedStyle(li.querySelector('button')).fontWeight,
  }));
  out.sections = [...document.querySelectorAll('.fp-section')].map(r);
  out.heads = [...document.querySelectorAll('.fp-head')].map((h) => [txt(h), ...r(h)]);
  out.rows = [...document.querySelectorAll('.fp-row')].map(r);
  out.segs = [...document.querySelectorAll('.fp-seg')].map(r);
  out.footer = document.querySelector('.fp-reset') ? r(document.querySelector('.fp-reset')) : null;

  const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 8).map((el) => [String(el.className).slice(0, 24), ...r(el)]);
  out.selects = pick('.fp-select');
  out.wells = pick('.fp-well');
  out.toggles = pick('.fp-toggle');
  out.measures = pick('.fp-measure');
  out.combos = pick('.fp-combo');
  out.bones = pick('.fp-bone');
  out.palettes = pick('.fp-palette');
  out.cards = pick('.fp-bone-card');
  out.previews = pick('.fp-preview');
  out.notes = pick('.fp-note');
  out.checklines = pick('.fp-check-line');
  return JSON.stringify(out);
})()
