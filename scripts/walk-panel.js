(() => {
  const root = document.querySelector('.uk-panel.uk-position-left');
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    const node = {
      d: depth,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).split(' ').filter((c) => c && !/^(uk-)?(flex|height|position|overflow|scrollbar|width|margin|padding|text|border|background|preserve)/.test(c)).slice(0, 4).join(' '),
      r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      t: own.slice(0, 40),
      fs: cs.fontSize, fw: cs.fontWeight, c: cs.color, bg: cs.backgroundColor,
      p: cs.padding, br: cs.borderRadius, bd: cs.borderTopWidth + ' ' + cs.borderBottomWidth,
    };
    if (depth < 14) {
      const kids = [...el.children].map((c) => walk(c, depth + 1));
      if (kids.length) node.k = kids;
    }
    return node;
  };
  const tree = walk(root, 0);
  const out = [];
  const press = (n) => {
    out.push(`${' '.repeat(n.d * 2)}${n.tag}${n.cls ? '.' + n.cls.replace(/ /g, '.') : ''}  [${n.r.join(',')}] ${n.t ? '«' + n.t + '»' : ''}  ${n.fs}/${n.fw} ${n.c} bg=${n.bg} pad=${n.p} br=${n.br}`);
    for (const k of n.k ?? []) press(k);
  };
  press(tree);
  return out.join('\n');
})()
