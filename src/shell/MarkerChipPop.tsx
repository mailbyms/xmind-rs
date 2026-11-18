import { useEffect, useRef } from 'react';
import { MARKER_GROUPS, markerIcon, markerLabel } from '../lib/markers';

interface Props {
  /** Marker id that was clicked inside a topic. */
  marker: string;
  /** Viewport anchor: the bottom centre of the clicked marker chip. */
  x: number;
  y: number;
  /** `null` means "remove this marker"; otherwise the replacement id. */
  onPick: (marker: string | null) => void;
  onClose: () => void;
}

/**
 * The shipped XMind popover for a single in-box marker: one row of *every
 * marker in the same group* plus a trash button, anchored below the topic.
 * Captured from 23.07 (FINDINGS §48) — clicking `star-red` opens
 * `star-red / orange / yellow / green / blue / purple / gray` and a delete
 * button, with a transparent full-window overlay behind it.
 */
export default function MarkerChipPop({ marker, x, y, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const group = MARKER_GROUPS.find((entry) => entry.items.some((item) => item.id === marker));
  const items = group?.items ?? [];

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // Clicking another chip toggles the popover through the canvas handler;
      // letting this listener close it first would make that impossible.
      if (target?.closest('.marker-chip-pop') || target?.closest('.marker-chip')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="marker-pop-overlay" onContextMenu={(event) => event.preventDefault()} />
      <div ref={ref} className="marker-chip-pop" role="menu" aria-label="更换标记"
        style={{ left: x, top: y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <div className="mcp-icons">
          {items.length === 0 && <span className="mcp-empty">未识别的标记：{marker}</span>}
          {items.map((item) => (
            <button key={item.id} type="button"
              className={`mcp-icon${item.id === marker ? ' on' : ''}`}
              data-marker-id={item.id}
              title={markerLabel(item.id)} aria-label={markerLabel(item.id)}
              onClick={() => onPick(item.id)}>
              <img src={item.icon || markerIcon(item.id)} alt="" draggable={false} />
            </button>
          ))}
        </div>
        <div className="mcp-sep" />
        <button className="mcp-trash" type="button" title="删除该标记"
          aria-label="删除该标记" data-marker-delete="1" onClick={() => onPick(null)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M11.155 15.78c1.107 0 1.804-.643 1.86-1.758l.45-9.768h.704c.39 0 .684-.294.684-.684a.667.667 0 0 0-.684-.676h-2.973v-.848C11.196.938 10.423.22 9.172.22H6.821C5.57.22 4.797.938 4.797 2.046v.848h-2.96c-.39 0-.69.293-.69.676 0 .39.3.684.69.684h.698l.458 9.775c.054 1.115.745 1.75 1.866 1.75h6.296zM9.774 2.893H6.226l.007-.793c0-.37.273-.63.67-.63h2.194c.397 0 .67.26.67.63l.007.793zm1.196 11.511H5.03c-.37 0-.622-.266-.643-.67l-.444-9.481h8.1l-.43 9.481c-.014.41-.267.67-.643.67zM9.506 13.34c.274 0 .486-.233.493-.547l.205-6.877c.013-.314-.205-.554-.479-.554-.273 0-.492.246-.499.547l-.205 6.877c-.014.308.205.554.485.554zm-3.012 0c.287 0 .499-.246.492-.554L6.78 5.908c-.014-.3-.233-.547-.5-.547-.28 0-.491.24-.478.554l.205 6.877c.007.314.212.547.486.547z"
              fill="currentColor" fillRule="nonzero" />
          </svg>
        </button>
      </div>
    </>
  );
}
