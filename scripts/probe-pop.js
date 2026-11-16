(() => {
  const pops = [...document.querySelectorAll('.uk-pop, .uk-drop, .uk-dropdown')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      cls: String(el.className).slice(0, 80),
      x: r.x, y: r.y, w: r.width, h: r.height,
      disp: cs.display, vis: cs.visibility, op: cs.opacity,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
  });
  const btns = [...document.querySelectorAll('.workbench-status-bar button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { cls: b.className.slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height, t: b.textContent.trim().slice(0, 20), aria: b.getAttribute('aria-expanded'), st: b.getAttribute('data-state') };
  });
  return JSON.stringify({ pops, btns }, null, 1);
})()
