import { useState } from 'react';
import { api } from '../lib/api';
import type { Action } from '../lib/api';
import type { Snapshot, Topic } from '../lib/types';

interface Props {
  snapshot: Snapshot;
  selected: string | null;
  onAction: Action;
  onClose: () => void;
  notify: (message: string) => void;
}

function findTopic(root: Topic, id: string): Topic | null {
  if (root.id === id) return root;
  for (const list of [root.children, root.detached, root.summary, root.callout]) {
    for (const topic of list ?? []) {
      const found = findTopic(topic, id);
      if (found) return found;
    }
  }
  return null;
}

const MARKERS = [
  'priority-1', 'priority-2', 'priority-3', 'priority-4', 'priority-5', 'priority-6',
  'task-done', 'task-start', 'flag-red', 'flag-blue', 'star-yellow',
];

export default function TopicAttrs({ snapshot, selected, onAction, onClose, notify }: Props) {
  const sheet = snapshot.document.sheets[snapshot.document.activeSheet];
  const topic = selected ? findTopic(sheet.root, selected) : null;
  const [title, setTitle] = useState(topic?.title ?? '');
  const [note, setNote] = useState(topic?.note ?? '');
  const [labels, setLabels] = useState((topic?.labels ?? []).join(', '));
  const [href, setHref] = useState(topic?.href ?? '');

  if (!topic) {
    return (
      <aside className="panel">
        <div className="panel-head"><h3>主题属性</h3><button className="panel-close" onClick={onClose}>×</button></div>
        <div className="panel-body"><p className="hint">在画布上选中一个主题后再编辑属性。</p></div>
      </aside>
    );
  }

  const id = topic.id;
  const colors = snapshot.layout.theme.branches;

  const onImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? '');
      void api.resourcePut(data, file.name)
        .then((resource) => onAction('setImage', { id, resource: resource.id }))
        .then(() => notify('已插入图片并写入 .xmind 资源'))
        .catch((error) => notify(String(error)));
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h3>格式 / 属性</h3>
        <button className="panel-close" onClick={onClose} aria-label="关闭">×</button>
      </div>
      <div className="panel-body">
        <div className="field">
          <label>标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== topic.title) void onAction('rename', { id, title }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </div>

        <div className="field">
          <label>笔记（写入 notes.plain.content）</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== (topic.note ?? '')) void onAction('setNote', { id, note }); }} />
        </div>

        <div className="field">
          <label>标签（英文逗号分隔）</label>
          <input value={labels} onChange={(e) => setLabels(e.target.value)}
            onBlur={() => {
              const list = labels.split(/[,，]/).map((v) => v.trim()).filter(Boolean);
              void onAction('setLabels', { id, labels: list });
            }} />
        </div>

        <div className="field">
          <label>超链接</label>
          <input value={href} onChange={(e) => setHref(e.target.value)}
            placeholder="https://... 或 xmind:#主题链接"
            onBlur={() => void onAction('setHref', { id, href: href.trim() || null })} />
        </div>

        <div className="section-title">标记</div>
        <div className="marker-grid">
          {MARKERS.map((marker) => (
            <button key={marker}
              className={`marker-btn${(topic.markers ?? []).includes(marker) ? ' active' : ''}`}
              onClick={() => void onAction('toggleMarker', { id, marker })}>
              {marker.replace('priority-', 'P').replace('task-', '任务-').replace('flag-', '旗-').replace('star-', '星-')}
            </button>
          ))}
        </div>

        <div className="section-title">主题填充</div>
        <div className="swatches">
          {colors.map((color) => (
            <button key={color} className="swatch"
              style={{ background: color }}
              title={color}
              onClick={() => void onAction('setStyle', { id, style: { fill: color, color: '#ffffff' } })} />
          ))}
          <button className="btn" onClick={() => void onAction('clearStyle', { id })}>恢复默认</button>
        </div>

        {topic.side !== undefined && (
          <>
            <div className="section-title">主分支方向</div>
            <div className="row">
              <button className="btn" onClick={() => void onAction('setSide', { id, side: 'right' })}>右侧</button>
              <button className="btn" onClick={() => void onAction('setSide', { id, side: 'left' })}>左侧</button>
              <button className="btn" onClick={() => void onAction('setSide', { id, side: null })}>自动</button>
            </div>
          </>
        )}

        <div className="section-title">图片资源</div>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={(e) => onImage(e.target.files?.[0])} />
        <p className="hint" style={{ marginTop: 6 }}>
          图片按 SHA-256 命名存入自有数据目录，保存时写入 resources/ 并登记到 manifest.json。
        </p>
        {topic.image && (
          <button className="btn" style={{ marginTop: 8 }}
            onClick={() => void onAction('setImage', { id, resource: null })}>移除图片</button>
        )}

        <div className="section-title">操作</div>
        <div className="row">
          <button className="btn" onClick={() => void onAction('addChild', { id })}>添加子主题</button>
          <button className="btn" onClick={() => void onAction('addSibling', { id })}>添加同级</button>
          <button className="btn" onClick={() => void onAction('remove', { id })}>删除主题</button>
        </div>
      </div>
    </aside>
  );
}
