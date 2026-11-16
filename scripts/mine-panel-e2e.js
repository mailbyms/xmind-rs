(async () => {
  // End-to-end check of every right-panel control: open the popover through the
  // real control, pick an item, then read what the canvas actually drew.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const closeAll = async () => {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(80);
  };
  const ctl = (title) => {
    const all = [...document.querySelectorAll('.fp [title]')];
    return all.find((e) => e.getAttribute('title') === title)
      || all.find((e) => (e.getAttribute('title') || '').startsWith(title));
  };
  const wells = () => [...document.querySelectorAll('.fp .fp-well')];
  const popItem = (sel, predicate) => {
    const items = [...document.querySelectorAll('.pop ' + sel)];
    return predicate ? items.find(predicate) : items[0];
  };
  const node = () => document.querySelector('.node.selected');
  const shape = () => {
    const p = node()?.querySelector('.node-shape > path');
    return p ? {
      d: (p.getAttribute('d') || '').replace(/\s+/g, ' ').slice(0, 44),
      fill: p.getAttribute('fill'),
      stroke: p.getAttribute('stroke'),
      dash: p.getAttribute('stroke-dasharray'),
      width: p.getAttribute('stroke-width'),
    } : null;
  };
  const text = () => {
    const t = node()?.querySelector('.node-title');
    const cs = t ? getComputedStyle(t) : null;
    return cs
      ? `${cs.color} w${cs.fontWeight} ${cs.fontStyle} ${cs.textDecorationLine} ${cs.textTransform} ${cs.textAlign} ${cs.fontSize}`
      : null;
  };
  // All edges, folded into a short fingerprint: a per-topic patch shows up as a
  // different signature even when it only touches one connector.
  const edge = () => {
    const ps = [...document.querySelectorAll('.edges > path')];
    if (!ps.length) return null;
    const sig = ps.map((p) => [
      (p.getAttribute('d') || '').length,
      p.getAttribute('stroke-width') || '-',
      p.getAttribute('stroke-dasharray') || '-',
      p.getAttribute('marker-end') ? 'M' : '-',
      p.getAttribute('fill') || '-',
    ].join('/')).join(' ');
    return { n: ps.length, sig };
  };

  const out = [];
  /** `opener` is an element or a tooltip; `pick` returns the item to click. */
  const step = async (label, opener, pick, report) => {
    await closeAll();
    const el = typeof opener === 'string' ? ctl(opener) : opener;
    if (!el) { out.push(`✗ ${label}: 找不到控件「${opener}」`); return; }
    el.click();
    await sleep(200);
    if (!document.querySelector('.pop')) { out.push(`✗ ${label}: 未弹出`); return; }
    const target = pick();
    if (!target) { out.push(`✗ ${label}: 弹层内没有目标项`); return; }
    target.click();
    await sleep(520);
    const leftover = document.querySelector('.pop') ? ' | 弹层未关闭' : '';
    out.push(`✓ ${label}: ${report()}${leftover}`);
  };

  let nodes = [...document.querySelectorAll('.node')];
  if (!nodes.length) return '画布没有主题';
  if (nodes.length === 1) {
    const rootId = nodes[0].dataset.id;
    await window.__TAURI_INTERNALS__.invoke('doc_add_child', { id: rootId, title: null });
    await sleep(500);
    nodes = [...document.querySelectorAll('.node')];
  }
  nodes[nodes.length - 1].click();
  await sleep(350);
  out.push('选中: ' + (node()?.dataset.id || '无'));
  out.push('初始: ' + JSON.stringify(shape()));

  await step('形状→椭圆', '设置主题形状。',
    () => popItem('.pop-tile', (b) => b.title === '椭圆'), () => JSON.stringify(shape()));
  await step('填充→手绘斜线', '选择填充样式。',
    () => popItem('.pop-tile', (b) => b.title === '手绘斜线'), () => JSON.stringify(shape()));
  await step('填充色→第2行第2色', wells()[0],
    () => document.querySelectorAll('.pop .pc-swatch')[10], () => JSON.stringify(shape()));
  await step('边框→虚线', '选择边框样式。',
    () => popItem('.pop-tile', (b) => b.title === '虚线'), () => JSON.stringify(shape()));
  await step('边框粗细→粗', '设置边框粗细。',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '粗'), () => JSON.stringify(shape()));
  await step('边框色→深红', wells()[1],
    () => document.querySelectorAll('.pop .pc-swatch')[36], () => JSON.stringify(shape()));
  await step('文字色→深蓝', wells()[2],
    () => document.querySelectorAll('.pop .pc-swatch')[15], () => text());
  await step('字体→微软雅黑', '设置字体属性。',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '微软雅黑'),
    () => getComputedStyle(node().querySelector('.node-title')).fontFamily);
  await step('字号→24', '设置字体大小。',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '24'), () => text());
  await step('字重→Bold Italic', '选择字体样式。',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === 'Bold Italic'), () => text());
  await step('大小写→全大写', '设置文字大小写。',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '全大写'), () => text());

  for (const [label, title] of [['加粗', '给文本加粗。'], ['斜体', '给文本加斜体。'],
    ['删除线', '给文本加删除线。'], ['左对齐', '文字左对齐。'], ['居中', '文本居中。']]) {
    await closeAll();
    const el = ctl(title);
    if (!el) { out.push(`✗ ${label}: 找不到控件`); continue; }
    el.click();
    await sleep(340);
    out.push(`✓ ${label}: ${text()}`);
  }

  for (const [label, opener, pick] of [
    ['分支线→直线', '选择分支线形状。',
      () => popItem('.pop-tile', (b) => b.title === '直线')],
    ['线型→折线', '选择分支线样式。',
      () => [...document.querySelectorAll('.pop-menu button')].find((b) => b.title === '折线')],
    ['端点→三角形', '选择端点样式。',
      () => popItem('.pop-tile', (b) => b.title === '三角形')],
    ['线宽→粗', '设置线条粗细。',
      () => popItem('.pop-menu button', (b) => b.textContent.trim() === '粗')],
    ['线宽→极粗·渐细', '设置线条粗细。',
      () => popItem('.pop-menu button', (b) => b.textContent.trim() === '极粗 - 线条渐细')],
  ]) {
    await step(label, opener, pick, () => JSON.stringify(edge()));
  }

  // ---- canvas tab ----
  await closeAll();
  const canvasTab = [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布');
  canvasTab.click();
  await sleep(400);
  const bgBefore = getComputedStyle(document.querySelector('.canvas')).backgroundColor;
  await step('画布背景→米色', wells()[0],
    () => document.querySelectorAll('.pop .pc-swatch')[9],
    () => 'canvas bg ' + bgBefore + ' → ' + getComputedStyle(document.querySelector('.canvas')).backgroundColor);
  await step('全局字体→楷体', '全局字体',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '楷体'),
    () => getComputedStyle(node()?.querySelector('.node-title') || document.body).fontFamily);
  await step('分支线粗细→中等', '分支线粗细',
    () => popItem('.pop-menu button', (b) => b.textContent.trim() === '中等'),
    () => JSON.stringify(edge()));
  const rainbow = [...document.querySelectorAll('.fp .fp-check')][0];
  if (rainbow) {
    const before = rainbow.checked;
    rainbow.click();
    await sleep(450);
    out.push(`✓ 彩虹分支: ${before} → ${rainbow.checked}, edge=${JSON.stringify(edge())}`);
    rainbow.click();
    await sleep(300);
  }

  await closeAll();
  const styleTab = [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '样式');
  styleTab.click();
  await sleep(350);
  const struct = ctl('设置结构布局。');
  if (struct) {
    struct.click();
    await sleep(220);
    const target = popItem('.pop-menu button', (b) => b.textContent.trim() === '顺时针');
    if (target) {
      target.click();
      await sleep(700);
      out.push('✓ 结构→顺时针: 下拉显示「' + (ctl('设置结构布局。')?.textContent || '') + '」');
    } else out.push('✗ 结构: 菜单里没有 顺时针');
  } else out.push('✗ 结构: 找不到下拉');

  return out.join('\n');
})()
