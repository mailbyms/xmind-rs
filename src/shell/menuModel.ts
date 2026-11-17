/**
 * The shipped XMind 23.07 menu tree, transcribed from the running app's
 * Electron `Menu.getApplicationMenu()` and from the native context menus
 * captured with `scripts/probe-ctx-menu.mjs`. Labels, order, grouping and
 * shortcuts are the original Chinese strings; `disabled` reflects the same
 * context-dependence the original has (no topic selected, central topic,
 * nothing folded, unsupported export targets, ...).
 */
import { item, sep, type MenuItem } from './Menu';

export interface MenuContext {
  hasTopic: boolean;
  isRoot: boolean;
  hasChildren: boolean;
  folded: boolean;
  hasFolded: boolean;
  multi: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  /** A save is in flight: 保存 shows 「保存中...」 and is locked. */
  saving: boolean;
  hasPath: boolean;
  viewMode: 'map' | 'outline';
  zen: boolean;
  toolbarLabels: boolean;
  hasStyle: boolean;
  hasHref: boolean;
  hasImage: boolean;
  isFloating: boolean;
  recent: string[];
}

const D = (extra: Partial<MenuItem> = {}) => ({ disabled: true, ...extra });

/** 插入 submenu that both the main menu and a topic's context menu share. */
function insertElements(ctx: MenuContext): MenuItem[] {
  return [
    item('in.child', '子主题', { shortcut: 'Tab', action: 'insert.child', disabled: !ctx.hasTopic }),
    item('in.after', '主题（之后）', { shortcut: 'Enter', action: 'insert.siblingAfter', disabled: !ctx.hasTopic }),
    item('in.before', '主题（之前）', { shortcut: 'Shift+Enter', action: 'insert.siblingBefore', disabled: !ctx.hasTopic }),
    item('in.parent', '父主题', { shortcut: 'Ctrl+Enter', action: 'insert.parent', disabled: !ctx.hasTopic || ctx.isRoot }),
    item('in.floating', '自由主题', { action: 'insert.floating' }),
    item('in.callout', '标注', { action: 'insert.callout' }),
    sep('in.sep1'),
    item('in.relation', '联系', { shortcut: 'Ctrl+Shift+R', action: 'insert.relation', disabled: !ctx.hasTopic }),
    item('in.summary', '概要', { action: 'insert.summary', disabled: !ctx.hasTopic }),
    item('in.boundary', '外框', { shortcut: 'Ctrl+Shift+B', action: 'insert.boundary', disabled: !ctx.hasTopic }),
    sep('in.sep2'),
    item('in.note', '笔记', { shortcut: 'Ctrl+Shift+N', action: 'insert.note', disabled: !ctx.hasTopic }),
    item('in.label', '标签', { shortcut: 'Ctrl+Shift+L', action: 'insert.label', disabled: !ctx.hasTopic }),
    item('in.link', '链接', {
      submenu: [
        item('in.link.web', '网页', { shortcut: 'Ctrl+K', action: 'insert.linkWeb', disabled: !ctx.hasTopic }),
        item('in.link.topic', '主题', { action: 'insert.linkTopic', disabled: !ctx.hasTopic }),
        item('in.link.file', '本地文件', { action: 'insert.linkFile', disabled: !ctx.hasTopic }),
        item('in.link.folder', '本地文件夹', { action: 'insert.linkFolder', disabled: !ctx.hasTopic }),
      ],
    }),
    sep('in.sep3'),
    // In the original these are enabled whenever a topic is selected, even
    // though they need XMind's online/asset services. A local build explains
    // that instead of silently doing nothing.
    item('in.attachment', '附件', { action: 'insert.notice', payload: { label: '附件' }, disabled: !ctx.hasTopic }),
    item('in.audio', '语音备注', { action: 'insert.notice', payload: { label: '语音备注' }, disabled: !ctx.hasTopic }),
    sep('in.sep4'),
    item('in.marker', '标记', { action: 'insert.marker', disabled: !ctx.hasTopic }),
    item('in.sticker', '贴纸', { action: 'insert.notice', payload: { label: '贴纸' }, disabled: !ctx.hasTopic }),
    item('in.clipart', '插画', { action: 'insert.notice', payload: { label: '插画' }, disabled: !ctx.hasTopic }),
    item('in.image', '本地图片', { shortcut: 'Ctrl+Shift+I', action: 'insert.image', disabled: !ctx.hasTopic }),
    item('in.equation', '方程', { action: 'insert.notice', payload: { label: '方程' }, disabled: !ctx.hasTopic }),
    sep('in.sep5'),
    item('in.sheet', '新画布', { shortcut: 'Ctrl+Alt+N', action: 'insert.sheet' }),
    item('in.sheetFrom', '从主题新建画布', { action: 'insert.sheetFromTopic', disabled: !ctx.hasTopic }),
  ];
}

