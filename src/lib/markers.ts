/** Official XMind marker catalogue, generated from the shipped renderer and
 *  app.asar. Every consumer (toolbar picker, topic attributes, canvas chips)
 *  must use this one definition so marker ids and icons stay in sync. */
import { MARKER_DATA } from './marker-data';
import type { MarkerDataItem } from './marker-data';

export { MARKER_UI } from './marker-data';

export interface MarkerDef extends MarkerDataItem {
  /** Short text fallback for contexts that cannot display the SVG icon. */
  glyph: string;
  color: string;
}

export interface MarkerGroup {
  id: string;
  title: string;
  items: MarkerDef[];
}

const FALLBACK_GLYPH: Record<string, string> = {
  'task-start': '▶', 'task-done': '✓', 'task-half': '½',
  'arrow-left': '←', 'arrow-right': '→', 'arrow-up': '↑', 'arrow-down': '↓',
  'arrow-refresh': '↻', 'priority-1': '1', 'priority-2': '2', 'priority-3': '3',
  'priority-4': '4', 'priority-5': '5', 'priority-6': '6', 'priority-7': '7',
};

const FALLBACK_COLOR: Record<string, string> = {
  red: '#e2483f', orange: '#ef8b2c', yellow: '#e3a008', green: '#28a06a',
  blue: '#2f7ee5', purple: '#8255c6', gray: '#7d8794',
};

function fallbackGlyph(id: string): string {
  if (FALLBACK_GLYPH[id]) return FALLBACK_GLYPH[id];
  if (id.startsWith('priority-')) return id.slice(-1);
  if (id.startsWith('task-')) return '◐';
  if (id.startsWith('star-')) return '★';
  if (id.startsWith('flag-')) return '⚑';
  if (id.startsWith('people-')) return '●';
  if (id.startsWith('tag-')) return '◆';
  return '•';
}

function fallbackColor(id: string): string {
  const match = Object.entries(FALLBACK_COLOR).find(([word]) => id.endsWith(`-${word}`));
  return match?.[1] ?? '#f9423a';
}

export const MARKER_GROUPS: MarkerGroup[] = MARKER_DATA.map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map((item) => ({
    ...item,
    glyph: fallbackGlyph(item.id),
    color: fallbackColor(item.id),
  })),
}));

const BY_ID = new Map(MARKER_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));

/** Catalogue group of a marker id; undefined for unknown/legacy ids. */
const GROUP_OF = new Map<string, string>(
  MARKER_GROUPS.flatMap((group) => group.items.map((item) => [item.id, group.id] as const)),
);

export function markerGroupOf(id: string): string | undefined {
  return GROUP_OF.get(id);
}

/** The shipped XMind keeps at most one marker per group on a topic.  Adding a
 *  marker from an occupied group replaces it in place; other groups survive. */
export function addMarkerExclusive(current: string[], marker: string): string[] {
  if (current.includes(marker)) return current;
  const group = markerGroupOf(marker);
  const next = [...current];
  const at = group ? next.findIndex((m) => markerGroupOf(m) === group) : -1;
  if (at >= 0) next[at] = marker;
  else next.push(marker);
  return next;
}

/** Attribute-panel variant of the same rule: clicking the active marker removes
 *  it, clicking another one replaces its group. */
export function toggleMarkerExclusive(current: string[], marker: string): string[] {
  if (current.includes(marker)) return current.filter((m) => m !== marker);
  return addMarkerExclusive(current, marker);
}

export const MARKERS: string[] = [...BY_ID.keys()];

/** 画布角标用的图标路径；未知 markerId 回退成空串，由上调用方画圆点。 */
export function markerIcon(id: string): string {
  return BY_ID.get(id)?.icon ?? '';
}

/** 画布角标用的极短字形；未知 markerId 回退成圆点。 */
export function markerGlyph(id: string): string {
  return BY_ID.get(id)?.glyph ?? '•';
}

export function markerColor(id: string): string {
  return BY_ID.get(id)?.color ?? '#f9423a';
}

export function markerLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}
