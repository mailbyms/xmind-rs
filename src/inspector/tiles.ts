/** Tile artwork captured from the shipped renderer (`scripts/dump-tiles.mjs`).
 *  Each entry carries the artwork file plus the exact style value the tile
 *  writes into the document. */

export interface Tile { value: string; label: string; src: string }

const T = (name: string) => `/tiles/${name}.svg`;

/** `org.xmind.topicShape.*` in the shipped grid order (3 per row). */
const SHAPES: [string, string, string][] = [
  ['roundedRect', '圆角矩形', 'shape-00-shape-rounded-rect'],
  ['rect', '矩形', 'shape-01-shape-rectangle'],
  ['ellipse', '椭圆', 'shape-02-shape-ellipse'],
  ['ellipserect', '胶囊', 'shape-03-shape-ellipse-rect'],
  ['underline', '下划线', 'shape-04-shape-underline'],
  ['diamond', '菱形', 'shape-05-shape-diamond'],
  ['circle', '圆形', 'shape-06-shape-circle'],
  ['parallelogram', '平行四边形', 'shape-07-shape-parallelogram'],
  ['hexagon', '六边形', 'shape-08-shape-hexagon'],
  ['roundedhexagon', '圆角六边形', 'shape-09-shape-rounded-hexagon'],
  ['ellipticrectangle', '圆角椭圆矩', 'shape-10-shape-elliptic-rect'],
  ['singlebreakangle', '折角矩形', 'shape-11-shape-single-breakangle'],
  ['doubleunderline', '双下划线', 'shape-12-shape-double-underline'],
  ['stack', '层叠', 'shape-13-shape-stack'],
  ['bookmark', '书签', 'shape-14-shape-bookmark'],
  ['cloud', '云朵', 'shape-15-shape-cloud'],
  ['cutdiamond', '切角菱形', 'shape-16-shape-cut-diamond'],
  ['waterdrop', '水滴', 'shape-17-shape-drop'],
  ['heart', '心形', 'shape-18-shape-heart'],
  ['label', '标签', 'shape-19-shape-label'],
  ['fatLeftArrow', '左箭头', 'shape-20-shape-left-arrow'],
  ['fatRightArrow', '右箭头', 'shape-21-shape-right-arrow'],
  ['shield', '盾形', 'shape-22-shape-shield'],
  ['star', '星形', 'shape-23-shape-star'],
  ['squareQuote', '尖括号', 'shape-24-shape-punctuation-angle-brackets'],
  ['curlyBracket', '大括号', 'shape-25-shape-punctuation-brace'],
  ['doubleQuote', '引号', 'shape-26-shape-punctuation-double-quotes'],
  ['doubleBookQuote', '书名号', 'shape-27-shape-punctuation-french-quotes'],
  ['roundBracket', '圆括号', 'shape-28-shape-punctuation-parentheses'],
  ['squareBracket', '方括号', 'shape-29-shape-punctuation-square-brackets'],
  ['singleBookQuote', '直角引号', 'shape-30-shape-punctuation-square-quotes'],
];

export const SHAPE_TILES: Tile[] = SHAPES.map(([value, label, file]) => ({
  value: `org.xmind.topicShape.${value}`, label, src: T(file),
}));

export const FILL_TILES: Tile[] = [
  ['solid', '实心', 'fill-00-solid'],
  ['solid-hand-drawn', '手绘实心', 'fill-01-solid-hand-drawn'],
  ['diagonal-hand-drawn', '手绘斜线', 'fill-02-diagonal-hand-drawn'],
  ['diagonal-thin-hand-drawn', '手绘细斜线', 'fill-03-diagonal-thin-hand-drawn'],
  ['horizontal-hand-drawn', '手绘横线', 'fill-04-horizontal-hand-drawn'],
  ['horizontal-thin-hand-drawn', '手绘细横线', 'fill-05-horizontal-thin-hand-drawn'],
].map(([value, label, file]) => ({ value, label, src: T(file) }));

export const BORDER_TILES: Tile[] = [
  ['solid', '实线', 'border-00-solid'],
  ['dash', '虚线', 'border-01-dash'],
  ['hand-drawn-solid', '手绘实线', 'border-02-hand-drawn-solid'],
  ['hand-drawn-dash', '手绘虚线', 'border-03-hand-drawn-dash'],
].map(([value, label, file]) => ({ value, label, src: T(file) }));

