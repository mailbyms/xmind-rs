import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import type { DecorSelection, Frame, LaidOutNode, Layout, LiveEditPhase, Side, Snapshot, Structure } from '../lib/types';

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
  setZoom: (scale: number) => void;
  /** Open the in-place title editor (F2 / 编辑主题). */
  edit: (id: string) => void;
}

interface Props {
  layout: Layout;
  selected: string | null;
  /** All box-selected / Ctrl-clicked topics (XMind's multi-selection). */
  selectedIds: string[];
  fitKey: string;
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  /** The shell owns the menu tree; the canvas only reports the anchor. */
  onContextMenu: (clientX: number, clientY: number, topicId: string | null) => void;
  onAction: (cmd: string, args?: Record<string, unknown>) => Promise<Snapshot | null>;
  /** Live edit session: each `text` phase asks the backend to re-layout. */
  onLiveEdit: (phase: LiveEditPhase, id: string, title: string | null) => Promise<Snapshot | null>;
  /** True while the user is picking the second end of a 联系. */
  linkPick: boolean;
  onLinkTarget: (id: string) => void;
  selectedDecor: DecorSelection | null;
  onDecorSelect: (value: DecorSelection | null) => void;
  onDecorRename: (selection: DecorSelection, current: string) => void;
  /** Drag one end of a 概要 / 外框: the range snaps to whole siblings. */
  onDecorRange: (kind: 'boundary' | 'summary', id: string, startId: string, endId: string) => void;
  onScale?: (scale: number) => void;
}

interface View { scale: number; tx: number; ty: number }

/** Where a dragged topic would land if the pointer were released now. */
interface DropPreview {
  id: string;
  /** Ghost rectangle in stage coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  target: string | null;
  /** The topic under the pointer (the insertion bar hugs it). */
  at: string | null;
  mode: 'child' | 'before' | 'after' | 'free';
  index: number;
  /** The dragged topic plus its subtree: dimmed, never a drop target. */
  subtree: string[];
}

/** Ids of `id` and everything below it — a topic cannot be dropped inside itself. */
function collectSubtree(nodes: LaidOutNode[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node.id); else children.set(node.parentId, [node.id]);
  }
  const out = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const child of children.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return [...out];
}

/** Topmost topic under a stage-space point (cells are not drop targets). */
function hitTopic(nodes: LaidOutNode[], point: { x: number; y: number }, blocked: Set<string>) {
  let best: LaidOutNode | null = null;
  for (const node of nodes) {
    if (node.cell || blocked.has(node.id)) continue;
    if (point.x < node.x - 2 || point.x > node.x + node.width + 2) continue;
    if (point.y < node.y - 2 || point.y > node.y + node.height + 2) continue;
    if (!best || node.width * node.height < best.width * best.height) best = node;
  }
  return best;
}

/** Structures whose children stack along x instead of y. 矩阵图 is *not* one of
 *  them: its level-2 topics sit in a column to the right of the level-1 label. */
const VERTICAL_STRUCTURES: Structure[] = [
  'orgDown', 'orgUp', 'timeline', 'braceRight', 'braceLeft', 'treeTable',
];
const isVerticalStructure = (structure: Structure) => VERTICAL_STRUCTURES.includes(structure);

/** Connector anchor on the side `from` grows its children from. */
function childAnchor(from: LaidOutNode, structure: Structure, prefer: Side) {
  const vertical = isVerticalStructure(structure);
  if (vertical) {
    const down = structure !== 'orgUp';
    return {
      x: from.x + from.width / 2,
      y: down ? from.y + from.height : from.y,
      axis: 'v' as const,
      dir: down ? 1 : -1,
    };
  }
  const right = from.depth === 0 ? prefer !== 'left' : from.side !== 'left';
  return {
    x: right ? from.x + from.width : from.x,
    y: from.y + from.height / 2,
    axis: 'h' as const,
    dir: right ? 1 : -1,
  };
}

interface Anchor { x: number; y: number; axis: 'h' | 'v'; dir: number }

/** Where the branch to a topic's children leaves it — the 折叠 disc sits there.
 *  XMind draws the disc centred 12px out along the first branch, so the line
 *  appears to start at the disc instead of at the topic's edge. */
function foldAnchor(node: LaidOutNode, layout: Layout): Anchor {
  const midX = node.x + node.width / 2;
  const midY = node.y + node.height / 2;
  // A live child tells us the true growth direction, whatever the skeleton is.
  const kid = layout.nodes.find((item) => item.parentId === node.id && !item.cell);
  if (kid) {
    const dx = kid.x + kid.width / 2 - midX;
    const dy = kid.y + kid.height / 2 - midY;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { x: node.x + node.width, y: midY, axis: 'h', dir: 1 }
        : { x: node.x, y: midY, axis: 'h', dir: -1 };
    }
    return dy >= 0
      ? { x: midX, y: node.y + node.height, axis: 'v', dir: 1 }
      : { x: midX, y: node.y, axis: 'v', dir: -1 };
  }
  // Folded: no child in the layout any more, so fall back to the skeleton.
  if (isVerticalStructure(layout.structure)) {
    return layout.structure === 'orgUp'
      ? { x: midX, y: node.y, axis: 'v', dir: -1 }
      : { x: midX, y: node.y + node.height, axis: 'v', dir: 1 };
  }
  return node.side === 'left'
    ? { x: node.x, y: midY, axis: 'h', dir: -1 }
    : { x: node.x + node.width, y: midY, axis: 'h', dir: 1 };
}


/** The same 曲线 law the layout uses, so the prediction reads as the real line. */
function predictCurve(anchor: Anchor, end: { x: number; y: number }): string {
  if (anchor.axis === 'h') {
    const dx = end.x - anchor.x;
    return `M ${anchor.x} ${anchor.y} C ${anchor.x + dx * 0.75} ${anchor.y}, ${end.x - dx * 0.5} ${end.y}, ${end.x} ${end.y}`;
  }
  const dy = end.y - anchor.y;
  return `M ${anchor.x} ${anchor.y} C ${anchor.x} ${anchor.y + dy * 0.75}, ${end.x} ${end.y - dy * 0.5}, ${end.x} ${end.y}`;
}

