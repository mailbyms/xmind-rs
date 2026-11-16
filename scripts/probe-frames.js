(() => {
  const frames = [...document.querySelectorAll('iframe,webview')].map((f) => {
    const r = f.getBoundingClientRect();
    return { tag: f.tagName.toLowerCase(), src: (f.src || '').slice(0, 120), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const probe = (doc, label) => {
    const roots = ['.uk-workbench', '.uk-workbench-right', '.uk-tab-capsule', '.uk-format-panel'];
    const found = roots.map((s) => [s, doc.querySelectorAll(s).length]);
    return { label, found };
  };
  return JSON.stringify({
    frames,
    self: probe(document, 'top'),
    bodyKids: [...document.body.children].map((c) => c.tagName + '.' + String(c.className).slice(0, 40)),
    framesCount: window.frames.length,
  }, null, 1);
})()
