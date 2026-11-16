(async () => {
  const r = await window.__shot?.();
  return r ?? 'no shot helper';
})()