function markerLabel(marker: string): string {
  if (marker.startsWith('priority-')) return marker.slice(-1);
  if (marker.startsWith('task-')) return 'T';
  if (marker.startsWith('flag-')) return 'F';
  if (marker.startsWith('star-')) return 'S';
  return '•';
}

/** Dash pattern → `stroke-dasharray`, matched to `ARROWLINEPATTERN`. */
function dashArray(pattern: string | null): string | undefined {
  switch (pattern) {
    case 'dash': case 'handdrawn-dash': return '5 4';
    case 'dot': case 'handdrawn-dot': return '1.5 3';
    // Zero-length dashes + the group's round linecap paint true round dots.
    case 'round-dot': return '0 4';
    case 'dash-dot': case 'dashdot': return '6 3 1.5 3';
    case 'dash-dot-dot': return '6 3 1.5 3 1.5 3';
    case 'hand-drawn-dash': return '4 3';
    case 'hand-drawn-solid': case 'handdrawn-solid': return undefined;
    default: return undefined;
  }
}

/**
 * Hand-drawn fill textures. XMind stores them in `fill-pattern` (see
 * `renderer/2907.js`: HACHURE / CROSSING / ZIGZAG plus the `-thin` and
 * `-left-hand` variants) and paints them as strokes of the topic colour over a
 * white base. `solid` and `solid-hand-drawn` keep the plain fill.
 */
interface HatchSpec {
  /** `line` = parallel strokes, `cross` = two directions, `zigzag` = sawtooth. */
  kind: 'line' | 'cross' | 'zigzag';
  angle: number;
  /** Pattern tile size in px. */
  gap: number;
  weight: number;
}

function fillHatch(pattern: string): HatchSpec | null {
  switch (pattern) {
    case 'hachure': return { kind: 'line', angle: 45, gap: 8, weight: 1.2 };
    case 'hachure-thin': return { kind: 'line', angle: 45, gap: 7, weight: 0.7 };
    case 'hachure-left-hand': return { kind: 'line', angle: -45, gap: 8, weight: 1.2 };
    case 'zigzag': return { kind: 'zigzag', angle: 0, gap: 9, weight: 1.2 };
    case 'zigzag-left-hand': return { kind: 'zigzag', angle: 180, gap: 9, weight: 1.2 };
    case 'crossing': return { kind: 'cross', angle: 45, gap: 9, weight: 1.1 };
    case 'crossing-thin': return { kind: 'cross', angle: 45, gap: 8, weight: 0.6 };
    default: return null;
  }
}

/** Pattern body for one tile; drawn in `color` over white, like the shipped app. */
function hatchTile(spec: HatchSpec, color: string): React.ReactNode {
  const g = spec.gap;
  const common = { stroke: color, strokeWidth: spec.weight, strokeLinecap: 'round' as const };
  if (spec.kind === 'cross') {
    return (
      <>
        <path d={`M0 ${g / 2} H${g} M${g / 2} 0 V${g}`} fill="none" {...common} />
      </>
    );
  }
  if (spec.kind === 'zigzag') {
    const step = g / 2;
    return (
      <path
        d={`M0 ${g} L${step} ${g - step} L${step * 2} ${g} L${step * 3} ${g - step} L${step * 4} ${g}`}
        fill="none" {...common} />
    );
  }
  return <path d={`M0 ${g / 2} H${g}`} fill="none" {...common} />;
}

/** One `<marker>` per arrow type; `context-stroke` keeps the branch colour. */
function ArrowDefs({ types }: { types: string[] }) {
  return (
    <defs>
      {types.map((type) => {
        const shapes: Record<string, React.ReactNode> = {
          normal: (
            <path d="M0 -3 L6 0 L0 3" fill="none" stroke="context-stroke"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          ),
          dot: <circle cx="3" cy="0" r="2.6" fill="context-stroke" />,
          triangle: <path d="M0 -3.4 L6 0 L0 3.4 Z" fill="context-stroke" />,
          spearhead: <path d="M0 -3.6 L7 0 L0 3.6 L3 0 Z" fill="context-stroke" />,
          square: <rect x="0" y="-2.6" width="5.2" height="5.2" fill="context-stroke" />,
          diamond: <path d="M0 0 L3.4 -3 L6.8 0 L3.4 3 Z" fill="context-stroke" />,
          herringbone: (
            <g stroke="context-stroke" strokeWidth="1.4" fill="none">
              <path d="M0 -3 L4 0 L0 3" /><path d="M3 -3 L7 0 L3 3" />
            </g>
          ),
          doublearrow: (
            <g fill="context-stroke">
              <path d="M0 -3 L4 0 L0 3 Z" /><path d="M4 -3 L8 0 L4 3 Z" />
            </g>
          ),
          ring: (
            <circle cx="3" cy="0" r="2.6" fill="none" stroke="context-stroke" strokeWidth="1.4" />
          ),
          eye: (
            <path d="M0 0 L3.4 -2.4 L6.8 0 L3.4 2.4 Z" fill="none"
              stroke="context-stroke" strokeWidth="1.4" strokeLinejoin="round" />
          ),
          squarering: (
            <rect x="0.7" y="-2.6" width="4.6" height="5.2" fill="none"
              stroke="context-stroke" strokeWidth="1.3" />
          ),
          knot: (
            <path d="M0 -3 L5 3 M0 3 L5 -3" fill="none" stroke="context-stroke"
              strokeWidth="1.4" strokeLinecap="round" />
          ),
          trianglering: (
            <path d="M0 -3.4 L6 0 L0 3.4 Z" fill="none" stroke="context-stroke"
              strokeWidth="1.3" strokeLinejoin="round" />
          ),
          antiTriangle: <path d="M0 0 L6 -3.4 L6 3.4 Z" fill="context-stroke" />,
          attached: <path d="M0 0 L5 -2.4 L5 2.4 Z" fill="context-stroke" />,
          hook: (
            <path d="M0 -3.4 Q5 -3.4 5 0 Q5 3.4 0 3.4" fill="none"
              stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" />
          ),
        };
        const shape = shapes[type];
        if (!shape) return null;
        return (
          <marker key={type} id={`arrow-${type}`} viewBox="-1 -5 9 10"
            refX="6" refY="0" markerWidth="9" markerHeight="10"
            markerUnits="userSpaceOnUse" orient="auto">
            {shape}
          </marker>
        );
      })}
    </defs>
  );
}

