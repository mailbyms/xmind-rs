(() => {
  const out = { href: location.href };
  const top = document.querySelector('.uk-workbench-top-bar') || document.querySelector('[class*="top-bar"]');
  out.topBar = top ? { cls: top.className, rect: top.getBoundingClientRect().toJSON() } : null;
  const btns = [...document.querySelectorAll('button, [role="button"]')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: String(el.className).slice(0, 90),
        text: (el.textContent || '').trim().slice(0, 24),
        title: el.getAttribute('title') || el.getAttribute('aria-label') || '',
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      };
    })
    .filter((b) => b.w > 0 && b.y < 110);
  out.buttons = btns;
  // Any right panel already mounted?
  out.right = [...document.querySelectorAll('[class*="workbench-right"], [class*="format-panel"]')]
    .map((el) => ({ cls: String(el.className).slice(0, 120), rect: el.getBoundingClientRect().toJSON() }));
  return out;
})()
