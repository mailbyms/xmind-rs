import { useEffect, useState } from 'react';
import type { Action } from '../lib/api';
import type { Document, Frame, Snapshot, Structure, Topic, TopicStyle } from '../lib/types';
import { ColorPicker, Menu, Popover, TileGrid } from './Popover';
import type { Anchor } from './Popover';
import {
  ARROW_TILES, BORDER_TILES, CASE_ITEMS, FILL_TILES, FONT_FAMILIES, FONT_SIZES,
  BRANCH_PALETTES, LINE_TILES, SHAPE_TILES, SKELETON_ICONS, SKELETON_TILES, WEIGHTS,
  WIDTH_LABELS, WIDTH_STEPS,
} from './tiles';
import { ALL_SKELETONS, SKELETON_GROUPS } from './skeletons';
import type { SkeletonPreset } from './skeletons';
import {
  PALETTE_TABS, paletteBranches, paletteById, paletteByColors, paletteCenter,
  paletteVariants,
} from './palettes';
import type { PaletteDef, PaletteVariant } from './palettes';

/** Depth-first lookup that also covers detached, summary and callout children. */
function findTopic(root: Topic, id: string): Topic | null {
  if (root.id === id) return root;
  for (const list of [root.children, root.detached, root.summary, root.callout]) {
    for (const child of list ?? []) {
      const found = findTopic(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** The 概要 line style lives on the parent's native `summaries[]` entry. */
function findSummaryProps(root: Topic, id: string): Record<string, string> {
  const walk = (topic: Topic): Record<string, string> | null => {
    const list = (topic as Record<string, unknown>).__extra as
      { summaries?: Array<{ topicId?: string; style?: { properties?: Record<string, string> } }> } | undefined;
    const hit = list?.summaries?.find((entry) => entry.topicId === id);
    if (hit) return hit.style?.properties ?? {};
    for (const group of [topic.children, topic.detached, topic.summary, topic.callout]) {
      for (const child of group ?? []) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root) ?? {};
}

interface Props {
  document: Document;
  snapshot: Snapshot;
  selected: string | null;
  /** 查看 > 格式面板 and 骨架 / 配色方案 jump straight to a tab / popover. */
  requestedTab?: Tab | null;
  requestedPop?: string | null;
  /** A 概要 was inserted or selected: show 概要线型 / 概要主题 in 样式. */
  summaryActive?: boolean;
  summaryTargetId?: string | null;
  summaryFrame?: Frame | null;
  onSummaryStyle?: (patch: {
    shapeClass?: string; lineColor?: string; lineWidth?: string;
  }) => void;
  onAction: Action;
  onStructure: (structure: Structure) => void;
  onSkeleton: (preset: SkeletonPreset) => void;
  onWidth: (id: string, width: number | null) => void;
  onCanvas: (patch: {
    background?: string; fontFamily?: string; lineWidth?: number; rainbow?: boolean;
    compact?: boolean; siblingAlign?: boolean;     branchColors?: string[] | null;
    palette?: string | null; centerColor?: string | null;
    paletteVariant?: number | null;
  }) => void;
  notify: (message: string) => void;
}

/** 侧面板只保留「样式 / 画布」；演说模式已整体移除。 */
type Tab = 'style' | 'canvas';

const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: '样式' },
  { id: 'canvas', label: '画布' },
];

/** The shipped panel's new-map default scheme; also the fallback when a file
 *  carries no `palette` id.  Its six quick themes are what the strip shows. */
const DEFAULT_SCHEME = () => paletteById('vivid-rainbow') ?? PALETTE_TABS[0].groups[0];

/* ------------------------------------------------------------------ glyphs */
const G = {
  chevron: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
      <path d="M3.5 6l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  caret: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
      <path d="M4.5 5.668L7.715 2 11 5.668M4.5 10.5l3.215 3.668L11 10.5"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevDown: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
      <path d="M5 6l3.215 3.668L11.5 6" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fill: (
    <svg viewBox="0 0 18 22" width="18" height="22" fill="none">
      <rect x="1" y="6" width="16" height="9" rx="1.5" fill="currentColor" />
    </svg>
  ),
  alignLeft: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <rect x="1" y="4.2" width="14" height="1.1" rx=".5" />
      <rect x="1" y="7.5" width="9" height="1.1" rx=".5" />
      <rect x="1" y="10.8" width="14" height="1.1" rx=".5" />
    </svg>
  ),
  alignCenter: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <rect x="1" y="4.2" width="14" height="1.1" rx=".5" />
      <rect x="3.5" y="7.5" width="9" height="1.1" rx=".5" />
      <rect x="1" y="10.8" width="14" height="1.1" rx=".5" />
    </svg>
  ),
  alignRight: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <rect x="1" y="4.2" width="14" height="1.1" rx=".5" />
      <rect x="6" y="7.5" width="9" height="1.1" rx=".5" />
      <rect x="1" y="10.8" width="14" height="1.1" rx=".5" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ layout */

function Collapse({ title, right, children, defaultOpen = true }: {
  title: string; right?: React.ReactNode; children?: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className={`fp-head${open ? ' open' : ''}${right ? ' has-ctl' : ''}`}>
        <span className="fp-chev" onClick={() => setOpen(!open)}>{G.chevron}</span>
        <span className="fp-title" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>{title}</span>
        <span className="fp-head-spacer" />
        {right}
      </div>
      {open && children ? <div className="fp-content">{children}</div> : null}
    </div>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className={`fp-row${label ? '' : ' bare'}`}>
      {label ? <span className="fp-row-label">{label}</span> : null}
      <div className="fp-fields">{children}</div>
    </div>
  );
}

/** Editable commit-on-blur number field with the shipped PX suffix. */
function NumberField({ value, onCommit, disabled }: {
  value: number | string; onCommit: (value: string) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <span className="fp-measure">
      <input className="fp-input" value={draft} disabled={disabled} inputMode="numeric"
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        onBlur={() => { if (draft !== String(value)) onCommit(draft); }}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
      <span className="fp-unit">PX</span>
    </span>
  );
}

/* ------------------------------------------------------------------ panel */

type PopKind =
  | 'shape' | 'fill' | 'fillColor' | 'border' | 'borderWidth' | 'borderColor'
  | 'font' | 'size' | 'weight' | 'case' | 'textColor' | 'align'
  | 'structure' | 'skeleton' | 'lineShape' | 'lineStyle' | 'arrow' | 'branchWidth'
  | 'branchPalette'
  | 'branches' | 'theme' | 'background' | 'canvasFont' | 'canvasLine'
  | 'summaryColor';

interface PopState { kind: PopKind; anchor: Anchor }

/** Popovers that act on the selected topic (the rest are canvas settings). */
const TOPIC_POPS = new Set<PopKind>([
  'shape', 'fill', 'fillColor', 'border', 'borderWidth', 'borderColor',
  'font', 'size', 'weight', 'case', 'textColor', 'align',
  'lineShape', 'lineStyle', 'arrow', 'branchWidth',
]);

export default function Inspector({
  snapshot, selected, onAction, onStructure, onSkeleton, onWidth, onCanvas,
  notify, requestedTab, requestedPop,
  summaryActive = false, summaryTargetId = null, summaryFrame = null, onSummaryStyle,
}: Props) {
  const [tab, setTab] = useState<Tab>('style');
  const [pop, setPop] = useState<PopState | null>(null);
  /** Which capsule tab the 配色方案 board shows (缤纷 / 经典). */
  const [paletteTab, setPaletteTab] = useState<'vivid' | 'classic'>('vivid');

  // A 查看 menu row behaves like clicking the tab / the board toggle itself.
  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
    if (requestedPop) {
      const panel = document.querySelector('.fp')?.getBoundingClientRect();
      const anchor = {
        left: (panel?.left ?? 1000) + 20,
        right: (panel?.left ?? 1000) + 210,
        top: (panel?.top ?? 100) + 210,
        bottom: (panel?.top ?? 100) + 242,
      };
      setPop({ kind: requestedPop as PopKind, anchor });
    } else setPop(null);
  }, [requestedTab, requestedPop]);
  const doc = snapshot.document;
  const sheet = doc.sheets[doc.activeSheet];
  /** While a 概要 is selected every style control targets the 概要 topic, not
   *  whichever branch topic happened to be selected before it. */
  const styleTargetId = summaryActive ? (summaryTargetId ?? selected) : selected;
  const node = snapshot.layout.nodes.find((n) => n.id === styleTargetId) ?? null;
  const topic = styleTargetId ? findTopic(sheet.root, styleTargetId) : null;
  const summaryProps = summaryTargetId ? findSummaryProps(sheet.root, summaryTargetId) : {};
  const summaryShape = summaryProps['shape-class'] ?? 'org.xmind.summaryShape.curly';
  const summaryWidth = summaryProps['line-width'] ?? '1.35pt';
  const summaryColor = summaryFrame?.color ?? summaryProps['line-color'] ?? '#0D0D0D';
  const patchStyle = topic?.style ?? {};
  const style = node?.style;
  const locked = !node;
  const activePalette = paletteById(doc.palette) ?? paletteByColors(doc.branchColors ?? null);
  /** The six cards are owned by the scheme in the drop-down, not a fixed list
   *  of unrelated palettes (FINDINGS §39): switching the scheme re-renders
   *  all six, and card 0 is the scheme's own multi-colour theme. */
  const scheme = activePalette ?? DEFAULT_SCHEME();
  const variants = paletteVariants(scheme);
  const activeVariant = Math.min(5, Math.max(0, doc.paletteVariant ?? 0));

  /** Apply a 配色方案: its last swatch paints the centre, the rest cycle over
   *  the main branches.  The shipped board stays open, exactly like the
   *  skeleton library, so people can keep comparing swatches. */
  const applyPalette = (entry: PaletteDef) => {
    onCanvas({
      palette: entry.id,
      centerColor: paletteCenter(entry),
      branchColors: paletteBranches(entry),
      rainbow: true,
      paletteVariant: 0,
    });
  };

  /** Card 0 restores the scheme itself; cards 1..5 are its single-accent
   *  quick themes.  The drop-down keeps showing the scheme name. */
  const applyVariant = (index: number) => {
    if (!scheme) return;
    if (index === 0) { applyPalette(scheme); return; }
    const variant: PaletteVariant | undefined = variants[index];
    if (!variant) return;
    onCanvas({
      palette: scheme.id,
      paletteVariant: index,
      centerColor: variant.center,
      branchColors: variant.branches,
      background: variant.bg,
      rainbow: true,
    });
  };

  const patch = (style2: TopicStyle) => {
    if (!styleTargetId) { notify('请先选中一个主题'); return; }
    void onAction('setStyle', { id: styleTargetId, style: style2 });
  };

  /** Open a popover anchored on the control that was clicked. Canvas-level
   *  popovers (background, theme, skeleton, line width) work without a
   *  selection; topic-level ones need one, exactly like the shipped panel. */
  const open = (kind: PopKind) => (event: React.MouseEvent<HTMLElement>) => {
    if (locked && TOPIC_POPS.has(kind)) { notify('请先选中一个主题'); return; }
    if (kind === 'theme') setPaletteTab(activePalette?.id.startsWith('classic') ? 'classic' : 'vivid');
    const rect = event.currentTarget.getBoundingClientRect();
    setPop({ kind, anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } });
  };
  const close = () => setPop(null);

  const pick = (fn: () => void) => () => { fn(); setPop(null); };

  /* ----- derived values -----
     Toggles read the *effective* style so the header artwork matches what the
     canvas draws, and fall back to the raw patch when nothing resolves. */
  const shapeValue = style?.shape
    ? `org.xmind.topicShape.${style.shape}`
    : String(patchStyle.shapeClass ?? 'org.xmind.topicShape.roundedRect');
  const fillPattern = style?.fillPattern ?? 'solid';
  const fillColor = style?.fill ?? '#ffffff';
  const borderPattern = style?.strokePattern ?? String(patchStyle.borderPattern ?? 'none');
  const borderWidthValue = String(patchStyle.borderWidth ?? '1pt');
  const borderColor = style?.stroke && style.stroke !== 'none' ? style.stroke : '#EF6C70';
  const textColor = style?.color ?? '#0d0d0d';
  const fontFamily = String(patchStyle.fontFamily ?? 'Roboto');
  const fontSize = Number(style?.fontSize ?? 14);
  const bold = (style?.fontWeight ?? 400) >= 600;
  const italic = Boolean(style?.italic);
  const strike = Boolean(style?.strike);
  const align = String(style?.align ?? 'center');
  const textCase = String(style?.textCase ?? patchStyle.textCase ?? 'none');
  const weightValue = (() => {
    const weight = style?.fontWeight ?? 400;
    const key = weight >= 900 ? 'black' : weight >= 700 ? 'bold' : weight >= 600 ? 'bold'
      : weight === 500 || weight === 600 ? 'medium' : weight === 300 ? 'light' : weight <= 100 ? 'thin' : 'regular';
    return `${key}${italic ? '-italic' : ''}`;
  })();
  const weightLabel = WEIGHTS.find((w) => w.value === weightValue)?.label ?? 'Regular';
  const lineClassValue = style?.lineClass
    ? `org.xmind.branchConnection.${style.lineClass}`
    : String(patchStyle.lineClass ?? 'org.xmind.branchConnection.curve');
  const arrowValue = style?.arrowEnd
    ? `org.xmind.arrowShape.${style.arrowEnd}`
    : String(patchStyle.arrowEnd ?? 'none');
  const lineTapered = Boolean(patchStyle.lineTapered);
  const lineWidthValue = String(patchStyle.lineWidth ?? '2pt');
  const widthPx = node ? Math.round(topic?.customWidth ?? node.width) : 0;

  const structureFamily = sheet.structure;
  const layouts: { value: Structure; label: string }[] = (() => {
    switch (structureFamily) {
      case 'logicRight': case 'logicLeft': return [
        { value: 'logicRight', label: '向右' }, { value: 'logicLeft', label: '向左' },
      ];
      case 'treeRight': case 'treeLeft': return [
        { value: 'treeRight', label: '向右' }, { value: 'treeLeft', label: '向左' },
      ];
      case 'orgDown': case 'orgUp': return [
        { value: 'orgDown', label: '向下' }, { value: 'orgUp', label: '向上' },
      ];
      case 'fishboneRight': case 'fishboneLeft': return [
        { value: 'fishboneRight', label: '向右' }, { value: 'fishboneLeft', label: '向左' },
      ];
      case 'braceRight': case 'braceLeft': return [
        { value: 'braceRight', label: '向右' }, { value: 'braceLeft', label: '向左' },
      ];
      case 'treeTable': return [{ value: 'treeTable', label: '树型表格' }];
      case 'matrix': return [{ value: 'matrix', label: '矩阵图' }];
      default: return [
        { value: 'balanced', label: '不平衡' },
        { value: 'clockwise', label: '顺时针' },
        { value: 'anticlockwise', label: '逆时针' },
      ];
    }
  })();
  const layoutLabel = layouts.find((l) => l.value === structureFamily)?.label
    ?? (structureFamily === 'clockwise' ? '顺时针' : '不平衡');

  const skeletonValue = (() => {
    switch (structureFamily) {
      case 'logicRight': case 'logicLeft': return 'logicRight';
      case 'treeRight': case 'treeLeft': return 'treeRight';
      case 'orgDown': case 'orgUp': return 'orgDown';
      case 'timeline': return 'timeline';
      case 'fishboneRight': case 'fishboneLeft': return 'fishboneRight';
      case 'braceRight': case 'braceLeft': return 'braceRight';
      case 'treeTable': return 'treetable';
      case 'matrix': return 'matrix';
      default: return 'clockwise';
    }
  })();

  /** Which library card the sheet currently matches: same structure, then the
   *  same central-topic shape and branch line — the three things a 骨架 preset
   *  actually changes. */
  const activeSkeleton = (() => {
    const rootShape = sheet.root.style?.shapeClass?.split('.').pop();
    const rootLine = sheet.root.style?.lineClass?.split('.').pop();
    const branch = sheet.root.children[0]?.style;
    const line = branch?.lineClass?.split('.').pop();
    // The three map flavours share one group in the library.
    const family = (s: Structure) => ((s === 'balanced' || s === 'anticlockwise') ? 'clockwise' : s);
    const pool = ALL_SKELETONS.filter((p) => family(p.structure) === family(structureFamily));
    return pool.find((p) => p.shape === rootShape && p.centralLine === rootLine && p.line === line)
      ?? pool.find((p) => p.shape === rootShape && p.line === line)
      ?? pool.find((p) => p.shape === rootShape)
      ?? pool[0];
  })();

  const branchWidthIndex = Math.min(4, Math.max(0, Math.round((Number(String(lineWidthValue).replace(/[^0-9.]/g, '')) || 2) - 1)));
  const branchWidthLabel = `${WIDTH_LABELS[branchWidthIndex]}${lineTapered ? ' - 线条渐细' : ''}`;
  const borderWidthIndex = Math.min(4, Math.max(0, Math.round((Number(String(borderWidthValue).replace(/[^0-9.]/g, '')) || 1) - 1)));
  /** Silhouette drawn inside the 骨架 card (see `.fp-bone-art`). */
  const boneArt = (SKELETON_TILES.find((t) => t.value === skeletonValue)
    ?? SKELETON_TILES[0]).src;

  /* ----- canvas tab ----- */
  const bgColor = snapshot.layout.theme.bg;
  const canvasFont = doc.fontFamily ?? '默认';
  const canvasLine = doc.lineWidth ? `${doc.lineWidth}px` : '默认';
  const rainbow = doc.rainbow;
  const compact = Boolean(doc.compact);
  const siblingAlign = doc.siblingAlign !== false;
  /** 自动平衡布局: the three map flavours are the "balanced" family. */
  const balanced = ['balanced', 'clockwise', 'anticlockwise'].includes(structureFamily);
  const branchColors = snapshot.layout.theme.branches;
  const branchDial = `conic-gradient(${Array.from({ length: 6 }, (_, i) => {
    const color = branchColors[i % Math.max(1, branchColors.length)] ?? '#F9423A';
    return `${color} ${i * 60}deg ${(i + 1) * 60}deg`;
  }).join(',')})`;

  const activeIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <aside className="fp">
      <ul className="fp-tabs">
        {TABS.map((item, index) => {
          const on = item.id === tab;
          const bar = index > 0 && !on && activeIndex !== index - 1;
          return (
            <li key={item.id} className={bar ? 'bar' : ''}>
              <button className={on ? 'on' : ''} onClick={() => { setTab(item.id); close(); }}>
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
      <hr className="fp-rule tight" />

      <div className="fp-scroll">
        {tab === 'style' ? (
          <>
            {/* XMind replaces the top of the 样式 tab with 概要线型 / 概要主题
                whenever a 概要 is inserted or one of its braces is selected. */}
            {summaryActive ? (
              <>
                <div className="fp-section">
                  <Collapse title="概要线型" right={
                    <button className="fp-select w-sm" title="切换概要括号形状"
                      onClick={() => onSummaryStyle?.({ shapeClass: summaryShape.endsWith('curly')
                        ? 'org.xmind.summaryShape.square'
                        : 'org.xmind.summaryShape.curly' })}>
                      {summaryShape.endsWith('curly') ? '花括号' : '方括号'}
                      <span className="fp-caret">{G.chevDown}</span>
                    </button>
                  }>
                    <Row label="形状">
                      <ul className="fp-seg">
                        {[['curly', '花括号'], ['square', '方括号']].map(([value, label]) => (
                          <li key={value}>
                            <button className={summaryShape.endsWith(value) ? 'on' : ''}
                              onClick={() => onSummaryStyle?.({
                                shapeClass: `org.xmind.summaryShape.${value}`,
                              })}>{label}</button>
                          </li>
                        ))}
                      </ul>
                    </Row>
                    <Row label="颜色">
                      <button className="fp-well" style={{ background: summaryColor }}
                        onClick={open('summaryColor')} title="点击选择概要线颜色。" />
                    </Row>
                    <Row label="粗细">
                      <ul className="fp-seg">
                        {[['1.35pt', '细'], ['3pt', '中'], ['5pt', '粗']].map(([value, label]) => (
                          <li key={value}>
                            <button className={summaryWidth === value ? 'on' : ''}
                              onClick={() => onSummaryStyle?.({ lineWidth: value })}>{label}</button>
                          </li>
                        ))}
                      </ul>
                    </Row>
                  </Collapse>
                </div>

                <hr className="fp-divider" />

                <div className="fp-section">
                  <Collapse title="概要主题" right={
                    <button className="fp-toggle" onClick={open('shape')} title="设置概要主题形状。">
                      <img className="fp-toggle-art" src={SHAPE_TILES.find((t) => t.value === shapeValue)?.src
                        ?? SHAPE_TILES[0].src} alt="" draggable={false} />
                      <span className="fp-caret">{G.chevDown}</span>
                    </button>
                  }>
                    <Row label="填充">
                      <button className="fp-ctl w-md" onClick={open('fill')} title="选择填充样式。">
                        <span className="fp-pattern" style={{
                          background: fillColor === 'none' ? '#d0d0d0' : fillColor,
                          WebkitMaskImage: `url(${FILL_TILES.find((t) => t.value === fillPattern)?.src
                            ?? FILL_TILES[0].src})`,
                          maskImage: `url(${FILL_TILES.find((t) => t.value === fillPattern)?.src
                            ?? FILL_TILES[0].src})`,
                        }} />
                        <span className="fp-caret">{G.chevDown}</span>
                      </button>
                      <button className="fp-well" style={{ background: fillColor }}
                        onClick={open('fillColor')} title="点击选择颜色。" />
                    </Row>
                    <Row label="宽度">
                      <NumberField value={widthPx} disabled={locked}
                        onCommit={(value) => { if (styleTargetId) onWidth(styleTargetId, Number(value) || null); }} />
                      <button className="fp-select w-sm" disabled={locked || !topic?.customWidth}
                        onClick={() => { if (styleTargetId) onWidth(styleTargetId, null); }}
                        title="自动根据文本适应主题的宽度。">适合</button>
                    </Row>
                  </Collapse>
                </div>

                <hr className="fp-divider" />
              </>
            ) : null}

            <div className="fp-section">
              {/* XMind's 概要 panel has no 形状 / 结构 groups: the shape is on
                  the 概要主题 header and a brace has no layout of its own. */}
              {!summaryActive && <>
              <Collapse title="形状" right={
                <button className="fp-toggle" onClick={open('shape')} title="设置主题形状。">
                  <img className="fp-toggle-art" src={SHAPE_TILES.find((t) => t.value === shapeValue)?.src
                    ?? SHAPE_TILES[0].src} alt="" draggable={false} />
                  <span className="fp-caret">{G.chevDown}</span>
                </button>
              }>
                <Row label="填充">
                  <button className="fp-ctl w-md" onClick={open('fill')} title="选择填充样式。">
                    <span className="fp-pattern" style={{
                      background: fillColor === 'none' ? '#d0d0d0' : fillColor,
                      WebkitMaskImage: `url(${FILL_TILES.find((t) => t.value === fillPattern)?.src
                        ?? FILL_TILES[0].src})`,
                      maskImage: `url(${FILL_TILES.find((t) => t.value === fillPattern)?.src
                        ?? FILL_TILES[0].src})`,
                    }} />
                    <span className="fp-caret">{G.chevDown}</span>
                  </button>
                  <button className="fp-well" style={{ background: fillColor }}
                    onClick={open('fillColor')} title="点击选择颜色。" />
                </Row>
                <Row label="宽度">
                  <NumberField value={widthPx} disabled={locked}
                    onCommit={(value) => { if (styleTargetId) onWidth(styleTargetId, Number(value) || null); }} />
                  <button className="fp-select w-sm" disabled={locked || !topic?.customWidth}
                    onClick={() => { if (styleTargetId) onWidth(styleTargetId, null); }}
                    title="自动根据文本适应主题的宽度。">适合</button>
                </Row>
              </Collapse>

              <hr className="fp-divider" />
              </>}

              <Collapse title="边框" right={
                <button className="fp-toggle" onClick={open('border')} title="选择边框样式。">
                  <img className="fp-toggle-art" src={
                    BORDER_TILES.find((t) => t.value === borderPattern)?.src ?? BORDER_TILES[0].src
                  } alt="" draggable={false} />
                  <span className="fp-caret">{G.chevDown}</span>
                </button>
              }>
                <Row>
                  <button className="fp-select w-lg" onClick={open('borderWidth')} disabled={locked}
                    title="设置边框粗细。">
                    {WIDTH_LABELS[borderWidthIndex]}
                    <span className="fp-caret">{G.caret}</span>
                  </button>
                  <button className="fp-well" style={{ background: borderColor }}
                    onClick={open('borderColor')} title="点击选择颜色。" />
                </Row>
              </Collapse>
            </div>

            <hr className="fp-rule" />

            <div className="fp-section">
              <Collapse title="文本">
                <Row>
                  <button className="fp-select w-lg" disabled={locked} onClick={open('font')}
                    title="设置字体属性。">
                    {fontFamily}
                    <span className="fp-caret">{G.caret}</span>
                  </button>
                  <span className="fp-combo">
                    <input className="fp-input" value={String(fontSize)} disabled={locked}
                      onChange={(event) => {
                        const next = Number(event.target.value.replace(/[^0-9]/g, ''));
                        if (next >= 6 && next <= 200) patch({ fontSize: next });
                      }} />
                    <button className="fp-combo-btn" onClick={open('size')} disabled={locked}
                      title="设置字体大小。">
                      {G.caret}
                    </button>
                  </span>
                </Row>
                <Row>
                  <button className="fp-select w-lg" disabled={locked} onClick={open('weight')}
                    title="选择字体样式。">
                    {weightLabel}
                    <span className="fp-caret">{G.caret}</span>
                  </button>
                  <button className="fp-well" style={{ background: textColor }}
                    onClick={open('textColor')} title="点击选择颜色。" />
                </Row>
                <div className="fp-seg-row">
                  <ul className="fp-seg">
                    <li><button className={bold ? 'on' : ''} disabled={locked} title="给文本加粗。"
                      onClick={() => patch({ bold: !bold })}>
                      <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>B</span>
                    </button></li>
                    <li><button className={italic ? 'on' : ''} disabled={locked} title="给文本加斜体。"
                      onClick={() => patch({ italic: !italic })}>
                      <span style={{ fontStyle: 'italic', fontSize: 14, lineHeight: 1 }}>I</span>
                    </button></li>
                    <li><button className={strike ? 'on' : ''} disabled={locked} title="给文本加删除线。"
                      onClick={() => patch({ strike: !strike })}>
                      <span style={{ textDecoration: 'line-through', fontSize: 14, lineHeight: 1 }}>S</span>
                    </button></li>
                    <li><button disabled={locked} title="设置文字大小写。" onClick={open('case')}>
                      <span className={textCase !== 'none' ? 'fp-aa on' : 'fp-aa'}>Aa</span>
                      <span className="fp-caret">{G.chevDown}</span>
                    </button></li>
                  </ul>
                </div>
                <div className="fp-seg-row last">
                  <ul className="fp-seg">
                    <li><button className={align === 'left' ? 'on' : ''} disabled={locked}
                      title="文字左对齐。" onClick={() => patch({ align: 'left' })}>{G.alignLeft}</button></li>
                    <li><button className={align === 'center' ? 'on' : ''} disabled={locked}
                      title="文本居中。" onClick={() => patch({ align: 'center' })}>{G.alignCenter}</button></li>
                    <li><button className={align === 'right' ? 'on' : ''} disabled={locked}
                      title="文字右对齐。" onClick={() => patch({ align: 'right' })}>{G.alignRight}</button></li>
                  </ul>
                </div>
              </Collapse>
            </div>

            <hr className="fp-rule" />

            {!summaryActive && <div className="fp-section">
              <Collapse title="结构" right={
                <button className="fp-toggle" onClick={open('skeleton')} title="设置主题结构。">
                  <img className="fp-struct-glyph" alt="" draggable={false}
                    src={SKELETON_ICONS[skeletonValue] ?? SKELETON_ICONS.clockwise} />
                  <span className="fp-caret">{G.chevDown}</span>
                </button>
              }>
                <button className="fp-select w-full" onClick={open('structure')}
                  title="设置结构布局。">
                  {layoutLabel}
                  <span className="fp-caret">{G.caret}</span>
                </button>
              </Collapse>
            </div>}

            <hr className="fp-rule" />

            <div className="fp-section">
              <Collapse title="分支" right={
                <button className="fp-toggle" onClick={open('lineShape')} title="选择分支线形状。">
                  <img className="fp-toggle-art" src={
                    LINE_TILES.find((t) => t.value === lineClassValue)?.src ?? LINE_TILES[3].src
                  } alt="" draggable={false} />
                  <span className="fp-caret">{G.chevDown}</span>
                </button>
              }>
                <div className="fp-row">
                  <div className="fp-fields fp-split-fields">
                    <div className="fp-stack" style={{ width: 153 }}>
                      <span className="fp-label-sm">线条</span>
                      <button className="fp-select w-lg" disabled={locked} onClick={open('lineStyle')}
                        title="选择分支线样式。">
                        {LINE_TILES.find((t) => t.value === lineClassValue)?.label ?? '曲线'}
                        <span className="fp-caret">{G.caret}</span>
                      </button>
                    </div>
                    <div className="fp-stack" style={{ width: 65 }}>
                      <span className="fp-label-sm">终点</span>
                      <button className="fp-ctl w-sm" disabled={locked} onClick={open('arrow')}
                        title="选择端点样式。">
                        <img className="fp-arrow-art" src={
                          ARROW_TILES.find((t) => t.value === arrowValue)?.src ?? ARROW_TILES[0].src
                        } alt="" draggable={false} />
                      </button>
                    </div>
                  </div>
                </div>
                <button className="fp-select w-full" disabled={locked} onClick={open('branchWidth')}
                  title="设置线条粗细。">
                  {branchWidthLabel}
                  <span className="fp-caret">{G.caret}</span>
                </button>
                <div className="fp-row bare" style={{ paddingTop: 12 }}>
                  <div className="fp-check-row">
                    <input className="fp-check" type="checkbox" checked={rainbow}
                      onChange={(event) => onCanvas({ rainbow: event.target.checked })} />
                    <span className="fp-check-label">彩虹分支</span>
                  </div>
                  <div className="w-sm" style={{ marginLeft: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="fp-rainbow" title="分支配色"
                      onClick={open('branchPalette')}>
                      <span className="fp-rainbow-dot" style={{ background: branchDial }} />
                      <span className="fp-caret">{G.chevDown}</span>
                    </button>
                  </div>
                </div>
              </Collapse>
            </div>

            {topic && !isPlain(topic.style) ? (
              <div className="fp-section fp-reset">
                <button className="fp-btn-default w-full"
                  onClick={() => { if (styleTargetId) void onAction('clearStyle', { id: styleTargetId }); }}>
                  重设样式
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'canvas' ? (
          <>
            <div className="fp-section fp-cv">
              <div className="fp-field">
                <div className="fp-label-sm">骨架</div>
                <button className="fp-bone" onClick={open('skeleton')} title="切换骨架">
                  {/* The shipped card shows a faint grey wireframe of the
                      skeleton.  We tint the structure glyph to the same tone
                      (a mask keeps the official per-structure silhouette). */}
                  <span className="fp-bone-art" style={{
                    WebkitMaskImage: `url("${boneArt}")`, maskImage: `url("${boneArt}")`,
                  }} />
                  <span className="fp-bone-name">
                    {SKELETON_TILES.find((t) => t.value === skeletonValue)?.label ?? '思维导图'}
                  </span>
                  <span className="fp-caret">{G.chevron}</span>
                </button>
              </div>

              <hr className="fp-divider map" />

              <div className="fp-field">
                <div className="fp-label-sm">配色方案</div>
                <div className="fp-palette-row">
                  <button className="fp-palette" onClick={open('theme')} title="选择配色方案。">
                    <span className="fp-chips">
                      {(activePalette?.colors ?? snapshot.layout.theme.branches.slice(0, 6)).map((color, index) => (
                        <span key={index} style={{ background: color }} />
                      ))}
                    </span>
                    <span className="fp-palette-name">
                      {activePalette?.name ?? (doc.branchColors?.length ? '自定义' : '默认')}
                    </span>
                    <span className="fp-caret">{G.caret}</span>
                  </button>
                  <button className="fp-ctl fp-add" onClick={open('theme')} title="新建配色方案。">
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                {/* Six quick themes owned by the selected scheme (FINDINGS §39).
                    Card 0 is the scheme's full palette; 1..5 are single-accent
                    themes built from its swatches. */}
                <div className="fp-bone-grid" data-scheme={scheme?.id ?? ''}>
                  {variants.map((_variant, index) => (
                    <button key={index}
                      className={`fp-bone-card is-pal${activeVariant === index ? ' on' : ''}`}
                      data-variant={index}
                      title={`${scheme?.name ?? '配色方案'} ${index + 1}`}
                      onClick={() => applyVariant(index)}>
                      <img className="fp-thumb" alt="" draggable={false}
                        src={index === 0
                          ? `/tiles/palettes/${scheme?.id ?? ''}.svg`
                          : `/tiles/palette-variants/${scheme?.id ?? ''}-${index}.svg`} />
                    </button>
                  ))}
                </div>
              </div>

              <hr className="fp-divider map" />

              <div className="fp-inline">
                <span className="fp-inline-title lg">背景颜色</span>
                <button className="fp-well" style={{ background: bgColor }} onClick={open('background')}
                  title="画布背景" />
              </div>

              <hr className="fp-divider map" />

              <div className="fp-field">
                <div className="fp-label-sm">全局字体</div>
                <button className="fp-select w-full" onClick={open('canvasFont')} title="全局字体">
                  {canvasFont}
                  <span className="fp-caret">{G.caret}</span>
                </button>
              </div>

              <div className="fp-field">
                <div className="fp-label-sm">分支线粗细</div>
                <button className="fp-select w-full" onClick={open('canvasLine')} title="分支线粗细">
                  {canvasLine}
                  <span className="fp-caret">{G.caret}</span>
                </button>
              </div>

              <div className="fp-inline fp-inline-check">
                <label className="fp-check-row">
                  <input className="fp-check" type="checkbox" checked={rainbow}
                    onChange={(event) => onCanvas({ rainbow: event.target.checked })} />
                  <span className="fp-check-label">彩虹分支</span>
                </label>
                <button className="fp-rainbow" title="分支配色"
                  onClick={open('branchPalette')}>
                  <span className="fp-rainbow-dot" style={{ background: branchDial }} />
                  <span className="fp-caret">{G.chevDown}</span>
                </button>
              </div>
            </div>

            <hr className="fp-rule" />

            <div className="fp-section fp-cv">
              <div className="fp-subtitle tight">导图样式</div>
              <div className="fp-check-line">
                <label className="fp-check-row" title="设置思维导图为左右平衡结构。">
                  <input className="fp-check" type="checkbox" checked={balanced}
                    onChange={(event) => onStructure(event.target.checked ? 'balanced' : 'clockwise')} />
                  <span className="fp-check-label">自动平衡布局</span>
                </label>
              </div>
              <div className="fp-check-line">
                <label className="fp-check-row" title="减少元素的大小和间距。">
                  <input className="fp-check" type="checkbox" checked={compact}
                    onChange={(event) => onCanvas({ compact: event.target.checked })} />
                  <span className="fp-check-label">紧凑型布局</span>
                </label>
              </div>
              <div className="fp-check-line last">
                <label className="fp-check-row" title="自动统一同层级主题的宽度。">
                  <input className="fp-check" type="checkbox" checked={siblingAlign}
                    onChange={(event) => onCanvas({ siblingAlign: event.target.checked })} />
                  <span className="fp-check-label">同级主题对齐</span>
                </label>
              </div>
            </div>

            <hr className="fp-rule" />

            <div className="fp-section fp-cv">
              <div className="fp-subtitle tight">高级布局</div>
              <div className="fp-check-line">
                <label className="fp-check-row">
                  <input className="fp-check" type="checkbox" disabled />
                  <span className="fp-check-label">分支自由布局</span>
                </label>
              </div>
              <div className="fp-check-line">
                <label className="fp-check-row">
                  <input className="fp-check" type="checkbox" disabled />
                  <span className="fp-check-label">灵活自由主题</span>
                </label>
              </div>
              <div className="fp-check-line last">
                <label className="fp-check-row">
                  <input className="fp-check" type="checkbox" disabled />
                  <span className="fp-check-label">主题层叠</span>
                </label>
              </div>
            </div>

            <hr className="fp-rule" />

            <div className="fp-section fp-cv">
              <div className="fp-field">
                <div className="fp-label-sm">中日韩字体</div>
                <button className="fp-select w-full" onClick={open('canvasFont')} title="中日韩字体">
                  {canvasFont}
                  <span className="fp-caret">{G.caret}</span>
                </button>
                <div className="fp-note">中日韩字体，设置后将优化与西文字体混合排版的字体效果。</div>
              </div>

              <hr className="fp-divider map" />

              <button className="fp-btn-default w-full" title="自定义风格"
                onClick={() => notify('自定义风格：这个版本尚未实现')}>自定义风格</button>
            </div>
          </>
        ) : null}
      </div>

      {pop ? (
        <Popover anchor={pop.anchor} width={popWidth(pop.kind)} onClose={close}
          height={pop.kind === 'skeleton' ? 496 : pop.kind === 'theme' ? 370 : undefined}
          align={pop.kind === 'skeleton' ? 'top' : pop.kind === 'theme' ? 'center' : 'below'}
          side={pop.kind === 'theme' ? 'left' : 'right'}
          className={popClass(pop.kind)}>
          {renderPop()}
        </Popover>
      ) : null}
    </aside>
  );

  function renderPop() {
    if (!pop) return null;
    const width = popWidth(pop.kind);
    switch (pop.kind) {
      case 'shape':
        return (
          <TileGrid tiles={SHAPE_TILES} value={shapeValue} columns={3} tileWidth={66} tileHeight={40}
            gap={8} onPick={(value) => { patch({ shapeClass: value }); close(); }} />
        );

      case 'fill':
        return (
          <>
            <TileGrid tiles={FILL_TILES} value={fillPattern} columns={2} tileWidth={75} tileHeight={40}
              gap={10} onPick={(value) => { patch({ fillPattern: value }); close(); }} />
            <button className="pop-foot" onClick={pick(() => patch({ fill: 'none' }))}>无填充</button>
          </>
        );

      case 'border':
        return (
          <>
            <TileGrid tiles={BORDER_TILES} value={borderPattern} columns={2} tileWidth={75} tileHeight={40}
              gap={10} onPick={(value) => { patch({ borderPattern: value }); close(); }} />
            <button className="pop-foot" onClick={pick(() => patch({ borderPattern: 'none', stroke: 'none' }))}>
              无边框
            </button>
          </>
        );

      case 'fillColor':
        return <ColorPicker value={fillColor} onPick={(color) => { patch({ fill: color }); close(); }} />;

      case 'summaryColor':
        return <ColorPicker value={summaryColor} onPick={(color) => {
          onSummaryStyle?.({ lineColor: color }); close();
        }} />;

      case 'borderColor':
        return (
          <ColorPicker value={borderColor} onPick={(color) => {
            patch({ stroke: color, borderPattern: borderPattern === 'none' ? 'solid' : borderPattern });
            close();
          }} />
        );

      case 'textColor':
        return <ColorPicker value={textColor} onPick={(color) => { patch({ color }); close(); }} />;

      case 'background':
        return <ColorPicker value={bgColor} onPick={(color) => { onCanvas({ background: color }); close(); }} />;

      case 'borderWidth':
        return (
          <Menu width={width} value={String(borderWidthIndex)}
            items={WIDTH_STEPS.map((_, index) => ({ value: String(index), label: WIDTH_LABELS[index] }))}
            onPick={(value) => { patch({ borderWidth: WIDTH_STEPS[Number(value)] }); close(); }} />
        );

      case 'font':
        return (
          <Menu width={width} value={fontFamily}
            items={[{ value: 'Roboto', label: 'Roboto' },
              ...FONT_FAMILIES.filter((f) => f !== 'Roboto').map((f) => ({ value: f, label: f }))]}
            onPick={(value) => { patch({ fontFamily: value }); close(); }} />
        );

      case 'canvasFont':
        return (
          <Menu width={width} value={canvasFont}
            items={[{ value: 'default', label: '默认' },
              ...FONT_FAMILIES.map((f) => ({ value: f, label: f }))]}
            onPick={(value) => { onCanvas({ fontFamily: value }); close(); }} />
        );

      case 'size':
        return (
          <Menu width={width} compact value={String(fontSize)}
            items={FONT_SIZES.map((value) => ({ value: String(value), label: String(value) }))}
            onPick={(value) => { patch({ fontSize: Number(value) }); close(); }} />
        );

      case 'weight':
        return (
          <Menu width={width} value={weightValue}
            items={WEIGHTS.map((w) => ({ value: w.value, label: w.label }))}
            onPick={(value) => {
              const target = WEIGHTS.find((w) => w.value === value);
              if (target) patch({ bold: target.weight >= 600, italic: target.italic });
              close();
            }} />
        );

      case 'case':
        return (
          <Menu width={width} value={textCase} items={CASE_ITEMS}
            onPick={(value) => { patch({ textCase: value }); close(); }} />
        );

      case 'structure':
        return (
          <Menu width={width} value={structureFamily} items={layouts}
            onPick={(value) => { onStructure(value as Structure); close(); }} />
        );

      case 'skeleton':
        // The shipped library is not a list: it is a scrolling board of 3-wide
        // thumbnail cards, split into nine fixed categories.
        return (
          <div className="bone-board">
            {SKELETON_GROUPS.map((group) => (
              <section className="bone-group" key={group.id}>
                <h5 className="bone-head">{group.title}</h5>
                <div className="bone-grid">
                  {group.items.map((preset) => (
                    <button key={preset.id}
                      className={`bone-card${preset.id === activeSkeleton?.id ? ' on' : ''}`}
                      aria-label={preset.title}
                      aria-pressed={preset.id === activeSkeleton?.id}
                      onClick={() => onSkeleton(preset)}>
                      <img src={preset.thumb} alt="" draggable={false} />
                      {preset.handDrawn ? (
                        <img className="bone-hand" src="/tiles/skeleton-hand-drawn.svg" alt="" draggable={false} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        );

      case 'lineShape':
        return (
          <TileGrid tiles={LINE_TILES} value={lineClassValue} columns={2} tileWidth={75} tileHeight={40}
            gap={10} onPick={(value) => { patch({ lineClass: value }); close(); }} />
        );

      case 'lineStyle':
        return (
          <ul className="pop-menu fp-line-menu" style={{ width }}>
            <li>
              <button className={lineClassValue === 'none' ? 'on' : ''}
                title="无" onClick={() => { patch({ lineClass: 'none' }); close(); }}>
                <span className="pop-label">无</span>
              </button>
            </li>
            <li className="pop-sep" />
            {LINE_TILES.map((tile) => (
              <li key={tile.value}>
                <button className={tile.value === lineClassValue ? 'on' : ''} title={tile.label}
                  onClick={() => { patch({ lineClass: tile.value }); close(); }}>
                  <img className="pop-line-art" src={tile.src} alt={tile.label} draggable={false} />
                </button>
              </li>
            ))}
          </ul>
        );

      case 'arrow':
        return (
          <TileGrid tiles={ARROW_TILES} value={arrowValue} columns={2} tileWidth={75} tileHeight={40}
            gap={10} onPick={(value) => { patch({ arrowEnd: value }); close(); }} />
        );

      case 'branchWidth':
        return (
          <Menu width={width} value={branchWidthLabel}
            items={[
              ...WIDTH_LABELS.map((label) => ({ value: label, label })),
              ...WIDTH_LABELS.map((label, index) => ({
                value: `${label} - 线条渐细`, label: `${WIDTH_LABELS[index]} - 线条渐细`, divider: index === 0,
              })),
            ]}
            onPick={(value) => {
              const tapered = value.includes('渐细');
              const label = value.replace(' - 线条渐细', '');
              const index = WIDTH_LABELS.indexOf(label);
              patch({ lineWidth: WIDTH_STEPS[index], lineTapered: tapered });
              close();
            }} />
        );

      case 'canvasLine':
        return (
          <Menu width={width} value={canvasLine}
            items={[{ value: 'default', label: '默认' },
              ...WIDTH_STEPS.map((_, index) => ({ value: `${index + 1}px`, label: WIDTH_LABELS[index] }))]}
            onPick={(value) => {
              onCanvas({ lineWidth: value === 'default' ? 0 : Number(value.replace('px', '')) });
              close();
            }} />
        );

      case 'branchPalette':
        return (
          <div className="pal-grid">
            {BRANCH_PALETTES.map((entry) => {
              const active = entry.colors.every(
                (color, index) => (branchColors[index] ?? '').toLowerCase() === color.toLowerCase(),
              );
              const dial = `conic-gradient(${entry.colors
                .map((color, index) => `${color} ${index * 60}deg ${(index + 1) * 60}deg`)
                .join(',')})`;
              return (
                <button key={entry.name} className={`pal-disc${active ? ' on' : ''}`}
                  title={entry.name}
                  onClick={() => {
                    // 分支配色 replaces the 配色方案: clear its id/centre so the
                    // trigger and the swatch strip stop claiming a palette.
                    onCanvas({
                      branchColors: entry.colors, rainbow: true,
                      palette: '', centerColor: '',
                    });
                    close();
                  }}>
                  <span className="pal-disc-art" style={{ background: dial }} />
                </button>
              );
            })}
          </div>
        );

      case 'theme': {
        const tabDef = PALETTE_TABS.find((t) => t.id === paletteTab) ?? PALETTE_TABS[0];
        return (
          <div className="pal-board">
            <div className="pal-tabs">
              {PALETTE_TABS.map((entry) => (
                <button key={entry.id} className={entry.id === paletteTab ? 'on' : ''}
                  onClick={() => setPaletteTab(entry.id)}>{entry.label}</button>
              ))}
            </div>
            <div className="pal-scroll">
              {tabDef.groups.map((group) => (
                <div key={group.id} className="pal-group">
                  <div className="pal-name">{group.name}</div>
                  <button className={`pal-cell${activePalette?.id === group.id ? ' on' : ''}`}
                    title={group.name} onClick={() => applyPalette(group)}>
                    {group.strips
                      ? group.strips.map((row, index) => (
                          <span key={index} style={{
                            background: `linear-gradient(205deg, ${row[0]} 0 33%, ${row[1]} 33% 66%, ${row[2]} 66% 100%)`,
                          }} />
                        ))
                      : group.colors.map((color, index) => (
                          <span key={index} style={{ background: color }} />
                        ))}
                    <em className="pal-switch">切换</em>
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function isPlain(style: TopicStyle | null | undefined): boolean {
  return !style || Object.values(style).every((v) => v === null || v === undefined || v === '');
}

/** Measured widths of the shipped popovers (`.uk-pop` inline width). */
function popWidth(kind: PopKind): number {
  switch (kind) {
    case 'shape': return 285;
    case 'fill': case 'border': case 'lineShape': case 'arrow': return 210;
    case 'font': case 'canvasFont': return 264;
    case 'size': return 72;
    case 'weight': return 153;
    case 'case': return 150;
    case 'lineStyle': return 172;
    case 'borderWidth': case 'branchWidth': case 'structure': case 'canvasLine': return 228;
    case 'skeleton': return 390;
    case 'theme': return 316;
    case 'branchPalette': return 184;
    case 'fillColor': case 'borderColor': case 'textColor': case 'background':
    case 'summaryColor': return 257;
    default: return 200;
  }
}

function popClass(kind: PopKind): string {
  if (kind === 'fillColor' || kind === 'borderColor' || kind === 'textColor'
    || kind === 'background' || kind === 'summaryColor') {
    return 'is-color';
  }
  if (kind === 'shape') return 'is-tiles is-shape';
  if (kind === 'fill' || kind === 'border' || kind === 'lineShape' || kind === 'arrow') return 'is-tiles';
  if (kind === 'skeleton') return 'is-skeleton';
  if (kind === 'theme') return 'is-themes';
  if (kind === 'branchPalette') return 'is-palette';
  if (kind === 'size') return 'is-menu is-compact';
  return 'is-menu';
}

