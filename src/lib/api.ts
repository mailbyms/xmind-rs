import { invoke } from '@tauri-apps/api/core';
import type {
  AiConfig, AiStatus, AppInfo, Layout, ResourceDto, Snapshot,
  Structure, ThemeId, TopicStyle, Side,
} from './types';

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const api = {
  info: () => call<AppInfo>('app_info'),
  log: (message: string) => call<void>('app_log', { message }),
  setTheme: (theme: ThemeId) => call<Snapshot>('app_set_theme', { theme }),
  setActiveSheet: (index: number) => call<Snapshot>('app_set_active_sheet', { index }),
  clearRecent: () => call<Snapshot>('app_clear_recent'),

  newDoc: () => call<Snapshot>('doc_new'),
  restore: () => call<Snapshot | null>('doc_restore'),
  saveRecovery: () => call<void>('doc_save_recovery'),
  open: (path: string) => call<Snapshot>('doc_open', { path }),
  save: (path?: string | null) => call<Snapshot>('doc_save', { path: path ?? null }),
  export: (path: string, format: string) => call<void>('doc_export', { path, format }),
  /** 导出分支为… / 打印分支…: cropped to one branch. */
  exportBranch: (path: string, format: string, id: string) =>
    call<void>('doc_export_branch', { path, format, id }),
  branchSvg: (id: string) => call<string>('doc_branch_svg', { id }),
  /** PNG / PDF bytes are built in the WebView and dropped here as base64. */
  writeBytes: (path: string, base64Data: string) =>
    call<void>('doc_write_bytes', { path, base64Data }),
  layout: () => call<Layout>('doc_layout'),

  addChild: (id: string, title?: string) => call<Snapshot>('doc_add_child', { id, title: title ?? null }),
  addSibling: (id: string, title?: string) => call<Snapshot>('doc_add_sibling', { id, title: title ?? null }),
  addSiblingBefore: (id: string, title?: string) => call<Snapshot>('doc_add_sibling_before', { id, title: title ?? null }),
  insertParent: (id: string, title?: string) => call<Snapshot>('doc_insert_parent', { id, title: title ?? null }),
  addFloating: (x: number, y: number, title: string, callout = false) =>
    call<Snapshot>('doc_add_floating', { x, y, title, callout }),
  duplicate: (id: string) => call<Snapshot>('doc_duplicate', { id }),
  remove: (id: string) => call<Snapshot>('doc_delete', { id }),
  removeSingle: (id: string) => call<Snapshot>('doc_delete_single', { id }),
  indent: (id: string) => call<Snapshot>('doc_indent', { id }),
  outdent: (id: string) => call<Snapshot>('doc_outdent', { id }),
  foldAll: (folded: boolean) => call<Snapshot>('doc_fold_all', { folded }),
  focusBranch: (id: string) => call<Snapshot>('doc_focus_branch', { id }),
  resetPosition: (id: string) => call<Snapshot>('doc_reset_position', { id }),
  sheetFromTopic: (id: string) => call<Snapshot>('doc_add_sheet_from_topic', { id }),
  rename: (id: string, title: string) => call<Snapshot>('doc_rename', { id, title }),
  // Live in-place editing: one call per keystroke, each returning a fresh layout.
  editBegin: (id: string) => call<void>('doc_edit_begin', { id }),
  editText: (id: string, title: string) => call<Snapshot>('doc_edit_text', { id, title }),
  editEnd: (id: string, title: string | null, cancel: boolean) =>
    call<Snapshot>('doc_edit_end', { id, title, cancel }),
  setNote: (id: string, note: string) => call<Snapshot>('doc_set_note', { id, note }),
  setLabels: (id: string, labels: string[]) => call<Snapshot>('doc_set_labels', { id, labels }),
  toggleMarker: (id: string, marker: string) => call<Snapshot>('doc_toggle_marker', { id, marker }),
  setStyle: (id: string, style: TopicStyle) => call<Snapshot>('doc_set_style', { id, style }),
  clearStyle: (id: string) => call<Snapshot>('doc_clear_style', { id }),
  setSide: (id: string, side: Side | null) => call<Snapshot>('doc_set_side', { id, side }),
  setImage: (id: string, resource: string | null) => call<Snapshot>('doc_set_image', { id, resource }),
  toggleFold: (id: string) => call<Snapshot>('doc_toggle_fold', { id }),
  setFold: (id: string, folded: boolean) => call<Snapshot>('doc_set_fold', { id, folded }),
  move: (id: string, newParentId: string, index: number) => call<Snapshot>('doc_move', { id, newParentId, index }),
  /** Drop on empty canvas: x/y are relative to the central topic's centre. */
  moveFree: (id: string, x: number, y: number) => call<Snapshot>('doc_move_free', { id, x, y }),
  /** 联系 / 概要 / 外框: `rangeStart`/`rangeEnd` carry a box-selected run. */
  addDecor: (
    kind: string, id: string, targetId: string | null, title: string,
    range?: { startId: string; endId: string } | null,
  ) => call<Snapshot>('doc_add_decor', {
    kind, id, targetId, title,
    rangeStart: range?.startId ?? null,
    rangeEnd: range?.endId ?? null,
  }),
  removeDecor: (kind: string, id: string) => call<Snapshot>('doc_remove_decor', { kind, id }),
  renameDecor: (kind: string, id: string, title: string) =>
    call<Snapshot>('doc_rename_decor', { kind, id, title }),
  /** Drag one end of a 概要 / 外框 range (both ends stay siblings). */
  setDecorRange: (kind: string, id: string, startId: string, endId: string) =>
    call<Snapshot>('doc_set_decor_range', { kind, id, startId, endId }),
  /** 样式面板 → 概要线型: brace shape / ink / thickness of a native 概要. */
  setSummaryStyle: (id: string, patch: {
    shapeClass?: string; lineColor?: string; lineWidth?: string;
  }) => call<Snapshot>('doc_set_summary_style', {
    id,
    shapeClass: patch.shapeClass ?? null,
    lineColor: patch.lineColor ?? null,
    lineWidth: patch.lineWidth ?? null,
  }),
  setHref: (id: string, href: string | null) => call<Snapshot>('doc_set_href', { id, href }),
  setStructure: (structure: Structure) => call<Snapshot>('doc_set_structure', { structure }),
  applySkeleton: (preset: {
    structure: Structure; central: string; main: string | null;
    shape: string; mainShape: string; line: string; centralLine: string;
    pattern: string; fillPattern: string;
    /** subTopic layer: line class / shape / pattern / width / fill. */
    subLine: string | null; subShape: string | null; subPattern: string | null;
    subWidth: string | null; subFill: string | null;
    mainWidth: string | null; centralWidth: string | null;
    /** `map/properties/line-tapered`. */
    tapered: string | null;
    /** Three depth layers from the original desktop theme (shape / fill / border). */
    layers: { shape: string; filled: boolean; border: number }[];
  }) => call<Snapshot>('doc_apply_skeleton', preset),
  setWidth: (id: string, width: number | null) => call<Snapshot>('doc_set_width', { id, width }),
  setCanvas: (patch: {
    background?: string; fontFamily?: string; lineWidth?: number;
    rainbow?: boolean; compact?: boolean; siblingAlign?: boolean;
    branchColors?: string[] | null; palette?: string | null; centerColor?: string | null;
  }) => call<Snapshot>('doc_set_canvas', {
    background: patch.background ?? null,
    fontFamily: patch.fontFamily ?? null,
    lineWidth: patch.lineWidth ?? null,
    rainbow: patch.rainbow ?? null,
    compact: patch.compact ?? null,
    siblingAlign: patch.siblingAlign ?? null,
    branchColors: patch.branchColors ?? null,
    palette: patch.palette ?? null,
    centerColor: patch.centerColor ?? null,
  }),

  addSheet: () => call<Snapshot>('doc_add_sheet'),
  removeSheet: (index: number) => call<Snapshot>('doc_remove_sheet', { index }),
  renameSheet: (index: number, title: string) => call<Snapshot>('doc_rename_sheet', { index, title }),
  undo: () => call<Snapshot>('doc_undo'),
  redo: () => call<Snapshot>('doc_redo'),

  resourcePut: (data: string, hint: string) => call<ResourceDto>('resource_put', { data, hint }),
  resourceData: (id: string) => call<string | null>('resource_data', { id }),

  aiStatus: () => call<AiStatus>('ai_status'),
  aiConfig: () => call<AiConfig>('ai_get_config'),
  aiSetConfig: (config: AiConfig) => call<AiStatus>('ai_set_config', { config }),
  aiClearConfig: () => call<AiStatus>('ai_clear_config'),
  aiExpand: (topicId: string, instruction: string, count: number) =>
    call<Snapshot>('ai_expand', { topicId, instruction, count }),
  aiChat: (message: string) => call<string>('ai_chat', { message }),
};

export type Action = (cmd: string, args?: Record<string, unknown>) => Promise<Snapshot | null>;
