(() => {
  const out = { req: typeof require };
  try { const e = require('electron'); out.electronKeys = Object.keys(e).slice(0, 40); } catch (err) { out.err = String(err); }
  try { const m = require('electron').remote?.Menu; out.remoteMenu = !!m; if (m) { const app = m.getApplicationMenu(); out.appMenus = app ? app.items.map((i) => ({ label: i.label, id: i.id, role: i.role, sub: i.submenu ? i.submenu.items.length : 0 })) : null; } } catch (err) { out.remoteErr = String(err); }
  try { out.remote2 = !!require('@electron/remote'); } catch (err) { out.remote2Err = String(err); }
  try { out.chunk = typeof webpackChunkxmind_vana; } catch (err) { out.chunkErr = String(err); }
  return out;
})()
