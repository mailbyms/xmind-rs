/** XMind 原生 markerId。工具栏标记弹层、主题属性面板与画布角标共用这一份
 *  定义，避免三处各写一套标题/图标导致选中的标记在画布上显示成别的样子。
 *  保存时由 xmind-file 写入 topic.markers（对象数组或字符串数组均可读回）。 */
export interface MarkerDef {
  id: string;
  label: string;
  /** 16px 角标与弹层按钮里显示的短字形。 */
  glyph: string;
  color: string;
}

export interface MarkerGroup {
  title: string;
  items: MarkerDef[];
}

export const MARKER_GROUPS: MarkerGroup[] = [
  {
    title: '优先级',
    items: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `priority-${n}`,
      label: `优先级 ${n}`,
      glyph: String(n),
      color: '#e2483f',
    })),
  },
  {
    title: '任务进度',
    items: [
      { id: 'task-start', label: '任务开始', glyph: '▶', color: '#2f7ee5' },
      { id: 'task-done', label: '任务完成', glyph: '✓', color: '#28a06a' },
    ],
  },
  {
    title: '旗帜',
    items: [
      { id: 'flag-red', label: '红旗', glyph: '⚑', color: '#e2483f' },
      { id: 'flag-blue', label: '蓝旗', glyph: '⚑', color: '#2f7ee5' },
    ],
  },
  {
    title: '其他',
    items: [
      { id: 'star-yellow', label: '星标', glyph: '★', color: '#e3a008' },
    ],
  },
];

const BY_ID = new Map(MARKER_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));

export const MARKERS: string[] = [...BY_ID.keys()];

/** 画布角标用的极短字形；未知 markerId 回退成圆点。 */
export function markerGlyph(id: string): string {
  if (BY_ID.has(id)) return BY_ID.get(id)!.glyph;
  if (id.startsWith('priority-')) return id.slice(-1);
  if (id.startsWith('task-')) return 'T';
  if (id.startsWith('flag-')) return 'F';
  if (id.startsWith('star-')) return '★';
  return '•';
}

export function markerColor(id: string): string {
  return BY_ID.get(id)?.color ?? '#f9423a';
}
