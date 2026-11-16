/** 演说（Pitch）相关的共享常量与幻灯片推导。
 *
 *  常量取自原版面板实测：风格库 7 张 `static/images/pitchmode/theme/16_9/*.svg`
 *  （已解包到 `public/pitch`），长宽比 5 项，主题/列表幻灯片 3 项，演说方式 3 项。
 *  幻灯片推导只依赖文档树与 `pitch` 设置，不依赖画布几何。 */
import type { PitchSettings, Topic } from './types';

export const PITCH_STYLES: { value: string; label: string; src: string }[] = [
  { value: 'light', label: '浅色', src: '/pitch/light.svg' },
  { value: 'dark', label: '深色', src: '/pitch/dark.svg' },
  { value: 'innocence', label: '缤纷童趣', src: '/pitch/innocence.svg' },
  { value: 'shape-for-you', label: '雅致色块', src: '/pitch/shape-for-you.svg' },
  { value: 'midnight-rose', label: '午夜玫瑰', src: '/pitch/midnight-rose.svg' },
  { value: 'hubble-bubble', label: '灵动气泡', src: '/pitch/hubble-bubble.svg' },
  { value: 'hand-drawn', label: '手绘涂鸦', src: '/pitch/hand-drawn.svg' },
];

export const PITCH_RATIOS = [
  { value: 'auto', label: '自动' }, { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
  { value: '3:4', label: '3:4' },
];

export const PITCH_SHOW = [
  { value: 'auto', label: '自动' }, { value: 'show', label: '显示' }, { value: 'hide', label: '隐藏' },
];

export const PITCH_METHODS = [
  { value: 'drill', label: '逐一出现并钻入' },
  { value: 'fade', label: '逐一出现' },
  { value: 'all', label: '一次性出现' },
];

/** 每种风格的底/字/次字颜色，供面板预览与演说视图共用。 */
export const PITCH_SWATCH: Record<string, { bg: string; ink: string; sub: string }> = {
  light: { bg: '#ffffff', ink: '#1a1a1a', sub: '#7a7a7a' },
  dark: { bg: '#000000', ink: '#ffffff', sub: '#9a9a9a' },
  innocence: { bg: '#fdf3e3', ink: '#8a4b13', sub: '#c08a4a' },
  'shape-for-you': { bg: '#f1f2f7', ink: '#242436', sub: '#767b96' },
  'midnight-rose': { bg: '#1d1033', ink: '#ffd9e8', sub: '#a98bc4' },
  'hubble-bubble': { bg: '#e9f4ff', ink: '#123a63', sub: '#6c8fae' },
  'hand-drawn': { bg: '#faf7ef', ink: '#2b2b2b', sub: '#8a8378' },
};

export const DEFAULT_PITCH: PitchSettings = {
  ratio: 'auto', topicSlides: 'auto', listSlides: 'auto',
  method: 'drill', layout: 1, style: 'dark',
};

export function pitchLabel(list: { value: string; label: string }[], value: string, fallback: string) {
  return list.find((entry) => entry.value === value)?.label ?? fallback;
}

/** 一张幻灯片：封面 / 主题页 / 列表页。 */
export interface Slide {
  kind: 'cover' | 'topic' | 'list';
  id: string;
  title: string;
  bullets: { id: string; text: string }[];
  /** 列表页的第一个子主题数量，供「逐一出现」逐步揭示。 */
  step: number;
}

/** 由画布根主题推导幻灯片序列。
 *  - 封面：根主题；
 *  - 每个一级分支：主题页（`topicSlides`）+ 列表页（`listSlides`，列出其子主题）；
 *  - `show` 强制生成，`hide` 永不生成，`auto` 只在有子主题时生成主题页、有内容时生成列表页。 */
export function buildSlides(root: Topic, pitch: PitchSettings): Slide[] {
  const slides: Slide[] = [{ kind: 'cover', id: root.id, title: root.title || '中心主题', bullets: [], step: 0 }];
  const branches = (root.children ?? []).filter((child) => !child.folded);
  for (const branch of branches) {
    const kids = (branch.children ?? []).filter((child) => !child.folded);
    const wantTopic = pitch.topicSlides === 'show'
      || (pitch.topicSlides === 'auto' && kids.length > 0);
    const wantList = kids.length > 0
      && (pitch.listSlides === 'show' || pitch.listSlides === 'auto');
    if (wantTopic) {
      slides.push({ kind: 'topic', id: branch.id, title: branch.title || '主题', bullets: [], step: 0 });
    }
    if (wantList) {
      slides.push({
        kind: 'list', id: branch.id, title: branch.title || '主题',
        bullets: kids.map((kid) => ({ id: kid.id, text: kid.title || '子主题' })),
        step: pitch.method === 'all' ? kids.length : 0,
      });
    }
    if (!wantTopic && !wantList) {
      slides.push({ kind: 'topic', id: branch.id, title: branch.title || '主题', bullets: [], step: 0 });
    }
  }
  return slides;
}

/** 幻灯片画布尺寸（16:9 1600x900 与其余三种比例）。 */
export function slideSize(ratio: string): { w: number; h: number } {
  switch (ratio) {
    case '4:3': return { w: 1400, h: 1050 };
    case '9:16': return { w: 900, h: 1600 };
    case '3:4': return { w: 1050, h: 1400 };
    default: return { w: 1600, h: 900 };
  }
}
