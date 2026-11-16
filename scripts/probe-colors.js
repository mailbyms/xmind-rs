(() => {
  const out = {};
  const cs = (el) => el ? getComputedStyle(el) : null;
  const hrs = [...document.querySelectorAll('hr')].slice(0, 6).map((el) => {
    const s = cs(el); const r = el.getBoundingClientRect();
    return { cls: String(el.className), y: Math.round(r.y), w: Math.round(r.width), bg: s.backgroundColor, h: s.height, border: s.borderTop };
  });
  out.hrs = hrs;
  const sb = document.querySelector('.workbench-status-bar');
  if (sb) {
    const s = cs(sb);
    out.statusBg = s.backgroundColor;
    const row = sb.querySelector('div[style*="height"]');
    out.rowH = row ? row.getBoundingClientRect().height : null;
  }
  const right = document.querySelector('.uk-panel.uk-position-right');
  out.rightBg = right ? cs(right).backgroundColor : null;
  const foot = document.querySelector('.uk-format-panel-section .uk-button-default');
  out.resetBtn = foot ? { bg: cs(foot).backgroundColor, c: cs(foot).color, bs: cs(foot).boxShadow, bd: cs(foot).border } : null;
  const tabs = [...document.querySelectorAll('.uk-tab-capsule > li > a')].filter((a) => a.getBoundingClientRect().width > 0)
    .map((a) => ({ t: a.textContent.trim(), bg: cs(a).backgroundColor, c: cs(a).color, fw: cs(a).fontWeight, r: a.getBoundingClientRect().toJSON() }));
  out.tabs = tabs;
  return out;
})()
