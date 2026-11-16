(() => {
  const panel = document.querySelector('.uk-format-panel');
  const f = (v) => Math.round(v * 100) / 100;
  const sub = [...panel.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes('配色方案'));
  const btns = [...sub.querySelectorAll('button')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: f(r.width), h: f(r.height), br: cs.borderRadius, title: el.title,
      cls: String(el.getAttribute('class') || '').slice(0, 50),
      html: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 1200),
    };
  });
  const strip = sub.querySelector('[class*="swatch"], [class*="color-theme"], [class*="theme-color"]');
  return JSON.stringify({
    btns,
    stripCls: strip ? strip.getAttribute('class') : null,
    stripKids: strip ? strip.children.length : 0,
    stripHTML: strip ? strip.outerHTML.replace(/\s+/g, ' ').slice(0, 900) : null,
  }, null, 1);
})()
