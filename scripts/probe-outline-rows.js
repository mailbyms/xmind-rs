(() => {
  const rows = [...document.querySelectorAll('.outliner-topic-container')].map((row) => {
    const t = row.querySelector('.outliner-topic-title');
    if (!t) return null;
    const r = row.getBoundingClientRect();
    const inner = row.querySelector('.outliner-topic');
    const dot = row.querySelector('.outliner-topic-dot');
    const cs = getComputedStyle(t);
    return {
      cls: String(row.className).slice(0, 46),
      text: (t.textContent || '').trim().slice(0, 12),
      rowX: Math.round(r.x), rowW: Math.round(r.width), rowY: Math.round(r.y), rowH: Math.round(r.height),
      padL: inner ? getComputedStyle(inner).paddingLeft : null,
      marL: getComputedStyle(row).marginLeft, marB: getComputedStyle(row).marginBottom,
      x: Math.round(t.getBoundingClientRect().x),
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, color: cs.color,
      padT: cs.padding,
      dot: dot ? { x: Math.round(dot.getBoundingClientRect().x), w: Math.round(dot.getBoundingClientRect().width) } : null,
    };
  }).filter(Boolean);
  return JSON.stringify(rows, null, 1);
})()
