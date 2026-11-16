(function(){
  document.getElementById('try2')?.remove();
  document.getElementById('try3')?.remove();
  const s=document.createElement('style'); s.id='try3';
  s.textContent = '.fp-row.space{min-height:0!important}.fp-row.space + .fp-field{margin-top:16px!important}';
  document.head.appendChild(s);
  const r=(el)=>{const b=el.getBoundingClientRect();return [Math.round(b.y),Math.round(b.height)];};
  return JSON.stringify({
    sections:[...document.querySelectorAll('.fp-section')].map(r),
    segs:[...document.querySelectorAll('.fp-seg')].map(r),
  });
})()
