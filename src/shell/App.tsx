import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, type Action } from '../lib/api';
import { addMarkerExclusive, MARKERS } from '../lib/markers';
import type { MapCanvasHandle } from '../editor/MapCanvas';
import type { AppInfo, DecorSelection, Document, Snapshot, Structure, Topic, TopicStyle, LiveEditPhase } from '../lib/types';
import type { SkeletonPreset } from '../inspector/skeletons';
import Menu, { type MenuItem } from './Menu';
import MarkerChipPop from './MarkerChipPop';
import { InsertPop, MarkerPop, type IconTab } from './ToolbarPop';
import type { IconItem } from '../lib/icon-data';
import { buildMainMenu, buildCanvasMenu, buildTopicMenu, buildImageMenu, SHORTCUTS, type MenuContext } from './menuModel';
import { exportBranch, printBranch, type BranchFormat } from '../io/branchExport';

// All four heavy views are separate chunks, fetched only when opened.
const MapCanvas = lazy(() => import('../editor/MapCanvas'));
const OutlineView = lazy(() => import('../editor/OutlineView'));
const AiPanel = lazy(() => import('../ai/AiPanel'));
const Inspector = lazy(() => import('../inspector/Inspector'));
const TopicAttrs = lazy(() => import('../inspector/TopicAttrs'));
const ExportDialog = lazy(() => import('../io/ExportDialog'));

type Panel = 'none' | 'ai' | 'format' | 'attrs' | 'export';
type ToolbarPop = 'marker' | 'insert' | null;
type TopicEditor = { kind: 'note' | 'label'; id: string; draft: string };
type CanvasView = { scale: number; tx: number; ty: number };
/** Which in-box marker owns the open same-group popover. */
type MarkerChipTarget = { topicId: string; marker: string; x: number; y: number };

type IconName =
  | 'menu' | 'undo' | 'redo' | 'topic' | 'subtopic' | 'relation' | 'summary' | 'boundary'
  | 'marker' | 'insert' | 'format'
  | 'min' | 'max' | 'close';

