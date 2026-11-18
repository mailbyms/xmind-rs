export type Side = 'left' | 'right';
/** Phases of an in-place topic edit; every `text` phase re-runs the layout. */
export type LiveEditPhase = 'begin' | 'text' | 'end' | 'cancel';
export type ThemeId = 'classic' | 'dark' | 'ocean' | 'forest';
export type Structure =
  | 'balanced' | 'clockwise' | 'anticlockwise'
  | 'logicRight' | 'logicLeft' | 'treeRight' | 'treeLeft'
  | 'orgDown' | 'orgUp' | 'timeline' | 'timelineHorizontal'
  | 'fishboneRight' | 'fishboneLeft'
  | 'braceRight' | 'braceLeft' | 'treeTable' | 'matrix';

export interface Position { x: number; y: number }

export interface TopicStyle {
  fill?: string | null;
  stroke?: string | null;
  color?: string | null;
  bold?: boolean | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  shapeClass?: string | null;
  lineClass?: string | null;
  lineColor?: string | null;
  lineWidth?: string | null;
  styleId?: string | null;
  italic?: boolean | null;
  strike?: boolean | null;
  align?: string | null;
  textCase?: string | null;
  fillPattern?: string | null;
  borderWidth?: string | null;
  borderPattern?: string | null;
  arrowEnd?: string | null;
  linePattern?: string | null;
  lineTapered?: boolean | null;
  opacity?: number | null;
  [key: string]: unknown;
}

export interface Topic {
  id: string;
  title: string;
  note?: string;
  folded: boolean;
  children: Topic[];
  detached?: Topic[];
  summary?: Topic[];
  callout?: Topic[];
  markers?: string[];
  labels?: string[];
  image?: string | null;
  style?: TopicStyle | null;
  side?: Side | null;
  structureClass?: string | null;
  href?: string | null;
  position?: Position | null;
  titleUnedited: boolean;
  customWidth?: number | null;
  [key: string]: unknown;
}

export interface Sheet {
  id: string;
  title: string;
  root: Topic;
  structure: Structure;
  [key: string]: unknown;
}

export interface Document {
  title: string;
  theme: ThemeId;
  activeSheet: number;
  sheets: Sheet[];
  /** Canvas-tab settings, all optional in the file format. */
  background?: string | null;
  fontFamily?: string | null;
  lineWidth?: number | null;
  rainbow?: boolean;
  compact?: boolean;
  /** 同级主题对齐: every topic of a level shares the widest width. */
  siblingAlign?: boolean;
  /** 分支配色: explicit branch colour cycle. */
  branchColors?: string[] | null;
  /** 配色方案 id (see `src/inspector/palettes.ts`), drives the panel's label. */
  palette?: string | null;
  /** Central-topic fill supplied by the active 配色方案. */
  centerColor?: string | null;
  /** Which of the six quick themes below the drop-down is active (0..5). */
  paletteVariant?: number | null;
  [key: string]: unknown;
}

export interface ThemePalette {
  bg: string;
  panel: string;
  border: string;
  grid: string;
  text: string;
  muted: string;
  primary: string;
  branches: string[];
  edge: string;
  center: string;
  /** Parsed `sheet.theme` layers, when the opened file carries its own theme. */
  sheetTheme?: unknown;
}

export interface EffectiveStyle {
  fill: string;
  stroke: string;
  color: string;
  fontWeight: number;
  fontSize: number;
  fontFamily: string | null;
  radius: number;
  underline: boolean;
  lineColor: string;
  lineWidth: number;
  italic: boolean;
  strike: boolean;
  align: string;
  textCase: string | null;
  shape: string;
  fillPattern: string;
  strokeWidth: number;
  strokePattern: string;
  opacity: number;
  lineClass: string;
  linePattern: string;
  arrowEnd: string;
  lineTapered: boolean;
  /** Ink and thickness of the underline shapes' CSS border-bottom. */
  underlineColor: string;
  underlineWidth: number;
}

