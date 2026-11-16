(() => {
  const f = (v) => Math.round(v * 100) / 100;
  const sub = [...document.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes('彩虹分支'));
  const btn = sub.querySelector('button');
  const r = btn.getBoundingClientRect();
  const cs = getComputedStyle(btn);
  const imgs = [...btn.querySelectorAll('*')].map((c) => {
    const cr = c.getBoundingClientRect();
    const ccs = getComputedStyle(c);
    return {
      tag: c.tagName.toLowerCase(), cls: String(c.getAttribute('class') || '').slice(0, 30),
      w: f(cr.width), h: f(cr.height), bg: ccs.backgroundImage.slice(0, 120),
      html: (c.outerHTML || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  return JSON.stringify({ btn: [f(r.width), f(r.height), cs.padding, cs.borderRadius, btn.className], kids: imgs }, null, 1);
})()
