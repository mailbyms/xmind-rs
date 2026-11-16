(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: String(el.className).slice(0, 100),
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      css: {
        display: cs.display, width: cs.width, height: cs.height,
        padding: cs.padding, margin: cs.margin, borderRadius: cs.borderRadius,
        background: cs.backgroundColor, color: cs.color,
        font: cs.fontFamily.slice(0, 40) + ' ' + cs.fontSize + '/' + cs.fontWeight,
        lineHeight: cs.lineHeight, border: cs.border, flex: cs.flex,
      },
      html: el.outerHTML.slice(0, 420),
    };
  };
  const btn = document.querySelectorAll('.top-bar-tool-b')[0];
  const box = btn?.parentElement;
  return {
    button: pick(btn),
    buttonParent: pick(box),
    buttonParentParent: pick(box?.parentElement),
    panelToggle: pick(document.querySelectorAll('.top-bar-tool-b')[9]),
    menuBtn: pick(document.querySelector('.main-menu-btn')),
    windowCtl: pick(document.querySelector('.uk-window-control-button-close')),
    // separators / groups in the top bar
    children: [...(document.querySelector('.uk-workbench-top-bar')?.children ?? [])].map((el) => ({
      cls: String(el.className).slice(0, 80),
      rect: el.getBoundingClientRect().toJSON(),
      kids: el.children.length,
    })),
  };
})()
