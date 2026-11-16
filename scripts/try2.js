(function(){
  document.getElementById('try')?.remove();
  document.getElementById('try2')?.remove();
  const s=document.createElement('style'); s.id='try2';
  s.textContent = '.fp-row.space{min-height:0!important}';
  document.head.appendChild(s);
  const r=(el)=>{const b=el.getBoundingClientRect();return [Math.round(b.y),Math.round(b.height)];};
  return JSON.stringify({
    sections:[...document.querySelectorAll('.fp-section')].map(x=>[x.getBoundingClientRect().y|0, x.getBoundingClientRect().height|0]),
    rows:[...document.querySelectorAll('.fp-row')].map(r),
    segs:[...document.querySelectorAll('.fp-seg')].map(r),
  });
})()
