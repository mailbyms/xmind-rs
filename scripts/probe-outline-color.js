(() => {
  const rows = [...document.querySelectorAll('.outliner-topic-container')].slice(0, 4);
  const out = rows.map((row) => {
    const t = row.querySelector('.outliner-topic-title');
    const cs = getComputedStyle(t);
    return { text: t.textContent.trim().slice(0, 8), color: cs.color, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, pad: cs.padding };
  });
  const att = document.querySelector('.outliner-attached-topics');
  const acs = att ? getComputedStyle(att) : null;
  const rowCs = getComputedStyle(rows[0]);
  const inner = rows[0].querySelector('.outliner-topic-inner');
  return JSON.stringify({
    rows: out,
    attached: acs ? { pad: acs.padding, mar: acs.margin, bl: acs.borderLeft, bg: acs.backgroundImage.slice(0, 80) } : null,
    rowShadow: rowCs.boxShadow, rowRadius: rowCs.borderRadius,
    innerPad: inner ? getComputedStyle(inner).padding : null,
    badge: (() => {
      const b = document.querySelector('.outliner-topic-container .uk-badge, .outliner-topic-container [class*="count"]');
      if (!b) return null;
      const c = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return { cls: b.className.slice(0, 40), t: b.textContent.trim(), w: r.width, h: r.height, fs: c.fontSize, bg: c.backgroundColor, color: c.color, br: c.borderRadius, pad: c.padding };
    })(),
  }, null, 1);
})()