/**
 * Right-clicking a topic offers only the element-insertion rows. Captured from
 * the original: *every* row here is enabled (including 附件 / 贴纸 / 方程),
 * with two separators splitting the 链接, media and icon groups.
 */
function topicInsertElements(ctx: MenuContext): MenuItem[] {
  const on = ctx.hasTopic;
  const notice = (id: string, label: string) => item(id, label, {
    action: 'insert.notice', payload: { label }, disabled: !on,
  });
  return [
    item('ti.note', '笔记', { shortcut: 'Ctrl+Shift+N', action: 'insert.note', disabled: !on }),
    item('ti.label', '标签', { shortcut: 'Ctrl+Shift+L', action: 'insert.label', disabled: !on }),
    item('ti.link', '链接', {
      submenu: [
        item('ti.link.web', '网页', { shortcut: 'Ctrl+K', action: 'insert.linkWeb', disabled: !on }),
        item('ti.link.topic', '主题', { action: 'insert.linkTopic', disabled: !on }),
        item('ti.link.file', '本地文件', { action: 'insert.linkFile', disabled: !on }),
        item('ti.link.folder', '本地文件夹', { action: 'insert.linkFolder', disabled: !on }),
      ],
    }),
    sep('ti.sep1'),
    notice('ti.attachment', '附件'),
    notice('ti.audio', '语音备注'),
    sep('ti.sep2'),
    item('ti.marker', '标记', { action: 'insert.marker', disabled: !on }),
    notice('ti.sticker', '贴纸'),
    notice('ti.clipart', '插画'),
    item('ti.image', '本地图片', { shortcut: 'Ctrl+Shift+I', action: 'insert.image', disabled: !on }),
    notice('ti.equation', '方程'),
  ];
}

function freeAlignSubmenu(ctx: MenuContext): MenuItem[] {
  const usable = ctx.multi > 1 && ctx.isFloating;
  return [
    item('al.left', '居左', { action: 'align.left', disabled: !usable }),
    item('al.vcenter', '垂直居中', { action: 'align.vcenter', disabled: !usable }),
    item('al.right', '居右', { action: 'align.right', disabled: !usable }),
    sep('al.sep1'),
    item('al.top', '居上', { action: 'align.top', disabled: !usable }),
    item('al.hcenter', '水平居中', { action: 'align.hcenter', disabled: !usable }),
    item('al.bottom', '居下', { action: 'align.bottom', disabled: !usable }),
    sep('al.sep2'),
    item('al.hgap', '横向等距分布', { action: 'align.hgap', disabled: !usable }),
    item('al.vgap', '纵向等距分布', { action: 'align.vgap', disabled: !usable }),
  ];
}

