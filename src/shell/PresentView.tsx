/** 演说模式（全屏演示）。
 *
 *  XMind 的演说视图其实就是「把导图按幻灯片切开再全屏播放」：封面是中心主题，
 *  之后每个一级分支先来一张主题页（如果不隐藏），再来一张把它子主题列成要点
 *  的列表页，`演说方式` 决定要点是一次性铺开还是逐个出现。
 *  这里只依赖文档树与 `pitch` 设置，键盘 ←/→/↑/↓/空格 翻页，Esc 退出。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildSlides, DEFAULT_PITCH, PITCH_SWATCH, slideSize } from '../lib/pitch';
import type { Slide } from '../lib/pitch';
import type { Document } from '../lib/types';

interface Props {
  document: Document;
  onExit: () => void;
}

/** 进入一张列表页时已经露出的要点数。 */
function initialReveal(slide: Slide, method: string): number {
  if (slide.kind !== 'list') return 0;
  if (method === 'all') return slide.bullets.length;
  return Math.min(1, slide.bullets.length);
}

export default function PresentView({ document: doc, onExit }: Props) {
  const sheet = doc.sheets[doc.activeSheet];
  const pitch = doc.pitch ?? DEFAULT_PITCH;
  const slides = useMemo(() => buildSlides(sheet.root, pitch), [sheet.root, pitch]);
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState(() => initialReveal(slides[0], pitch.method));

  const goto = useCallback((next: number) => {
    const target = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(target);
    setReveal(initialReveal(slides[target], pitch.method));
  }, [slides, pitch.method]);

  const next = useCallback(() => {
    const slide = slides[index];
    if (slide?.kind === 'list' && reveal < slide.bullets.length) { setReveal(reveal + 1); return; }
    if (index < slides.length - 1) goto(index + 1);
  }, [slides, index, reveal, goto]);

  const prev = useCallback(() => {
    const slide = slides[index];
    if (slide?.kind === 'list' && reveal > initialReveal(slide, pitch.method)) {
      setReveal(reveal - 1);
      return;
    }
    if (index > 0) goto(index - 1);
  }, [slides, index, reveal, pitch.method, goto]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); onExit(); return; }
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(key)) {
        event.preventDefault(); event.stopPropagation(); next(); return;
      }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) {
        event.preventDefault(); event.stopPropagation(); prev(); return;
      }
      if (key === 'Home') { event.preventDefault(); event.stopPropagation(); goto(0); return; }
      if (key === 'End') { event.preventDefault(); event.stopPropagation(); goto(slides.length - 1); return; }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [next, prev, onExit, goto, slides.length]);

  const skin = PITCH_SWATCH[pitch.style] ?? PITCH_SWATCH.dark;
  const size = slideSize(pitch.ratio);
  const slide = slides[index];
  const shown = slide.kind === 'list' ? slide.bullets.slice(0, reveal) : [];
  const total = slides.length;

  return (
    <div className="present" role="dialog" aria-label="演说模式"
      style={{ background: skin.bg === '#000000' || pitch.style === 'midnight-rose' ? '#0b0b0f' : '#1c1c1e' }}>
      <div className="present-stage"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (event.clientX - box.left > box.width / 2) next(); else prev();
        }}>
        <div key={`${index}-${slide.kind}`}
          className={`present-slide is-${pitch.style} kind-${slide.kind} layout-${pitch.layout}`}
          style={{
            background: skin.bg, color: skin.ink,
            width: `min(92vw, ${Math.round((84 * size.w) / size.h)}vh)`,
            aspectRatio: `${size.w} / ${size.h}`,
          }}>
          {slide.kind === 'cover' ? (
            <div className="ps-cover">
              <span className="ps-cover-title">{slide.title}</span>
              <span className="ps-cover-sub" style={{ color: skin.sub }}>{sheet.title || '思维导图'}</span>
            </div>
          ) : (
            <div className="ps-body">
              <span className="ps-title">{slide.title}</span>
              {slide.kind === 'list' ? (
                <ul className="ps-list">
                  {shown.map((bullet, i) => (
                    <li key={bullet.id}
                      className={`ps-item${i === shown.length - 1 && pitch.method === 'drill' ? ' is-current' : ''}`}>
                      <span className="ps-dot" style={{ background: skin.ink }} />
                      <span className="ps-text">{bullet.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="present-bar">
        <button className="present-exit" onClick={onExit} title="退出演说（Esc）">退出</button>
        <span className="present-count">{index + 1} / {total}</span>
        <span className="present-hint">← → 翻页 · Esc 退出</span>
        <div className="present-track">
          <span style={{ width: `${((index + 1) / Math.max(1, total)) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
