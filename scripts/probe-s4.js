(function(){
  const r=(el)=>{const b=el.getBoundingClientRect();return [Math.round(b.y),Math.round(b.height)];};
  const secs=[...document.querySelectorAll('.fp-section')];
  const s4=secs[secs.length-1];
  return JSON.stringify({
    sec:r(s4),
    kids:[...s4.children].map(el=>[el.className.slice(0,16),...r(el)]),
    field:r(s4.querySelector('.fp-field')),
    note:r(s4.querySelector('.fp-note')),
    cs:(({paddingTop,paddingBottom})=>({paddingTop,paddingBottom}))(getComputedStyle(s4)),
  });
})()