function editSubmenu(ctx: MenuContext): MenuItem[] {
  return [
    item('ed.cut', '剪切', { shortcut: 'Ctrl+X', action: 'edit.cut', disabled: !ctx.hasTopic || ctx.isRoot }),
    item('ed.copy', '拷贝', { shortcut: 'Ctrl+C', action: 'edit.copy', disabled: !ctx.hasTopic }),
    item('ed.paste', '粘贴', { shortcut: 'Ctrl+V', action: 'edit.paste' }),
    item('ed.dup', '复制', { shortcut: 'Ctrl+D', action: 'edit.duplicate', disabled: !ctx.hasTopic || ctx.isRoot }),
    item('ed.del', '删除', { shortcut: 'Delete', action: 'edit.delete', disabled: !ctx.hasTopic || ctx.isRoot }),
    item('ed.del1', '删除单个主题', { shortcut: 'Ctrl+Backspace', action: 'edit.deleteSingle', disabled: !ctx.hasTopic || ctx.isRoot }),
    sep('ed.sep1'),
    item('ed.indent', '缩进', { action: 'edit.indent', disabled: !ctx.hasTopic || ctx.isRoot }),
    item('ed.outdent', '减少缩进', { action: 'edit.outdent', disabled: !ctx.hasTopic || ctx.isRoot }),
    sep('ed.sep2'),
    item('ed.copyStyle', '拷贝样式', { shortcut: 'Ctrl+Alt+C', action: 'edit.copyStyle', disabled: !ctx.hasTopic }),
    item('ed.pasteStyle', '粘贴样式', { shortcut: 'Ctrl+Alt+V', action: 'edit.pasteStyle' }),
    item('ed.resetStyle', '重设样式', { shortcut: 'Ctrl+Alt+0', action: 'edit.resetStyle', disabled: !ctx.hasStyle }),
    sep('ed.sep3'),
    item('ed.center', '前往中心主题', { shortcut: 'Ctrl+R', action: 'edit.goCenter' }),
    item('ed.all', '全选', { shortcut: 'Ctrl+A', action: 'edit.selectAll' }),
    sep('ed.sep4'),
    item('ed.fold', ctx.folded ? '展开子主题' : '折叠子主题', {
      shortcut: 'Ctrl+/', action: 'edit.fold', disabled: !ctx.hasTopic || !ctx.hasChildren,
    }),
    item('ed.foldAll', '折叠所有子分支', { shortcut: 'Ctrl+Alt+/', action: 'edit.foldAll' }),
    sep('ed.sep5'),
    item('ed.align', '自由主题对齐', { submenu: freeAlignSubmenu(ctx) }),
    sep('ed.sep6'),
    item('ed.find', '查找与替换', { shortcut: 'Ctrl+F', ...D() }),
  ];
}

function fileSubmenu(ctx: MenuContext): MenuItem[] {
  const recent: MenuItem[] = ctx.recent.map((path, index) => item(`fi.recent.${index}`, path.split(/[\\/]/).pop() || path, {
    action: 'recent.open', payload: { path },
  }));
  const notice = (id: string, label: string, extra: Partial<MenuItem> = {}) =>
    item(id, label, { action: 'file.notice', payload: { label }, ...extra });
  return [
    notice('fi.template', '从模板新建'),
    notice('fi.gallery', '从图库中新建'),
    item('fi.tab', '新建标签页', { shortcut: 'Ctrl+T', ...D() }),
    item('fi.recent', '最近打开', { submenu: [...recent, sep('fi.recent.sep'), item('fi.recent.clear', '清空目录', { action: 'recent.clear' })] }),
    sep('fi.sep1'),
    item('fi.cache', '文件缓存', { action: 'file.notice', payload: { label: '文件缓存' } }),
    item('fi.password', '设置密码', D()),
    sep('fi.sep2'),
    item('fi.import', '导入', {
      submenu: [
        item('fi.import.other', '其他思维导图格式', { action: 'import.open' }),
        item('fi.import.md', 'Markdown', { action: 'import.open' }),
        item('fi.import.opml', 'OPML', { action: 'import.open' }),
        notice('fi.import.tb', 'TextBundle'),
        notice('fi.import.word', 'Word（仅 DOCX）'),
      ],
    }),
    sep('fi.sep3'),
    item('fi.share', '分享', {
      submenu: [notice('fi.share.custom', '自定义', { shortcut: 'Ctrl+Shift+P' })],
    }),
    sep('fi.sep4'),
    item('fi.close', '关闭窗口', { shortcut: 'Ctrl+W', action: 'window.close' }),
    sep('fi.sep5'),
    item('fi.quit', '退出', { action: 'window.close' }),
  ];
}

