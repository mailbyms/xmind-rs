(function(){
  document.getElementById('try')?.remove();
  const s=document.createElement('style'); s.id='try';
  s.textContent=`
    .fp-field > .fp-label-sm { line-height: 18px; margin-bottom: 0; }
    .fp-bone-grid { padding-top: 12px; }
    .fp-check-line { padding-bottom: 12px; display: flex; align-items: center; }
    .fp-check-line .fp-check-row { height: 14px; }
    .fp-check-line.last { padding-bottom: 0; }
    .fp-field { padding-bottom: 13px; }
    .fp-note { margin-top: 6px; }
    .fp-inline { min-height: 23px; }
    .fp-check-label { line-height: 13px; }
  `;
  document.head.appendChild(s);
  const r=(el)=>{const b=el.getBoundingClientRect();return [Math.round(b.y),Math.round(b.height)];};
  return JSON.stringify({
    sections:[...document.querySelectorAll('.fp-section')].map(r),
    cards:[...document.querySelectorAll('.fp-bone-card')].slice(0,2).map(r),
    field1:r(document.querySelectorAll('.fp-field')[0]),
    field2:r(document.querySelectorAll('.fp-field')[1]),
  });
})()
