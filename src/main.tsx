import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// The startup chunk is only React + this 20-line bootstrap. Everything else,
// including the editor shell, is a separate chunk fetched after first paint.
const Shell = lazy(() => import('./shell/App'));

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<div className="boot"><div className="boot-mark" /><span>正在启动 XMind RS…</span></div>}>
    <Shell />
  </Suspense>,
);
