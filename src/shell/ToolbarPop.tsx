import { MARKER_GROUPS, markerColor, markerGlyph } from '../lib/markers';

/** 工具栏「插入」下拉里的条目。action 直接复用主菜单 / 右键菜单的动作名，
 *  因此同一个动作在菜单、快捷键和下拉里走的是同一段真实逻辑。 */
export interface InsertEntry {
  label: string;
  action: string;
  shortcut?: string;
  needsTopic?: boolean;
}

export interface InsertGroup {
  title: string;
  items: InsertEntry[];
}

export const INSERT_GROUPS: InsertGroup[] = [
  {
    title: '主题',
    items: [
      { label: '子主题', action: 'insert.child', shortcut: 'Tab', needsTopic: true },
      { label: '主题（之后）', action: 'insert.siblingAfter', shortcut: 'Enter', needsTopic: true },
      { label: '主题（之前）', action: 'insert.siblingBefore', shortcut: 'Shift+Enter', needsTopic: true },
      { label: '父主题', action: 'insert.parent', shortcut: 'Ctrl+Enter', needsTopic: true },
      { label: '自由主题', action: 'insert.floating' },
      { label: '标注', action: 'insert.callout' },
    ],
  },
  {
    title: '联系与范围',
    items: [
      { label: '联系', action: 'insert.relation', shortcut: 'Ctrl+Shift+R', needsTopic: true },
      { label: '概要', action: 'insert.summary', needsTopic: true },
      { label: '外框', action: 'insert.boundary', shortcut: 'Ctrl+Shift+B', needsTopic: true },
    ],
  },
  {
    title: '信息与链接',
    items: [
      { label: '笔记', action: 'insert.note', shortcut: 'Ctrl+Shift+N', needsTopic: true },
      { label: '标签', action: 'insert.label', shortcut: 'Ctrl+Shift+L', needsTopic: true },
      { label: '网页链接', action: 'insert.linkWeb', shortcut: 'Ctrl+K', needsTopic: true },
      { label: '主题链接', action: 'insert.linkTopic', needsTopic: true },
      { label: '本地文件链接', action: 'insert.linkFile', needsTopic: true },
      { label: '标记', action: 'insert.marker', needsTopic: true },
    ],
  },
  {
    title: '资源与画布',
    items: [
      { label: '本地图片', action: 'insert.image', shortcut: 'Ctrl+Shift+I', needsTopic: true },
      { label: '主题属性…', action: 'insert.attrs' },
      { label: '新画布', action: 'insert.sheet', shortcut: 'Ctrl+Alt+N' },
      { label: '从主题新建画布', action: 'insert.sheetFromTopic', needsTopic: true },
    ],
  },
];

interface MarkerProps {
  active: string[];
  hasTopic: boolean;
  onToggle: (id: string) => void;
}

/** 与 XMind 一样，标记弹层保持打开，可以一次给主题加多个标记。 */
export function MarkerPop({ active, hasTopic, onToggle }: MarkerProps) {
  return (
    <div className="tool-pop tool-pop-marker" role="menu" aria-label="标记"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="tp-head">标记</div>
      {!hasTopic ? (
        <div className="tp-hint">请先在画布上选中一个主题</div>
      ) : MARKER_GROUPS.map((group) => (
        <div className="tp-group" key={group.title}>
          <div className="tp-title">{group.title}</div>
          <div className="tp-marks">
            {group.items.map((item) => (
              <button key={item.id} className={`tp-mark${active.includes(item.id) ? ' on' : ''}`}
                title={item.label} aria-label={item.label}
                aria-pressed={active.includes(item.id)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onToggle(item.id)}>
                <span className="tp-mark-glyph" style={{ color: markerColor(item.id) }}>
                  {markerGlyph(item.id)}
                </span>
                <span className="tp-mark-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="tp-foot">再次点击可取消标记</div>
    </div>
  );
}

interface InsertProps {
  hasTopic: boolean;
  onPick: (action: string) => void;
}

export function InsertPop({ hasTopic, onPick }: InsertProps) {
  return (
    <div className="tool-pop tool-pop-insert" role="menu" aria-label="插入其他元素"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="tp-head">插入</div>
      {INSERT_GROUPS.map((group, index) => (
        <div className="tp-group" key={group.title}>
          {index > 0 && <div className="tp-sep" />}
          <div className="tp-title">{group.title}</div>
          {group.items.map((entry) => (
            <button key={entry.action} className="tp-row" disabled={entry.needsTopic && !hasTopic}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onPick(entry.action)}>
              <span>{entry.label}</span>
              {entry.shortcut && <span className="tp-shortcut">{entry.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
