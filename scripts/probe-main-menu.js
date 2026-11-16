// Click the hamburger main-menu button, then dump whatever appears.
(async () => {
  const btn = document.querySelector('button.main-menu-btn');
  if (!btn) return { error: 'no main-menu-btn' };
  btn.click();
  await new Promise((r) => setTimeout(r, 500));
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const all = [...document.querySelectorAll('body *')].filter((e) => {
    if (!vis(e)) return false;
    const c = String(e.className || '');
    return /menu|popover|uk-pop|dropdown|context/i.test(c);
  });
  const menus = all.slice(0, 25).map((e) => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      cls: String(e.className).slice(0, 120),
      r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      bg: cs.backgroundColor, radius: cs.borderRadius, shadow: cs.boxShadow.slice(0, 90),
      text: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 900),
      items: [...e.querySelectorAll('li')].slice(0, 60).map((li) => ({
        t: (li.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 70),
        cls: String(li.className).slice(0, 60),
        r: (() => { const x = li.getBoundingClientRect(); return [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)]; })(),
      })),
    };
  });
  return { menus, bodyTextTail: (document.body.innerText || '').slice(-1200) };
})()