function viewSubmenu(ctx: MenuContext): MenuItem[] {
  return [
    item('vw.map', '思维导图', { checked: ctx.viewMode === 'map', action: 'view.map' }),
    item('vw.outline', '大纲', { checked: ctx.viewMode === 'outline', action: 'view.outline' }),
    sep('vw.sep1'),
    item('vw.zoomIn', '放大', { shortcut: 'Ctrl++', action: 'view.zoomIn' }),
    item('vw.zoomOut', '缩小', { shortcut: 'Ctrl+-', action: 'view.zoomOut' }),
    item('vw.zoomReset', '实际大小', { shortcut: 'Ctrl+0', action: 'view.zoomReset' }),
    item('vw.fit', '适应画布', { action: 'view.fit' }),
    sep('vw.sep2'),
    item('vw.focus', '仅显示该分支', { shortcut: 'Ctrl+;', action: 'view.focusBranch', disabled: !ctx.hasTopic || ctx.isRoot }),
    sep('vw.sep3'),
    item('vw.zen', 'ZEN 模式', { shortcut: 'Ctrl+Alt+F', checked: ctx.zen, action: 'view.zen' }),
    item('vw.present', '演说模式', {
      submenu: [
        item('vw.present.play', '演示', { shortcut: 'Ctrl+Alt+P', action: 'view.present' }),
        item('vw.present.window', '在窗口中演示', D()),
        item('vw.present.view', '演说者视图', D()),
      ],
    }),
    sep('vw.sep4'),
    item('vw.nav', '导航面板', {
      submenu: [
        item('vw.nav.topic', '主题', D()),
        item('vw.nav.note', '笔记', D()),
        item('vw.nav.marker', '标记 && 标签', D()),
      ],
    }),
    sep('vw.sep5'),
    item('vw.panel', '格式面板', {
      submenu: [
        item('vw.panel.style', '样式', { shortcut: 'Ctrl+]', action: 'view.panel.style' }),
        item('vw.panel.canvas', '画布', { action: 'view.panel.canvas' }),
        item('vw.panel.skeleton', '骨架', { action: 'view.panel.skeleton' }),
        item('vw.panel.palette', '配色方案', { action: 'view.panel.palette' }),
      ],
    }),
    sep('vw.sep6'),
    item('vw.toolbar', '工具栏', {
      submenu: [
        item('vw.toolbar.icons', '仅显示图标', { checked: !ctx.toolbarLabels, action: 'view.toolbar.icons' }),
        item('vw.toolbar.labels', '图标和文字', { checked: ctx.toolbarLabels, action: 'view.toolbar.labels' }),
      ],
    }),
    sep('vw.sep7'),
    item('vw.tabs', '显示标签页栏', { shortcut: 'Ctrl+Shift+T', ...D() }),
    item('vw.hidebar', '隐藏画布栏', D()),
    sep('vw.sep8'),
    item('vw.merge', '合并所有窗口', { action: 'help.notice', payload: { label: '合并所有窗口' } }),
  ];
}

function helpSubmenu(): MenuItem[] {
  // This offline rebuild only ships two real help entries. Everything else in
  // the shipped Windows menu needs XMind online services (account, news,
  // updates, subscription) or a disabled 入门 tutorial, so it is omitted.
  return [
    item('hp.keys', '快捷键命令', { shortcut: 'Ctrl+Shift+/', action: 'help.shortcuts' }),
    item('hp.about', '关于 xmind-rs', { action: 'help.about' }),
  ];
}

