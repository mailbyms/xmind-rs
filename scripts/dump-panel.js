(() => {
  const panel = document.querySelector('.uk-workbench-right');
  const html = panel.outerHTML;
  // Strip inline svg bodies to keep it readable.
  const clean = html.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/<!--[\s\S]*?-->/g, '');
  return { len: html.length, html: clean.slice(0, 14000) };
})()
