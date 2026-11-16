(() => {
  const svgs = [...document.querySelectorAll('svg')];
  const out = svgs.slice(0, 6).map((s) => {
    const r = s.getBoundingClientRect();
    return {
      cls: s.getAttribute('class'),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      kids: [...s.children].slice(0, 8).map((c) => c.tagName + '|' + (c.getAttribute('class') || '')),
    };
  });
  const classes = new Set();
  document.querySelectorAll('svg *').forEach((el) => {
    const c = el.getAttribute('class');
    if (c) classes.add(c.split(/\s+/)[0]);
  });
  return JSON.stringify({ svgs: out, classNames: [...classes].slice(0, 40) }, null, 1);
})()
