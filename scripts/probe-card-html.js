(() => {
  const card = document.querySelector('.uk-format-panel form .uk-card');
  const bone = [...document.querySelectorAll('.uk-format-panel button')].find((b) => (b.textContent || '').includes('思维导图'));
  const clean = (s) => (s || '').replace(/\s+/g, ' ');
  return JSON.stringify({
    cardTag: card ? card.tagName : null,
    cardCls: card ? card.getAttribute('class') : null,
    cardHTML: card ? clean(card.outerHTML).slice(0, 2600) : null,
    boneHTML: bone ? clean(bone.outerHTML).slice(0, 2600) : null,
  }, null, 1);
})()