export interface LaidOutNode {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Wrapped text lines; the in-place editor uses this as its `rows` count. */
  lines: number;
  depth: number;
  side: Side;
  branch: number;
  hasChildren: boolean;
  folded: boolean;
  hiddenCount: number;
  style: EffectiveStyle;
  shapePath: string;
  shapeClosed: boolean;
  markers: string[];
  /** Width reserved for the in-box marker row, in topic-local px. */
  markerWidth: number;
  /** Native marker icon size (36px for official themes, 30px for unresolved ones). */
  markerSize: number;
  /** Content inset on each side when the topic carries markers (FINDINGS §48). */
  markerPad: number;
  labels: string[];
  image: string | null;
  /** Intrinsic artwork size; XMind draws image topics as cards with the
   * artwork above the label instead of a small inline icon. */
  imageWidth: number;
  imageHeight: number;
  parentId: string | null;
  /** Position among the parent's children, in document order (0 for the root). */
  childIndex: number;
  note: string;
  href: string | null;
  titleUnedited: boolean;
  /** Extra horizontal padding (table cells). */
  pad: number;
  /** Half of the topic's horizontal padding; XMind puts it on both sides of
   * the label so left-aligned text never touches the shape's left edge. */
  textPad: number;
  /** Table cell / matrix banner: drawn without a shape. */
  cell: boolean;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  path: string;
  color: string;
  width: number;
  tapered: boolean;
  dash: string | null;
  arrow: string;
}

/** Braces (括号图) and table rules (树型表格 / 矩阵图) drawn under the topics. */
export interface Decor {
  path: string;
  color: string;
  width: number;
  dash: string | null;
}

/** 联系线 / 外框 / 概要选中态（与主题选中互斥）。 */
export interface DecorSelection {
  kind: 'relation' | 'boundary' | 'summary';
  id: string;
}

/** 联系: a curved line between two topics. */
export interface Link {
  id: string;
  from: string;
  to: string;
  title: string;
  path: string;
  color: string;
  /** theme.relationship.line-width, px */
  width?: number;
  /** theme.relationship.line-pattern: dash */
  dash?: string | null;
  /** false when arrow-end-class is none */
  arrow?: boolean;
  labelX: number;
  labelY: number;
}

/** 外框 / 概要: a shape around a range of sibling topics. */
export interface Frame {
  id: string;
  kind: 'boundary' | 'summary';
  title: string;
  path: string;
  color: string;
  /** 概要线型 stroke width in px. */
  width?: number;
  labelX: number;
  labelY: number;
  /** Parent of the wrapped siblings (`null` when the range hangs off the root). */
  parentId: string | null;
  /** Inclusive sibling range; the two ends carry the resize handles. */
  startId: string;
  endId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: Edge[];
  decor: Decor[];
  links: Link[];
  frames: Frame[];
  width: number;
  height: number;
  theme: ThemePalette;
  structure: Structure;
}

export interface DocStats {
  topics: number;
  depth: number;
  branches: number;
  sheets: number;
}

export interface Snapshot {
  document: Document;
  layout: Layout;
  dirty: boolean;
  path: string | null;
  canUndo: boolean;
  canRedo: boolean;
  stats: DocStats;
  recent: string[];
  structure: Structure;
  theme: ThemeId;
}

export interface StructureInfo { id: Structure; label: string }

export interface AppInfo {
  version: string;
  dataDir: string;
  startupFile?: string | null;
  theme: ThemeId;
  recent: string[];
  structures: StructureInfo[];
}

export interface AiStatus {
  provider: string;
  model: string;
  ready: boolean;
  configured: boolean;
  baseUrl: string;
  keyHint: string;
  offlineDemo: boolean;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  enabled: boolean;
}

export interface ResourceDto {
  id: string;
  mime: string;
  size: number;
  dataUrl: string;
}
