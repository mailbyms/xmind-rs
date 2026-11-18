import { useEffect, useState } from 'react';
import { MARKER_GROUPS, MARKER_UI, markerIcon, markerLabel } from '../lib/markers';
import { ILLUSTRATION_GROUPS, STICKER_GROUPS, type IconGroup, type IconItem } from '../lib/icon-data';

/** 工具栏「插入」下拉按原版保留 5 项；链接 / 附件 / 语音备注 / 方程不实现。 */
export interface InsertEntry {
  label: string;
  action: string;
  needsTopic?: boolean;
}

export interface InsertGroup {
  title: string;
  items: InsertEntry[];
}

export const INSERT_GROUPS: InsertGroup[] = [
  {
    title: '信息',
    items: [
      { label: '笔记', action: 'insert.note', needsTopic: true },
      { label: '标签', action: 'insert.label', needsTopic: true },
    ],
  },
  {
    title: '素材',
    items: [
      { label: '贴纸', action: 'insert.sticker', needsTopic: true },
      { label: '插画', action: 'insert.illustration', needsTopic: true },
      { label: '本地图片', action: 'insert.image', needsTopic: true },
    ],
  },
];

export type IconTab = 'marker' | 'sticker' | 'illustration';

interface MarkerProps {
  used: string[];
  hasTopic: boolean;
  initialTab?: IconTab;
  onToggle: (id: string) => void;
  onPickIcon: (kind: 'sticker' | 'illustration', item: IconItem) => void;
  onClose: () => void;
}

const TAB_LABEL: Record<IconTab, string> = {
  marker: '标记', sticker: '贴纸', illustration: '插画',
};
const TAB_ICON: Record<IconTab, string> = {
  marker: MARKER_UI.marker, sticker: MARKER_UI.sticker, illustration: MARKER_UI.illustration,
};

/** Matches the shipped XMind icon panel: three 16px icon-module tabs, close
 *  button, then either the 7 marker groups or the sticker / illustration
 *  catalogue with its 「类别」 filter. The official panel shows no selected
 *  state on the icon tiles. */
export function MarkerPop({
  used, hasTopic, initialTab = 'marker', onToggle, onPickIcon, onClose,
}: MarkerProps) {
  const [tab, setTab] = useState<IconTab>(initialTab);
  const [legend, setLegend] = useState(false);
  const [category, setCategory] = useState('全部');

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { setCategory('全部'); }, [tab]);

  const catalogue: IconGroup[] = tab === 'sticker' ? STICKER_GROUPS
    : tab === 'illustration' ? ILLUSTRATION_GROUPS : [];
  const visible = category === '全部' ? catalogue
    : catalogue.filter((group) => group.title === category);

  return (
    <div className={`tool-pop tool-pop-marker${tab !== 'marker' ? ' icon-mode' : ''}`}
      role="menu" aria-label={TAB_LABEL[tab]}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="tp-tabs">
        {(['marker', 'sticker', 'illustration'] as const).map((name) => (
          <button key={name} type="button"
            className={`tp-tab${tab === name ? ' on' : ''}`}
            aria-current={tab === name ? 'page' : undefined}
            title={TAB_LABEL[name]} aria-label={TAB_LABEL[name]}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setTab(name)}>
            <img src={TAB_ICON[name]} alt="" draggable={false} />
          </button>
        ))}
        <button className="tp-close" type="button" aria-label="关闭图标面板" title="关闭"
          onPointerDown={(event) => event.stopPropagation()} onClick={onClose}>×</button>
      </div>
      <div className="tp-sep" />
      {tab === 'marker' ? (
        <>
          <button className="tp-legend-btn" type="button" onClick={() => setLegend((value) => !value)}>
            {legend ? '隐藏图例' : '显示图例'}
          </button>
          {legend && (
            <div className="tp-legend">
              <div className="tp-legend-title">本图已用标记</div>
              {used.length === 0 ? (
                <div className="tp-legend-empty">当前导图尚未使用标记</div>
              ) : used.map((id) => (
                <div className="tp-legend-row" key={id} data-legend-marker={id}>
                  <img src={markerIcon(id)} alt="" draggable={false} />
                  <span>{markerLabel(id)}</span>
                </div>
              ))}
            </div>
          )}
          {!hasTopic ? (
            <div className="tp-hint">请先在画布上选中一个主题</div>
          ) : MARKER_GROUPS.map((group) => (
            <div className="tp-group" key={group.id}>
              <div className="tp-title">{group.title}</div>
              <div className="tp-marks">
                {group.items.map((item) => (
                  <button key={item.id} className="tp-mark"
                    data-marker-id={item.id}
                    title={item.label} aria-label={item.label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onToggle(item.id)}>
                    <img className="tp-mark-icon" src={item.icon} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="tp-category">
            <span>类别</span>
            <select value={category} aria-label="类别"
              onChange={(event) => setCategory(event.target.value)}>
              <option value="全部">全部</option>
              {catalogue.map((group) => (
                <option key={group.id} value={group.title}>{group.title}</option>
              ))}
            </select>
          </div>
          {!hasTopic && <div className="tp-hint">请先在画布上选中一个主题</div>}
          <div className="tp-icon-scroll">
            {visible.map((group) => (
              <div className="tp-group" key={group.id}>
                <div className="tp-title">{group.title}</div>
                <div className="tp-icon-grid">
                  {group.items.map((item) => (
                    <button key={item.id} className="tp-icon-item"
                      data-icon-id={item.id} title={item.id} aria-label={item.id}
                      disabled={!hasTopic}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onPickIcon(tab as 'sticker' | 'illustration', item)}>
                      <img src={item.icon} alt="" draggable={false} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
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
          {group.items.map((entry) => (
            <button key={entry.action} className="tp-row" data-action={entry.action}
              disabled={entry.needsTopic && !hasTopic}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onPick(entry.action)}>
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
