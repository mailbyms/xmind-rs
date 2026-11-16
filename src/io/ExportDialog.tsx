import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/api';

interface Props {
  onClose: () => void;
  notify: (message: string) => void;
  /** The main menu's 导出 > Markdown / OPML opens with that format selected. */
  initialFormat?: string;
}

const FORMATS = [
  { id: 'xmind', label: 'XMind 文件', ext: 'xmind', desc: '完整容器：content.json + metadata + manifest + 资源 + content.xml 占位。可被本机 XMind 直接打开。' },
  { id: 'svg', label: 'SVG 矢量图', ext: 'svg', desc: '由 Rust 布局引擎直接生成，与画布所见一致。' },
  { id: 'md', label: 'Markdown 大纲', ext: 'md', desc: '标题 + 缩进列表，适合笔记软件。' },
  { id: 'opml', label: 'OPML', ext: 'opml', desc: '通用大纲交换格式。' },
  { id: 'json', label: 'JSON（内部格式）', ext: 'json', desc: '便于调试或二次处理。' },
  { id: 'txt', label: '纯文本树', ext: 'txt', desc: '缩进纯文本。' },
];

export default function ExportDialog({ onClose, notify, initialFormat = 'svg' }: Props) {
  const [format, setFormat] = useState(FORMATS.some((entry) => entry.id === initialFormat) ? initialFormat : 'svg');
  const [busy, setBusy] = useState(false);
  const current = FORMATS.find((item) => item.id === format) ?? FORMATS[0];

  const run = async () => {
    setBusy(true);
    try {
      const path = await save({
        title: '导出思维导图',
        defaultPath: `思维导图.${current.ext}`,
        filters: [{ name: current.label, extensions: [current.ext] }],
      });
      if (!path) return;
      await api.export(path, current.id);
      notify(`已导出到 ${path}`);
      onClose();
    } catch (error) {
      notify(`导出失败：${String(error)}`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(10, 18, 34, .34)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30,
    }} onClick={onClose}>
      <div className="panel" style={{
        width: 440, height: 'auto', maxHeight: '80%', borderRadius: 12,
        border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden',
      }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>导出</h3>
          <button className="panel-close" onClick={onClose}>×</button>
        </div>
        <div className="panel-body">
          <div className="field">
            <label>格式</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label} (.{item.ext})</option>)}
            </select>
          </div>
          <p className="hint" style={{ minHeight: 42 }}>{current.desc}</p>
          <button className="btn primary" style={{ width: '100%', marginTop: 8 }}
            disabled={busy} onClick={() => void run()}>
            {busy ? '导出中…' : '选择路径并导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
