// What exactly are the six cards under 配色方案 in the shipped XMind?
// Capture their inline SVG colours for two different drop-down selections,
// and see what clicking a card changes.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/palette');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((r) => {
    const mid = ++id; pending.set(mid, r);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result?.value;
  };
  return { ws, ready, send, ev };
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
const c = connect(page.webSocketDebuggerUrl);
await c.ready;
await c.ev(`(() => { const a=[...document.querySelectorAll('.uk-tab a, .uk-tab button')].find(x=>(x.innerText||'').trim()==='画布'); if(a)a.click(); })()`);
await wait(350);

const CARDS = `(() => {
  const btn = document.querySelector('button[title="选择配色方案。"]');
  const sub = btn?.closest('.uk-format-panel-sub-section');
  if (!sub) return { error: 'no section' };
  const cards = [...sub.querySelectorAll('.uk-card.uk-card-selectable')];
  const colours = (svg) => {
    const all = [...svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,8}|rgb\\([^)]*\\))"/g)].map(m => m[1]);
    return [...new Set(all)];
  };
  return {
    trigger: (btn.innerText || '').trim(),
    cards: cards.map((card, i) => {
      const img = card.querySelector('img');
      let svg = '';
      try { svg = decodeURIComponent((img?.src || '').replace(/^data:image\\/svg\\+xml,/, '')); } catch {}
      const r = card.getBoundingClientRect();
      return {
        i, active: card.classList.contains('uk-active'),
        title: card.getAttribute('title') || card.parentElement?.getAttribute('title') || '',
        w: Math.round(r.width), h: Math.round(r.height),
        svgLen: svg.length,
        colours: colours(svg).slice(0, 26),
        allColours: colours(svg).length,
        wrapper: card.parentElement?.outerHTML.replace(/\\s+/g, ' ').slice(0, 220),
      };
    }),
  };
})()`;

async function pickScheme(name) {
  await c.ev(`(() => { const b=document.querySelector('button[title="选择配色方案。"]'); if(b && b.getAttribute('aria-expanded')!=='true') b.click(); })()`);
  await wait(450);
  return c.ev(`(() => {
    const pop=[...document.querySelectorAll('.uk-pop.uk-open')].find(p=>p.querySelector('.smart-color-theme-group'));
    if(!pop) return 'no popover';
    const find = () => [...pop.querySelectorAll('.smart-color-theme-group')].find(g => (g.querySelector('.theme-name-label')?.innerText||'').trim() === ${JSON.stringify(name)});
    let g = find();
    if (!g) {
      const tabs=[...pop.querySelectorAll('.uk-tab li, .uk-tab a')];
      const other=tabs.find(e=>(e.innerText||'').trim()!=='缤纷' && (e.innerText||'').trim()!=='');
      if (other) other.click();
    }
    return 'tab-switched';
  })()`).then(async () => {
    await wait(450);
    return c.ev(`(() => {
      const pop=[...document.querySelectorAll('.uk-pop.uk-open')].find(p=>p.querySelector('.smart-color-theme-group'));
      if(!pop) return 'no popover';
      const g=[...pop.querySelectorAll('.smart-color-theme-group')].find(g => (g.querySelector('.theme-name-label')?.innerText||'').trim() === ${JSON.stringify(name)});
      if(!g) return 'no group';
      g.querySelector('.smart-color-theme-group-cell')?.click();
      return 'clicked';
    })()`);
  });
}

const states = {};
for (const name of ['彩虹', '活力', '永恒']) {
  const r = await pickScheme(name);
  await wait(700);
  states[name] = { pick: r, ...(await c.ev(CARDS)) };
  console.log(name, r, 'trigger:', states[name].trigger, 'cards:', states[name].cards?.length);
}

// Click card #2 in the last state and see what changes.
const click2 = await c.ev(`(() => {
  const sub = document.querySelector('button[title="选择配色方案。"]')?.closest('.uk-format-panel-sub-section');
  const cards = [...(sub?.querySelectorAll('.uk-card.uk-card-selectable')||[])];
  if (cards.length < 3) return 'few cards';
  cards[2].click();
  return 'clicked card 2';
})()`);
await wait(700);
const afterCardClick = await c.ev(CARDS);

const out = { states, click2, afterCardClick };
writeFileSync(resolve(OUT, 'orig-palette-cards.json'), JSON.stringify(out, null, 1));
for (const [name, s] of Object.entries(states)) {
  console.log('===', name, '===');
  for (const card of s.cards || []) console.log(' ', card.i, card.active ? 'ACTIVE' : '', card.title, JSON.stringify(card.colours?.slice(0, 12)));
}
console.log('after card2:', click2, afterCardClick.trigger, afterCardClick.cards?.map(x => x.active));
c.ws.close();
