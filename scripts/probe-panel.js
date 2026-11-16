(() => {
  const panel = document.querySelector('.uk-workbench-right') || document.querySelector('[class*="format-panel"]')?.closest('[class*="right"]');
  if (!panel) return { error: 'panel not found', cands: [...document.querySelectorAll('[class*="right"]')].map((e) => String(e.className).slice(0, 60)) };
  const pr = panel.getBoundingClientRect();
  const pcs = getComputedStyle(panel);

  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && !el.textContent.trim()) return null;
    const cs = getComputedStyle(el);
    const node = {
      d: depth,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 100),
      r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      t: (el.textContent || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 60),
      s: {
        fs: cs.fontSize, fw: cs.fontWeight, c: cs.color, bg: cs.backgroundColor,
        bd: cs.border, br: cs.borderRadius, p: cs.padding, m: cs.margin,
      },
    };
    if (depth < 12) {
      const kids = [...el.children].map((c) => walk(c, depth + 1)).filter(Boolean);
      if (kids.length) node.k = kids;
    }
    return node;
  };

  const text = (n, out = [], max = 500) => {
    if (!n || out.length > max) return out;
    out.push(`${'  '.repeat(n.d)}${n.tag}.${n.cls.split(' ')[0] || ''} [${n.r.join(',')}] ${n.t ? '"' + n.t + '"' : ''} {fs:${n.s.fs} fw:${n.s.fw} c:${n.s.c} bg:${n.s.bg} p:${n.s.p} br:${n.s.br}}`);
    for (const k of n.k ?? []) text(k, out, max);
    return out;
  };

  const tree = walk(panel, 0);
  return {
    panel: { r: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)], bg: pcs.backgroundColor, bl: pcs.borderLeft, ov: pcs.overflowY },
    lines: text(tree),
  };
})()