/** Hamburger menu — the application menu of the shipped Windows build. */
export function buildMainMenu(ctx: MenuContext): MenuItem[] {
  return [
    item('m.undo', '撤销', { shortcut: 'Ctrl+Z', action: 'undo', disabled: !ctx.canUndo }),
    item('m.redo', '重做', { shortcut: 'Ctrl+Y', action: 'redo', disabled: !ctx.canRedo }),
    sep('m.sep1'),
    item('m.new', '新建', { shortcut: 'Ctrl+N', action: 'new' }),
    item('m.open', '打开', { shortcut: 'Ctrl+O', action: 'open' }),
    sep('m.sep2'),
    item('m.save', '保存', { shortcut: 'Ctrl+S', action: 'save', disabled: !ctx.dirty || ctx.saving }),
    item('m.saveAs', '另存为', { shortcut: 'Ctrl+Shift+S', action: 'saveAs' }),
    sep('m.sep3'),
    item('m.export', '导出', {
      submenu: [
        item('m.ex.pdf', 'PDF', { action: 'export.pdf' }),
        item('m.ex.png', 'PNG', { action: 'export.png' }),
        item('m.ex.md', 'Markdown', { action: 'export.md' }),
        item('m.ex.word', 'Word', D()),
        item('m.ex.excel', 'Excel', D()),
        item('m.ex.ppt', 'PowerPoint (演说)', D()),
        item('m.ex.opml', 'OPML', { action: 'export.opml' }),
        item('m.ex.tb', 'TextBundle', D()),
      ],
    }),
    item('m.print', '打印', { shortcut: 'Ctrl+P', ...D() }),
    sep('m.sep4'),
    item('m.pref', '首选项', { shortcut: 'Ctrl+Shift+P', action: 'file.notice', payload: { label: '首选项' } }),
    sep('m.sep5'),
    item('m.file', '文件', { submenu: fileSubmenu(ctx) }),
    item('m.edit', '编辑', { submenu: editSubmenu(ctx) }),
    item('m.insert', '插入', { submenu: insertElements(ctx) }),
    item('m.tools', '工具', {
      submenu: [
        item('m.tools.shot', 'Map Shot 截图', { shortcut: 'F7', ...D() }),
        item('m.tools.merge', '合并 Xmind 文件', D()),
        item('m.tools.style', '创建/自定义风格', D()),
      ],
    }),
    item('m.view', '查看', { submenu: viewSubmenu(ctx) }),
    item('m.help', '帮助', { submenu: helpSubmenu() }),
  ];
}

/** Right click on bare canvas. */
export function buildCanvasMenu(ctx: MenuContext): MenuItem[] {
  return [
    item('c.paste', '粘贴', { shortcut: 'Ctrl+V', action: 'edit.paste' }),
    sep('c.sep1'),
    item('c.floating', '插入自由主题', { action: 'insert.floating' }),
    item('c.relation', '插入联系', { shortcut: 'Ctrl+Shift+R', action: 'insert.relation' }),
    sep('c.sep2'),
    item('c.unfoldAll', '展开所有子分支', { shortcut: 'Ctrl+Alt+/', action: 'edit.unfoldAll', disabled: !ctx.hasFolded }),
    sep('c.sep3'),
    item('c.center', '前往中心主题', { shortcut: 'Ctrl+R', action: 'edit.goCenter' }),
    item('c.all', '全选', { shortcut: 'Ctrl+A', action: 'edit.selectAll' }),
  ];
}