/** 20x20 line icons matching the weight of XMind's own toolbar glyphs. */
function Icon({ name }: { name: IconName }) {
  const p = {
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  const svg = (children: React.ReactNode, size = 20) => (
    <svg viewBox="0 0 20 20" width={size} height={size} {...p}>{children}</svg>
  );
  switch (name) {
    case 'menu': return svg(<><path d="M3 5.5h18M3 12h18M3 18.5h18" /></>, 24);
    case 'undo': return svg(<><path d="M7.2 6.4H4.1V3.3" /><path d="M4.1 6.4A6.4 6.4 0 1 1 4.8 13" /></>);
    case 'redo': return svg(<><path d="M12.8 6.4h3.1V3.3" /><path d="M15.9 6.4A6.4 6.4 0 1 0 15.2 13" /></>);
    case 'topic': return svg(<><rect x="2.6" y="7" width="9" height="6" rx="1.8" /><path d="M11.6 10h5.8" /></>);
    case 'subtopic': return svg(<><path d="M2.6 5h5" /><rect x="5.4" y="9" width="8.4" height="6" rx="1.8" /><path d="M2.6 10.5v1.5h2.8" /></>);
    case 'relation': return svg(<><circle cx="5" cy="14.4" r="2.2" /><circle cx="15" cy="5.6" r="2.2" /><path d="M6.8 13.1c2.4-1.4 3.2-4.6 6.2-6.2" strokeDasharray="2 2" /></>);
    case 'summary': return svg(<><path d="M7 4.5h2.6c1.2 0 2 .8 2 2v7c0 1.2-.8 2-2 2H7" /><path d="M13.4 8h3.2M13.4 12h3.2" /></>);
    case 'boundary': return svg(<rect x="2.8" y="4.8" width="14.4" height="10.4" rx="2.4" strokeDasharray="2.4 2.2" />);
    case 'marker': return svg(<><path d="M6 16.5V4.2c2.2-1.3 4.2 1.3 6.4 0v6.2c-2.2 1.3-4.2-1.3-6.4 0" /></>);
    case 'insert': return svg(<><rect x="3.4" y="3.4" width="13.2" height="13.2" rx="2" strokeDasharray="2.2 2" /><path d="M10 7v6M7 10h6" /></>);
    case 'format': return svg(<><rect x="2.8" y="3.4" width="6" height="6" rx="1.4" /><path d="M12 3.4h5.2M12 6.4h5.2M2.8 12.4h6M2.8 15.4h6" /><rect x="12" y="10.6" width="5.2" height="6" rx="1.4" /><path d="M3.6 9.4v5.6" strokeWidth="1.2" /></>);
    case 'min': return svg(<path d="M4 10h12" />, 16);
    case 'max': return svg(<rect x="4" y="4" width="12" height="12" rx="1.4" />, 16);
    case 'close': return svg(<path d="M5 5l10 10M15 5L5 15" />, 16);
  }
}

function collectIds(document: Document): string[] {
  const result: string[] = [];
  const walk = (topic: Topic) => {
    result.push(topic.id);
    for (const list of [topic.children, topic.detached, topic.summary, topic.callout]) {
      for (const child of list ?? []) walk(child);
    }
  };
  for (const sheet of document.sheets) walk(sheet.root);
  return result;
}

/** XMind's zoom ladder, in the order it appears in the status bar menu. */
const ZOOM_STEPS = [500, 400, 300, 200, 150, 120, 100, 80, 50, 20, 10];

function findTopicById(document: Document, id: string | null): Topic | null {
  if (!id) return null;
  const walk = (topic: Topic): Topic | null => {
    if (topic.id === id) return topic;
    for (const list of [topic.children, topic.detached, topic.summary, topic.callout]) {
      for (const child of list ?? []) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  for (const sheet of document.sheets) {
    const found = walk(sheet.root);
    if (found) return found;
  }
  return null;
}

/** "字数" counts the characters of every topic title, spaces left out. */
function countCharacters(document: Document): number {
  let total = 0;
  const walk = (topic: Topic) => {
    total += topic.title.replace(/\s+/g, '').length;
    for (const list of [topic.children, topic.detached, topic.summary, topic.callout]) {
      for (const child of list ?? []) walk(child);
    }
  };
  for (const sheet of document.sheets) walk(sheet.root);
  return total;
}

const loading = <div className="loading">正在加载模块…</div>;

/** Label used by the title bar and the native window: XMind shows the bare
 *  file name, and "未命名" for a fresh canvas that has never been saved. */
function docLabel(path: string | null | undefined): string {
  return path ? path.split(/[\\/]/).pop() || '未命名' : '未命名';
}

export default function App() {
  const win = getCurrentWindow();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Box-selection / Ctrl+click. `selected` stays the last clicked topic. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** First end of a 联系 being created; the next topic click completes it. */
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  /** Same two-click gesture, but the result is a topic hyperlink. */
  const [hrefFrom, setHrefFrom] = useState<string | null>(null);
  /** Selected relationship / boundary / summary (mutually exclusive with a topic). */
  const [selectedDecor, setSelectedDecor] = useState<DecorSelection | null>(null);
  /** In-app rename box for a 联系 / 外框 (WebView2 has no reliable prompt()). */
  const [renameTarget, setRenameTarget] = useState<
    { kind: string; id: string; current: string; label: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [panel, setPanel] = useState<Panel>('format');
  /** 工具栏「标记 / 插入」的下拉弹层；两者互斥，点击外部或 Esc 关闭。 */
  const [toolbarPop, setToolbarPop] = useState<ToolbarPop>(null);
  /** 同一个图标面板的三个页签；插入 > 贴纸/插画会 direct-open 对应页。 */
  const [markerTab, setMarkerTab] = useState<IconTab>('marker');
  /** 主题下方的笔记 / 标签浮层，位置跟随画布缩放与平移。 */
  const [topicEditor, setTopicEditor] = useState<TopicEditor | null>(null);
  const [canvasView, setCanvasView] = useState<CanvasView>({ scale: 1, tx: 0, ty: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  /** Right-click menu: viewport coordinates + the exact item tree to show. */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Clicking an in-box marker opens a same-group replacement popover. */
  const [markerChipPop, setMarkerChipPop] = useState<MarkerChipTarget | null>(null);
  /** The artwork of an image topic, selected independently of its topic. */
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  /** In-app stand-ins for the original's small non-editor dialogs. */
  const [dialog, setDialog] = useState<{ title: string; lines: string[] } | null>(null);
  const [inputDialog, setInputDialog] = useState<{
    title: string; label: string; value: string; onSubmit: (value: string) => void;
  } | null>(null);
  const [exportFormat, setExportFormat] = useState('svg');
  const [panelTab, setPanelTab] = useState<'style' | 'canvas' | null>(null);
  const [panelPop, setPanelPop] = useState<string | null>(null);
  const [toolbarLabels, setToolbarLabels] = useState(true);
  /** 拷贝样式 / 粘贴样式 and the text clipboard live in the renderer. */
  const styleClipboard = useRef<TopicStyle | null>(null);
  const textClipboard = useRef<string>('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState<'map' | 'outline'>('map');
  const [outlineScale, setOutlineScale] = useState(100);
  const [zoomMenu, setZoomMenu] = useState<{ right: number; bottom: number } | null>(null);
  /** 保存进行中：标题栏显示「保存中...」，同时锁住菜单里的保存项。 */
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<MapCanvasHandle>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  /** Guards Ctrl+S repeating while a save dialog / write is still in flight. */
  const savingRef = useRef(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  const commit = useCallback((value: Snapshot) => {
    snapshotRef.current = value;
    setSnapshot(value);
  }, []);

  /* Undo / delete / sheet switch can remove topics that were still selected in
     the previous state; XMind never keeps a selection it cannot draw, so drop
     the stale ids instead of counting them in 「主题: N / 总数」. */
  useEffect(() => {
    const nodes = snapshot?.layout.nodes;
    if (!nodes) return;
    const live = new Set(nodes.map((node) => node.id));
    setSelectedIds((current) => {
      const next = current.filter((id) => live.has(id));
      return next.length === current.length ? current : next;
    });
    setSelected((current) => (current && !live.has(current) ? null : current));
    setTopicEditor((current) => (current && !live.has(current.id) ? null : current));
    setSelectedDecor((current) => {
      if (!current) return current;
      const frames = snapshot?.layout.frames ?? [];
      const links = snapshot?.layout.links ?? [];
      const alive = current.kind === 'relation'
        ? links.some((entry) => entry.id === current.id)
        : frames.some((entry) => entry.id === current.id && entry.kind === current.kind);
      return alive ? current : null;
    });
  }, [snapshot]);

  /** Single source of truth for "which topics are selected". */
  const select = useCallback((id: string | null, ids?: string[]) => {
    const next = ids ?? (id ? [id] : []);
    setSelectedIds(next);
    setSelected(ids?.length ? ids[ids.length - 1] : id);
  }, []);

  const onSelect = useCallback((id: string | null, additive = false) => {
    // Clicking bare canvas (or any topic) drops the artwork / marker popover
    // selection; those are separate objects inside a topic (FINDINGS §48).
    setSelectedImage(null);
    setMarkerChipPop(null);
    if (!id) { select(null); return; }
    if (additive) {
      setSelectedIds((current) => {
        const next = current.includes(id)
          ? current.filter((entry) => entry !== id)
          : [...current, id];
        setSelected(next.length ? next[next.length - 1] : null);
        return next;
      });
    } else select(id);
  }, [select]);

  /** Inclusive sibling range from a box selection, in document order. */
  const selectionRange = useCallback(() => {
    const nodes = snapshotRef.current?.layout.nodes ?? [];
    const chosen = nodes.filter((node) => selectedIds.includes(node.id) && !node.cell && node.parentId);
    if (chosen.length < 2) return null;
    const groups = new Map<string, typeof chosen>();
    for (const node of chosen) {
      const key = `${node.parentId}|${node.side}`;
      const list = groups.get(key);
      if (list) list.push(node); else groups.set(key, [node]);
    }
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (!best || best.length < 2) return null;
    best.sort((a, b) => a.childIndex - b.childIndex);
    // XMind expands a 概要/外框 to every sibling between the two extremes.
    return { startId: best[0].id, endId: best[best.length - 1].id };
  }, [selectedIds]);

  // Bootstrap: XMind always opens on a clean, unsaved "未命名" map (one
  // central topic + four main topics), never on the document left behind by
  // the previous session. Recovery snapshots are still written on edit and can
  // be loaded through `doc_restore`, but startup must not consume them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const appInfo = await api.info();
        if (cancelled) return;
        setInfo(appInfo);
        const initial = await api.newDoc();
        if (cancelled) return;
        commit(initial);
        select(initial.document.sheets[initial.document.activeSheet].root.id);
      } catch (error) {
        notify(`初始化失败：${String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [commit, notify, select]);

  // The chrome uses XMind's measured palette (styles.css); the document theme
  // only affects canvas content, so nothing writes CSS variables here.
  useEffect(() => {
    document.title = `${snapshot?.dirty ? '● ' : ''}${docLabel(snapshot?.path)} - XMind RS`;
  }, [snapshot]);

  // Windows draws the taskbar button / Alt-Tab entry from the *native* window
  // title; the WebView's document.title never reaches it. Only a different file
  // path changes the label, so ignore the many dirty/layout snapshots emitted
  // while typing — that would otherwise fire an IPC on every keystroke.
  useEffect(() => {
    void getCurrentWindow().setTitle(docLabel(snapshot?.path)).catch(() => undefined);
  }, [snapshot?.path]);

  // Debounced crash-recovery snapshot, entirely on the Rust side. Startup no
  // longer reads it back automatically (XMind always opens a clean map), but
  // the data remains available for an explicit `doc_restore` call.
  useEffect(() => {
    if (!snapshot?.dirty) return;
    const timer = window.setTimeout(() => { void api.saveRecovery().catch(() => undefined); }, 900);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  const run: Action = useCallback(async (cmd, args = {}) => {
    const text = (key: string) => String(args[key] ?? '');
    setBusy(true);
    try {
      let result: Snapshot | null = null;
      switch (cmd) {
        case 'addChild': result = await api.addChild(text('id')); break;
        case 'addSibling': result = await api.addSibling(text('id'), text('title') || undefined); break;
        case 'addSiblingBefore': result = await api.addSiblingBefore(text('id')); break;
        case 'insertParent': result = await api.insertParent(text('id')); break;
        case 'addFloating': result = await api.addFloating(
          Number(args.x ?? 0), Number(args.y ?? 0), text('title') || '自由主题', Boolean(args.callout)); break;
        case 'duplicate': result = await api.duplicate(text('id')); break;
        case 'remove': result = await api.remove(text('id')); break;
        case 'removeSingle': result = await api.removeSingle(text('id')); break;
        case 'indent': result = await api.indent(text('id')); break;
        case 'outdent': result = await api.outdent(text('id')); break;
        case 'foldAll': result = await api.foldAll(Boolean(args.folded)); break;
        case 'focusBranch': result = await api.focusBranch(text('id')); break;
        case 'resetPosition': result = await api.resetPosition(text('id')); break;
        case 'sheetFromTopic': result = await api.sheetFromTopic(text('id')); break;
        case 'rename': result = await api.rename(text('id'), text('title')); break;
        case 'setNote': result = await api.setNote(text('id'), text('note')); break;
        case 'setLabels': result = await api.setLabels(text('id'), (args.labels as string[]) ?? []); break;
        case 'toggleMarker': result = await api.toggleMarker(text('id'), text('marker')); break;
        case 'setMarkers': result = await api.setMarkers(text('id'), (args.markers as string[]) ?? []); break;
        case 'setStyle': result = await api.setStyle(text('id'), (args.style as TopicStyle) ?? {}); break;
        case 'clearStyle': result = await api.clearStyle(text('id')); break;
        case 'setSide': result = await api.setSide(text('id'), (args.side as 'left' | 'right' | null) ?? null); break;
        case 'setImage': result = await api.setImage(text('id'), (args.resource as string | null) ?? null); break;
        case 'toggleFold': result = await api.toggleFold(text('id')); break;
        case 'setFold': result = await api.setFold(text('id'), Boolean(args.folded)); break;
        case 'move': result = await api.move(text('id'), text('newParentId'), Number(args.index ?? 0)); break;
        case 'moveFree': result = await api.moveFree(text('id'), Number(args.x ?? 0), Number(args.y ?? 0)); break;
        case 'addDecor': result = await api.addDecor(
          text('kind'), text('id'), args.targetId ? text('targetId') : null, text('title'),
          (args.range as { startId: string; endId: string } | null) ?? null); break;
        case 'removeDecor': result = await api.removeDecor(text('kind'), text('id')); break;
        case 'setDecorRange': result = await api.setDecorRange(
          text('kind'), text('id'), text('startId'), text('endId')); break;
        case 'renameDecor': result = await api.renameDecor(text('kind'), text('id'), text('title')); break;
        case 'setHref': result = await api.setHref(text('id'), (args.href as string | null) ?? null); break;
        case 'addSheet': result = await api.addSheet(); break;
        case 'removeSheet': result = await api.removeSheet(Number(args.index ?? 0)); break;
        case 'renameSheet': result = await api.renameSheet(Number(args.index ?? 0), text('title')); break;
        case 'setActiveSheet': result = await api.setActiveSheet(Number(args.index ?? 0)); break;
        case 'undo': result = await api.undo(); break;
        case 'redo': result = await api.redo(); break;
        default: notify(`未知操作：${cmd}`); return null;
      }
      if (result) {
        if (['addChild', 'addSibling', 'addSiblingBefore', 'insertParent', 'addFloating', 'duplicate'].includes(cmd)) {
          const before = new Set(snapshotRef.current ? collectIds(snapshotRef.current.document) : []);
          const added = collectIds(result.document).find((id) => !before.has(id));
          if (added) select(added);
        }
        if (cmd === 'sheetFromTopic') {
          const root = result.document.sheets[result.document.activeSheet]?.root;
          if (root) select(root.id);
        }
        commit(result);
      }
      return result;
    } catch (error) {
      notify(`操作失败：${String(error)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [commit, notify, select]);

  // Live in-place edit: one IPC per keystroke, each returning a freshly laid
  // out snapshot so the topic box grows as the user types. Sequence numbers
  // keep a slow earlier response from painting an older layout on top.
  const liveSeq = useRef(0);
  const liveApplied = useRef(0);
  const liveEdit = useCallback(async (
    phase: LiveEditPhase, id: string, title: string | null,
  ): Promise<Snapshot | null> => {
    if (phase === 'begin') {
      liveSeq.current += 1;
      liveApplied.current = liveSeq.current;
      try { await api.editBegin(id); } catch (error) { notify(`编辑失败：${String(error)}`); }
      return null;
    }
    const seq = ++liveSeq.current;
    try {
      const result = phase === 'text'
        ? await api.editText(id, title ?? '')
        : await api.editEnd(id, phase === 'cancel' ? null : title, phase === 'cancel');
      if (seq >= liveApplied.current) {
        liveApplied.current = seq;
        commit(result);
      }
      return result;
    } catch (error) {
      notify(`编辑失败：${String(error)}`);
      return null;
    }
  }, [commit, notify]);

  const openFile = useCallback(async (givenPath?: string) => {
    try {
      let path = givenPath ?? '';
      if (!path) {
        const chosen = await openDialog({
          multiple: false,
          filters: [{ name: '思维导图', extensions: ['xmind', 'json', 'md', 'txt', 'opml'] }],
        });
        if (!chosen) return;
        path = chosen as string;
      }
      const result = await api.open(path);
      commit(result);
      select(result.document.sheets[result.document.activeSheet].root.id);
      notify('已打开（未知字段会原样保留）');
    } catch (error) { notify(`打开失败：${String(error)}`); }
  }, [commit, notify, select]);

  const saveFile = useCallback(async (asNew: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      let path: string | null = null;
      if (asNew || !snapshotRef.current?.path) {
        const chosen = await saveDialog({
          title: '保存思维导图',
          defaultPath: '未命名思维导图.xmind',
          filters: [{ name: 'XMind 文件', extensions: ['xmind'] }],
        });
        if (!chosen) return;
        path = chosen;
      }
      const result = await api.save(path);
      commit(result);
      notify('已保存为 XMind 兼容文件');
    } catch (error) { notify(`保存失败：${String(error)}`); }
    finally { savingRef.current = false; setSaving(false); }
  }, [commit, notify]);

  const newFile = useCallback(async () => {
    if (snapshotRef.current?.dirty && !window.confirm('当前导图尚未保存，确定新建吗？')) return;
    const result = await api.newDoc();
    commit(result);
    select(result.document.sheets[result.document.activeSheet].root.id);
  }, [commit, select]);

  // 联系 is a two-click gesture: pick the first topic (toolbar / shortcut),
  // then click the second one on the canvas. Escape aborts.
  const startLink = useCallback(() => {
    if (!selected) { notify('请先选中一个主题作为联系的起点'); return; }
    setLinkFrom(selected);
    setHrefFrom(null);
    setSelectedDecor(null);
    notify('请点击另一个主题建立联系（Esc 取消）');
  }, [selected, notify]);

  const finishLink = useCallback(async (to: string) => {
    const from = linkFrom;
    setLinkFrom(null);
    if (!from) return;
    if (from === to) { notify('联系需要两个不同的主题'); return; }
    await run('addDecor', { kind: 'relation', id: from, targetId: to, title: '联系' });
    notify('已添加联系');
  }, [linkFrom, run, notify]);

  const onLinkTarget = useCallback((to: string) => {
    if (hrefFrom) {
      const from = hrefFrom;
      setHrefFrom(null);
      if (from !== to) { void run('setHref', { id: from, href: `#${to}` }); notify('已建立主题链接'); }
      return;
    }
    void finishLink(to);
  }, [hrefFrom, finishLink, run, notify]);

  const addRange = useCallback((kind: 'summary' | 'boundary') => {
    if (!selected) { notify('请先选中一个主题'); return; }
    const title = kind === 'summary' ? '概要' : '外框';
    const range = selectionRange();
    const before = new Set((snapshotRef.current?.layout.frames ?? [])
      .filter((frame) => frame.kind === kind).map((frame) => frame.id));
    void run('addDecor', { kind, id: selected, title, range }).then((result) => {
      if (!result) return;
      // XMind selects the freshly inserted 概要 and switches the 格式 panel to
      // its 概要线型 / 概要主题 options.
      if (kind === 'summary') {
        const added = result.layout.frames.find(
          (frame) => frame.kind === 'summary' && !before.has(frame.id),
        );
        if (added) {
          setSelectedDecor({ kind: 'summary', id: added.id });
          setPanel('format');
          setPanelTab('style');
          setPanelPop(null);
        }
      }
      notify(range
        ? `已按选中的 ${selectedIds.length} 个主题添加${title}（点选后按 Delete 可删除）`
        : `已添加${title}（点选后按 Delete 可删除）`);
    });
  }, [selected, selectedIds.length, selectionRange, run, notify]);

  /** Double clicking a 联系 / 外框 opens an in-app edit box. */
  const renameDecor = useCallback((selection: DecorSelection, current: string) => {
    setRenameTarget({
      kind: selection.kind,
      id: selection.id,
      current,
      label: selection.kind === 'relation' ? '联系文字' : '外框标题',
    });
    setRenameDraft(current);
  }, []);

  const submitRename = useCallback(async () => {
    const target = renameTarget;
    setRenameTarget(null);
    if (target) await run('renameDecor', { kind: target.kind, id: target.id, title: renameDraft });
  }, [renameTarget, renameDraft, run]);

  /** Delete every box-selected topic in one gesture (one undo step each). */
  const deleteSelection = useCallback(async () => {
    const current = snapshotRef.current;
    if (!current) return;
    const rootId = current.document.sheets[current.document.activeSheet].root.id;
    const ids = (selectedIds.length ? selectedIds : selected ? [selected] : [])
      .filter((entry) => entry !== rootId);
    for (const entry of ids) await run('remove', { id: entry });
    if (ids.length) select(rootId);
  }, [selected, selectedIds, run, select]);

  const copySelectionText = useCallback(() => {
    const nodes = snapshotRef.current?.layout.nodes ?? [];
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    const text = ids
      .map((entry) => nodes.find((node) => node.id === entry)?.title ?? '')
      .filter(Boolean)
      .join('\n');
    textClipboard.current = text;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    return text;
  }, [selected, selectedIds]);

  const pasteSelectionText = useCallback(async () => {
    let text = textClipboard.current;
    try {
      const system = await navigator.clipboard?.readText?.();
      if (system) text = system;
    } catch { /* WebView2 may deny clipboard reads; the local buffer wins. */ }
    if (!text.trim()) { notify('剪贴板是空的'); return; }
    const current = snapshotRef.current;
    if (!current) return;
    const rootId = current.document.sheets[current.document.activeSheet].root.id;
    let anchor = selected ?? rootId;
    for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const before = new Set(collectIds(snapshotRef.current?.document ?? current.document));
      const next = await run('addSibling', { id: anchor, title: line });
      const added = next ? collectIds(next.document).find((id) => !before.has(id)) : null;
      if (added) anchor = added;
    }
  }, [selected, run, notify]);

  const pickImage = useCallback((id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        void api.resourcePut(String(reader.result ?? ''), file.name)
          .then((resource) => run('setImage', { id, resource: resource.id }))
          .then(() => notify('已插入图片并写入 .xmind 资源'))
          .catch((error) => notify(String(error)));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [run, notify]);

  /** 贴纸 / 插画和本地图片走同一条资源链路：取字节 → content-addressed
   *  store → topic.image → .xmind resources/，因此保存后可再次打开。 */
  const insertIconImage = useCallback(async (kind: 'sticker' | 'illustration', item: IconItem) => {
    if (!selected) { notify('请先选中一个主题'); return; }
    try {
      const response = await fetch(item.icon);
      if (!response.ok) throw new Error(`读取素材失败：${response.status}`);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const resource = await api.resourcePut(dataUrl, `${item.id}.svg`);
      await run('setImage', { id: selected, resource: resource.id });
      notify(`已插入${kind === 'sticker' ? '贴纸' : '插画'}`);
    } catch (error) {
      notify(`插入素材失败：${String(error)}`);
    }
  }, [selected, run, notify]);

  /** 自由主题对齐: the shipped eight commands, applied to box-selected floaters. */
  const alignFloating = useCallback(async (kind: string) => {
    const current = snapshotRef.current;
    if (!current) return;
    const nodes = current.layout.nodes;
    const root = nodes.find((node) => node.depth === 0 && !node.parentId);
    if (!root) return;
    const cx = root.x + root.width / 2;
    const cy = root.y + root.height / 2;
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    const boxes = nodes.filter((node) => ids.includes(node.id) && node.depth > 0 && !node.parentId);
    if (boxes.length < 2) { notify('请先框选至少两个自由主题'); return; }
    const left = Math.min(...boxes.map((n) => n.x));
    const right = Math.max(...boxes.map((n) => n.x + n.width));
    const top = Math.min(...boxes.map((n) => n.y));
    const bottom = Math.max(...boxes.map((n) => n.y + n.height));
    const byX = [...boxes].sort((a, b) => a.x - b.x);
    const byY = [...boxes].sort((a, b) => a.y - b.y);
    const gapX = (right - left - boxes.reduce((sum, n) => sum + n.width, 0)) / (boxes.length - 1);
    const gapY = (bottom - top - boxes.reduce((sum, n) => sum + n.height, 0)) / (boxes.length - 1);
    let cursorX = left;
    let cursorY = top;
    const positions = boxes.map((node) => {
      let x = node.x;
      let y = node.y;
      switch (kind) {
        case 'left': x = left; break;
        case 'right': x = right - node.width; break;
        case 'vcenter': x = (left + right) / 2 - node.width / 2; break;
        case 'top': y = top; break;
        case 'bottom': y = bottom - node.height; break;
        case 'hcenter': y = (top + bottom) / 2 - node.height / 2; break;
        case 'hgap': x = byX.indexOf(node) === 0 ? left : cursorX; cursorX = x + node.width + gapX; break;
        case 'vgap': y = byY.indexOf(node) === 0 ? top : cursorY; cursorY = y + node.height + gapY; break;
      }
      return { id: node.id, x: x + node.width / 2 - cx, y: y + node.height / 2 - cy };
    });
    for (const position of positions) await run('moveFree', position);
  }, [selected, selectedIds, run, notify]);

  /** Every menu row (main menu, canvas menu, topic menu) lands here. */
  const handleMenuAction = useCallback((entry: MenuItem) => {
    const action = entry.action ?? '';
    const payload = entry.payload ?? {};
    const current = snapshotRef.current;
    const rootId = current?.document.sheets[current.document.activeSheet].root.id ?? null;
    const id = selected ?? '';
    const need = () => {
      if (!id) { notify('请先选中一个主题'); return false; }
      return true;
    };
    const topicOf = (topicId: string | null) =>
      current ? findTopicById(current.document, topicId) : null;

    switch (action) {
      /* ---------------------------------------------------------- 文件 */
      case 'undo': void run('undo'); break;
      case 'redo': void run('redo'); break;
      case 'new': void newFile(); break;
      case 'open': case 'import.open': void openFile(); break;
      case 'save': void saveFile(false); break;
      case 'saveAs': void saveFile(true); break;
      case 'export.md': case 'export.opml':
        setExportFormat(action === 'export.md' ? 'md' : 'opml');
        setPanel('export');
        break;
      /* 文件 → 导出 → PNG / PDF: the whole sheet, not one branch. Exporting the
         central topic is the same code path (it rebuilds a document around the
         root, which is the map itself). */
      case 'export.png': case 'export.pdf': {
        if (!current || !rootId) break;
        const format = action === 'export.png' ? 'png' : 'pdf';
        void exportBranch(rootId, current.document.title || '思维导图', format)
          .then((path) => { if (path) notify(`已导出到 ${path}`); })
          .catch((error) => notify(`导出失败：${String(error)}`));
        break;
      }
      case 'recent.open': void openFile(String(payload.path ?? '')); break;
      case 'recent.clear':
        void api.clearRecent().then((next) => { commit(next); notify('已清空最近打开'); })
          .catch((error) => notify(String(error)));
        break;
      case 'window.close': void win.close(); break;
      /* Rows that need XMind's online services or OS-level features stay
         visible and enabled (as in the original), but explain themselves. */
      case 'file.notice': case 'help.notice':
        setDialog({
          title: String(payload.label ?? 'XMind 功能'),
          lines: [
            `「${String(payload.label ?? '')}」依赖 XMind 在线服务或系统级能力，本机离线版本暂未接入。`,
            '文件、编辑、插入、查看中已在本地实现的条目均可直接使用。',
          ],
        });
        break;
      /* ---------------------------------------------------------- 编辑 */
      case 'edit.cut':
        if (!need()) break;
        copySelectionText();
        void deleteSelection();
        break;
      case 'edit.copy': if (need()) { copySelectionText(); notify('已拷贝主题文字'); } break;
      case 'edit.paste': void pasteSelectionText(); break;
      case 'edit.duplicate': if (need()) void run('duplicate', { id }); break;
      case 'edit.delete': void deleteSelection(); break;
      case 'edit.deleteSingle': if (need()) void run('removeSingle', { id }); break;
      case 'edit.indent': if (need()) void run('indent', { id }); break;
      case 'edit.outdent': if (need()) void run('outdent', { id }); break;
      case 'edit.copyStyle': {
        if (!need()) break;
        styleClipboard.current = topicOf(id)?.style ?? {};
        notify('已拷贝主题样式');
        break;
      }
      case 'edit.pasteStyle': {
        if (!need()) break;
        const style = styleClipboard.current;
        if (!style) { notify('请先拷贝一个主题的样式'); break; }
        void run('setStyle', { id, style });
        break;
      }
      case 'edit.resetStyle': if (need()) void run('clearStyle', { id }); break;
      case 'edit.goCenter': if (rootId) select(rootId); break;
      case 'edit.selectAll': {
        const ids = (current?.layout.nodes ?? []).filter((node) => !node.cell).map((node) => node.id);
        select(null, ids);
        break;
      }
      case 'edit.fold': if (need()) void run('toggleFold', { id }); break;
      case 'edit.foldAll': void run('foldAll', { folded: true }); break;
      case 'edit.unfoldAll': void run('foldAll', { folded: false }); break;
      case 'edit.resetPosition': if (need()) void run('resetPosition', { id }); break;
      case 'align.left': case 'align.right': case 'align.vcenter': case 'align.top':
      case 'align.bottom': case 'align.hcenter': case 'align.hgap': case 'align.vgap':
        void alignFloating(action.slice(6));
        break;
      /* ---------------------------------------------------------- 插入 */
      case 'insert.child': if (need()) void run('addChild', { id }); break;
      case 'insert.siblingAfter': if (need()) void run('addSibling', { id }); break;
      case 'insert.siblingBefore': if (need()) void run('addSiblingBefore', { id }); break;
      case 'insert.parent': if (need() && id !== rootId) void run('insertParent', { id }); break;
      case 'insert.floating': {
        const count = current?.document.sheets[current.document.activeSheet].root.detached?.length ?? 0;
        void run('addFloating', { x: 0, y: 150 + count * 70, title: '自由主题' });
        break;
      }
      case 'insert.callout': void run('addFloating', { x: 190, y: -130, title: '标注', callout: true }); break;
      case 'insert.relation': startLink(); break;
      case 'insert.summary': addRange('summary'); break;
      case 'insert.boundary': addRange('boundary'); break;
      case 'insert.note': {
        if (!need()) break;
        setToolbarPop(null);
        setTopicEditor({ kind: 'note', id, draft: topicOf(id)?.note ?? '' });
        break;
      }
      case 'insert.label': {
        if (!need()) break;
        setToolbarPop(null);
        setTopicEditor({ kind: 'label', id, draft: (topicOf(id)?.labels ?? []).join(', ') });
        break;
      }
      case 'insert.marker': {
        if (!need()) break;
        setMarkerTab('marker');
        setToolbarPop('marker');
        break;
      }
      case 'insert.image': if (need()) pickImage(id); break;
      /* ------------------------------------------- 图片（贴纸 / 插画 / 本地图片）
         Right-clicking the artwork selects the image, not the topic, so the
         id always comes from the menu payload (FINDINGS §48). */
      case 'image.remove': {
        const imageId = String(payload.id ?? selectedImage ?? id);
        if (!imageId) break;
        void run('setImage', { id: imageId, resource: null });
        setSelectedImage(null);
        break;
      }
      case 'image.replaceFile': {
        const imageId = String(payload.id ?? selectedImage ?? id);
        if (imageId) pickImage(imageId);
        break;
      }
      case 'image.replaceSticker': case 'image.replaceClipart': {
        const imageId = String(payload.id ?? selectedImage ?? id);
        if (!imageId) break;
        select(imageId);
        setMarkerTab(action === 'image.replaceSticker' ? 'sticker' : 'illustration');
        setToolbarPop('marker');
        setContextMenu(null);
        break;
      }
      case 'image.copy': {
        const imageId = String(payload.id ?? selectedImage ?? id);
        const resource = topicOf(imageId)?.image;
        if (!resource) { notify('图片资源不可用'); break; }
        void api.resourceData(resource).then(async (dataUrl) => {
          if (!dataUrl) { notify('图片资源不可用'); return; }
          try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            notify('已拷贝图片');
          } catch {
            copySelectionText();
            notify('已拷贝主题文字（当前环境不支持图片剪贴板）');
          }
        }).catch((error) => notify(`拷贝失败：${String(error)}`));
        break;
      }
      case 'insert.linkWeb': {
        if (!need()) break;
        const href = topicOf(id)?.href ?? 'https://';
        setInputDialog({
          title: '插入链接', label: '网页地址', value: href ?? 'https://',
          onSubmit: (value) => { if (value.trim()) void run('setHref', { id, href: value.trim() }); },
        });
        break;
      }
      case 'insert.linkTopic': {
        if (!need()) break;
        setHrefFrom(id);
        setLinkFrom(null);
        notify('请点击要链接到的主题（Esc 取消）');
        break;
      }
      case 'insert.linkFile': case 'insert.linkFolder': {
        if (!need()) break;
        void openDialog({ multiple: false, directory: action === 'insert.linkFolder' })
          .then((chosen) => {
            if (!chosen) return;
            void run('setHref', { id, href: `file:///${String(chosen).replace(/\\/g, '/')}` });
          });
        break;
      }
      case 'insert.sheet': void run('addSheet').then((next) => {
        if (next) select(next.document.sheets[next.document.activeSheet].root.id);
      }); break;
      case 'insert.sheetFromTopic': if (need()) void run('sheetFromTopic', { id }); break;
      /* 主题右键「插入」里的在线素材项，以及「导出分支为 / 打印分支」。 */
      case 'insert.notice':
        setDialog({
          title: String(payload.label ?? '插入元素'),
          lines: [
            `「${String(payload.label ?? '')}」需要 XMind 在线素材或原生模块，本机离线版本未接入。`,
            '可用替代：本地图片（Ctrl+Shift+I）、笔记、标签、标记、网页/主题/文件链接。',
          ],
        });
        break;
      case 'branch.export.png': case 'branch.export.svg':
      case 'branch.export.pdf': case 'branch.export.md': {
        if (!need()) break;
        const format = action.slice('branch.export.'.length) as BranchFormat;
        void exportBranch(id, topicOf(id)?.title ?? '分支', format)
          .then((path) => { if (path) notify(`已导出分支到 ${path}`); })
          .catch((error) => notify(`导出失败：${String(error)}`));
        break;
      }
      case 'branch.print': {
        if (!need()) break;
        void printBranch(id, topicOf(id)?.title ?? '分支')
          .catch((error) => notify(`打印失败：${String(error)}`));
        break;
      }
      /* ---------------------------------------------------------- 查看 */
      case 'view.map': setViewMode('map'); break;
      case 'view.outline': setViewMode('outline'); break;
      case 'view.zoomIn': canvasRef.current?.zoomIn(); break;
      case 'view.zoomOut': canvasRef.current?.zoomOut(); break;
      case 'view.zoomReset': canvasRef.current?.reset(); break;
      case 'view.fit': canvasRef.current?.fit(); break;
      case 'view.focusBranch': if (need()) void run('focusBranch', { id }); break;
      case 'view.panel.style': case 'view.panel.canvas':
      case 'view.panel.skeleton': case 'view.panel.palette': {
        setPanel('format');
        setPanelTab(action === 'view.panel.style' ? 'style' : 'canvas');
        setPanelPop(null);
        const wanted = action === 'view.panel.skeleton' ? 'skeleton'
          : action === 'view.panel.palette' ? 'theme' : null;
        // Reset first so choosing the same board twice re-opens it.
        if (wanted) window.setTimeout(() => setPanelPop(wanted), 0);
        break;
      }
      case 'view.toolbar.icons': setToolbarLabels(false); break;
      case 'view.toolbar.labels': setToolbarLabels(true); break;
      /* ---------------------------------------------------------- 帮助 */
      case 'help.shortcuts':
        setDialog({ title: '快捷键命令', lines: SHORTCUTS.map(([name, keys]) => `${name}  —  ${keys}`) });
        break;
      case 'help.about':
        setDialog({
          title: '关于 xmind-rs',
          lines: [
            `XMind RS ${info?.version ?? ''}`,
            '遵循本机 Xmind 23.07 的界面与交互规格重写。',
            `数据目录：${info?.dataDir ?? ''}`,
            '单窗口 + 系统 WebView2，文件读写与布局全部在 Rust 侧完成。',
          ],
        });
        break;
      default: break;
    }
  }, [selected, selectedIds, run, notify, select, newFile, openFile, saveFile, startLink,
    addRange, commit, win, info, copySelectionText, pasteSelectionText, deleteSelection,
    pickImage, alignFloating, selectedImage]);

  const doAction = useCallback((action: string, payload?: Record<string, unknown>) => {
    handleMenuAction({ id: `kbd:${action}`, label: '', action, payload });
  }, [handleMenuAction]);

  // XMind-compatible keyboard map. Every menu row has its shortcut here too.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const alt = event.altKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      const fire = (action: string) => { event.preventDefault(); doAction(action); };
      const cmd = (action: string) => { event.preventDefault(); void run(action, { id: selected }); };

      if (event.key === 'Escape') {
        if (inputDialog) { setInputDialog(null); return; }
        if (dialog) { setDialog(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (menuOpen) { setMenuOpen(false); return; }
        if (toolbarPop) { setToolbarPop(null); return; }
        if (linkFrom || hrefFrom) {
          setLinkFrom(null); setHrefFrom(null); notify('已取消联系');
        } else if (markerChipPop) setMarkerChipPop(null);
        else if (selectedImage) setSelectedImage(null);
        else if (selectedDecor) setSelectedDecor(null);
        else if (renameTarget) setRenameTarget(null);
        else if (selectedIds.length > 1) select(selected);
        return;
      }
      if (mod && alt && key === 'n') fire('insert.sheet');
      else if (mod && alt && key === 'c') fire('edit.copyStyle');
      else if (mod && alt && key === 'v') fire('edit.pasteStyle');
      else if (mod && alt && key === '0') fire('edit.resetStyle');
      else if (mod && alt && key === '/') fire('edit.foldAll');
      else if (mod && shift && key === 'r') { event.preventDefault(); startLink(); }
      else if (mod && shift && key === 'b') { event.preventDefault(); addRange('boundary'); }
      else if (mod && shift && key === 's') { event.preventDefault(); void saveFile(true); }
      else if (mod && shift && key === 'n') fire('insert.note');
      else if (mod && shift && key === 'l') fire('insert.label');
      else if (mod && shift && key === 'i') fire('insert.image');
      else if (mod && shift && event.code === 'Slash') fire('help.shortcuts');
      else if (mod && key === 's') { event.preventDefault(); void saveFile(false); }
      else if (mod && key === 'o') { event.preventDefault(); void openFile(); }
      else if (mod && key === 'z') { event.preventDefault(); void run(shift ? 'redo' : 'undo'); }
      else if (mod && key === 'y') { event.preventDefault(); void run('redo'); }
      else if (mod && key === 'n') { event.preventDefault(); void newFile(); }
      else if (mod && key === 'a') fire('edit.selectAll');
      else if (mod && key === 'd') fire('edit.duplicate');
      else if (mod && key === 'x') fire('edit.cut');
      else if (mod && key === 'c') fire('edit.copy');
      else if (mod && key === 'v') fire('edit.paste');
      else if (mod && key === 'r') fire('edit.goCenter');
      else if (mod && key === 'k') fire('insert.linkWeb');
      else if (mod && key === '/') fire('edit.fold');
      else if (mod && key === ';') fire('view.focusBranch');
      else if (mod && key === '0') fire('view.zoomReset');
      else if (mod && key === '=') fire('view.zoomIn');
      else if (mod && key === '-') fire('view.zoomOut');
      else if (mod && key === 'backspace') fire('edit.deleteSingle');
      else if (mod && event.key === 'Enter') fire('insert.parent');
      else if (!mod && shift && event.key === 'Enter') fire('insert.siblingBefore');
      else if (!mod && event.key === 'F2') { event.preventDefault(); if (selected) canvasRef.current?.edit(selected); }
      else if (!mod && event.key === 'Tab') { event.preventDefault(); if (selected) cmd('addChild'); }
      else if (!mod && event.key === 'Enter') { event.preventDefault(); if (selected) cmd('addSibling'); }
      else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (selectedImage) {
          void run('setImage', { id: selectedImage, resource: null });
          setSelectedImage(null);
        } else if (selectedDecor) {
          void run('removeDecor', { kind: selectedDecor.kind, id: selectedDecor.id });
          setSelectedDecor(null);
        } else void deleteSelection();
      }
      // Space is deliberately unused here: in XMind it is the hold-to-pan
      // modifier handled by MapCanvas, not a fold shortcut (fold is Ctrl+/).
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, selectedIds, selectedDecor, linkFrom, hrefFrom, renameTarget,
    menuOpen, contextMenu, dialog, inputDialog, toolbarPop, run, startLink, addRange, saveFile, openFile,
    newFile, notify, select, doAction, deleteSelection, markerChipPop, selectedImage]);

  const setStructure = async (structure: Structure) => {
    try {
      const result = await api.setStructure(structure);
      commit(result);
      notify('已切换分支结构');
      window.setTimeout(() => canvasRef.current?.fit(), 30);
    } catch (error) { notify(String(error)); }
  };

  /** Apply a 骨架 preset: structure + the shape/line snapshot it carries. */
  const setSkeleton = async (preset: SkeletonPreset) => {
    try {
      commit(await api.applySkeleton({
        structure: preset.structure,
        central: preset.central,
        main: preset.main,
        shape: preset.shape,
        mainShape: preset.mainShape,
        line: preset.line,
        centralLine: preset.centralLine,
        pattern: preset.pattern,
        fillPattern: preset.fill,
        subLine: preset.subLine ?? null,
        subShape: preset.subShape ?? null,
        subPattern: preset.subPattern ?? null,
        subWidth: preset.subWidth ?? null,
        subFill: preset.subFill ?? null,
        mainWidth: preset.mainWidth ?? null,
        centralWidth: preset.centralWidth ?? null,
        tapered: preset.tapered ?? null,
        layers: preset.layers,
      }));
      // The shipped panel stays open and applies on every click, so there is
      // no toast — only the canvas changes.
      window.setTimeout(() => canvasRef.current?.fit(), 30);
    } catch (error) { notify(String(error)); }
  };

  const setWidth = async (id: string, width: number | null) => {
    try { commit(await api.setWidth(id, width)); } catch (error) { notify(String(error)); }
  };

  const setCanvas = async (patch: {
    background?: string; fontFamily?: string; lineWidth?: number; rainbow?: boolean;
    compact?: boolean; siblingAlign?: boolean; branchColors?: string[] | null;
    palette?: string | null; centerColor?: string | null; paletteVariant?: number | null;
  }) => {
    try { commit(await api.setCanvas(patch)); } catch (error) { notify(String(error)); }
  };

  const togglePanel = (next: Exclude<Panel, 'none' | 'export'>) =>
    setPanel((current) => current === next ? 'none' : next);

  /** 标记与插入是真正的下拉面板，不再只是把「主题属性」侧面板开开关关。 */
  const toggleToolPop = (next: Exclude<ToolbarPop, null>) => {
    setMenuOpen(false);
    setContextMenu(null);
    setTopicEditor(null);
    if (next === 'marker') setMarkerTab('marker');
    setToolbarPop((current) => current === next ? null : next);
  };

  /** 插入下拉的 5 行：笔记/标签是浮层，贴纸/插画打开同一个图标面板的
   *  另两个页签，本地图片沿用原有文件选择链路。 */
  const pickInsert = (action: string) => {
    setTopicEditor(null);
    if (action === 'insert.sticker' || action === 'insert.illustration') {
      setMarkerTab(action === 'insert.sticker' ? 'sticker' : 'illustration');
      setToolbarPop('marker');
      return;
    }
    setToolbarPop(null);
    doAction(action);
  };

  /** 笔记 / 标签浮层：原版在主题下方就地编辑，关闭时才写一次文档。 */
  const commitTopicEditor = () => {
    const editor = topicEditor;
    if (!editor) return;
    setTopicEditor(null);
    if (editor.kind === 'note') {
      void run('setNote', { id: editor.id, note: editor.draft });
      return;
    }
    const labels = editor.draft.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    void run('setLabels', { id: editor.id, labels });
  };

  const editorAnchor = useMemo(() => {
    if (!topicEditor || !snapshot) return null;
    const node = snapshot.layout.nodes.find((entry) => entry.id === topicEditor.id);
    if (!node) return null;
    const { scale, tx, ty } = canvasView;
    const half = topicEditor.kind === 'note' ? 180 : 140;
    return {
      left: Math.min(Math.max(node.x * scale + tx + node.width * scale / 2, half + 8),
        Math.max(half + 8, window.innerWidth - half - 8)),
      top: Math.min(Math.max(node.y * scale + ty + node.height * scale + 8, 60),
        Math.max(60, window.innerHeight - 260)),
    };
  }, [topicEditor, snapshot, canvasView]);

  const activeMarkers = useMemo(() =>
    (snapshot && selected ? findTopicById(snapshot.document, selected)?.markers : []) ?? [],
  [snapshot, selected]);

  /** 图例列出整份导图中已用过的标记，顺序与官方面板的标记目录一致。 */
  const usedMarkers = useMemo(() => {
    const seen = new Set<string>();
    if (!snapshot) return [];
    const visit = (topic: Topic) => {
      topic.markers?.forEach((marker) => seen.add(marker));
      for (const list of [topic.children, topic.detached, topic.summary, topic.callout]) {
        list?.forEach(visit);
      }
    };
    snapshot.document.sheets.forEach((sheet) => visit(sheet.root));
    return MARKERS.filter((marker) => seen.has(marker));
  }, [snapshot]);

  /** 官方标记面板：同组只能有一个，点同组另一个替换、跨组累加；同 id 幂等。 */
  const addMarker = (marker: string) => {
    if (!selected) { notify('请先选中一个主题'); return; }
    const next = addMarkerExclusive(activeMarkers, marker);
    if (next === activeMarkers) return;
    void run('setMarkers', { id: selected, markers: next });
  };

  /** Clicking one marker chip opens the shipped same-group popover.  A second
   *  click on the same chip toggles it shut (FINDINGS §48). */
  const openMarkerPop = useCallback((topicId: string, marker: string, anchor: { x: number; y: number }) => {
    setSelectedImage(null);
    setContextMenu(null);
    setMarkerChipPop((current) => current?.topicId === topicId && current.marker === marker
      ? null : { topicId, marker, ...anchor });
  }, []);

  const pickMarkerReplacement = useCallback((nextMarker: string | null) => {
    const target = markerChipPop;
    if (!target) return;
    const doc = snapshotRef.current?.document;
    const current = doc ? findTopicById(doc, target.topicId)?.markers ?? [] : [];
    // Dropping the old id first keeps the "one marker per group" invariant
    // even when the replacement already exists elsewhere in the row.
    const without = current.filter((entry) => entry !== target.marker);
    const next = nextMarker ? addMarkerExclusive(without, nextMarker) : without;
    void run('setMarkers', { id: target.topicId, markers: next });
    setMarkerChipPop(null);
  }, [markerChipPop, run]);

  /** Artwork selection is independent of topic selection. */
  const selectImage = useCallback((topicId: string | null) => {
    setMarkerChipPop(null);
    setSelectedImage(topicId);
  }, []);

  const openImageContextMenu = useCallback((x: number, y: number, topicId: string) => {
    setMenuOpen(false);
    setMarkerChipPop(null);
    const current = snapshotRef.current;
    const rootId = current?.document.sheets[current.document.activeSheet].root.id;
    setContextMenu({ x, y, items: buildImageMenu(topicId, topicId === rootId) });
  }, []);

  useEffect(() => {
    if (!toolbarPop) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.tool-pop') || target?.closest('[data-tool-pop]')) return;
      setToolbarPop(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [toolbarPop]);

  useEffect(() => {
    if (!topicEditor) return;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.topic-inline-editor')) return;
      setTopicEditor(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [topicEditor]);

  const fitKey = snapshot
    ? `${snapshot.path ?? 'new'}|${snapshot.structure}|${snapshot.document.activeSheet}|${snapshot.stats.sheets}`
    : 'boot';

  const docName = docLabel(snapshot?.path);
  const topicCount = snapshot?.stats.topics ?? 0;
  const activeSheet = snapshot?.document.activeSheet ?? 0;
  const idList = snapshot ? collectIds(snapshot.document) : [];
  const selectedIndex = selected ? Math.max(1, idList.indexOf(selected) + 1) : 0;

  /** The 格式 panel shows 概要线型 / 概要主题 when a 概要 was just inserted or
   *  an existing brace / 概要 topic is selected (XMind behaves the same way). */
  const summaryFrames = useMemo(() =>
    (snapshot?.layout.frames ?? []).filter((frame) => frame.kind === 'summary'), [snapshot]);
  const summaryTargetId = selectedDecor?.kind === 'summary'
    ? selectedDecor.id
    : selected && summaryFrames.some((frame) => frame.id === selected) ? selected : null;
  const summaryActive = summaryTargetId !== null;
  const applySummaryStyle = useCallback(async (patch: {
    shapeClass?: string; lineColor?: string; lineWidth?: string;
  }) => {
    if (!summaryTargetId) return;
    try { commit(await api.setSummaryStyle(summaryTargetId, patch)); }
    catch (error) { notify(`概要样式设置失败：${String(error)}`); }
  }, [summaryTargetId, commit, notify]);

  const charCount = snapshot ? countCharacters(snapshot.document) : 0;
  const currentZoom = viewMode === 'outline' ? outlineScale : Math.round(scale * 100);

  /* The shipped status bar lists the fixed ladder, plus the live value when the
     user zoomed to something in between; outliner mode only offers 80-300%. */
  const zoomOptions = (() => {
    const base = viewMode === 'outline' ? ZOOM_STEPS.filter((value) => value >= 80 && value <= 300) : ZOOM_STEPS;
    return Array.from(new Set([...base, currentZoom])).sort((a, b) => b - a);
  })();

  const openZoomMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (zoomMenu) { setZoomMenu(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setZoomMenu({
      right: Math.round(window.innerWidth - rect.right),
      bottom: Math.round(window.innerHeight - rect.top + 5),
    });
  };

  const applyZoom = (value: number) => {
    if (viewMode === 'outline') setOutlineScale(value);
    else canvasRef.current?.setZoom(value / 100);
  };

  /** Everything the menu builders need to decide enabled / checked states. */
  const menuContext: MenuContext = useMemo(() => {
    const nodes = snapshot?.layout.nodes ?? [];
    const rootId = snapshot?.document.sheets[snapshot.document.activeSheet]?.root.id ?? null;
    const node = nodes.find((entry) => entry.id === selected) ?? null;
    const topic = snapshot?.document ? findTopicById(snapshot.document, selected) : null;
    return {
      hasTopic: Boolean(selected),
      isRoot: Boolean(selected && selected === rootId),
      hasChildren: Boolean(node?.hasChildren),
      folded: Boolean(node?.folded),
      hasFolded: nodes.some((entry) => entry.folded),
      multi: selectedIds.length,
      canUndo: Boolean(snapshot?.canUndo),
      canRedo: Boolean(snapshot?.canRedo),
      dirty: Boolean(snapshot?.dirty),
      saving,
      hasPath: Boolean(snapshot?.path),
      viewMode,
      toolbarLabels,
      hasStyle: Boolean(topic?.style && Object.keys(topic.style).length > 0),
      hasHref: Boolean(topic?.href),
      hasImage: Boolean(topic?.image),
      isFloating: Boolean(node && node.depth > 0 && !node.parentId),
      recent: snapshot?.recent ?? [],
    };
  }, [snapshot, selected, selectedIds, viewMode, toolbarLabels, saving]);

  /** MapCanvas reports right clicks; which menu appears depends on the target. */
  const openContextMenu = useCallback((x: number, y: number, topicId: string | null) => {
    setMenuOpen(false);
    setMarkerChipPop(null);
    setSelectedImage(null);
    if (topicId && !selectedIds.includes(topicId)) select(topicId);
    const ctx: MenuContext = {
      ...menuContext,
      hasTopic: Boolean(topicId ?? selected),
      isRoot: topicId === snapshot?.document.sheets[snapshot.document.activeSheet].root.id,
    };
    if (topicId) {
      const node = snapshot?.layout.nodes.find((entry) => entry.id === topicId);
      ctx.hasChildren = Boolean(node?.hasChildren);
      ctx.folded = Boolean(node?.folded);
      ctx.isFloating = Boolean(node && node.depth > 0 && !node.parentId);
    }
    setContextMenu({
      x, y,
      items: topicId ? buildTopicMenu(ctx) : buildCanvasMenu(ctx),
    });
  }, [menuContext, selected, selectedIds, select, snapshot]);

  return (
    <div className={`app${toolbarLabels ? '' : ' icons-only'}`}>
      {renameTarget && (
        <div className="modal-backdrop" onPointerDown={() => setRenameTarget(null)}>
          <div className="rename-dialog" onPointerDown={(event) => event.stopPropagation()}>
            <div className="rename-title">{renameTarget.label}</div>
            <input
              className="rename-input" autoFocus value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void submitRename(); }
                if (event.key === 'Escape') { event.preventDefault(); setRenameTarget(null); }
                event.stopPropagation();
              }}
            />
            <div className="rename-actions">
              <button onClick={() => setRenameTarget(null)}>取消</button>
              <button className="primary" onClick={() => void submitRename()}>确定</button>
            </div>
          </div>
        </div>
      )}
      {/* Tauri 2.12 "deep" makes every non-interactive pixel of the whole bar
          draggable; buttons / inputs / labels automatically block the drag. */}
      <header className="titlebar" data-tauri-drag-region="deep">
        <div className="titlebar-left">
          <button className="menu-btn" title="主菜单"
            onClick={(event) => {
              event.stopPropagation();
              setToolbarPop(null);
              setMenuOpen((open) => !open);
            }}>
            <Icon name="menu" />
          </button>
          <div className="titlebar-title">
            <span className="doc-name" title={snapshot?.path ?? '尚未保存到文件'}>{docName}</span>
            {/* XMind shows an empty subtitle for a clean document, 已编辑 once
                it is dirty, and 保存中... while the write is in flight. */}
            <span className="doc-status">
              {saving ? '保存中...' : snapshot?.dirty ? '已编辑' : ''}
            </span>
          </div>
        </div>

        <div className="toolbar">
          <div className="tool-flex" />

          <div className="tool-group">
            <div className="tool-item">
              <button title="插入同级主题（Enter）" disabled={!selected}
                onClick={() => selected && void run('addSibling', { id: selected })}><Icon name="topic" /></button>
              <span className="tool-label">主题</span>
            </div>
            <div className="tool-item">
              <button title="插入子主题（Tab）" disabled={!selected}
                onClick={() => selected && void run('addChild', { id: selected })}><Icon name="subtopic" /></button>
              <span className="tool-label">子主题</span>
            </div>
            <div className="tool-item">
              <button title="联系（Ctrl Shift R）" disabled={!selected}
                className={linkFrom ? 'on' : ''} onClick={startLink}><Icon name="relation" /></button>
              <span className="tool-label">联系</span>
            </div>
            <div className="tool-item">
              <button title="概要" disabled={!selected}
                onClick={() => addRange('summary')}><Icon name="summary" /></button>
              <span className="tool-label">概要</span>
            </div>
            <div className="tool-item">
              <button title="外框（Ctrl Shift B）" disabled={!selected}
                onClick={() => addRange('boundary')}><Icon name="boundary" /></button>
              <span className="tool-label">外框</span>
            </div>
            <div className={`tool-item${toolbarPop === 'marker' ? ' on' : ''}`}>
              <button title="标记（为选中主题添加标记）" data-tool-pop="marker"
                disabled={!selected}
                onClick={() => toggleToolPop('marker')}><Icon name="marker" /></button>
              <span className="tool-label">标记</span>
              {toolbarPop === 'marker' && (
                <MarkerPop used={usedMarkers} hasTopic={!!selected}
                  initialTab={markerTab}
                  onToggle={addMarker} onPickIcon={(kind, item) => { void insertIconImage(kind, item); }}
                  onClose={() => setToolbarPop(null)} />
              )}
            </div>
            <div className={`tool-item wide${toolbarPop === 'insert' ? ' on' : ''}`}>
              <button title="插入其他元素" data-tool-pop="insert"
                onClick={() => toggleToolPop('insert')}>
                <Icon name="insert" />
              </button>
              <span className="tool-label">插入</span>
              {toolbarPop === 'insert' && (
                <InsertPop hasTopic={!!selected} onPick={pickInsert} />
              )}
            </div>
          </div>

          <div className="tool-flex end" />

          <div className="tool-group">
            <div className={`tool-item${panel === 'format' ? ' on' : ''}`}>
              <button title="显示或隐藏样式及格式设置" onClick={() => togglePanel('format')}>
                <Icon name="format" />
              </button>
              <span className="tool-label">格式</span>
            </div>
          </div>
          <div className="tool-gap" />
        </div>

        <div className="window-controls">
          <button title="最小化" onClick={() => void win.minimize()}><Icon name="min" /></button>
          <button title="最大化" onClick={() => void win.toggleMaximize()}><Icon name="max" /></button>
          <button className="close" title="关闭" onClick={() => void win.close()}><Icon name="close" /></button>
        </div>
      </header>

      {menuOpen && (
        <Menu
          items={buildMainMenu(menuContext)}
          x={12}
          y={46}
          onAction={handleMenuAction}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {contextMenu && (
        <Menu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
      {markerChipPop && (
        <MarkerChipPop
          marker={markerChipPop.marker}
          x={markerChipPop.x}
          y={markerChipPop.y}
          onPick={pickMarkerReplacement}
          onClose={() => setMarkerChipPop(null)}
        />
      )}
      {dialog && (
        <div className="modal-backdrop" onPointerDown={() => setDialog(null)}>
          <div className="info-dialog" onPointerDown={(event) => event.stopPropagation()}>
            <div className="rename-title">{dialog.title}</div>
            <div className="info-lines">
              {dialog.lines.map((line, index) => <div key={index}>{line}</div>)}
            </div>
            <div className="rename-actions"><button className="primary" onClick={() => setDialog(null)}>确定</button></div>
          </div>
        </div>
      )}
      {inputDialog && (
        <div className="modal-backdrop" onPointerDown={() => setInputDialog(null)}>
          <div className="rename-dialog" onPointerDown={(event) => event.stopPropagation()}>
            <div className="rename-title">{inputDialog.title}</div>
            <input
              className="rename-input" autoFocus value={inputDialog.value}
              onChange={(event) => setInputDialog((current) => current ? { ...current, value: event.target.value } : null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); inputDialog.onSubmit(inputDialog.value); setInputDialog(null); }
                if (event.key === 'Escape') { event.preventDefault(); setInputDialog(null); }
                event.stopPropagation();
              }}
            />
            <div className="rename-actions">
              <button onClick={() => setInputDialog(null)}>取消</button>
              <button className="primary" onClick={() => { inputDialog.onSubmit(inputDialog.value); setInputDialog(null); }}>确定</button>
            </div>
          </div>
        </div>
      )}

      <div className="main">
        <div className="left-col">
        <div className="workspace">
          <div className="canvas-wrap">
            {snapshot ? (
              viewMode === 'outline' ? (
                <Suspense fallback={loading}>
                  <OutlineView root={snapshot.document.sheets[activeSheet].root}
                    selected={selected} zoom={outlineScale}
                    onSelect={(id) => onSelect(id)} onAction={run} />
                </Suspense>
              ) : (
                <Suspense fallback={loading}>
                  <MapCanvas ref={canvasRef} layout={snapshot.layout}
                    selected={selected} selectedIds={selectedIds}
                    fitKey={fitKey} onSelect={onSelect} onSelectMany={(ids) => select(null, ids)}
                    onAction={run} onLiveEdit={liveEdit} onContextMenu={openContextMenu}
                    onMarkerClick={openMarkerPop}
                    activeMarker={markerChipPop
                      ? { topicId: markerChipPop.topicId, marker: markerChipPop.marker } : null}
                    selectedImage={selectedImage} onImageSelect={selectImage}
                    onImageContextMenu={openImageContextMenu}
                    onScale={setScale} onViewChange={setCanvasView}
                    onOpenNote={(id) => {
                      const topic = snapshot ? findTopicById(snapshot.document, id) : null;
                      select(id);
                      setToolbarPop(null);
                      setTopicEditor({ kind: 'note', id, draft: topic?.note ?? '' });
                    }}
                    linkPick={linkFrom !== null || hrefFrom !== null} onLinkTarget={onLinkTarget}
                    selectedDecor={selectedDecor} onDecorSelect={setSelectedDecor}
                    onDecorRename={renameDecor}
                    onDecorRange={(kind, id, startId, endId) => {
                      void run('setDecorRange', { kind, id, startId, endId });
                    }} />
                </Suspense>
              )
            ) : <div className="loading">正在准备画布…</div>}
            {topicEditor && editorAnchor && (
              <div className={`topic-inline-editor editor-${topicEditor.kind}`}
                data-kind={topicEditor.kind}
                style={{ left: editorAnchor.left, top: editorAnchor.top }}
                onPointerDown={(event) => event.stopPropagation()}>
                <div className="tie-head">
                  <span className="tie-icon" aria-hidden="true">
                    {topicEditor.kind === 'note' ? '▤' : '🏷'}
                  </span>
                  <span className="tie-title">{topicEditor.kind === 'note' ? '笔记' : '标签'}</span>
                </div>
                {topicEditor.kind === 'note' ? (
                  <>
                    <div className="tie-tools" aria-hidden="true">
                      <span><b>B</b></span><span><i>I</i></span><span><u>U</u></span>
                      <span>≡</span><span>☰</span><span>≡</span>
                    </div>
                    <textarea autoFocus className="tie-input" rows={5}
                      value={topicEditor.draft} placeholder="在此输入笔记…"
                      onChange={(event) => setTopicEditor((current) =>
                        current ? { ...current, draft: event.target.value } : null)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') { event.preventDefault(); setTopicEditor(null); }
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault(); commitTopicEditor();
                        }
                      }} />
                  </>
                ) : (
                  <>
                    <input autoFocus className="tie-input" value={topicEditor.draft}
                      placeholder="多个标签请用半角逗号隔开"
                      onChange={(event) => setTopicEditor((current) =>
                        current ? { ...current, draft: event.target.value } : null)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') { event.preventDefault(); setTopicEditor(null); }
                        if (event.key === 'Enter') { event.preventDefault(); commitTopicEditor(); }
                      }} />
                    <div className="tie-hint">多个标签请用半角逗号隔开</div>
                  </>
                )}
                <div className="tie-actions">
                  <button type="button" onClick={() => setTopicEditor(null)}>取消</button>
                  <button type="button" className="primary" onClick={commitTopicEditor}>确定</button>
                </div>
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
            <Suspense fallback={null}>
              {panel === 'export' && <ExportDialog initialFormat={exportFormat}
                onClose={() => setPanel('none')} notify={notify} />}
            </Suspense>
          </div>
        </div>

        <footer className="statusbar">
          <div className="sb-line">
            <span className="sb-sheet" title="当前画布">
              {snapshot?.document.sheets[activeSheet]?.title || '画布 1'}
            </span>

            <div className="sb-right">
              {busy && <span className="sb-busy">处理中…</span>}

              <button className="sb-btn" title={viewMode === 'outline'
                ? `字数：${charCount}`
                : `当前主题序号 / 主题总数（${topicCount} 个主题）`}>
                {viewMode === 'outline'
                  ? `字数: ${charCount}`
                  : selectedIds.length > 1
                    ? `主题: ${selectedIds.length} / ${topicCount}`
                    : `主题: ${selectedIndex || 1} / ${topicCount}`}
              </button>

              <span className="sb-divider" />

              <button className="sb-btn sb-zoom" title="缩放" onClick={openZoomMenu}>
                <span className="sb-zoom-label">{currentZoom}%</span>
                <svg className="sb-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path d="M4.5 5.668L7.715 2 11 5.668M4.5 10.5l3.215 3.668L11 10.5"
                    stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <span className="sb-divider" />

              <button className="sb-btn" title={viewMode === 'map' ? '切换至大纲模式' : '切换至导图模式'}
                onClick={() => setViewMode(viewMode === 'map' ? 'outline' : 'map')}>
                {viewMode === 'map' ? '大纲' : '思维导图'}
              </button>
            </div>
          </div>
        </footer>

        {zoomMenu && (
          <>
            <div className="zoom-backdrop" onPointerDown={() => setZoomMenu(null)} />
            <div className="zoom-menu" style={{ right: zoomMenu.right, bottom: zoomMenu.bottom }}>
              {zoomOptions.map((value) => (
                <button key={value} className="zoom-item"
                  onClick={() => { applyZoom(value); setZoomMenu(null); }}>
                  <span className="zoom-tick">
                    {value === currentZoom && (
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                        <path d="M3.4 8.4l3 3 6.2-6.6" stroke="currentColor" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {value}%
                </button>
              ))}
              {viewMode === 'map' && (
                <>
                  <div className="zoom-sep" />
                  <button className="zoom-item" onClick={() => { canvasRef.current?.fit(); setZoomMenu(null); }}>
                    <span className="zoom-tick" />适应画布
                  </button>
                </>
              )}
            </div>
          </>
        )}
        </div>

        <Suspense fallback={null}>
          {panel === 'ai' && snapshot && (
            <AiPanel selected={selected} onClose={() => setPanel('none')}
              onSnapshot={(value) => { commit(value); notify('AI 已更新导图'); }} notify={notify} />
          )}
          {panel === 'format' && snapshot && (
            <Inspector snapshot={snapshot} document={snapshot.document} selected={selected}
              requestedTab={panelTab} requestedPop={panelPop}
              summaryActive={summaryActive} summaryTargetId={summaryTargetId}
              summaryFrame={summaryFrames.find((frame) => frame.id === summaryTargetId) ?? null}
              onSummaryStyle={(patch) => void applySummaryStyle(patch)}
              onAction={run} onStructure={(value) => void setStructure(value)}
              onSkeleton={(preset) => void setSkeleton(preset)}
              onWidth={(id, width) => void setWidth(id, width)}
              onCanvas={(patch) => void setCanvas(patch)}
              notify={notify} />
          )}
          {panel === 'attrs' && snapshot && (
            <TopicAttrs key={selected ?? 'none'} snapshot={snapshot} selected={selected}
              onAction={run} onClose={() => setPanel('none')} notify={notify} />
          )}
        </Suspense>
      </div>

    </div>
  );
}
