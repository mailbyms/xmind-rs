// Inspect editor-frame DOM: canvas, topics, any menu containers.
(() => {
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const info = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const sheet = document.querySelector('.sheet-viewer');
  const topics = [...document.querySelectorAll('[class*="topic"]')].filter(vis).slice(0, 12)
    .map((e) => ({ cls: String(e.className).slice(0, 100), r: info(e), text: (e.innerText || '').trim().slice(0, 40) }));
  const svgs = [...document.querySelectorAll('svg')].filter(vis).slice(0, 8).map((e) => ({ cls: String(e.getAttribute('class') || ''), r: info(e) }));
  const menuEls = [...document.querySelectorAll('[class*="menu"],[class*="uk-pop"]')].filter(vis).slice(0, 15)
    .map((e) => ({ cls: String(e.className).slice(0, 100), r: info(e), text: (e.innerText || '').slice(0, 200) }));
  return { url: location.href.slice(-150), bodyCls: String(document.body.className).slice(0, 200),
    sheet: sheet ? { cls: String(sheet.className), r: info(sheet) } : null, topics, svgs, menuEls,
    bodyTail: (document.body.innerText || '').slice(-300) };
})()
