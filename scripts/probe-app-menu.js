// Access the original's webpack module cache to read the real Electron menus.
(() => {
  const out = { steps: [] };
  try {
    let req;
    webpackChunkxmind_vana.push([[999991], {}, (r) => { req = r; }]);
    out.steps.push('require=' + typeof req);
    const electronMod = req(67657);
    out.electronModKeys = Object.keys(electronMod).slice(0, 30);
    const Menu = electronMod.Menu;
    out.hasMenu = !!Menu;
    if (Menu) {
      const app = Menu.getApplicationMenu();
      out.hasAppMenu = !!app;
      if (app) {
        const walk = (items, depth) => items.map((i) => ({
          label: i.label, id: i.id, role: i.role, type: i.type, accelerator: i.accelerator,
          enabled: i.enabled, visible: i.visible, checked: i.checked, commandId: i.commandId,
          sub: i.submenu ? walk(i.submenu.items, depth + 1) : undefined,
        }));
        out.appMenu = walk(app.items, 0);
      }
    }
  } catch (err) { out.error = String(err) + '\n' + (err.stack || '').slice(0, 600); }
  return out;
})()
