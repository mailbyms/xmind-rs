(() => {
  const all = [...document.querySelectorAll('*')];
  const cls = new Set();
  all.forEach((el) => {
    const c = el.getAttribute('class');
    if (!c) return;
    c.split(/\s+/).forEach((k) => { if (/panel|workbench|format|right/i.test(k)) cls.add(k); });
  });
  return JSON.stringify({ classes: [...cls], count: all.length }, null, 1);
})()
