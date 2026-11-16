(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function tabs() {
    return Array.from(document.querySelectorAll('ul.uk-tab-capsule > li'));
  }

  function indent(el) {
    let d = 0, p = el;
    while (p && p !== document.body) { d++; p = p.parentElement; }
    return d;
  }

  function dump(root) {
    const lines = [];
    const walk = (el, depth) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(' ');
      let cls = String(el.className || '').trim().replace(/\s+/g, '.');
      if (typeof el.className !== 'string') cls = '';
      const parts = [
        '  '.repeat(depth) + el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
        `[${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`,
      ];
      if (own) parts.push('"' + own.slice(0, 40) + '"');
      const extra = [];
      if (cs.padding !== '0px') extra.push('pad=' + cs.padding);
      if (cs.fontSize !== '13px') extra.push('fs=' + cs.fontSize);
      if (cs.fontWeight !== '400') extra.push('fw=' + cs.fontWeight);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') extra.push('bg=' + cs.backgroundColor);
      if (cs.color !== 'rgb(0, 0, 0)' && cs.color !== 'rgb(39, 41, 42)') extra.push('c=' + cs.color);
      if (cs.display === 'grid' || cs.display === 'flex') extra.push(cs.display);
      if (extra.length) parts.push('{' + extra.join(' ') + '}');
      lines.push(parts.join(' '));
      for (const c of el.children) {
        if (c.tagName === 'svg' || c.tagName === 'SVG') { lines.push('  '.repeat(depth + 1) + '<svg>'); continue; }
        walk(c, depth + 1);
      }
    };
    walk(root, 0);
    return lines.join('\n');
  }

  const out = {};
  for (const li of tabs()) {
    const name = (li.textContent || '').trim().split('\n')[0].trim();
    li.querySelector('a')?.click();
    await sleep(350);
    const panel = document.querySelector('.uk-format-panel')
      || document.querySelector('.uk-workbench-right .uk-overflow-auto');
    out[name] = panel ? dump(panel) : '(no panel)';
  }

  // tab strip detail incl. pseudo dividers
  const strip = tabs().map((li) => {
    const a = li.querySelector('a');
    const ar = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const before = getComputedStyle(li, '::before');
    return {
      text: (a.textContent || '').trim(),
      li: li.className,
      a: [Math.round(ar.x), Math.round(ar.y), Math.round(ar.width), Math.round(ar.height)],
      bg: cs.backgroundColor, color: cs.color, fw: cs.fontWeight, lh: cs.lineHeight,
      divider: before.display === 'none' ? 'none' : `${before.borderLeftWidth} ${before.borderLeftColor} top:${before.top} h:${before.height}`,
    };
  });

  const ul = document.querySelector('ul.uk-tab-capsule');
  const ur = ul.getBoundingClientRect();
  out.__strip = JSON.stringify({
    ul: [Math.round(ur.x), Math.round(ur.y), Math.round(ur.width), Math.round(ur.height)],
    display: getComputedStyle(ul).display,
    cols: getComputedStyle(ul).gridTemplateColumns,
    pad: getComputedStyle(ul).padding,
    tabs: strip,
  }, null, 1);

  return JSON.stringify(out);
})()
