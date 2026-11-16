import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SWATCHES } from './tiles';

export interface Anchor { left: number; right: number; top: number; bottom: number }

const MARGIN = 8;

/** A floating panel anchored to a control inside the inspector.
 *
 *  Mirrors `.uk-pop.uk-popover` of the shipped app: 10px radius, 70% white
 *  over a 30px blur, and a soft drop shadow. It always opens toward the
 *  canvas (to the left of the 268px rail) and flips above the anchor when the
 *  panel would leave the viewport — the same four `uk-popover-*` placements
 *  the original switches between. */
export function Popover({ anchor, width, height, align = 'below', side = 'right', className = '', onClose, children }: {
  anchor: Anchor;
  width: number;
  /** Fixed panel height (the 骨架 library scrolls inside 496px). */
  height?: number;
  /** `top` pins the panel's top edge to the control — the shipped
   *  `uk-popover-left-top` placement used by the skeleton library;
   *  `center` centres the panel on the control (`uk-popover-left-center`,
   *  used by the 配色方案 board). */
  align?: 'below' | 'top' | 'center';
  /** `left` parks the panel to the left of the control instead of right-
   *  aligning with its right edge. */
  side?: 'right' | 'left';
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const natural = node?.offsetHeight ?? 0;
    // Right-align with the control (or sit just left of it), then keep the
    // panel inside the viewport.
    let left = side === 'left' ? anchor.left - 6 - width : anchor.right - width;
    left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
    if (align === 'center') {
      // `uk-popover-left-center`: vertically centred on the control, clipped at
      // the window edge instead of being squeezed.
      const want = height ?? natural;
      const mid = (anchor.top + anchor.bottom) / 2;
      const top = Math.min(Math.max(MARGIN, mid - want / 2), window.innerHeight - MARGIN - want);
      setPos({ left: Math.round(left), top: Math.round(top), maxHeight: want });
      return;
    }
    if (align === 'top') {
      // `uk-popover-left-top`: top edge level with the control. When the panel
      // would overflow the window it slides up instead of being squeezed, so
      // the 骨架 board keeps its full height and scrolls inside.
      const want = height ?? natural;
      const below = window.innerHeight - MARGIN - anchor.top;
      const top = below >= want ? anchor.top : Math.max(MARGIN, window.innerHeight - MARGIN - want);
      const avail = window.innerHeight - MARGIN - top;
      setPos({ left: Math.round(left), top: Math.round(top), maxHeight: Math.min(want, avail) });
      return;
    }
    let top = anchor.bottom + 6;
    let maxHeight: number | undefined;
    if (top + natural > window.innerHeight - MARGIN) {
      const above = anchor.top - 6 - MARGIN;
      if (above > natural || above > window.innerHeight - anchor.bottom - 6) {
        top = Math.max(MARGIN, anchor.top - 6 - natural);
        if (natural > above) maxHeight = above;
      } else {
        top = anchor.bottom + 6;
        maxHeight = window.innerHeight - MARGIN - top;
      }
    }
    setPos({ left: Math.round(left), top: Math.round(top), maxHeight });
  }, [anchor.left, anchor.right, anchor.top, anchor.bottom, width, height, align, side]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`pop ${className}`}
      style={{
        width, left: pos?.left ?? -9999, top: pos?.top ?? -9999,
        maxHeight: pos?.maxHeight,
        overflowY: pos?.maxHeight && align !== 'center' ? 'auto' : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

export interface MenuItem { value: string; label: string; divider?: boolean }

/** List menu: 27px rows with the shipped 28px text inset, hairline
 *  separators, and the chosen row in `rgb(15,102,222)` with `#fafafb` text. */
export function Menu({ items, value, onPick, width, compact }: {
  items: MenuItem[];
  value: string | null;
  onPick: (value: string) => void;
  width: number;
  /** The 72px font-size ladder: 4px list padding and 4px row gutters. */
  compact?: boolean;
}) {
  return (
    <ul className={`pop-menu${compact ? ' compact' : ''}`} style={{ width }}>
      {items.map((item) => (
        <Fragment key={item.value}>
          {item.divider ? <li className="pop-sep" /> : null}
          <li>
            <button className={item.value === value ? 'on' : ''} onClick={() => onPick(item.value)}>
              <span className="pop-label">{item.label}</span>
            </button>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

/** Tile library (shapes, fills, borders, branch lines, arrow ends). The
 *  padding lives on the popover shell, exactly like `.popover-list`. */
export function TileGrid({ tiles, value, onPick, columns, tileWidth, tileHeight, gap }: {
  tiles: { value: string; label: string; src: string }[];
  value: string | null;
  onPick: (value: string) => void;
  columns: number;
  tileWidth: number;
  tileHeight: number;
  gap?: number;
}) {
  return (
    <div className="pop-tiles"
      style={{ gridTemplateColumns: `repeat(${columns}, ${tileWidth}px)`, gap: `${gap ?? 8}px` }}>
      {tiles.map((tile) => (
        <button key={tile.value} title={tile.label}
          className={`pop-tile${tile.value === value ? ' on' : ''}`}
          style={{ width: tileWidth, height: tileHeight }}
          onClick={() => onPick(tile.value)}>
          <img src={tile.src} alt={tile.label} draggable={false} />
        </button>
      ))}
    </div>
  );
}

const RECENT_KEY = 'xmind-rs.recent-colors';

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) as string[] : [];
    return Array.isArray(list) ? list.slice(0, 9) : [];
  } catch { return []; }
}

function pushRecent(color: string): string[] {
  const next = [color, ...loadRecent().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 9);
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** `.uk-color-well-popover`: 9x5 swatch grid, hex + opacity row and the
 *  最近使用 strip, separated by the shipped hairline. */
export function ColorPicker({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const parsed = parseColor(value);
  const [hex, setHex] = useState(parsed.hex);
  const [alpha, setAlpha] = useState(String(parsed.alpha));

  useEffect(() => {
    const next = parseColor(value);
    setHex(next.hex);
    setAlpha(String(next.alpha));
  }, [value]);

  const commit = (nextHex: string, nextAlpha: number) => {
    const base = `#${nextHex.replace('#', '').slice(0, 6).toUpperCase()}`;
    const color = withAlpha(base, nextAlpha);
    setRecent(pushRecent(color));
    onPick(color);
  };

  const current = `#${hex.replace('#', '').slice(0, 6)}`;

  return (
    <div className="pop-color">
      <div className="pc-section">
        <div className="pc-grid">
          {SWATCHES.map((swatch) => (
            <button key={swatch} className="pc-swatch" style={{ background: swatch }}
              title={swatch}
              onClick={() => {
                const next = Number(alpha) > 0 ? Number(alpha) : 100;
                setAlpha(String(next));
                commit(swatch, next);
              }} />
          ))}
        </div>
        <div className="pc-row">
          <div className="pc-input">
            <span className="pc-hash">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M6.2 2.4L4.6 13.6M11.2 2.4L9.6 13.6M2.4 6h11M2 10.2h11"
                  stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            </span>
            <input className="pc-hex" value={hex} spellCheck={false}
              onChange={(event) => setHex(event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
              onBlur={() => commit(current, Number(alpha) || 0)}
              onKeyDown={(event) => { if (event.key === 'Enter') commit(current, Number(alpha) || 0); }} />
            <span className="pc-divider" />
            <input className="pc-alpha" value={alpha}
              onChange={(event) => setAlpha(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              onBlur={() => commit(current, Number(alpha) || 0)}
              onKeyDown={(event) => { if (event.key === 'Enter') commit(current, Number(alpha) || 0); }} />
            <span className="pc-percent">%</span>
          </div>
          <span className="pc-preview" style={{ background: current, opacity: (Number(alpha) || 0) / 100 }} />
          <label className="pc-more" title="更多颜色">
            <span className="pc-ring" style={{ background: `conic-gradient(#ff2d2d, #ffeb2d, #2dff56, #2dfbff, #2d47ff, #ff2df0, #ff2d2d)` }} />
            <input type="color" value={current}
              onChange={(event) => { setHex(event.target.value.slice(1)); commit(event.target.value, 100); }} />
          </label>
        </div>
      </div>
      <hr className="pc-sep" />
      <div className="pc-section">
        <div className="pc-recent-title">最近使用</div>
        <div className="pc-recent">
          {(recent.length ? recent : SWATCHES.slice(0, 9)).map((color, index) => (
            <button key={`${color}-${index}`} className="pc-swatch" style={{ background: color }}
              title={color}
              onClick={() => {
                const next = parseColor(color);
                setHex(next.hex); setAlpha(String(next.alpha));
                commit(next.hex, next.alpha);
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** `#RRGGBB` / `#RRGGBBAA` → editable parts. */
export function parseColor(input: string | null | undefined): { hex: string; alpha: number } {
  if (!input || input === 'none' || input === 'transparent') return { hex: 'FFFFFF', alpha: 100 };
  const raw = input.replace('#', '');
  if (/^[0-9a-fA-F]{8}$/.test(raw)) {
    return { hex: raw.slice(0, 6).toUpperCase(), alpha: Math.round(parseInt(raw.slice(6), 16) / 2.55) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return { hex: raw.toUpperCase(), alpha: 100 };
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return { hex: raw.split('').map((c) => c + c).join('').toUpperCase(), alpha: 100 };
  }
  return { hex: 'FFFFFF', alpha: 100 };
}

/** `#RRGGBBAA` when translucent, plain hex otherwise. */
export function withAlpha(hex: string, alpha: number): string {
  const base = `#${hex.replace('#', '').slice(0, 6).toUpperCase()}`;
  return alpha >= 100 ? base : `${base}${Math.round(alpha * 2.55).toString(16).padStart(2, '0')}`;
}
