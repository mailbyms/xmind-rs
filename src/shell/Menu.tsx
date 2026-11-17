import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** One row of an XMind-style menu. `label === null` means a separator. */
export interface MenuItem {
  id: string;
  label: string | null;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
  action?: string;
  payload?: Record<string, unknown>;
  danger?: boolean;
}

export const sep = (id: string): MenuItem => ({ id, label: null });
export const item = (
  id: string, label: string, extra: Partial<MenuItem> = {},
): MenuItem => ({ id, label, ...extra });

interface LevelProps {
  items: MenuItem[];
  x: number;
  y: number;
  depth: number;
  onAction: (item: MenuItem) => void;
  /** Close only this level (Escape / ArrowLeft / parent focus restore). */
  onClose: () => void;
  /** Dismiss the whole popup tree after an item is activated. */
  onDismiss: () => void;
}

/** A single popup column. Submenus are further <MenuLevel> columns. */
function MenuLevel({ items, x, y, depth, onAction, onClose, onDismiss }: LevelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [focus, setFocus] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  // Native/uk-pop menus flip or slide when there is not enough room.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (r.right > window.innerWidth - 4) nx = Math.max(4, window.innerWidth - r.width - 4);
    if (r.bottom > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4);
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => { ref.current?.focus(); }, []);

  const usable = (index: number) => {
    const entry = items[index];
    return Boolean(entry && entry.label !== null && !entry.disabled);
  };
  const next = (from: number, step: number) => {
    let index = from;
    for (let i = 0; i < items.length; i += 1) {
      index = (index + step + items.length) % items.length;
      if (usable(index)) return index;
    }
    return -1;
  };

  const openSub = (index: number, element: HTMLElement) => {
    const entry = items[index];
    if (!entry?.submenu) { setSub(null); return; }
    const r = element.getBoundingClientRect();
    const panel = ref.current?.getBoundingClientRect();
    // Native menus open to the right and flip to the left near a screen edge.
    const flip = r.right + 220 > window.innerWidth;
    const nx = flip ? Math.max(4, r.left - (panel?.width ?? 210) + 4) : r.right - 4;
    setSub({ index, x: nx, y: r.top - 5 });
  };

  const activate = (index: number, element: HTMLElement) => {
    const entry = items[index];
    if (!entry || entry.label === null || entry.disabled) return;
    if (entry.submenu) { openSub(index, element); return; }
    // A leaf item must dismiss the *entire* menu tree. onClose here only closes
    // the current column (and is what Escape / ArrowLeft use), so clicking
    // e.g. 文件 > 最近打开 > foo.xmind would otherwise leave the parent panels
    // and the backdrop on screen while the document is already open.
    onAction(entry);
    onDismiss();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setFocus((f) => next(f, 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setFocus((f) => next(f, -1)); return; }
    if (event.key === 'ArrowRight' && focus >= 0 && items[focus]?.submenu) {
      event.preventDefault();
      const el = ref.current?.querySelector<HTMLElement>(`[data-mi="${focus}"]`);
      if (el) openSub(focus, el);
      return;
    }
    if (event.key === 'ArrowLeft' && depth > 0) { event.preventDefault(); onClose(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && focus >= 0) {
      event.preventDefault();
      const el = ref.current?.querySelector<HTMLElement>(`[data-mi="${focus}"]`);
      if (el) activate(focus, el);
    }
  };

  return (
    <>
      <div
        ref={ref}
        className="xm-panel"
        style={{ left: pos.x, top: pos.y }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        role="menu"
      >
        {items.map((entry, index) => entry.label === null ? (
          <div key={entry.id} className="xm-sep" />
        ) : (
          <button
            key={entry.id}
            data-mi={index}
            type="button"
            role="menuitem"
            className={`xm-item${focus === index ? ' focus' : ''}${sub?.index === index ? ' open' : ''}${entry.danger ? ' danger' : ''}`}
            disabled={entry.disabled}
            onMouseEnter={(event) => {
              setFocus(index);
              if (entry.submenu) openSub(index, event.currentTarget);
              else setSub(null);
            }}
            onClick={(event) => { event.stopPropagation(); activate(index, event.currentTarget); }}
          >
            <span className="xm-tick">{entry.checked ? '✓' : ''}</span>
            <span className="xm-label">{entry.label}</span>
            {entry.shortcut && <span className="xm-shortcut">{entry.shortcut}</span>}
            {entry.submenu && <span className="xm-arrow" aria-hidden="true">›</span>}
          </button>
        ))}
      </div>
      {sub && items[sub.index]?.submenu && (
        <MenuLevel
          items={items[sub.index].submenu as MenuItem[]}
          x={sub.x}
          y={sub.y}
          depth={depth + 1}
          onAction={onAction}
          onDismiss={onDismiss}
          onClose={() => { setSub(null); ref.current?.focus(); }}
        />
      )}
      {/* The parent level needs its own Escape/Left handling to close all. */}
      {depth === 0 && <MenuKeyBridge onClose={onClose} />}
    </>
  );
}

/** Escape must close the entire menu even while a submenu has focus. */
function MenuKeyBridge({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);
  return null;
}

export interface MenuProps {
  items: MenuItem[];
  x: number;
  y: number;
  onAction: (item: MenuItem) => void;
  onClose: () => void;
}

export default function Menu({ items, x, y, onAction, onClose }: MenuProps) {
  return (
    <>
      <div className="xm-backdrop" onPointerDown={onClose} onContextMenu={(event) => {
        event.preventDefault(); onClose();
      }} />
      <MenuLevel items={items} x={x} y={y} depth={0} onAction={onAction} onClose={onClose} onDismiss={onClose} />
    </>
  );
}