export const LINE_TILES: Tile[] = [
  ['roundedElbow', '圆角折线', 'line-00-line-rounded-elbow'],
  ['elbow', '折线', 'line-01-line-elbow'],
  ['straight', '直线', 'line-02-line-straight'],
  ['curve', '曲线', 'line-03-line-curve'],
  ['bight', '弧线', 'line-04-line-bight'],
  ['fold', '折角', 'line-05-line-fold'],
  ['roundedfold', '圆角折角', 'line-06-line-rounded-fold'],
].map(([value, label, file]) => ({
  value: `org.xmind.branchConnection.${value}`, label, src: T(file),
}));

export const ARROW_TILES: Tile[] = [
  ['none', '无', 'arrow-00-arrow-none'],
  ['dot', '圆点', 'arrow-01-arrow-end-dot'],
  ['triangle', '三角形', 'arrow-02-arrow-end-triangle'],
  ['spearhead', '尖头', 'arrow-03-arrow-end-spearhead'],
  ['square', '方块', 'arrow-04-arrow-end-square'],
  ['diamond', '菱形', 'arrow-05-arrow-end-diamond'],
  ['herringbone', '鱼骨', 'arrow-06-arrow-end-herringbone'],
  ['doublearrow', '双箭头', 'arrow-07-arrow-end-doublearrow'],
  ['antiTriangle', '反三角', 'arrow-08-arrow-end-antiTriangle'],
  ['attached', '附着', 'arrow-09-arrow-end-attached'],
  ['hook', '钩形', 'arrow-10-arrow-end-hook'],
].map(([value, label, file]) => ({
  value: `org.xmind.arrowShape.${value}`, label, src: T(file),
}));

/** The nine skeletons of the shipped structure library. */
export const SKELETON_TILES: Tile[] = [
  ['clockwise', '思维导图', 'skeleton-00-balanced-map-clockwise-Copy'],
  ['logicRight', '逻辑图', 'skeleton-01-logic-right-Copy'],
  ['braceRight', '括号图', 'skeleton-02-brace-right-Copy'],
  ['orgDown', '组织结构图', 'skeleton-03-org-down-Copy'],
  ['treeRight', '树形图', 'skeleton-04-tree-right-Copy'],
  ['timeline', '时间轴', 'skeleton-05-Page-1'],
  ['fishboneRight', '鱼骨图', 'skeleton-06-fishbone-left'],
  ['treetable', '树型表格', 'skeleton-07-treemap-row-Copy-2_'],
  ['matrix', '矩阵图', 'skeleton-08-matrix-row-Copy-3'],
].map(([value, label, file]) => ({ value, label, src: T(file) }));

/** The 45 swatches of the shipped colour picker, 5 rows of 9. */
export const SWATCHES = [
  '#FFFFFF', '#EEEEEE', '#D0D0D0', '#ADADAD', '#999999', '#666666', '#333333', '#111111', '#000000',
  '#FDD834', '#FF9595', '#8EDE99', '#0CE6CF', '#8EDDF9', '#50C3F7', '#7986CB', '#BA69C8', '#FFABD5',
  '#FFC009', '#FF5252', '#2CD551', '#00A99D', '#2ABEE0', '#05A8F4', '#4051B5', '#9C27B0', '#EA8ABA',
  '#FF9F00', '#FF3C00', '#19A719', '#007C74', '#0096BF', '#0288D1', '#303E9F', '#7B1FA2', '#CE4289',
  '#FF6F00', '#E32C2D', '#15831C', '#025A5A', '#00526B', '#00579B', '#1A227E', '#4A148C', '#A34075',
];

/** The nine branch-colour sets behind 分支配色 (6 hues each, used cyclically).
 *  The first six are the shipped `L` palette array; the last three come from
 *  the shipped theme palettes (`Freshness` / `Vintage` / `Sakura`). */
