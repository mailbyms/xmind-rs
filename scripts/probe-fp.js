(() => {
  const fp = document.querySelector('.uk-format-panel');
  if (!fp) return { error: 'no .uk-format-panel' };
  // Walk up to the outermost panel container (the sliding one).
  let host = fp;
  const chain = [];
  while (host.parentElement && chain.length < 5) {
    const cs = getComputedStyle(host);
    const r = host.getBoundingClientRect();
    chain.push({
      cls: String(host.className).slice(0, 90),
      r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor, bl: cs.borderLeft, pos: cs.position, of: cs.overflowY, p: cs.padding,
    });
    host = host.parentElement;
    if (host === document.body) break;
  }
  return { chain, text: fp.textContent.replace(/\s+/g, ' ').slice(0, 700) };
})()
