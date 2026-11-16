(() => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  };
  const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
  const q = (sel) => document.querySelector(sel);
  const items = [...document.querySelectorAll('.tool-item')];
  const heads = [...document.querySelectorAll('.fp-head')];
  const sections = [...document.querySelectorAll('.fp-section')];
  return {
    titlebar: r(q('.titlebar')),
    titlebarBorder: cs(q('.titlebar'), 'borderBottom'),
    menuBtn: r(q('.menu-btn')),
    docName: { r: r(q('.doc-name')), fs: cs(q('.doc-name'), 'fontSize') },
    toolbar: r(q('.toolbar')),
    toolItems: items.map((el) => ({
      label: el.querySelector('.tool-label')?.textContent ?? '',
      item: r(el),
      btn: r(el.querySelector('button')),
      icon: r(el.querySelector('svg')),
      labelFs: el.querySelector('.tool-label') ? cs(el.querySelector('.tool-label'), 'fontSize') : null,
      labelLh: el.querySelector('.tool-label') ? cs(el.querySelector('.tool-label'), 'lineHeight') : null,
    })),
    controls: r(q('.window-controls')),
    controlBtn: r(q('.window-controls button')),
    panel: r(q('.fp')),
    panelBg: cs(q('.fp'), 'backgroundColor'),
    tabs: [...document.querySelectorAll('.fp-tabs button')].map((el) => ({
      t: el.textContent, r: r(el), bg: cs(el, 'backgroundColor'), c: cs(el, 'color'), fw: cs(el, 'fontWeight'),
    })),
    tabStrip: r(q('.fp-tabs')),
    sections: sections.map((el) => ({ r: r(el), pad: cs(el, 'padding') })),
    heads: heads.map((el) => ({ t: el.querySelector('.fp-title')?.textContent, r: r(el) })),
    titleFs: heads[0]?.querySelector('.fp-title') ? cs(heads[0].querySelector('.fp-title'), 'fontSize') : null,
    titleFw: heads[0]?.querySelector('.fp-title') ? cs(heads[0].querySelector('.fp-title'), 'fontWeight') : null,
    footer: r(q('.fp-footer')),
    statusbar: r(q('.statusbar')),
    statusRow: r(q('.sb-row')),
    sheetTab: r(q('.sb-sheet')),
    zoomText: q('.sb-right')?.textContent,
    canvas: r(q('.canvas')),
  };
})()
