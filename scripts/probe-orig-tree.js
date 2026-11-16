(() => {
  const fp = document.querySelector('.uk-workbench-right');
  const out = [];
  const walk = (el, depth) => {
    if (depth > 8) return;
    for (const child of el.children) {
      const b = child.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      const cs = getComputedStyle(child);
      const own = [...child.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').trim();
      out.push({
        d: depth,
        tag: child.tagName.toLowerCase(),
        cls: String(child.className).slice(0, 70),
        r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        t: own.slice(0, 24),
        bg: cs.backgroundColor,
        fw: cs.fontWeight,
        fs: cs.fontSize,
        dis: child.hasAttribute('disabled') || cs.opacity === '0.4' ? 1 : 0,
        title: (child.getAttribute('title') || child.getAttribute('uk-tooltip') || '').slice(0, 40),
      });
      walk(child, depth + 1);
    }
  };
  walk(fp, 0);
  return JSON.stringify(out);
})()
