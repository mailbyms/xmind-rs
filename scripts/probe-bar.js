(() => {
  const bar = document.querySelector('.uk-workbench-top-bar');
  const kids = [...bar.children].map((el) => {
    const r = el.getBoundingClientRect();
    const btn = el.querySelector('button');
    return {
      cls: String(el.className).slice(0, 70),
      x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      kids: el.children.length,
      btn: btn ? { cls: String(btn.className).slice(0, 50), rect: btn.getBoundingClientRect().toJSON() } : null,
      html: el.outerHTML.slice(0, 200),
    };
  });
  return { kids };
})()
