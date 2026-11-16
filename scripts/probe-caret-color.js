(() => {
  const btn = document.querySelector('.uk-format-panel-section-collapse button');
  const cs = getComputedStyle(btn);
  return JSON.stringify({
    v: cs.getPropertyValue('--uk-button-popover-toggle-color'),
    afterOpacity: getComputedStyle(btn, '::after').opacity,
  });
})()
