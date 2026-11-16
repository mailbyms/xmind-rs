import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AiConfig, AiStatus, Snapshot } from '../lib/types';

interface Props {
  selected: string | null;
  onClose: () => void;
  onSnapshot: (value: Snapshot) => void;
  notify: (message: string) => void;
}

const PRESETS = [
  '按 MECE 拆解', '列出优缺点', '生成执行步骤', '做风险分析', '补充案例与数据',
];

export default function AiPanel({ selected, onClose, onSnapshot, notify }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [config, setConfig] = useState<AiConfig>({
    baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini',
    temperature: 0.6, enabled: false,
  });
  const [instruction, setInstruction] = useState(PRESETS[0]);
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    void Promise.all([api.aiStatus(), api.aiConfig()])
      .then(([s, c]) => { setStatus(s); setConfig(c); })
      .catch((error) => notify(String(error)));
  }, [notify]);

  const expand = async () => {
    if (!selected) { notify('请先选中一个主题'); return; }
    setBusy(true);
    try {
      const snapshot = await api.aiExpand(selected, instruction, count);
      onSnapshot(snapshot);
      notify(`已生成 ${count} 个子主题`);
    } catch (error) {
      notify(`AI 扩展失败：${String(error)}`);
    } finally { setBusy(false); }
  };

  const saveConfig = async () => {
    try {
      const next = await api.aiSetConfig(config);
      setStatus(next);
      setConfig((current) => ({ ...current, apiKey: '' }));
      notify(next.configured ? '已启用 OpenAI 兼容接口' : '已切换为离线演示模式');
    } catch (error) { notify(String(error)); }
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    setChat((current) => [...current, { role: 'user', text }]);
    try {
      const reply = await api.aiChat(text);
      setChat((current) => [...current, { role: 'assistant', text: reply }]);
    } catch (error) {
      setChat((current) => [...current, { role: 'assistant', text: `失败：${String(error)}` }]);
    }
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h3>AI 助手</h3>
        <button className="panel-close" onClick={onClose} aria-label="关闭">×</button>
      </div>
      <div className="panel-body">
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={`status-pill${status?.configured ? ' on' : ''}`}>
            ● {status?.configured ? 'OpenAI 兼容接口' : '离线演示模式'}
          </span>
          <button className="btn" onClick={() => setShowConfig((v) => !v)}>
            {showConfig ? '收起配置' : '接口配置'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {status?.configured
            ? `模型 ${status.model} · ${status.baseUrl}`
            : '未配置密钥时由本地 mock 生成大纲，不产生任何网络请求。'}
        </p>

        {showConfig && (
          <>
            <div className="section-title">OpenAI 兼容接口</div>
            <div className="field">
              <label>Base URL</label>
              <input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1" />
            </div>
            <div className="field">
              <label>API Key（{status?.keyHint ?? '未设置'}，留空表示保持不变）</label>
              <input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="sk-..." />
            </div>
            <div className="field">
              <label>模型</label>
              <input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  style={{ width: 'auto', marginRight: 6 }} />
                启用在线接口（关闭则回到离线模式）
              </label>
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => void saveConfig()}>保存配置</button>
              <button className="btn" onClick={() => void api.aiClearConfig().then((s) => { setStatus(s); notify('已清除接口配置'); })}>
                清除
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              密钥只写入自有数据目录的 ai.json，不会回传到页面，也不会在启动时读取。
            </p>
          </>
        )}

        <div className="section-title">扩展选中主题</div>
        <div className="field">
          <label>要求</label>
          <select value={instruction} onChange={(e) => setInstruction(e.target.value)}>
            {PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          </select>
        </div>
        <div className="field">
          <label>子主题数量：{count}</label>
          <input type="range" min={2} max={10} value={count}
            onChange={(e) => setCount(Number(e.target.value))} />
        </div>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy || !selected}
          onClick={() => void expand()}>
          {busy ? '生成中…' : '生成子主题'}
        </button>

        <div className="section-title">对话</div>
        <div className="chat-log">
          {chat.length === 0 && <span className="hint">可以就当前导图提问，例如「帮我收敛成三个关键点」。</span>}
          {chat.map((message, index) => (
            <div key={index} className={`chat-msg ${message.role}`}>
              {message.role === 'user' ? `你：${message.text}` : message.text}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void sendChat(); }}
            placeholder="输入问题后回车" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn" onClick={() => void sendChat()}>发送</button>
        </div>
      </div>
    </aside>
  );
}