export const BRANCH_PALETTES: { name: string; colors: string[] }[] = [
  { name: '经典', colors: ['#F9423A', '#F6A04D', '#F3D321', '#00BC7B', '#486AFF', '#4D49BE'] },
  { name: '彩虹', colors: ['#FA8155', '#FFAD36', '#B7C82B', '#0098B9', '#7574BC', '#A165A8'] },
  { name: '水粉', colors: ['#E7C2C0', '#F3D4B2', '#D8DCAF', '#A8D4CC', '#B0C0D0', '#C8BAC9'] },
  { name: '雅致', colors: ['#D3BD6C', '#ADB66B', '#76B18A', '#54A39B', '#5192A4', '#7878A0'] },
  { name: '暖阳', colors: ['#F2D96E', '#FFBE71', '#FA8155', '#A61D39', '#C53F4D', '#FFA787'] },
  { name: '深海', colors: ['#0B5D99', '#534E96', '#7B4083', '#A23E6A', '#C34150', '#CA5835'] },
  { name: '清泉', colors: ['#F0F0F0', '#F2BDC7', '#F2DC6B', '#5BA683', '#B796D9', '#3C74A6'] },
  { name: '复古', colors: ['#E9C46A', '#F4A261', '#DC856F', '#A4705E', '#2A9D8F', '#264653'] },
  { name: '樱粉', colors: ['#FFE3E8', '#FFDCC8', '#FFB4B6', '#FFA9C6', '#D1C3BD', '#C1CFDE'] },
];

/** Font stack shown in the shipped font menu (Windows system fonts first). */export const FONT_FAMILIES = [
  'Roboto', 'NeverMind', '等线', '等线 Light', '方正舒体', '方正姚体', '仿宋', '楷体', '隶书',
  'Microsoft JhengHei', 'Microsoft JhengHei Light', '微软雅黑', '微软雅黑 Light',
  'Microsoft YaHei UI', 'Microsoft YaHei UI Light', 'MingLiU-ExtB', '新宋体', '宋体',
  'Segoe UI', 'Segoe UI Light', 'Tahoma', 'Times New Roman', 'Verdana', 'Arial', 'Georgia',
];

export const FONT_SIZES = [8, 10, 12, 14, 18, 24, 36, 48, 60];

/** Five weights plus their italic variants, as written by `fo:font-weight`. */
export const WEIGHTS: { value: string; label: string; weight: number; italic: boolean }[] = [
  { value: 'thin', label: 'Thin', weight: 100, italic: false },
  { value: 'thin-italic', label: 'Thin Italic', weight: 100, italic: true },
  { value: 'light', label: 'Light', weight: 300, italic: false },
  { value: 'light-italic', label: 'Light Italic', weight: 300, italic: true },
  { value: 'regular', label: 'Regular', weight: 400, italic: false },
  { value: 'regular-italic', label: 'Regular Italic', weight: 400, italic: true },
  { value: 'medium', label: 'Medium', weight: 500, italic: false },
  { value: 'medium-italic', label: 'Medium Italic', weight: 500, italic: true },
  { value: 'bold', label: 'Bold', weight: 700, italic: false },
  { value: 'bold-italic', label: 'Bold Italic', weight: 700, italic: true },
  { value: 'black', label: 'Black', weight: 900, italic: false },
  { value: 'black-italic', label: 'Black Italic', weight: 900, italic: true },
];

/** Border / line width ladder (`border-line-width`). */
export const WIDTH_STEPS = ['1pt', '2pt', '3pt', '4pt', '5pt'];
export const WIDTH_LABELS = ['极细', '细', '中等', '粗', '极粗'];

/** Text transforms (`fo:text-transform`). */
export const CASE_ITEMS = [
  { value: 'none', label: '无' },
  { value: 'uppercase', label: '全大写' },
  { value: 'lowercase', label: '全小写' },
  { value: 'capitalize', label: '首字母大写' },
];

/** The 22x18 format-panel glyphs shipped with each skeleton
 *  (`static/assets/images/structures/small/*.svg`, extracted from app.asar). */
export const SKELETON_ICONS: Record<string, string> = {
  clockwise: '/tiles/struct-map.svg',
  logicRight: '/tiles/struct-logic.svg',
  braceRight: '/tiles/struct-brace.svg',
  orgDown: '/tiles/struct-org.svg',
  treeRight: '/tiles/struct-tree.svg',
  timeline: '/tiles/struct-timeline.svg',
  fishboneRight: '/tiles/struct-fishbone.svg',
  treetable: '/tiles/struct-treetable.svg',
  matrix: '/tiles/struct-matrix.svg',
};
