// Dump the original's top bar controls + any currently visible menu-like DOM.
(() => {
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const bar = document.querySelector('.uk-workbench-top-bar');
  const btns = bar ? [...bar.querySelectorAll('button,[role="button"],a')].map((e) => ({
    tag: e.tagName, cls: String(e.className).slice(0, 90), title: e.getAttribute('title') || '',
    text: (e.innerText || '').trim().slice(0, 40),
    r: (() => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })(),
  })) : [];
  const menus = [...document.querySelectorAll('[class*="uk-menu"],[class*="context"],[class*="uk-pop"]')]
    .filter(vis).slice(0, 30).map((e) => ({ cls: String(e.className).slice(0, 110), text: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 300) }));
  return { url: location.href.slice(-90), barCls: bar ? String(bar.className) : null, btns, menus };
})()