/** Unique per node so patterned fills can carry the topic colour. */
function hatchPattern(node: LaidOutNode): { id: string; el: React.ReactNode } | null {
  const hatch = fillHatch(node.style.fillPattern);
  if (!hatch || !node.shapeClosed) return null;
  const id = `hatch-${node.id.slice(0, 8)}`;
  return {
    id,
    el: (
      <pattern id={id} width={hatch.gap} height={hatch.gap} patternUnits="userSpaceOnUse"
        patternTransform={`rotate(${hatch.angle})`}>
        {/* White base: the strokes are the topic colour itself. */}
        <rect width={hatch.gap} height={hatch.gap} fill="#ffffff" />
        {hatchTile(hatch, node.style.fill)}
      </pattern>
    ),
  };
}

/** Heavy renderer: loaded as its own chunk, never part of the startup bundle. */
const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { layout, selected, selectedIds, fitKey, onSelect, onSelectMany, onContextMenu,
    onAction, onLiveEdit, onScale,
    linkPick, onLinkTarget, selectedDecor, onDecorSelect, onDecorRename, onDecorRange }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const startEditRef = useRef<(node: LaidOutNode) => void>(() => {});
  /** Latest node list for the imperative `edit()` handle (avoids a stale closure). */
  const nodesRef = useRef(layout.nodes);
  nodesRef.current = layout.nodes;
  const imageCache = useRef<Record<string, string>>({});
  const [, forceImageRender] = useState(0);

  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  /** Space is XMind's temporary pan modifier (Space + left drag pans). */
  const [spacePan, setSpacePan] = useState(false);
  const [drop, setDrop] = useState<DropPreview | null>(null);
  const dropRef = useRef<DropPreview | null>(null);
  /** Set once a topic drag actually moved, so the trailing click is ignored. */
  const suppressClick = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Mirrors `draft` synchronously, so Enter/blur never read a stale render. */
  const draftRef = useRef('');
  /** Id of the session in flight; Enter + blur must close it only once. */
  const editIdRef = useRef<string | null>(null);
  const editActive = useRef(false);
  /** Marquee rectangle and its live hit set, both in stage coordinates. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [marqueeIds, setMarqueeIds] = useState<string[]>([]);
  /** Live preview while a 概要 / 外框 end handle is dragged. */
  const [rangePreview, setRangePreview] = useState<string[] | null>(null);
  const [bounds, setBounds] = useState({ w: 0, h: 0 });

  // Track the viewport so the overlay scrollbars can size themselves.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setBounds({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Space is a hold-to-pan modifier, exactly like the shipped app. It must not
  // fire while the in-place title editor owns the keyboard.
  useEffect(() => {
    const typing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !typing(event)) {
        event.preventDefault();
        setSpacePan(true);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false); };
    const blur = () => setSpacePan(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const fit = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    // XMind keeps a fresh map at 100% and only zooms out when content is larger.
    const ratio = Math.min(width / layout.width, height / layout.height);
    const scale = ratio >= 1 ? 1 : ratio * 0.96;
    setView({
      scale: Math.max(0.15, scale),
      tx: (width - layout.width * scale) / 2,
      ty: (height - layout.height * scale) / 2,
    });
  }, [layout.width, layout.height]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setView((current) => {
      const element = containerRef.current;
      const cx = clientX ?? (element ? element.clientWidth / 2 : 0);
      const cy = clientY ?? (element ? element.clientHeight / 2 : 0);
      const next = Math.min(2.5, Math.max(0.15, current.scale * factor));
      const ratio = next / current.scale;
      return {
        scale: next,
        tx: cx - (cx - current.tx) * ratio,
        ty: cy - (cy - current.ty) * ratio,
      };
    });
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomAt(1.15),
    zoomOut: () => zoomAt(1 / 1.15),
    fit,
    reset: () => setView({ scale: 1, tx: 0, ty: 0 }),
    edit: (id: string) => {
      const node = nodesRef.current.find((entry) => entry.id === id);
      if (node) startEditRef.current(node);
    },
    // Zoom to an exact percentage, anchored on the viewport centre.
    setZoom: (scale: number) => setView((current) => {
      const element = containerRef.current;
      const cx = element ? element.clientWidth / 2 : 0;
      const cy = element ? element.clientHeight / 2 : 0;
      const ratio = scale / current.scale;
      return {
        scale,
        tx: cx - (cx - current.tx) * ratio,
        ty: cy - (cy - current.ty) * ratio,
      };
    }),
  }), [zoomAt, fit]);

  useEffect(() => { fit(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [fitKey]);

  // The status bar shows the live zoom percentage, exactly like XMind's.
  useEffect(() => { onScale?.(view.scale); }, [view.scale, onScale]);

  // Native listener: React's wheel handler is passive and cannot preventDefault.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX, event.clientY);
      } else {
        setView((current) => ({
          ...current,
          tx: current.tx - event.deltaX,
          ty: current.ty - event.deltaY,
        }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Resolve images only for nodes that are actually on the canvas.
  useEffect(() => {
    const ids = Array.from(new Set(
      layout.nodes.map((node) => node.image).filter((id): id is string => Boolean(id)),
    ));
    const missing = ids.filter((id) => !imageCache.current[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => [id, await api.resourceData(id).catch(() => null)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      let changed = false;
      for (const [id, url] of pairs) {
        if (url) { imageCache.current[id] = url; changed = true; }
      }
      if (changed) forceImageRender((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [layout.nodes]);

  /* XMind re-measures the topic on every keystroke. The backend owns the
     layout, so each change is sent through `doc_edit_text` and the returned
     snapshot widens the box (and shifts its siblings) while the editor stays
     focused. One session = one undo step; Escape rolls the document back. */
  const startEdit = useCallback((node: LaidOutNode) => {
    draftRef.current = node.title;
    editIdRef.current = node.id;
    editActive.current = true;
    setDraft(node.title);
    setEditing(node.id);
    void onLiveEdit('begin', node.id, null);
  }, [onLiveEdit]);
  startEditRef.current = startEdit;

  const finishEdit = useCallback((node: LaidOutNode, mode: 'commit' | 'cancel') => {
    if (!editActive.current || editIdRef.current !== node.id) return;
    editActive.current = false;
    editIdRef.current = null;
    const title = draftRef.current.trim();
    setEditing(null);
    // An empty label was never valid in XMind; treat it as a cancel.
    const shouldCommit = mode === 'commit' && Boolean(title);
    void onLiveEdit(shouldCommit ? 'end' : 'cancel', node.id, shouldCommit ? title : null);
  }, [onLiveEdit]);

  /* Dragging a topic reparents it. XMind previews the move with a predictive
     connector from the prospective parent plus a ghost of the topic at its
     would-be slot; the top and bottom quarter of a topic mean "insert as a
     sibling before / after it" instead. */
  const beginNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: LaidOutNode) => {
    if (event.button !== 0 || node.depth === 0 || editing === node.id) return;
    // Ctrl / Shift + click is additive selection, not a drag: pointer capture
    // would retarget the click away from the node (same bug as the fold badge).
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const host = containerRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const toStage = (clientX: number, clientY: number) => ({
      x: (clientX - box.left - view.tx) / view.scale,
      y: (clientY - box.top - view.ty) / view.scale,
    });
    const grab = toStage(event.clientX, event.clientY);
    const offsetX = grab.x - node.x;
    const offsetY = grab.y - node.y;
    const blocked = new Set(collectSubtree(layout.nodes, node.id));
    const originParent = node.parentId;
    let moved = false;

    const move = (native: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(native.clientX - event.clientX, native.clientY - event.clientY) < 4) return;
        moved = true;
        suppressClick.current = true;
      }
      const point = toStage(native.clientX, native.clientY);
      const ghost = { x: point.x - offsetX, y: point.y - offsetY, w: node.width, h: node.height };
      const hit = hitTopic(layout.nodes, point, blocked);
      // Empty canvas means "reposition freely" (XMind turns the topic into a
      // floating one); hovering a topic means reparent / reorder as before.
      let mode: DropPreview['mode'] = hit ? 'child' : 'free';
      let index = 0;
      let target: string | null = null;
      const at = hit?.id ?? null;
      if (hit) {
        const ratio = (point.y - hit.y) / Math.max(1, hit.height);
        if (hit.parentId && ratio < 0.28) mode = 'before';
        else if (hit.parentId && ratio > 0.72) mode = 'after';
        if (mode === 'child') {
          target = hit.id;
          index = layout.nodes.filter((child) => child.parentId === hit.id).length;
        } else {
          // Dropping between siblings keeps the hovered topic's parent.
          target = hit.parentId;
          index = hit.childIndex + (mode === 'after' ? 1 : 0);
          // The move detaches first, so a later slot shifts down by one.
          if (originParent === hit.parentId && node.childIndex < index) index -= 1;
        }
      }
      const next: DropPreview = { id: node.id, ...ghost, target, at, mode, index, subtree: [...blocked] };
      dropRef.current = next;
      setDrop(next);
    };

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey, true);
      const preview = dropRef.current;
      dropRef.current = null;
      setDrop(null);
      if (!moved || !preview) return;
      if (preview.mode === 'free') {
        // Floating topics are positioned relative to the central topic, so
        // subtract its centre before sending the drop point to the backend.
        const centre = layout.nodes.find((item) => !item.parentId);
        const cx = centre ? centre.x + centre.width / 2 : layout.width / 2;
        const cy = centre ? centre.y + centre.height / 2 : layout.height / 2;
        void onAction('moveFree', {
          id: node.id,
          x: preview.x + preview.w / 2 - cx,
          y: preview.y + preview.h / 2 - cy,
        });
        return;
      }
      if (!preview.target) return;
      // Re-appending a topic that is already the last child is a no-op.
      const siblings = layout.nodes.filter((child) => child.parentId === originParent);
      const last = siblings.every((child) => child.id === node.id || child.childIndex < node.childIndex);
      const unchanged = preview.mode === 'child' && preview.target === originParent && last;
      if (!unchanged) {
        void onAction('move', { id: node.id, newParentId: preview.target, index: preview.index });
      }
    };

    const cancel = () => {
      dropRef.current = null;
      setDrop(null);
      finish();
    };

    const onKey = (native: KeyboardEvent) => {
      if (native.key === 'Escape') { native.stopPropagation(); cancel(); }
    };

    // Keep the move / up events coming even when the pointer leaves the window.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKey, true);
  };

  const marqueeIdsRef = useRef<string[]>([]);

  /* XMind's `summary-resize-handle-start/end`: dragging a brace tip grows or
     shrinks the range one whole sibling at a time. The pointer only picks the
     nearest sibling, so the bottom-up half of a clockwise map still behaves. */
  const beginRangeDrag = (
    event: ReactPointerEvent<SVGGElement>, frame: Frame, end: 'start' | 'end',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const host = containerRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const toStage = (clientX: number, clientY: number) => ({
      x: (clientX - box.left - view.tx) / view.scale,
      y: (clientY - box.top - view.ty) / view.scale,
    });
    const vertical = isVerticalStructure(layout.structure);
    const anchorNode = layout.nodes.find((node) => node.id === frame.startId);
    const siblings = layout.nodes
      .filter((node) => !node.cell && node.parentId === frame.parentId
        && (!anchorNode || node.side === anchorNode.side))
      .sort((a, b) => a.childIndex - b.childIndex);
    const indexOf = (id: string) => siblings.findIndex((node) => node.id === id);
    const first = indexOf(frame.startId);
    const last = indexOf(frame.endId);
    if (first < 0 || last < 0) return;
    let lo = Math.min(first, last);
    let hi = Math.max(first, last);
    let range = siblings.slice(lo, hi + 1).map((node) => node.id);
    setRangePreview(range);
    const move = (native: PointerEvent) => {
      const point = toStage(native.clientX, native.clientY);
      let pick = -1;
      let best = Infinity;
      siblings.forEach((node, index) => {
        const distance = vertical
          ? Math.abs(node.x + node.width / 2 - point.x)
          : Math.abs(node.y + node.height / 2 - point.y);
        if (distance < best) { best = distance; pick = index; }
      });
      if (pick < 0) return;
      if (end === 'start') lo = Math.min(pick, hi);
      else hi = Math.max(pick, lo);
      range = siblings.slice(lo, hi + 1).map((node) => node.id);
      setRangePreview(range);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setRangePreview(null);
      if (commit && range.length > 0) {
        onDecorRange(frame.kind, frame.id, range[0], range[range.length - 1]);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest('.node')) return;
    // Panning uses pointer capture, which would retarget the following click
    // away from a 联系 / 外框 hit path (exactly like the fold badge bug).
    if (target.closest('.decor-hit')) return;
    // Clicking bare canvas clears a selected 联系 / 外框 / 概要.
    onDecorSelect(null);
    const host = containerRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const toStage = (clientX: number, clientY: number) => ({
      x: (clientX - box.left - view.tx) / view.scale,
      y: (clientY - box.top - view.ty) / view.scale,
    });

    // Middle button / Alt+drag / Space+drag pans; a plain left drag on bare
    // canvas draws the blue multi-selection box instead.
    if (event.button === 1 || event.altKey || spacePan) {
      panStart.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    const origin = toStage(event.clientX, event.clientY);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const base = additive ? selectedIds : [];
    let moved = false;
    const move = (native: PointerEvent) => {
      if (!moved && Math.hypot(native.clientX - event.clientX, native.clientY - event.clientY) < 4) return;
      moved = true;
      const point = toStage(native.clientX, native.clientY);
      const x0 = Math.min(origin.x, point.x);
      const x1 = Math.max(origin.x, point.x);
      const y0 = Math.min(origin.y, point.y);
      const y1 = Math.max(origin.y, point.y);
      setMarquee({ x0, y0, x1, y1 });
      // The shipped outline hugs whole topic boxes, not just their labels.
      const hits = layout.nodes
        .filter((node) => !node.cell
          && node.x < x1 && node.x + node.width > x0
          && node.y < y1 && node.y + node.height > y0)
        .map((node) => node.id);
      marqueeIdsRef.current = [...new Set([...base, ...hits])];
      setMarqueeIds(marqueeIdsRef.current);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey, true);
      setMarquee(null);
      setMarqueeIds([]);
      if (!moved) { onSelect(null); return; }
      if (marqueeIdsRef.current.length) onSelectMany(marqueeIdsRef.current);
      else onSelect(null);
      marqueeIdsRef.current = [];
    };
    const onKey = (native: KeyboardEvent) => {
      if (native.key === 'Escape') { native.stopPropagation(); finish(); }
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKey, true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStart.current;
    if (!start) return;
    setView((current) => ({
      ...current,
      tx: start.tx + event.clientX - start.x,
      ty: start.ty + event.clientY - start.y,
    }));
  };

  const onPointerUp = () => { panStart.current = null; setDragging(false); };

  /* Overlay scrollbars, the way XMind draws them: they only appear when the
     map is bigger than the viewport, and dragging them pans the stage. */
  const contentW = layout.width * view.scale;
  const contentH = layout.height * view.scale;
  const maxX = Math.max(0, contentW - bounds.w);
  const maxY = Math.max(0, contentH - bounds.h);
  const showX = maxX > 1;
  const showY = maxY > 1;
  const thumbW = showX ? Math.max(28, Math.min(bounds.w, bounds.w * (bounds.w / contentW))) : 0;
  const thumbH = showY ? Math.max(28, Math.min(bounds.h, bounds.h * (bounds.h / contentH))) : 0;
  const trackX = Math.max(1, bounds.w - thumbW - (showY ? 10 : 0));
  const trackY = Math.max(1, bounds.h - thumbH - (showX ? 10 : 0));
  const posX = maxX > 0 ? Math.min(1, Math.max(0, -view.tx / maxX)) * trackX : 0;
  const posY = maxY > 0 ? Math.min(1, Math.max(0, -view.ty / maxY)) * trackY : 0;

  const beginScroll = (axis: 'x' | 'y', event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const track = axis === 'x' ? trackX : trackY;
    const range = axis === 'x' ? maxX : maxY;
    const factor = track > 0 ? range / track : 0;
    const start = axis === 'x' ? event.clientX : event.clientY;
    const origin = axis === 'x' ? view.tx : view.ty;
    const move = (native: PointerEvent) => {
      const delta = (axis === 'x' ? native.clientX : native.clientY) - start;
      setView((current) => (axis === 'x'
        ? { ...current, tx: origin - delta * factor }
        : { ...current, ty: origin - delta * factor }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Prediction chrome for the in-flight drag: the topic is drawn where it would
  // land, joined to the prospective parent by the same curve the layout uses;
  // between siblings it becomes an insertion bar instead.
  const dropTarget = drop?.target
    ? layout.nodes.find((node) => node.id === drop.target) ?? null
    : null;
  const dropAt = drop?.at
    ? layout.nodes.find((node) => node.id === drop.at) ?? null
    : null;
  const predicted = drop && dropTarget
    ? (() => {
      const dragged = layout.nodes.find((node) => node.id === drop.id);
      if (drop.mode === 'child') {
        const anchor = childAnchor(dropTarget, layout.structure, dragged?.side ?? 'right');
        const gap = 40;
        // A new child is appended after the target's last child, so the ghost
        // sits there; with no children it lands level with the parent.
        const existing = layout.nodes.filter((child) => child.parentId === dropTarget.id);
        if (anchor.axis === 'h') {
          const last = existing.reduce<LaidOutNode | null>(
            (best, child) => (!best || child.childIndex > best.childIndex ? child : best), null,
          );
          // Clockwise maps the left half bottom-up, so appended children do not
          // always grow downwards.
          const below = !last || last.y >= dropTarget.y;
          const level = last
            ? (below ? last.y + last.height + 6 + drop.h / 2 : last.y - 6 - drop.h / 2)
            : dropTarget.y + dropTarget.height / 2;
          const x = anchor.dir > 0 ? anchor.x + gap : anchor.x - gap - drop.w;
          const box = { x, y: level - drop.h / 2 };
          const end = { x: anchor.dir > 0 ? box.x : box.x + drop.w, y: level };
          return { box, curve: predictCurve(anchor, end), bar: null };
        }
        const rightmost = existing
          .slice()
          .sort((a, b) => (a.x - b.x) || (a.y - b.y))
          .at(-1);
        const level = rightmost
          ? rightmost.x + rightmost.width + 6 + drop.w / 2
          : dropTarget.x + dropTarget.width / 2;
        const y = anchor.dir > 0 ? anchor.y + gap : anchor.y - gap - drop.h;
        const box = { x: level - drop.w / 2, y };
        const end = { x: level, y: anchor.dir > 0 ? box.y : box.y + drop.h };
        return { box, curve: predictCurve(anchor, end), bar: null };
      }
      return {
        box: null,
        curve: null,
        bar: dropAt
          ? {
            left: dropAt.x,
            width: dropAt.width,
            top: drop.mode === 'before' ? dropAt.y - 5 : dropAt.y + dropAt.height + 3,
          }
          : null,
      };
    })()
    : { box: drop ? { x: drop.x, y: drop.y } : null, curve: null, bar: null };

  /* XMind paints selection as SVG, not as a CSS box-shadow: a translucent
     rubber band while dragging, plus a rounded blue outline around *every*
     selected topic (a single selection gets one too). Re-measured on 23.07
     against the *shape* box (not the text `foreignObject`): the outline is
     only 2px outside on each side, e.g. topic [1075,335,264,31] → outline
     [1073,333,268,35], central [591,391,170,67] → [589,389,174,71].
     Radius 5, stroke rgb(46,189,255) at 2px; band = 10% fill, 50% stroke. */
  const outlinedIds = marquee ? marqueeIds
    : selectedIds.length ? selectedIds : selected ? [selected] : [];
  const outlined = layout.nodes.filter((node) => !node.cell && outlinedIds.includes(node.id));

  return (
    <div
      ref={containerRef}
      className={`canvas${dragging ? ' panning' : ''}${linkPick ? ' link-pick' : ''}${spacePan ? ' space-pan' : ''}`}
      style={{ background: layout.theme.bg }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        const nodeEl = (event.target as HTMLElement).closest('.node');
        onContextMenu(event.clientX, event.clientY, nodeEl?.getAttribute('data-id') ?? null);
      }}
    >
      <div
        className="stage"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        <svg className="edges" width={layout.width} height={layout.height} aria-hidden="true">
          <ArrowDefs types={[...new Set(layout.edges.map((edge) => edge.arrow))].filter((a) => a && a !== 'none')} />
          {/* Braces / table rules: they belong under every topic. */}
          {(layout.decor ?? []).map((item, index) => (
            <path
              key={`decor-${index}`}
              d={item.path}
              fill="none"
              stroke={item.color}
              strokeWidth={item.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dashArray(item.dash)}
            />
          ))}
          {layout.edges.map((edge) => (
            edge.tapered ? (
              <path key={edge.id} d={edge.path} fill={edge.color} stroke="none" />
            ) : (
              <path
                key={edge.id}
                d={edge.path}
                fill="none"
                stroke={edge.color}
                strokeWidth={edge.width}
                strokeLinecap="round"
                strokeDasharray={dashArray(edge.dash)}
                markerEnd={edge.arrow && edge.arrow !== 'none' ? `url(#arrow-${edge.arrow})` : undefined}
              />
            )
          ))}
        </svg>

        {/* 联系 / 外框 / 概要: drawn beneath the topics, with a wide
            transparent hit path so they can still be selected and deleted. */}
        <svg className="decor-layer" width={layout.width} height={layout.height}>
          <defs>
            <marker id="decor-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={layout.links[0]?.color ?? '#8A63D2'} />
            </marker>
          </defs>
          {(layout.frames ?? []).map((frame) => {
            const active = selectedDecor?.kind === frame.kind && selectedDecor.id === frame.id;
            const selection: DecorSelection = { kind: frame.kind, id: frame.id };
            return (
              <g key={frame.id} data-kind={frame.kind} data-id={frame.id}
                className={`decor-frame${active ? ' selected' : ''}`}>
                <path d={frame.path} fill="none" stroke={frame.color}
                  strokeWidth={active ? (frame.width ?? 1.8) + 1.5 : (frame.width ?? 1.8)}
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={frame.kind === 'summary' ? undefined : '6 4'} />
                {frame.title && (
                  <text className="decor-label" x={frame.labelX} y={frame.labelY} fill={frame.color}>
                    {frame.title}
                  </text>
                )}
                <path className="decor-hit" d={frame.path} fill="none" stroke="transparent" strokeWidth={14}
                  onClick={(event) => { event.stopPropagation(); onDecorSelect(selection); }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (frame.kind === 'boundary') onDecorRename(selection, frame.title);
                  }} />
              </g>
            );
          })}
          {/* Live preview of the sibling run the drag would snap to. */}
          {rangePreview && (() => {
            const picked = layout.nodes.filter((node) => rangePreview.includes(node.id));
            if (!picked.length) return null;
            const left = Math.min(...picked.map((node) => node.x)) - 8;
            const top = Math.min(...picked.map((node) => node.y)) - 8;
            const right = Math.max(...picked.map((node) => node.x + node.width)) + 8;
            const bottom = Math.max(...picked.map((node) => node.y + node.height)) + 8;
            return (
              <rect className="range-preview" x={left} y={top}
                width={right - left} height={bottom - top} rx={8} />
            );
          })()}
          {/* 概要 / 外框 范围手柄: shown for the selected frame, or when the
              概要 topic itself is the current selection (as in XMind). */}
          {(() => {
            const frame = (layout.frames ?? []).find((item) => (
              (selectedDecor?.id === item.id && selectedDecor.kind === item.kind)
              || (item.kind === 'summary' && selected === item.id)
            ));
            if (!frame) return null;
            const axis = isVerticalStructure(layout.structure) ? 'vertical' : 'horizontal';
            return (
              <>
                {([['start', frame.startX, frame.startY],
                  ['end', frame.endX, frame.endY]] as const).map(([which, x, y]) => (
                  <g key={which} data-handle={which} data-frame={frame.id}
                    className={`summary-handle ${which} ${axis}`}
                    transform={`translate(${x} ${y})`}
                    onPointerDown={(event) => beginRangeDrag(event, frame, which)}>
                    <circle r={10} fill="transparent" />
                    <circle r={4.5} fill="#fff" stroke={frame.color} strokeWidth={1.6} />
                  </g>
                ))}
              </>
            );
          })()}
          {(layout.links ?? []).map((link) => {
            const active = selectedDecor?.kind === 'relation' && selectedDecor.id === link.id;
            const selection: DecorSelection = { kind: 'relation', id: link.id };
            return (
              <g key={link.id} data-kind="relation" data-id={link.id}
                className={`decor-link${active ? ' selected' : ''}`}>
                <path d={link.path} fill="none" stroke={link.color}
                  strokeWidth={active ? 3 : (link.width ?? 1.8)} strokeLinecap="round"
                  strokeDasharray={link.dash ?? '6 4'}
                  markerEnd={link.arrow === false ? undefined : 'url(#decor-arrow)'} />
                {link.title && (
                  <text className="decor-label" x={link.labelX} y={link.labelY - 6}
                    textAnchor="middle" fill={link.color}>{link.title}</text>
                )}
                <path className="decor-hit" d={link.path} fill="none" stroke="transparent" strokeWidth={16}
                  onClick={(event) => { event.stopPropagation(); onDecorSelect(selection); }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onDecorRename(selection, link.title);
                  }} />
              </g>
            );
          })}
        </svg>

        {layout.nodes.map((node) => {
          const style = node.style;
          const isSelected = selected === node.id;
          const imageUrl = node.image ? imageCache.current[node.image] : undefined;
          const hatch = hatchPattern(node);
          const fill = style.fill === 'none' || style.fill === 'transparent'
            ? 'none'
            : hatch ? `url(#${hatch.id})` : style.fill;
          const inFlight = Boolean(drop && drop.subtree.includes(node.id));
          const isTarget = Boolean(drop && drop.target === node.id);
          const fold = node.hasChildren ? foldAnchor(node, layout) : null;
          const foldColor = layout.edges.find((edge) => edge.from === node.id)?.color
            ?? style.lineColor;
          return (
            <div
              key={node.id}
              data-id={node.id}
              className={`node${style.underline ? ' underline' : ''}${isSelected ? ' selected' : ''}${node.cell ? ' cell' : ''}`
                + `${style.align === 'left' ? ' align-left' : ''}`
                + `${node.lines > 1 && !node.title.includes('\n') && style.align === 'left'
                    && !style.underline && node.textPad > 0 && !node.cell ? ' auto-wrap' : ''}`
                + `${inFlight ? ' drag-src' : ''}${drop && drop.id === node.id ? ' drag-origin' : ''}`
                + `${isTarget && drop?.mode === 'child' ? ' drop-target' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                color: style.color,
                fontSize: style.fontSize,
                fontFamily: style.fontFamily ?? undefined,
                fontWeight: style.fontWeight,
                fontStyle: style.italic ? 'italic' : 'normal',
                textDecoration: style.strike ? 'line-through' : 'none',
                textTransform: (style.textCase as React.CSSProperties['textTransform']) || 'none',
                justifyContent: style.align === 'left' ? 'flex-start'
                  : style.align === 'right' ? 'flex-end' : 'center',
                textAlign: (style.align as React.CSSProperties['textAlign']) || 'center',
                opacity: style.opacity,
                paddingLeft: node.pad || undefined,
                paddingRight: node.pad || undefined,
                // XMind splits the topic's horizontal padding evenly: the
                // label (and the in-place editor) are inset by `textPad` on
                // both sides instead of starting on the shape's left edge.
                ['--text-pad' as string]: `${node.textPad || 0}px`,
                // The 下划线 shapes underline with the branch hue (or the
                // theme's border colour); the label ink may be flipped for
                // contrast, so `currentColor` would be wrong here.
                ['--ul' as string]: style.underlineColor || style.lineColor,
                ['--ulw' as string]: `${style.underlineWidth || 1.5}px`,
              } as React.CSSProperties}
              onPointerDown={(event) => beginNodeDrag(event, node)}
              onClick={(event) => {
                if (suppressClick.current) { suppressClick.current = false; return; }
                if (linkPick) { onLinkTarget(node.id); return; }
                onSelect(node.id, event.ctrlKey || event.metaKey || event.shiftKey);
                onDecorSelect(null);
              }}
              onDoubleClick={() => { if (!linkPick) startEdit(node); }}
            >
              <svg className="node-shape" width={node.width} height={node.height} aria-hidden="true">
                {hatch ? <defs>{hatch.el}</defs> : null}
                <path
                  d={node.shapePath}
                  fill={fill}
                  stroke={style.stroke === 'none' || style.stroke === 'transparent' ? 'none' : style.stroke}
                  strokeWidth={style.strokeWidth}
                  strokeDasharray={dashArray(style.strokePattern)}
                  strokeLinejoin="round"
                />
              </svg>
              {node.markers.length > 0 && (
                <div className="node-markers">
                  {node.markers.map((marker) => (
                    <span key={marker} className="marker-chip" title={marker}>
                      {markerLabel(marker)}
                    </span>
                  ))}
                </div>
              )}
              {imageUrl && <img className="node-image" src={imageUrl} alt="" draggable={false} />}
              {editing === node.id ? (
                <textarea
                  className="node-title-input"
                  autoFocus
                  // Backend wrapping decides how many lines the box needs; a
                  // fixed-height table cell stays single-line.
                  rows={node.cell ? 1 : Math.max(1, node.lines)}
                  value={draft}
                  // XMind selects the whole label on entry, so typing replaces it.
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const next = event.target.value;
                    draftRef.current = next;
                    setDraft(next);
                    // Every keystroke re-runs the backend layout engine.
                    void onLiveEdit('text', node.id, next);
                  }}
                  onBlur={() => finishEdit(node, 'commit')}
                  onKeyDown={(event) => {
                    // Enter commits; Shift+Enter inserts a real line break,
                    // which the backend also counts when wrapping.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      finishEdit(node, 'commit');
                    }
                    if (event.key === 'Escape') finishEdit(node, 'cancel');
                    event.stopPropagation();
                  }}
                  onClick={(event) => event.stopPropagation()}
                  // Selecting a word inside the editor must not re-enter edit
                  // mode on the node (that would reset the draft).
                  onDoubleClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="node-title">{node.title}</span>
              )}
              {node.href && <span className="link-dot" title={node.href}>↗</span>}
              {node.labels.length > 0 && (
                <div className="node-labels">
                  {node.labels.map((label) => <span key={label} className="label-chip">{label}</span>)}
                </div>
              )}
              {node.hasChildren && fold && (
                <button
                  className={`fold-badge${node.folded ? ' folded' : ''}`}
                  // XMind keeps the disc hidden until the topic is hovered; the
                  // CSS also lets it stay visible while a branch is collapsed.
                  title={node.folded ? '展开' : '折叠'}
                  style={{
                    // Centre the 16px disc 12px out *along* the first branch —
                    // horizontally for a sideways branch, vertically for one
                    // that grows up or down — so the line looks like it starts
                    // inside the disc instead of beside it.
                    left: fold.x - node.x + (fold.axis === 'h' ? fold.dir * 12 : 0) - 8,
                    top: fold.y - node.y + (fold.axis === 'v' ? fold.dir * 12 : 0) - 8,
                    borderColor: foldColor,
                    color: foldColor,
                    background: layout.theme.bg,
                  }}
                  // The node starts a pointer-capturing drag on pointerdown;
                  // without this the browser retargets the following click to
                  // the node and the badge's onClick never fires.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onAction('toggleFold', { id: node.id });
                  }}
                >
                  {node.folded ? node.hiddenCount : '−'}
                </button>
              )}
            </div>
          );
        })}

        {(marquee || outlined.length > 0) && (
          <svg className="selection-layer" width={layout.width} height={layout.height} aria-hidden="true">
            {marquee && (
              <rect className="marquee" x={marquee.x0} y={marquee.y0}
                width={marquee.x1 - marquee.x0} height={marquee.y1 - marquee.y0} />
            )}
            {outlined.map((node) => (
              <rect key={node.id} className="topic-outline" data-id={node.id}
                x={node.x - 2} y={node.y - 2}
                width={node.width + 4} height={node.height + 4} rx={5} />
            ))}
          </svg>
        )}

        {drop && (
          <>
            {predicted.curve && (
              <svg className="drop-layer" width={layout.width} height={layout.height} aria-hidden="true">
                <path className="drop-curve" d={predicted.curve} />
              </svg>
            )}
            {predicted.bar && (
              <div className="drop-bar"
                style={{ left: predicted.bar.left, top: predicted.bar.top, width: predicted.bar.width }} />
            )}
            {predicted.box && (
              <div className={`drag-ghost${drop.mode === 'free' ? ' free' : ''}`}
                style={{ left: predicted.box.x, top: predicted.box.y, width: drop.w, height: drop.h }} />
            )}
          </>
        )}
      </div>

      {showX && (
        <div className="scroll-x" onPointerDown={(event) => event.stopPropagation()}>
          <div className="scroll-thumb" style={{ width: thumbW, transform: `translateX(${posX}px)` }}
            onPointerDown={(event) => beginScroll('x', event)} />
        </div>
      )}
      {showY && (
        <div className="scroll-y" onPointerDown={(event) => event.stopPropagation()}>
          <div className="scroll-thumb" style={{ height: thumbH, transform: `translateY(${posY}px)` }}
            onPointerDown={(event) => beginScroll('y', event)} />
        </div>
      )}

    </div>
  );
});

export default MapCanvas;
