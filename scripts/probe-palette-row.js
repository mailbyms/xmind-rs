(() => {
  const panel = document.querySelector('.uk-format-panel');
  const f = (v) => Math.round(v * 100) / 100;
  const sub = [...panel.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes('配色方案'));
  const row = sub.querySelector('.uk-flex');
  const kids = [...row.children].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 40),
      w: f(r.width), h: f(r.height), br: cs.borderRadius, pad: cs.padding,
      html: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 700),
    };
  });
  return JSON.stringify({ row: [f(row.getBoundingClientRect().width), f(row.getBoundingClientRect().height)], kids }, null, 1);
})()
