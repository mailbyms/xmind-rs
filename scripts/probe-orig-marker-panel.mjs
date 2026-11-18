import { writeFile, mkdir } from 'node:fs/promises';

const port = process.env.CDP_PORT || '9222';
const outDir = process.env.OUT_DIR || 'target/verify';

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((x) => /editor\.html/.test(x.url) && !/editor-frame/.test(x.url));
  if (!page) throw new Error('editor tab not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        reject(new Error(`timeout ${method}`));
      }
    }, 15000);
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  return { ws, send, ev };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await mkdir(outDir, { recursive: true });
  const { ws, send, ev } = await connect();
  await send('Runtime.enable');
  await send('Page.enable');

  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const topic = await ev(`(() => {
    const els = [...document.querySelectorAll('text, div, span')]
      .filter((e) => (e.textContent || '').trim() === '思维导图')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { tag: e.tagName, cls: typeof e.className === 'string' ? e.className : '', x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
      })
      .filter((e) => e.w > 0 && e.h > 0 && e.w < 300)
      .sort((a, b) => a.w - b.w);
    return els[0] || null;
  })()`);
  console.log('TOPIC', JSON.stringify(topic));
  if (!topic) throw new Error('topic not found');
  await clickAt(topic.x, topic.y);
  await wait(900);

  const state = await ev(`(() => {
    const item = document.querySelector('[data-id="marker"]');
    const btn = item?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return {
      disabled: btn.disabled,
      title: btn.title,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      cls: btn.className,
      html: btn.outerHTML.slice(0, 600),
    };
  })()`);
  console.log('MARKER_BUTTON', JSON.stringify(state, null, 2));
  if (!state || state.disabled) throw new Error('marker button disabled after topic select');
  await clickAt(state.x, state.y);
  await wait(1500);

  const visible = await ev(`(() => {
    const all = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      const c = typeof e.className === 'string' ? e.className : '';
      return r.width > 0 && r.height > 0 && /marker|popover|sidebar|right-panel|panel/i.test(c);
    });
    return all.slice(-60).map((e) => ({
      tag: e.tagName,
      cls: typeof e.className === 'string' ? e.className : '',
      text: (e.innerText || '').trim().slice(0, 200),
      html: e.outerHTML.slice(0, 1200),
    }));
  })()`);
  console.log('VISIBLE', JSON.stringify(visible, null, 2));

  const summary = await ev(`(() => {
    const imgs = [...document.querySelectorAll('img')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((e) => ({ src: e.src, w: e.naturalWidth, h: e.naturalHeight, rw: e.getBoundingClientRect().width, rh: e.getBoundingClientRect().height, title: e.title }));
    const svgs = [...document.querySelectorAll('svg')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.width < 200 && r.height < 200; })
      .map((e) => ({ cls: e.getAttribute('class'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, html: e.outerHTML.slice(0, 300) }));
    return { imgs: imgs.slice(0, 120), svgs: svgs.slice(0, 120) };
  })()`);
  console.log('SUMMARY', JSON.stringify(summary, null, 2));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${outDir}/orig-marker-panel-open.png`, Buffer.from(shot.data, 'base64'));
  console.log('SHOT', `${outDir}/orig-marker-panel-open.png`);
  ws.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
