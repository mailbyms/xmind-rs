(() => {
  const out = {};
  const grab = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) { out[label] = null; return; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out[label] = {
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      display: cs.display, padding: cs.padding, margin: cs.margin,
      radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight,
      border: cs.border, gap: cs.gap, alignItems: cs.alignItems,
    };
  };
  grab('.top-bar-title-bar', 'titleBar');
  const item = document.querySelectorAll('.uk-workbench-top-bar > .uk-flex-column')[0];
  grab('.uk-workbench-top-bar > .uk-flex-column', 'toolItem');
  const btn = item?.querySelector('button');
  if (btn) {
    const r = btn.getBoundingClientRect(); const cs = getComputedStyle(btn);
    out.toolBtn = { rect: r.toJSON(), radius: cs.borderRadius, bg: cs.backgroundColor, margin: cs.margin, padding: cs.padding };
  }
  const svg = item?.querySelector('svg');
  if (svg) out.toolIcon = { rect: svg.getBoundingClientRect().toJSON(), w: svg.getAttribute('width'), h: svg.getAttribute('height') };
  out.titleHtml = document.querySelector('.top-bar-title-bar')?.outerHTML.slice(0, 600);
  return out;
})()
