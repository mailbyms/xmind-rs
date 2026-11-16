(() => {
  let hosts = 0, shadowCount = 0, names = new Set();
  for (const el of document.querySelectorAll('*')) {
    if (el.shadowRoot) {
      hosts++;
      shadowCount += el.shadowRoot.querySelectorAll('*').length;
      names.add(el.tagName.toLowerCase());
    }
  }
  const sel = document.querySelector('textarea');
  return JSON.stringify({
    all: document.querySelectorAll('*').length,
    hosts, shadowCount, hostTags: [...names],
    textarea: sel ? sel.className : null,
    tabText: document.querySelector('.uk-tab-capsule')?.textContent?.trim().slice(0, 40),
  }, null, 1);
})()
