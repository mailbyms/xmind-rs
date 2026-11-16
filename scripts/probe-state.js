(() => JSON.stringify({
  href: location.href.slice(0, 80),
  ready: document.readyState,
  svgs: document.querySelectorAll('svg').length,
  g: document.querySelectorAll('svg .topic, svg g[class]').length,
  bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
  bodyRect: [document.body.scrollWidth, document.body.scrollHeight],
  sheetKids: document.querySelector('.sheet-viewer') ? [...document.querySelector('.sheet-viewer').children].map((c) => c.tagName + '.' + String(c.className).slice(0, 30)) : null,
}, null, 1))()