/** Right click on a topic (central topic has a shorter variant). */
export function buildTopicMenu(ctx: MenuContext): MenuItem[] {
  const root = ctx.isRoot;
  const rows: MenuItem[] = [
    item('t.insert', '插入', { submenu: topicInsertElements(ctx) }),
    sep('t.sep1'),
    item('t.cut', '剪切', { shortcut: 'Ctrl+X', action: 'edit.cut', disabled: root }),
    item('t.copy', '拷贝', { shortcut: 'Ctrl+C', action: 'edit.copy' }),
    item('t.paste', '粘贴', { shortcut: 'Ctrl+V', action: 'edit.paste' }),
    item('t.dup', '复制', { shortcut: 'Ctrl+D', action: 'edit.duplicate', disabled: root }),
    sep('t.sep2'),
    item('t.del', '删除', { shortcut: 'Backspace', action: 'edit.delete', disabled: root }),
    item('t.del1', '删除单个主题', { shortcut: 'Ctrl+Backspace', action: 'edit.deleteSingle', disabled: root }),
    sep('t.sep3'),
    item('t.copyStyle', '拷贝样式', { shortcut: 'Ctrl+Alt+C', action: 'edit.copyStyle' }),
    item('t.pasteStyle', '粘贴样式', { shortcut: 'Ctrl+Alt+V', action: 'edit.pasteStyle' }),
    item('t.resetStyle', '重设样式', { shortcut: 'Ctrl+Alt+0', action: 'edit.resetStyle', disabled: !ctx.hasStyle }),
    sep('t.sep4'),
  ];
  // The central topic's menu has no 展开子主题 row at all; the branch menu
  // shows it (disabled when the branch has no children).
  if (!root) {
    rows.push(item('t.fold', ctx.folded ? '展开子主题' : '折叠子主题', {
      shortcut: 'Ctrl+/', action: 'edit.fold', disabled: !ctx.hasChildren,
    }));
  }
  rows.push(item('t.unfoldAll', '展开所有子分支', {
    shortcut: 'Ctrl+Alt+/', action: 'edit.unfoldAll', disabled: !ctx.hasFolded,
  }));
  if (!root) {
    rows.push(
      sep('t.sep5'),
      item('t.export', '导出分支为', {
        submenu: [
          item('t.ex.png', 'PNG...', { action: 'branch.export.png' }),
          item('t.ex.svg', 'SVG...', { action: 'branch.export.svg' }),
          item('t.ex.pdf', 'PDF...', { action: 'branch.export.pdf' }),
          item('t.ex.md', 'Markdown...', { action: 'branch.export.md' }),
        ],
      }),
      item('t.print', '打印分支...', { action: 'branch.print' }),
      sep('t.sep6'),
      item('t.focus', '仅显示该分支', { shortcut: 'Ctrl+;', action: 'view.focusBranch' }),
    );
  }
  if (!root) rows.push(sep('t.sep7'));
  rows.push(
    item('t.align', '自由主题对齐', { submenu: freeAlignSubmenu(ctx) }),
    item('t.newSheet', '从主题新建画布', { action: 'insert.sheetFromTopic' }),
  );
  if (!root) {
    rows.push(
      sep('t.sep8'),
      item('t.resetPos', '重设位置', { action: 'edit.resetPosition', disabled: !ctx.isFloating }),
    );
  }
  return rows;
}

/** Shortcut list shown by 帮助 > 快捷键命令. */
export const SHORTCUTS: [string, string][] = [
  ['新建 / 打开 / 保存', 'Ctrl+N / Ctrl+O / Ctrl+S'],
  ['另存为', 'Ctrl+Shift+S'],
  ['撤销 / 重做', 'Ctrl+Z / Ctrl+Y'],
  ['子主题 / 同级主题 / 主题（之前）', 'Tab / Enter / Shift+Enter'],
  ['父主题 / 自由主题', 'Ctrl+Enter / —'],
  ['复制 / 删除单个主题', 'Ctrl+D / Ctrl+Backspace'],
  ['联系 / 外框', 'Ctrl+Shift+R / Ctrl+Shift+B'],
  ['拷贝样式 / 粘贴样式 / 重设样式', 'Ctrl+Alt+C / Ctrl+Alt+V / Ctrl+Alt+0'],
  ['前往中心主题 / 全选', 'Ctrl+R / Ctrl+A'],
  ['折叠子主题 / 折叠所有子分支', 'Ctrl+/ / Ctrl+Alt+/'],
  ['缩进 / 减少缩进', '使用「编辑」菜单'],
  ['查找与替换', 'Ctrl+F'],
  ['大纲 / 思维导图', '状态栏按钮'],
  ['放大 / 缩小 / 实际大小', 'Ctrl++ / Ctrl+- / Ctrl+0'],
  ['仅显示该分支', 'Ctrl+;'],
  ['ZEN 模式 / 演说模式', 'Ctrl+Alt+F / Ctrl+Alt+P'],
  ['快捷键命令', 'Ctrl+Shift+/'],
  ['框选多个主题', '在画布空白处按住左键拖动'],
  ['增量选择', 'Ctrl / Shift + 点击主题'],
  ['就地编辑 / 取消编辑', '双击主题 / Esc'],
  ['删除选中装饰', 'Delete'],
];
