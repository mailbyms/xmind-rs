//! Layout engine. All geometry is computed in Rust; the WebView only draws
//! rectangles/text/paths. Supports the structures XMind stores in
//! `structureClass`: balanced/clockwise maps, logic & tree maps, org charts,
//! timelines, brace maps, tree tables and matrices.

use crate::{theme_style, Document, Side, Structure, ThemeId, Topic, TopicStyle};
use crate::theme_style::{key as sk, SheetTheme, SkeletonLayers, SKELETON_KEY};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const PAD: f64 = 72.0;
/// Gap between a topic and its children (measured from the original XMind DOM:
/// `topic-connection` start to the child box, 52px at every depth).
const H_GAP: f64 = 52.0;
/// Gap between root branches. Measured on the shipped renderer by diffing the
/// subtree bounding boxes of adjacent 一级分支: 36px (was 86).
const V_GAP: f64 = 36.0;
/// 平衡图 never puts two first-level branch centres closer than this, even
/// when both labels are small: two 46px right branches sit at ±65 while the
/// two tall image cards on the left stay packed at v_gap (FINDINGS §47).
const MIN_BRANCH_PITCH: f64 = 130.0;
/// Sub-branches sit tighter than root branches: the original leaves 7–12px
/// between the bottom of one subtree and the top of the next (median 9).
const SUB_GAP: f64 = 9.0;
/// Vertical skeletons space rows by 53px (`org-chart` / timeline captures).
const ROW_GAP: f64 = 53.0;
/// …but siblings inside a row are packed almost edge to edge (8–10px).
const SIB_X: f64 = 10.0;
/// The first org-chart row sits much further below the central topic (154px)
/// than the 53px between the rows underneath it.
const ROOT_ROW_GAP: f64 = 154.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePalette {
    pub bg: String,
    pub panel: String,
    pub border: String,
    pub grid: String,
    pub text: String,
    pub muted: String,
    pub primary: String,
    pub branches: Vec<String>,
    pub edge: String,
    /// Fill of the central topic.  XMind's 配色方案 paints it with the last
    /// swatch of the palette instead of the default near-black.
    pub center: String,
    /// Resolved `sheet.theme` layers (FINDINGS §26, option A).  `None` for a
    /// document we created from scratch; a real `.xmind` carries its own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_theme: Option<SheetTheme>,
    /// Active 骨架 preset's three depth layers (FINDINGS §38).  Unlike the
    /// per-topic patches written by `apply_skeleton_styles`, this applies to
    /// topics created *after* the preset was chosen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skeleton: Option<SkeletonLayers>,
    /// `fo:text-align` taken straight from `sheet.theme`, for the three top
    /// level layers.  This is injected even when `has_theme` is false: the
    /// shipped renderer still honours text alignment on sheets whose theme
    /// was re-tagged with one of our palette ids (FINDINGS §47).
    pub theme_align: [Option<String>; 3],
}

fn s(value: &str) -> String { value.to_string() }

pub fn palette(theme: ThemeId) -> ThemePalette {
    match theme {
        // The shipped canvas is plain white; the tinted hexes are our own
        // alternatives, so the classic palette must not recolour it.
        ThemeId::Classic => ThemePalette {
            bg: s("#ffffff"), panel: s("#ffffff"), border: s("#e3e8f0"), grid: s("#dce3ee"),
            text: s("#1f2733"), muted: s("#6b7688"), primary: s("#3b6bf5"),
            branches: vec![s("#F9423A"), s("#F6A04D"), s("#F3D321"), s("#00BC7B"), s("#0098B9"), s("#A165A8")],
            center: s("#000229"),
            edge: s("#c8d2e2"),
            sheet_theme: None,
            skeleton: None,
            theme_align: [None, None, None],
        },
        ThemeId::Dark => ThemePalette {
            bg: s("#141922"), panel: s("#1c2330"), border: s("#2c3646"), grid: s("#232c3a"),
            text: s("#e8ecf4"), muted: s("#9aa6b8"), primary: s("#5b82ff"),
            branches: vec![s("#5b82ff"), s("#f07167"), s("#f5b545"), s("#43bd93"), s("#a27df0"), s("#ec6cae")],
            center: s("#000229"),
            edge: s("#3a465e"),
            sheet_theme: None,
            skeleton: None,
            theme_align: [None, None, None],
        },
        ThemeId::Ocean => ThemePalette {
            bg: s("#eef7fa"), panel: s("#ffffff"), border: s("#d7e8ee"), grid: s("#cfe9ef"),
            text: s("#123642"), muted: s("#5b7d88"), primary: s("#0e8fa8"),
            branches: vec![s("#0e8fa8"), s("#1aa6b8"), s("#2d7fb8"), s("#13a98a"), s("#4868b8"), s("#e07a55")],
            center: s("#000229"),
            edge: s("#b7d8e0"),
            sheet_theme: None,
            skeleton: None,
            theme_align: [None, None, None],
        },
        ThemeId::Forest => ThemePalette {
            bg: s("#f4f8f2"), panel: s("#ffffff"), border: s("#dfe9d9"), grid: s("#d5e6cd"),
            text: s("#22321f"), muted: s("#6b8168"), primary: s("#3f8f4f"),
            branches: vec![s("#3f8f4f"), s("#7aab3d"), s("#c08a2e"), s("#2e8b8b"), s("#7a6bb0"), s("#c05f5f")],
            center: s("#000229"),
            edge: s("#c8dcc1"),
            sheet_theme: None,
            skeleton: None,
            theme_align: [None, None, None],
        },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveStyle {
    pub fill: String,
    pub stroke: String,
    pub color: String,
    pub font_weight: u16,
    pub font_size: u16,
    pub font_family: Option<String>,
    pub radius: f64,
    pub underline: bool,
    pub line_color: String,
    pub line_width: f64,
    /* ---- panel-driven properties ---- */
    pub italic: bool,
    pub strike: bool,
    pub align: String,
    pub text_case: Option<String>,
    /// Short shape name (`roundedRect`, `ellipse`, …) derived from `shape-class`.
    pub shape: String,
    pub fill_pattern: String,
    pub stroke_width: f64,
    pub stroke_pattern: String,
    pub opacity: f64,
    pub line_class: String,
    pub line_pattern: String,
    pub arrow_end: String,
    pub line_tapered: bool,
    /* ---- underline shapes: CSS draws the line, so it needs its own ink ---- */
    /// Colour of `.node-title`'s bottom border (and the SVG exporter's line).
    /// Falls back to the branch hue when the theme only sets `line-color`.
    pub underline_color: String,
    /// Border thickness; `border-line-width` in the theme, 1.5 otherwise.
    pub underline_width: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaidOutNode {
    pub id: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Wrapped text lines; the in-place editor uses this as its `rows` count.
    pub lines: usize,
    pub depth: u32,
    pub side: Side,
    pub branch: usize,
    pub has_children: bool,
    pub folded: bool,
    pub hidden_count: usize,
    pub style: EffectiveStyle,
    /// SVG path of the topic outline in node-local coordinates (`0..width`).
    pub shape_path: String,
    /// Whether the outline is a closed area (false for the underline shapes).
    pub shape_closed: bool,
    pub markers: Vec<String>,
    /// Width reserved in the topic box for the in-box marker row: the shipped
    /// renderer gives every marker a slot to the left of the label.
    pub marker_width: f64,
    /// Native marker icon size for this document (FINDINGS §43 / §47).
    pub marker_size: f64,
    /// Content-group inset on each side, applied by the renderer when the
    /// topic carries an in-box marker row (FINDINGS §48).
    pub marker_pad: f64,
    pub labels: Vec<String>,
    /// Chip boxes for `labels` in node-local coordinates.  The layout reserves
    /// the vertical space these take, so a sibling can never cover them.
    pub label_chips: Vec<LabelChip>,
    pub image: Option<String>,
    /// Intrinsic artwork size (px); zero when the topic has no image or the
    /// resource does not advertise one.  The frontend draws image topics as
    /// cards with the artwork on top and the label below.
    pub image_width: f64,
    pub image_height: f64,
    pub parent_id: Option<String>,
    /// Position among its parent's children, in document order (0 for the root).
    pub child_index: usize,
    pub note: String,
    pub href: Option<String>,
    pub title_unedited: bool,
    /// Extra horizontal padding (table cells), in px.
    pub pad: f64,
    /// Half of the topic's horizontal padding: XMind splits `h_pad` evenly
    /// between the left and right of the label, so left-aligned text never
    /// starts on the shape's edge (measured 29/18/6 px by depth on the shipped
    /// renderer). The frontend applies this to `.node-title` / the editor.
    pub text_pad: f64,
    /// Table cell / matrix header: no shape, text aligned by `style.align`.
    pub cell: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub path: String,
    pub color: String,
    pub width: f64,
    /// `true` when `path` is a filled tapered wedge instead of a stroked line.
    pub tapered: bool,
    pub dash: Option<String>,
    pub arrow: String,
}

/// A stroked path that is not a connector: braces (括号图) and table rules
/// (树型表格 / 矩阵图). Drawn under the topics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decor {
    pub path: String,
    pub color: String,
    pub width: f64,
    pub dash: Option<String>,
}

/// 联系: a curved arrow between two topics with an optional label.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: String,
    pub from: String,
    pub to: String,
    pub title: String,
    pub path: String,
    pub color: String,
    /// `theme.relationship.line-width` in px (2 in the shipped theme).
    pub width: f64,
    /// `line-pattern: dash` → `"9 3"`, as the shipped renderer emits.
    pub dash: Option<String>,
    /// `arrow-end-class` != `org.xmind.arrowShape.none`.
    pub arrow: bool,
    pub label_x: f64,
    pub label_y: f64,
}

/// 外框 / 概要: a shape drawn around a range of sibling topics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub id: String,
    /// `boundary` (rounded box) or `summary` (brace).
    pub kind: String,
    pub title: String,
    pub path: String,
    pub color: String,
    /// Stroke width in px (概要线型 writes `summaries[].style.properties.line-width`).
    pub width: f64,
    pub label_x: f64,
    pub label_y: f64,
    /* ---- the sibling range the frame wraps ---- */
    /// Parent of the wrapped siblings; `None` for a frame around the root.
    pub parent_id: Option<String>,
    /// Inclusive sibling range, so the UI can drag the ends (XMind's
    /// `summary-resize-handle-start` / `-end`).
    pub start_id: String,
    pub end_id: String,
    /// Handle anchors at each end of the range, in stage coordinates.
    pub start_x: f64,
    pub start_y: f64,
    pub end_x: f64,
    pub end_y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub nodes: Vec<LaidOutNode>,
    pub edges: Vec<Edge>,
    pub decor: Vec<Decor>,
    /// 联系 lines and 外框 / 概要 shapes, derived from the sheet's extras.
    pub links: Vec<Link>,
    pub frames: Vec<Frame>,
    pub width: f64,
    pub height: f64,
    pub theme: ThemePalette,
    pub structure: Structure,
}

/* ------------------------------------------------------------------ metrics */

/// Spacing / padding scale for one layout pass. 紧凑型布局 shrinks both the
/// gaps between branches and the padding inside a topic ("减少元素的大小和间距").
#[derive(Debug, Clone, Copy)]
struct Metrics {
    h_gap: f64,
    /// Gap between the central topic and the first level — 逻辑图 fans its
    /// branches out over 160px, every other skeleton uses `h_gap`.
    root_gap: f64,
    v_gap: f64,
    sub_gap: f64,
    row_gap: f64,
    sib_x: f64,
    pad: f64,
    /// Per-level font size from `sheet.theme` (central / main / sub).  Text
    /// metrics and `EffectiveStyle.font_size` must agree, so `node_size` reads
    /// this instead of the hard-coded defaults when a theme is present.
    font: Option<[u16; 3]>,
    /// Native marker icon size.  Official files use 36px icons in 40px slots
    /// (FINDINGS §43); a sheet whose theme XMind cannot resolve falls back to
    /// 30px icons in 34px slots (FINDINGS §47).
    marker_icon: f64,
}

impl Metrics {
    fn new(compact: bool) -> Self {
        if compact {
            Self {
                h_gap: 30.0, root_gap: 96.0, v_gap: 24.0, sub_gap: 6.0,
                row_gap: 42.0, sib_x: 8.0, pad: 0.7, font: None, marker_icon: 36.0,
            }
        } else {
            Self {
                h_gap: H_GAP, root_gap: H_GAP, v_gap: V_GAP, sub_gap: SUB_GAP,
                row_gap: ROW_GAP, sib_x: SIB_X, pad: 1.0, font: None, marker_icon: 36.0,
            }
        }
    }

    fn with_theme(mut self, theme: Option<&SheetTheme>) -> Self {
        if let Some(theme) = theme {
            let mut sizes = [default_font_size(0), default_font_size(1), default_font_size(2)];
            for (index, depth) in [0u32, 1, 2].into_iter().enumerate() {
                if let Some(size) = theme.font_size(depth) { sizes[index] = size; }
            }
            self.font = Some(sizes);
        }
        self
    }

    fn font_size(&self, depth: u32) -> u16 {
        match self.font {
            Some(sizes) => sizes[match depth { 0 => 0, 1 => 1, _ => 2 }],
            None => default_font_size(depth),
        }
    }

    /// 括号图: a brace needs room of its own but the rows stay tight.
    fn brace(compact: bool) -> Self {
        let mut m = Self::new(compact);
        // Measured: 66px from the central topic to the first branch, 41px from a
        // topic to its brace, 36px between first-level branches — but only 7px
        // between the deeper siblings under one brace.
        m.root_gap = if compact { 40.0 } else { 66.0 };
        m.h_gap = if compact { 26.0 } else { 41.0 };
        m.sub_gap = if compact { 6.0 } else { 7.0 };
        m.v_gap = if compact { 18.0 } else { 36.0 };
        m
    }
}

/// XMind's default sizes: 30px central topic, 18px main branch, 14px below.
fn default_font_size(depth: u32) -> u16 {
    match depth { 0 => 30, 1 => 18, _ => 14 }
}

/// Deterministic text measurement matched against the real renderer:
/// CJK 1em, space 0.28em, digits 0.42em, other Latin 0.55em.
fn char_ratio(ch: char) -> f64 {
    match ch {
        ' ' => 0.28,
        c if c.is_ascii_digit() => 0.42,
        c if (c as u32) > 0x2e80 => 1.0,
        _ => 0.55,
    }
}

fn line_text_width(line: &str, size: u16) -> f64 {
    let em = f64::from(size);
    line.chars().map(|ch| em * char_ratio(ch)).sum()
}

fn text_width(title: &str, size: u16) -> f64 {
    title.split('\n').map(|line| line_text_width(line, size)).fold(0.0, f64::max)
}

/// Width ratios used *only* for wrapping. Box sizing deliberately uses the
/// tighter `char_ratio`; real Roboto glyphs (capitals in particular) are wider,
/// so reusing `char_ratio` here counted one line too few and clipped the last
/// line of the in-place editor.
fn wrap_ratio(ch: char) -> f64 {
    match ch {
        ' ' => 0.30,
        c if c.is_ascii_uppercase() => 0.68,
        c if c.is_ascii_digit() => 0.52,
        c if (c as u32) > 0x2e80 => 1.0,
        _ => 0.58,
    }
}

/// Greedy per-character wrapping at `usable` px. XMind wraps a long label onto
/// extra lines instead of clipping it; the renderer uses `overflow-wrap:
/// anywhere`, so breaking at any character keeps the two in sync.
fn title_lines(title: &str, size: u16, usable: f64) -> usize {
    let em = f64::from(size);
    let limit = usable.max(em);
    let mut lines = 1usize;
    let mut used = 0.0f64;
    for ch in title.chars() {
        if ch == '\n' {
            lines += 1;
            used = 0.0;
            continue;
        }
        let w = em * wrap_ratio(ch);
        if used + w > limit && used > 0.0 {
            lines += 1;
            used = w;
        } else {
            used += w;
        }
    }
    lines
}

/// Roboto/NeverMind line box is ~1.333em (30px -> 40px, 18px -> 24px).
fn text_height(size: u16) -> f64 { f64::from(size) * 1.333 }

/// Usable width of the label for `title_lines()`.
///
/// A left-aligned label is inset by `pad` on both sides (CSS `--text-pad`).
/// For a single line that is purely cosmetic: the ink is shorter than the box,
/// so the full-width limit can stay. Once the label *auto-wraps*, however, the
/// CSS element must keep the last glyph inside the shape, which costs `2*pad`
/// of usable width (see `.node.auto-wrap` in styles.css). Explicit `\n` breaks
/// and centred / underline shapes keep the classic full-width limit.
///
/// Narrowing the limit for every topic would be wrong: `wrap_ratio` is wider
/// than the `char_ratio` used for box sizing, so even one-line labels would be
/// counted as two (6 of 7 example2 main-tree topics). Only auto-wrapped
/// left-aligned labels get the narrower limit, and the frontend uses exactly
/// the same predicate for the `.auto-wrap` class.
fn wrap_usable(title: &str, size: u16, width: f64, pad: f64) -> f64 {
    let wide = width.max(60.0);
    if pad <= 0.0 || title.contains('\n') || title_lines(title, size, wide) <= 1 {
        wide
    } else {
        (wide - 2.0 * pad).max(60.0)
    }
}

/// `pad` that `wrap_usable()` should reserve for a node: underline shapes size
/// their label to the text itself, and centred labels are symmetric by design.
fn wrap_pad(style: &EffectiveStyle, text_pad: f64) -> f64 {
    if style.underline || style.align != "left" { 0.0 } else { text_pad }
}

/// Split a title into the exact lines the canvas shows: explicit `\n` /
/// `\r\n` breaks first, then the same greedy per-character wrap as
/// `title_lines()`.  Exports use this so standalone SVG/PNG/PDF keep the
/// multi-line titles instead of flattening them into one clipped `<text>`.
pub fn wrapped_title_lines(title: &str, size: u16, usable: f64) -> Vec<String> {
    let normalized = title.replace("\r\n", "\n").replace('\r', "");
    let em = f64::from(size);
    let limit = usable.max(em);
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut used = 0.0f64;
    for ch in normalized.chars() {
        if ch == '\n' {
            lines.push(std::mem::take(&mut current));
            used = 0.0;
            continue;
        }
        let w = em * wrap_ratio(ch);
        if used + w > limit && used > 0.0 {
            lines.push(std::mem::take(&mut current));
            current.push(ch);
            used = w;
        } else {
            current.push(ch);
            used += w;
        }
    }
    lines.push(current);
    lines
}

/// Lines for an already laid-out node, using the very same wrap width that
/// decided `LaidOutNode.lines` and the canvas's `rows`.
pub fn node_title_lines(node: &LaidOutNode) -> Vec<String> {
    let text_box = (node.width - node.marker_width).max(60.0);
    let pad = if node.markers.is_empty() {
        wrap_pad(&node.style, node.text_pad)
    } else {
        0.0
    };
    let usable = wrap_usable(&node.title, node.style.font_size, text_box, pad);
    wrapped_title_lines(&node.title, node.style.font_size, usable)
}

/// Horizontal / vertical padding inside a topic, per depth. The deep values are
/// pinned to the shipped renderer: 4 CJK glyphs at 14px → a 68px box (12px of
/// padding) and a 32px height (13px on top of the 18.7px line box). 6 glyphs
/// give 96px, 3 give 54px — all exact matches.
fn h_pad(depth: u32) -> f64 { match depth { 0 => 58.0, 1 => 36.0, _ => 12.0 } }
fn v_pad(depth: u32) -> f64 { match depth { 0 => 30.0, 1 => 20.0, _ => 13.0 } }

/// XMind lays markers out inside the topic box, to the left of the label.
/// Measured on the shipped renderer (FINDINGS §48): the content group starts
/// `h_pad/2` in from the shape edge, the first icon sits another 5px right
/// (`transform(5,5)`), consecutive icons step by `icon + 2` (30px icons at
/// x = 0, 32, 64, 96), and a 15px gap separates the row from the label:
///   324 = 29 + [5 + 126] + 15 + 120(title) + 29
/// Earlier builds used `count * (icon + 4) + 18`, which starts the row flush
/// against the left border and leaves the label floating in a wide right half.
/// `Metrics::marker_icon` switches the icon size for unresolved sheet themes.
const MARKER_LEAD: f64 = 5.0;
const MARKER_STEP: f64 = 2.0;
const MARKER_TRAIL: f64 = 15.0;
fn marker_width(topic: &Topic, m: Metrics) -> f64 {
    let count = topic.markers.len();
    if count == 0 { return 0.0; }
    (MARKER_LEAD + (count - 1) as f64 * (m.marker_icon + MARKER_STEP)
        + m.marker_icon + MARKER_TRAIL) * m.pad
}

/// The shipped renderer orders marker icons by their catalogue group
/// (标签 / 优先级 / 任务 / 旗帜 / 星星 / 人像 / 符号), *not* by the order in
/// `content.json`.  test.xmind stores `task-oct, priority-1, flag-red,
/// star-red` but draws `priority-1, task-oct, flag-red, star-red` (§48).
/// Stable sort keeps file order within one group.
const MARKER_GROUP_PREFIXES: &[&str] = &[
    "tag-", "priority-", "task-", "flag-", "star-", "people-", "symbol-",
];
fn ordered_markers(markers: &[String]) -> Vec<String> {
    let mut out = markers.to_vec();
    out.sort_by_key(|id| MARKER_GROUP_PREFIXES.iter()
        .position(|prefix| id.starts_with(prefix))
        .unwrap_or(MARKER_GROUP_PREFIXES.len()));
    out
}

/// Half of `h_pad`: XMind's content group is inset by this on *both* sides.
/// The frontend only materialises it as CSS padding when a topic carries
/// markers (plain labels use `--text-pad` instead, so their wrap limit and
/// in-place editor geometry stay exactly as before).
fn marker_pad(depth: u32, m: Metrics) -> f64 { h_pad(depth) * m.pad / 2.0 }

// --- 标签 (labels) ---------------------------------------------------------
//
// The shipped renderer hangs labels under the topic as 23px pills: 13px text,
// 6px side padding, 1px `rgba(0,0,0,.1)` border, radius 8, and a very light
// `rgba(255,255,255,.7)` fill.  Measured on 23.07 (FINDINGS §52):
//   - 8 CJK glyphs → 104px of text in a 117px chip  (104 + 13)
//   - chips sit 3px apart and wrap onto a new row when the row would exceed
//     the topic's width, so they never stick out past the shape
//   - a too-long label is clipped with an ellipsis, the chip stops at the box
//   - the first row starts ~10px under the shape
// Unlike markers, labels are *outside* the shape but still part of the topic's
// occupied box: the layout reserves `label_block_height()` so the next sibling
// is pushed down instead of covering them.
const LABEL_FONT_SIZE: u16 = 13;
const LABEL_CHIP_H: f64 = 23.0;
/// Horizontal chrome of a chip: 6px padding on both sides + 1px border each.
const LABEL_CHROME: f64 = 14.0;
const LABEL_GAP_X: f64 = 3.0;
const LABEL_GAP_Y: f64 = 3.0;
const LABEL_TOP_GAP: f64 = 4.0;

/// One chip's box in node-local coordinates (`0..width`, `0..height` covers
/// the shape; chips start below it).  The canvas and the SVG export both draw
/// from this, so screen and file never disagree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelChip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
}

fn label_chip_widths(labels: &[String], box_width: f64) -> Vec<f64> {
    let cap = box_width.max(24.0);
    labels.iter()
        .map(|label| (text_width(label, LABEL_FONT_SIZE) + LABEL_CHROME).min(cap))
        .collect()
}

/// Greedy row fill, identical to `flex-wrap` with `gap: 3px` inside the box.
fn label_rows(widths: &[f64], box_width: f64) -> Vec<Vec<usize>> {
    let mut rows: Vec<Vec<usize>> = Vec::new();
    let mut used = 0.0;
    for (index, width) in widths.iter().enumerate() {
        if let Some(last) = rows.last_mut() {
            if used + LABEL_GAP_X + width <= box_width + 0.01 {
                last.push(index);
                used += LABEL_GAP_X + width;
                continue;
            }
        }
        rows.push(vec![index]);
        used = *width;
    }
    rows
}

fn label_chips(labels: &[String], box_width: f64, box_height: f64) -> Vec<LabelChip> {
    let widths = label_chip_widths(labels, box_width);
    let rows = label_rows(&widths, box_width);
    let mut chips = vec![LabelChip { x: 0.0, y: 0.0, width: 0.0 }; labels.len()];
    for (row, indexes) in rows.iter().enumerate() {
        let total: f64 = indexes.iter().map(|i| widths[*i]).sum::<f64>()
            + LABEL_GAP_X * indexes.len().saturating_sub(1) as f64;
        // XMind centres the row under the shape.
        let mut x = (box_width - total) / 2.0;
        let y = box_height + LABEL_TOP_GAP + row as f64 * (LABEL_CHIP_H + LABEL_GAP_Y);
        for index in indexes {
            chips[*index] = LabelChip { x, y, width: widths[*index] };
            x += widths[*index] + LABEL_GAP_X;
        }
    }
    chips
}

/// Vertical space the labels occupy *below* the shape (0 when there are none).
fn label_block_height(labels: &[String], box_width: f64) -> f64 {
    if labels.is_empty() { return 0.0; }
    let widths = label_chip_widths(labels, box_width);
    let rows = label_rows(&widths, box_width).len() as f64;
    LABEL_TOP_GAP + rows * LABEL_CHIP_H + (rows - 1.0) * LABEL_GAP_Y
}

fn node_size(topic: &Topic, depth: u32, m: Metrics) -> (f64, f64) {
    let size = topic.style.as_ref().and_then(|v| v.font_size).unwrap_or_else(|| m.font_size(depth));
    let hpad = h_pad(depth) * m.pad;
    let markers = marker_width(topic, m);
    // XMind keeps the note/info button *inside* the box at its right edge
    // (18×18 plus a 10px gap).  Reserve that column so the label never runs
    // underneath it.
    let note_badge = if topic.note.is_empty() { 0.0 } else { 28.0 };
    let title_w = text_width(&topic.title, size);
    if let Some((art_w, art_h)) = topic.image_size {
        // Image topics are cards, not labels with an inline icon.  Measured on
        // the shipped renderer (FINDINGS §46): content padding 20/12/18/10,
        // the artwork at its intrinsic size, a 12px gap, then the label.
        // A 140×140 sticker → 178×198; a 60×60 sticker → 128×118.
        // The extra 6px keeps the label from clipping in the real font: the
        // shipped renderer's 60×60 card is 128 wide with a 90px title box.
        let content_w = art_w.max(title_w + markers + note_badge + 6.0);
        let content_h = art_h + 12.0 + text_height(size);
        let width = match topic.custom_width {
            Some(custom) => custom.clamp(60.0, 600.0),
            None => (content_w + 38.0).clamp(72.0, 600.0),
        };
        return (width, content_h + 22.0);
    }
    let raw = title_w + hpad + markers + note_badge;
    // The marker row widens the box without shrinking the label's wrap limit:
    // official topics keep the same title width before and after a marker.
    let width = match topic.custom_width {
        Some(custom) => custom.clamp(60.0, 600.0),
        None => raw.clamp(if depth == 0 { 150.0 } else { 72.0 }, 340.0),
    };
    let text_width_limit = (width - markers).max(60.0);
    let lines = title_lines(&topic.title, size, text_width_limit);
    // This is the *shape* only.  Labels hang under it and are added back by the
    // packing functions (`label_block_height`) so siblings move out of their way.
    let mut height = text_height(size) * lines as f64 + v_pad(depth) * m.pad;
    if topic.image.is_some() { height += 26.0; }
    (width, height)
}

/// Darken a branch hue for the ink XMind puts on a 20% branch wash.  The
/// shipped build shows `#600C05` for `#F22816`; 40% of the RGB channels lands
/// at `#611009`, within one or two levels per channel.
fn darken(value: &str, factor: f64) -> String {
    match rgb_of(value) {
        Some((r, g, b)) => format!(
            "#{:02x}{:02x}{:02x}",
            (r * factor).round().clamp(0.0, 255.0) as u8,
            (g * factor).round().clamp(0.0, 255.0) as u8,
            (b * factor).round().clamp(0.0, 255.0) as u8,
        ),
        None => value.to_string(),
    }
}

/// Pick black or white text for a background hex (YIQ threshold).
fn readable_on(hex: &str) -> &'static str {
    match rgb_of(hex) {
        Some((r, g, b)) if (r * 299.0 + g * 587.0 + b * 114.0) / 1000.0 > 150.0 => "black",
        _ => "white",
    }
}

/// `#rgb` / `#rrggbb` / `#rrggbbaa` / `black` / `white` → 0..255 components.
fn rgb_of(value: &str) -> Option<(f64, f64, f64)> {
    let raw = value.trim();
    match raw.to_ascii_lowercase().as_str() {
        "black" => return Some((0.0, 0.0, 0.0)),
        "white" => return Some((255.0, 255.0, 255.0)),
        "transparent" | "none" | "" => return None,
        _ => {}
    }
    let raw = raw.trim_start_matches('#');
    let byte = |i: usize| u8::from_str_radix(&raw[i..i + 2], 16).ok().map(f64::from);
    match raw.len() {
        6 | 8 => Some((byte(0)?, byte(2)?, byte(4)?)),
        3 => {
            let each = |i: usize| u8::from_str_radix(&raw[i..i + 1].repeat(2), 16).ok().map(f64::from);
            Some((each(0)?, each(1)?, each(2)?))
        }
        _ => None,
    }
}

/// WCAG relative luminance (alpha is ignored — the canvas is opaque white).
fn rel_luminance(hex: &str) -> Option<f64> {
    let (r, g, b) = rgb_of(hex)?;
    let channel = |c: f64| {
        let v = c / 255.0;
        if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
    };
    Some(0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b))
}

/// WCAG contrast ratio, 1.0 (identical) … 21.0 (black on white).
fn contrast_ratio(a: &str, b: &str) -> f64 {
    match (rel_luminance(a), rel_luminance(b)) {
        (Some(la), Some(lb)) => {
            let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
            (hi + 0.05) / (lo + 0.05)
        }
        // Unknown colours (gradients, `url(#…)`) — assume the worst so the
        // caller keeps whatever ink it already picked.
        _ => 21.0,
    }
}

/// Paint `fg` over `bg` at `alpha`, e.g. the sparse strokes of a hachure tile.
fn blend_over(fg: &str, bg: &str, alpha: f64) -> String {
    match (rgb_of(fg), rgb_of(bg)) {
        (Some((fr, fg_, fb)), Some((br, bg_, bb))) => {
            let mix = |f: f64, b: f64| (f * alpha + b * (1.0 - alpha)).round().clamp(0.0, 255.0) as u8;
            format!("#{:02x}{:02x}{:02x}", mix(fr, br), mix(fg_, bg_), mix(fb, bb))
        }
        _ => bg.to_string(),
    }
}

/// `hachure` / `hachure-thin` / `crossing` / `zigzag` … are drawn as strokes on
/// a white tile, so their *average* backdrop is the fill washed into white, not
/// the fill itself.
fn is_stroke_fill(pattern: &str) -> bool {
    pattern.contains("hachure") || pattern.contains("crossing") || pattern.contains("zigzag")
}

/// The colour the text actually sits on, plus whether that colour is a plate
/// the topic itself paints. A borderless topic shows the canvas, a hatched one
/// is mostly its tile's white base, and only a solid fill is itself.
fn text_surface(style: &EffectiveStyle, pal: &ThemePalette) -> (String, bool) {
    if style.underline || style.fill == "none" || style.fill == "transparent" {
        return (pal.bg.clone(), false);
    }
    if is_stroke_fill(&style.fill_pattern) {
        return (blend_over(&style.fill, "#ffffff", 0.22), false);
    }
    (style.fill.clone(), true)
}

/// Keep the palette's ink when it reads; otherwise swap in the black/white that
/// does. This is what makes 下划线/手绘 skeletons (no filled plate) and light
/// palettes legible on the white canvas.
///
/// A painted plate is left alone: the shipped app picks its ink from that same
/// fill (verified against the running 23.x build — white on the red branch,
/// black on the yellow one), so re-deciding it here would drift from XMind.
/// Only when the label sits on the bare canvas or on a hatch tile's white base
/// does the ink have to be re-chosen.
fn ensure_contrast(style: &mut EffectiveStyle, pal: &ThemePalette) {
    let (surface, on_plate) = text_surface(style, pal);
    if on_plate { return; }
    if contrast_ratio(&style.color, &surface) >= 4.5 { return; }
    let on_black = contrast_ratio("black", &surface);
    let on_white = contrast_ratio("white", &surface);
    style.color = if on_black >= on_white { "black".into() } else { "white".into() };
}

/// `MindMapStyleSelector` cascade for one topic, applied **below** the user's
/// `topic.style` patch.  `resolve` = `sheet.theme[class]` → `defaultStyles`;
/// `get` = theme only.  Line colour/class deliberately ignore the 2020
/// defaults: the current app takes branch hues from `multi-line-colors` and
/// its curve geometry is calibrated against the shipped renderer (§24).
///
/// Returns whether the theme supplied an explicit ink, which `ensure_contrast`
/// must never flip.
fn apply_theme_layer(
    style: &mut EffectiveStyle, theme: &SheetTheme, depth: u32, branch: &str,
) -> bool {
    // XMind's `Energy-…` style themes leave `svg:fill` / `fo:color` as the
    // literal `"inherited"`.  In the shipped 23.x renderer that means the
    // branch-colour engine paints the plate: main topics get the solid branch
    // hue, deeper topics get a 20% wash of it and a darkened ink.  Measured
    // on example2.xmind (`#F22816`): main `#F22816` + white label, subtopic
    // `rgba(242,40,22,.2)` + `#600C05` label.
    let inherited_fill = theme.get(depth, sk::FILL_COLOR)
        .map(theme_style::is_inherited).unwrap_or(false);
    let inherited_color = theme.get(depth, sk::TEXT_COLOR)
        .map(theme_style::is_inherited).unwrap_or(false);
    // `svg:fill` uses #RRGGBBAA; #00000000 means "no plate at all".
    if inherited_fill && depth > 0 {
        if depth == 1 {
            style.fill = branch.to_string();
            style.color = readable_on(branch).into();
        } else {
            style.fill = blend_over(branch, "#ffffff", 0.2);
            style.color = darken(branch, 0.4);
        }
    } else if let Some(v) = theme.resolve(depth, sk::FILL_COLOR) {
        let fill = theme_style::color(v);
        style.fill = fill.clone();
        // A theme that changes the plate without naming an ink still needs
        // readable text (this is what `readable_on` did for the base style).
        if theme.get(depth, sk::TEXT_COLOR).is_none() && fill != "none" {
            style.color = readable_on(&fill).into();
        }
    }
    let explicit_color = theme.resolve(depth, sk::TEXT_COLOR).is_some();
    if let Some(v) = theme.resolve(depth, sk::TEXT_COLOR) {
        style.color = theme_style::color(v);
    } else if inherited_color {
        // `fo:color: inherited` on an explicitly filled plate (the near-black
        // central topic, for instance) means "pick a readable ink".
        if style.fill != "none" {
            style.color = if inherited_fill && depth > 1 {
                darken(branch, 0.4)
            } else {
                readable_on(&style.fill).into()
            };
        }
    }
    if let Some(v) = theme.resolve(depth, sk::FONT_SIZE).and_then(theme_style::pt) {
        style.font_size = (v.round() as u16).clamp(6, 96);
    }
    if let Some(v) = theme.resolve(depth, sk::FONT_WEIGHT).and_then(theme_style::font_weight) {
        style.font_weight = v;
    }
    if let Some(v) = theme.resolve(depth, sk::FONT_STYLE) {
        style.italic = matches!(v, "italic" | "oblique");
    }
    // Official `_getFontFamily` appends NeverMind + the CJK fallbacks; without
    // them a theme like "Montserrat" would leave Chinese labels in a serif face.
    if let Some(v) = theme.get(depth, sk::FONT_FAMILY).filter(|v| !v.is_empty() && *v != "$system$") {
        style.font_family = Some(theme_style::font_stack(v));
    }
    if let Some(v) = theme.resolve(depth, sk::TEXT_ALIGN) {
        if matches!(v, "left" | "center" | "right") { style.align = v.into(); }
    }
    if let Some(v) = theme.resolve(depth, sk::TEXT_TRANSFORM).filter(|v| *v != "manual") {
        style.text_case = Some(v.into());
    }
    if let Some(v) = theme.resolve(depth, sk::TEXT_DECORATION) {
        style.strike = v.contains("line-through");
    }
    // subTopic often omits shape-class; defaultStyles says underline, which is
    // what makes real XMind files show text + a coloured rule instead of a plate.
    if let Some(v) = theme.resolve(depth, sk::SHAPE_CLASS) {
        style.shape = theme_style::shape(v);
    }
    if let Some(v) = theme.get(depth, sk::LINE_CLASS) { style.line_class = v.into(); }
    if let Some(v) = theme.get(depth, sk::LINE_COLOR).filter(|v| !theme_style::is_inherited(v)) {
        // `line-color: inherited` is the branch hue already in the base style.
        style.line_color = theme_style::color(v);
    }
    if let Some(v) = theme.resolve(depth, sk::LINE_WIDTH).and_then(theme_style::to_px) {
        style.line_width = v.max(0.5);
    }
    if let Some(v) = theme.get(depth, sk::BORDER_LINE_COLOR).filter(|v| !theme_style::is_inherited(v)) {
        style.stroke = theme_style::color(v);
    }
    if let Some(v) = theme.get(depth, sk::BORDER_LINE_WIDTH).and_then(theme_style::to_px) {
        style.stroke_width = v.max(0.0);
    }
    if let Some(v) = theme.map_get("svg:opacity").and_then(theme_style::pt) {
        style.opacity = v.clamp(0.0, 1.0);
    }
    if let Some(tapered) = theme.line_tapered() { style.line_tapered = tapered; }
    explicit_color
}

fn style_for(topic: &Topic, depth: u32, branch: usize, pal: &ThemePalette) -> EffectiveStyle {
    let branch_color = pal.branches[branch % pal.branches.len()].clone();
    let mut style = match depth {
        // Central topic: near-black block, white 30px label, 8px radius.  A
        // 配色方案 may swap the fill for its own last swatch, so the label has
        // to flip to dark text when that swatch is light.
        0 => EffectiveStyle {
            fill: pal.center.clone(), stroke: "none".into(), color: readable_on(&pal.center).into(),
            font_weight: 500, font_size: 30, font_family: None, radius: 8.0, underline: false,
            line_color: branch_color, line_width: 3.0,
            italic: false, strike: false, align: "center".into(), text_case: None,
            shape: "roundedRect".into(), fill_pattern: "solid".into(),
            stroke_width: 0.0, stroke_pattern: "solid".into(), opacity: 1.0,
            line_class: "org.xmind.branchConnection.curve".into(),
            line_pattern: "solid".into(), arrow_end: "none".into(), line_tapered: true,
            underline_color: String::new(), underline_width: 1.5,
        },
        // Main branches: solid colour block, 18px label whose ink flips for
        // dark fills (some 配色方案 end on near-black swatches).
        1 => EffectiveStyle {
            fill: branch_color.clone(), stroke: "none".into(),
            color: readable_on(&branch_color).into(), font_weight: 500, font_size: 18, font_family: None, radius: 8.0,
            underline: false,
            // XMind's `mainTopic` layer is 2pt; a connector's width comes from
            // its parent, so level 1 → level 2 must be thinner than root → 1.
            line_color: branch_color, line_width: 2.0,
            italic: false, strike: false, align: "center".into(), text_case: None,
            shape: "roundedRect".into(), fill_pattern: "solid".into(),
            stroke_width: 0.0, stroke_pattern: "solid".into(), opacity: 1.0,
            line_class: "org.xmind.branchConnection.curve".into(),
            line_pattern: "solid".into(), arrow_end: "none".into(), line_tapered: true,
            underline_color: String::new(), underline_width: 1.5,
        },
        // Deeper topics are plain text on the canvas, but keep the branch hue
        // on their connector.
        _ => EffectiveStyle {
            fill: "none".into(), stroke: "none".into(), color: "#0D0D0D".into(),
            font_weight: 400, font_size: 14, font_family: None, radius: 0.0, underline: false,
            line_color: branch_color, line_width: 2.0,
            italic: false, strike: false, align: "left".into(), text_case: None,
            shape: "roundedRect".into(), fill_pattern: "solid".into(),
            stroke_width: 0.0, stroke_pattern: "solid".into(), opacity: 1.0,
            line_class: "org.xmind.branchConnection.curve".into(),
            line_pattern: "solid".into(), arrow_end: "none".into(), line_tapered: true,
            underline_color: String::new(), underline_width: 1.5,
        },
    };
    // sheet.theme sits between the built-in defaults and the user's own style.
    // The alignment key is injected separately so it survives the `foreign`
    // gate; the skeleton and per-topic patches below can still override it.
    if let Some(Some(align)) = pal.theme_align.get(depth as usize) {
        style.align = align.clone();
    }
    let mut explicit_color = false;
    if let Some(theme) = &pal.sheet_theme {
        explicit_color = apply_theme_layer(
            &mut style, theme, depth, &pal.branches[branch % pal.branches.len()],
        );
    }
    // 骨架 layers sit between `sheet.theme` and the user's own style.  They
    // live at sheet level, so a topic added *after* the preset was chosen has
    // exactly the same plate as one that existed at click time (FINDINGS §38).
    if let Some(layers) = &pal.skeleton {
        let skeleton_branch = pal.branches[branch % pal.branches.len()].clone();
        let layer = layers.layer(depth);
        if !layer.shape.is_empty() { style.shape = layer.shape.clone(); }
        let closed = !matches!(style.shape.as_str(), "underline" | "doubleunderline");
        if !closed {
            // Underline shapes have no area.  The CSS rule below takes its
            // colour/width from `stroke`/`stroke_width`, which is reset by the
            // underline fix-up at the end of this function.
            style.fill = "none".into();
        } else if layer.filled {
            // No `svg:fill` in the original theme = XMind's colour-theme
            // engine paints the plate.  Measured on the shipped 23.x build
            // (FINDINGS §29): main = solid branch hue, depth >= 2 = 20% wash
            // of it with a 40%-darkened ink.
            let plate = match depth {
                0 => pal.center.clone(),
                1 => skeleton_branch.clone(),
                _ => blend_over(&skeleton_branch, "#ffffff", 0.2),
            };
            style.fill = plate.clone();
            style.color = if depth >= 2 { darken(&skeleton_branch, 0.4) } else { readable_on(&plate).into() };
            explicit_color = true;
        } else {
            // `svg:fill: none` — no plate at all.  A non-zero
            // `border-line-width` still draws the shape's outline.
            style.fill = "none".into();
            style.color = if depth >= 2 { darken(&skeleton_branch, 0.4) } else { s("#0D0D0D") };
        }
        if layer.border > 0.0 {
            style.stroke = skeleton_branch.clone();
            style.stroke_width = layer.border;
        }
    }
    if let Some(patch) = &topic.style {
        // User styles also use XMind's `#RRGGBBAA` spelling and the literal
        // `"inherited"`; normalise both here so the shape layer, the contrast
        // helpers and the SVG exporter all see the same paint.
        if let Some(v) = patch.fill.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            style.fill = theme_style::color(v);
            // A user plate replaces the theme's plate, so a first-level topic
            // needs its ink re-picked (the yellow floating topic in
            // example2.xmind is black-on-yellow, not the branch's white ink).
            // Deeper topics keep the theme's darkened branch ink even when the
            // user only changes the translucent wash.
            if depth <= 1 && patch.color.is_none() && !explicit_color && style.fill != "none" {
                style.color = readable_on(&style.fill).into();
            }
        }
        if let Some(v) = patch.stroke.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            style.stroke = theme_style::color(v);
        }
        if let Some(v) = patch.color.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            style.color = theme_style::color(v);
            explicit_color = true;
        }
        if let Some(v) = patch.bold { style.font_weight = if v { 700 } else { 400 }; }
        if let Some(v) = patch.font_size { style.font_size = v; }
        if let Some(v) = &patch.font_family {
            // The official `_getFontFamily` appends the CJK fallbacks to the
            // user layer too, so a hand-picked Montserrat never strands
            // Chinese labels in a serif face.
            style.font_family = Some(theme_style::font_stack(v));
        }
        if let Some(v) = patch.italic { style.italic = v; }
        if let Some(v) = patch.strike { style.strike = v; }
        if let Some(v) = &patch.align {
            if matches!(v.as_str(), "left" | "center" | "right") { style.align = v.clone(); }
        }
        if let Some(v) = &patch.text_case { style.text_case = Some(v.clone()); }
        if let Some(v) = &patch.fill_pattern { style.fill_pattern = v.clone(); }
        if let Some(v) = &patch.border_pattern {
            style.stroke_pattern = v.clone();
            if v == "none" { style.stroke = "none".into(); }
            else if style.stroke == "none" { style.stroke = "#000000".into(); }
        }
        if let Some(v) = &patch.border_width {
            style.stroke_width = parse_pt(v).unwrap_or(style.stroke_width.max(1.0));
            if style.stroke == "none" { style.stroke = "#000000".into(); }
        }
        if let Some(v) = &patch.opacity { style.opacity = v.clamp(0.0, 1.0); }
        if let Some(v) = &patch.arrow_end {
            style.arrow_end = v.rsplit('.').next().unwrap_or(v).to_string();
        }
        if let Some(v) = &patch.line_pattern { style.line_pattern = v.clone(); }
        if let Some(v) = patch.line_tapered { style.line_tapered = v; }
        if let Some(v) = &patch.line_class {
            style.line_class = v.clone();
        }
        if let Some(v) = &patch.shape_class {
            style.shape = v.rsplit('.').next().unwrap_or(v).to_string();
        }
        if let Some(v) = patch.line_color.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            style.line_color = theme_style::color(v);
        }
        if let Some(v) = &patch.line_width {
            if let Some(n) = parse_pt(v) { style.line_width = n; }
        }
    }
    // The 下划线 shapes have no area to fill.  Official BORDER_LINE_COLOR
    // falls back to LINE_COLOR (the branch hue); the CSS border-bottom on
    // `.node-title` is the rule, so the SVG outline must not stroke a second,
    // full-width line underneath it.
    let branch_hue = pal.branches[branch % pal.branches.len()].clone();
    style.underline_color = if style.stroke != "none" && style.stroke != "transparent" {
        style.stroke.clone()
    } else if style.line_color != "none" {
        style.line_color.clone()
    } else {
        branch_hue
    };
    style.underline_width = if style.stroke_width > 0.0 { style.stroke_width } else { 1.5 };
    if matches!(style.shape.as_str(), "underline" | "doubleunderline") {
        style.underline = true;
        style.fill = "none".into();
        style.stroke = "none".into();
        style.stroke_width = 0.0;
    }
    // 手绘 presets pair a hachure fill with an ink outline: XMind strokes every
    // closed topic with the marker pen instead of leaving it borderless.
    if style.line_pattern.starts_with("handdrawn") && style.fill != "none" {
        style.stroke = "#262626".into();
        style.stroke_width = style.stroke_width.max(2.0);
    }
    if style.stroke != "none" && style.stroke != "transparent" && style.stroke_width <= 0.0 {
        style.stroke_width = 1.0;
    }
    // A colour the user (or the sheet theme) picked explicitly wins, even when
    // it is hard to read.  Everything else is ink the palette implied.
    if !explicit_color {
        ensure_contrast(&mut style, pal);
    }
    style
}

/// Stroke widths coming from a user patch (`border-line-width`, `line-width`)
/// use the same unit-stripping rule as the theme layers: `2pt` → 2.0, `2` → 2.0.
fn parse_pt(value: &str) -> Option<f64> {
    theme_style::to_px(value)
}

/// Every topic hidden under a collapsed branch (XMind counts the subtree).
fn descendant_count(topic: &Topic) -> usize {
    let mut total = 0;
    for group in [&topic.children, &topic.detached, &topic.summary, &topic.callout] {
        for child in group {
            total += 1 + descendant_count(child);
        }
    }
    total
}

#[allow(clippy::too_many_arguments)]
fn make_node(
    topic: &Topic, x: f64, y: f64, width: f64, height: f64,
    depth: u32, side: Side, branch: usize, parent: Option<String>, pal: &ThemePalette,
    m: Metrics,
) -> LaidOutNode {
    let style = style_for(topic, depth, branch, pal);
    // A centred label is visually unchanged by symmetric padding, so skipping
    // it there also keeps the classic full-width wrap limit (and the in-place
    // editor's row count) exactly as it was. Left-aligned labels get XMind's
    // 29/18/6px inset on each side.
    let text_pad = if style.align == "center" { 0.0 } else { h_pad(depth) * m.pad / 2.0 };
    let markers = marker_width(topic, m);
    let text_box = (width - markers).max(60.0);
    let base_lines = title_lines(&topic.title, style.font_size, text_box);
    // Marker topics spend the horizontal inset as real CSS padding around the
    // whole content group, so their label has no extra `--text-pad` and the
    // wrap limit must not be narrowed either (FINDINGS §48).
    let effective_wrap_pad = if topic.markers.is_empty() { wrap_pad(&style, text_pad) } else { 0.0 };
    let usable = wrap_usable(&topic.title, style.font_size, text_box, effective_wrap_pad);
    let lines = title_lines(&topic.title, style.font_size, usable);
    // `height` came from node_size(), which used the full-width limit. Keep the
    // box (and the in-place editor's `rows`) in step with the narrower limit.
    let height = height + (lines as f64 - base_lines as f64) * text_height(style.font_size);
    let (shape_path, shape_closed) = crate::shape::outline(&style.shape, width, height);
    LaidOutNode {
        id: topic.id.clone(),
        title: topic.title.clone(),
        x, y, width, height, lines, depth, side, branch,
        has_children: !topic.children.is_empty(),
        folded: topic.folded,
        // XMind's collapsed disc counts the whole hidden subtree, not just the
        // direct children (measured: 5 children + 9 grandchildren → "14").
        hidden_count: if topic.folded { descendant_count(topic) } else { 0 },
        style,
        shape_path,
        shape_closed,
        markers: ordered_markers(&topic.markers),
        marker_width: markers,
        marker_size: m.marker_icon,
        marker_pad: marker_pad(depth, m),
        labels: topic.labels.clone(),
        label_chips: label_chips(&topic.labels, width, height),
        image: topic.image.clone(),
        image_width: topic.image_size.map(|(w, _)| w).unwrap_or(0.0),
        image_height: topic.image_size.map(|(_, h)| h).unwrap_or(0.0),
        parent_id: parent,
        child_index: 0,
        note: topic.note.clone(),
        href: topic.href.clone(),
        title_unedited: topic.title_unedited,
        pad: 0.0,
        text_pad,
        cell: false,
    }
}

#[derive(Clone)]
struct Placed { node: LaidOutNode }

fn resize_node(node: &mut LaidOutNode, width: f64) {
    node.width = width;
    let text_box = (width - node.marker_width).max(60.0);
    let usable = wrap_usable(&node.title, node.style.font_size, text_box,
        wrap_pad(&node.style, node.text_pad));
    let lines = title_lines(&node.title, node.style.font_size, usable);
    if lines != node.lines {
        node.height += (lines as f64 - node.lines as f64) * text_height(node.style.font_size);
        node.lines = lines;
    }
    let (path, closed) = crate::shape::outline(&node.style.shape, width, node.height);
    node.shape_path = path;
    node.shape_closed = closed;
    // A wider box can fit the labels on fewer rows.
    node.label_chips = label_chips(&node.labels, node.width, node.height);
}

// ---------------------------------------------------------------------------
// Horizontal layouts (map / logic / tree / fishbone / brace)
// ---------------------------------------------------------------------------

type Columns = HashMap<(Side, u32), f64>;

fn collect_columns(topic: &Topic, depth: u32, side: Side, columns: &mut Columns, m: Metrics) {
    let (width, _) = node_size(topic, depth, m);
    let entry = columns.entry((side, depth)).or_insert(0.0);
    *entry = entry.max(width);
    if topic.folded { return; }
    for child in &topic.children {
        collect_columns(child, depth + 1, side, columns, m);
    }
}

fn column_start(depth: u32, side: Side, columns: &Columns, m: Metrics) -> f64 {
    let mut offset = 0.0;
    for d in 1..depth {
        offset += columns.get(&(side, d)).copied().unwrap_or(140.0) + m.h_gap;
    }
    offset
}

fn node_x(depth: u32, side: Side, width: f64, columns: &Columns, root_half: f64, m: Metrics) -> f64 {
    // Every deeper column starts *after* the first one, and the first one is
    // offset by `root_gap` (160px for 逻辑图).  Using `h_gap` again at depth 2
    // made deeper topics overlap their parent on logic charts; the shipped
    // renderer puts level 2 exactly `column[1] + h_gap` to the right of level 1.
    let distance = root_half + m.root_gap + column_start(depth, side, columns, m);
    match side { Side::Right => distance, Side::Left => -distance - width }
}

fn subtree_height(topic: &Topic, depth: u32, m: Metrics) -> f64 {
    let (width, height) = node_size(topic, depth, m);
    // Labels hang below the shape but belong to the topic's occupied box, so a
    // sibling's label must not be covered by the next sibling.
    let height = height + label_block_height(&topic.labels, width);
    if topic.folded || topic.children.is_empty() { return height; }
    let gap = if depth == 0 { m.v_gap } else { m.sub_gap };
    let children: f64 = topic.children.iter().map(|c| subtree_height(c, depth + 1, m)).sum::<f64>()
        + gap * (topic.children.len().saturating_sub(1)) as f64;
    height.max(children)
}

#[allow(clippy::too_many_arguments)]
/// Vertical centre to hand to `place_horizontal()` for a child whose row is
/// `block` tall starting at `top`.  A leaf keeps its shape on the row's top
/// edge so the labels hang into the space the row reserved; a branch is still
/// centred on its own (taller) children, exactly as before labels existed.
fn child_centre(topic: &Topic, depth: u32, top: f64, block: f64, m: Metrics) -> f64 {
    let (width, shape) = node_size(topic, depth, m);
    let own = shape + label_block_height(&topic.labels, width);
    if block > own + 0.01 { top + block / 2.0 } else { top + shape / 2.0 }
}

fn place_horizontal(
    topic: &Topic, center_y: f64, depth: u32, side: Side, branch: usize,
    parent: Option<String>, columns: &Columns, root_half: f64, pal: &ThemePalette,
    m: Metrics, out: &mut Vec<Placed>, child_index: usize,
) {
    let (width, height) = node_size(topic, depth, m);
    let x = node_x(depth, side, width, columns, root_half, m);
    // Labels hang below the shape without moving the topic itself (measured:
    // a labelled topic keeps its y), so the shape stays centred on the branch
    // line and the reserved label space is added *after* it.
    let mut node = make_node(topic, x, center_y - height / 2.0, width, height,
        depth, side, branch, parent, pal, m);
    node.child_index = child_index;
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() { return; }
    let gap = if depth == 0 { m.v_gap } else { m.sub_gap };
    let heights: Vec<f64> = topic.children.iter().map(|c| subtree_height(c, depth + 1, m)).collect();
    let total: f64 = heights.iter().sum::<f64>() + gap * (topic.children.len().saturating_sub(1)) as f64;
    let mut cursor = center_y - total / 2.0;
    for (index, child) in topic.children.iter().enumerate() {
        let block = heights[index];
        let center = child_centre(child, depth + 1, cursor, block, m);
        let child_branch = if depth == 0 { index } else { branch };
        place_horizontal(
            child, center, depth + 1, side, child_branch,
            Some(topic.id.clone()), columns, root_half, pal, m, out, index,
        );
        cursor += block + gap;
    }
}

// ---------------------------------------------------------------------------
// Vertical layouts (org chart / timeline)
// ---------------------------------------------------------------------------

fn subtree_width(topic: &Topic, depth: u32, m: Metrics) -> f64 {
    let (width, _) = node_size(topic, depth, m);
    if topic.folded || topic.children.is_empty() { return width; }
    let children: f64 = topic.children.iter().map(|c| subtree_width(c, depth + 1, m)).sum::<f64>()
        + m.sib_x * (topic.children.len().saturating_sub(1)) as f64;
    width.max(children)
}

fn max_row_height(root: &Topic, depth: u32, m: Metrics) -> HashMap<u32, f64> {
    fn walk(topic: &Topic, depth: u32, map: &mut HashMap<u32, f64>, m: Metrics) {
        let (width, h) = node_size(topic, depth, m);
        let entry = map.entry(depth).or_insert(0.0);
        *entry = entry.max(h + label_block_height(&topic.labels, width));
        if topic.folded { return; }
        for child in &topic.children { walk(child, depth + 1, map, m); }
    }
    let mut map = HashMap::new();
    walk(root, depth, &mut map, m);
    map
}

#[allow(clippy::too_many_arguments)]
fn place_vertical(
    topic: &Topic, center_x: f64, depth: u32, branch: usize, parent: Option<String>,
    rows: &HashMap<u32, f64>, upward: bool, pal: &ThemePalette, m: Metrics,
    out: &mut Vec<Placed>, child_index: usize,
) {
    let (width, height) = node_size(topic, depth, m);
    // The shipped org chart gives the central topic 154px of air below it and
    // only 53px between the narrower rows underneath.
    let row_y: f64 = (0..depth)
        .map(|d| rows.get(&d).copied().unwrap_or(m.row_gap)
            + if d == 0 { ROOT_ROW_GAP } else { m.row_gap })
        .sum();
    let y = if upward { -row_y - height } else { row_y };
    let mut node = make_node(topic, center_x - width / 2.0, y, width, height, depth, Side::Right, branch, parent, pal, m);
    node.child_index = child_index;
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() { return; }
    let widths: Vec<f64> = topic.children.iter().map(|c| subtree_width(c, depth + 1, m)).collect();
    let total: f64 = widths.iter().sum::<f64>() + m.sib_x * (topic.children.len().saturating_sub(1)) as f64;
    let mut cursor = center_x - total / 2.0;
    for (index, child) in topic.children.iter().enumerate() {
        let w = widths[index];
        let child_branch = if depth == 0 { index } else { branch };
        place_vertical(
            child, cursor + w / 2.0, depth + 1, child_branch, Some(topic.id.clone()),
            rows, upward, pal, m, out, index,
        );
        cursor += w + m.sib_x;
    }
}

// ---------------------------------------------------------------------------
// 树形图: an indented outline. Measured off the shipped renderer: the first
// level hangs below the central topic at 0.75 × its width, every deeper level
// indents a further 71px, and siblings stack depth-first.
// ---------------------------------------------------------------------------

const TREE_INDENT: f64 = 71.0;
const TREE_GAP: f64 = 27.0;
/// The first branch of an outline clears the central topic by 50px; the rest
/// only keep `v_gap`.
const TREE_BRANCH_GAP: f64 = 50.0;

#[allow(clippy::too_many_arguments)]
fn place_outline(
    topic: &Topic, x: f64, y: f64, depth: u32, branch: usize, parent: Option<String>,
    pal: &ThemePalette, m: Metrics, left: bool, out: &mut Vec<Placed>,
    anchors: &mut Anchors, child_index: usize,
) -> f64 {
    let (width, height) = node_size(topic, depth, m);
    let x = if left { x - width } else { x };
    let mut node = make_node(topic, x, y, width, height, depth, Side::Right, branch, parent.clone(), pal, m);
    node.child_index = child_index;
    if left {
        node.side = Side::Left;
    }
    out.push(Placed { node });
    let first_gap = if depth == 0 { m.h_gap } else { TREE_GAP };
    let mut cursor = y + height + label_block_height(&topic.labels, width);
    if topic.folded || topic.children.is_empty() { return cursor; }
    let indent = if depth == 0 { width * 0.75 } else { TREE_INDENT };
    let child_x = if left { x + width - indent } else { x + indent };
    for (index, child) in topic.children.iter().enumerate() {
        let (child_width, child_height) = node_size(child, depth + 1, m);
        // A child hangs TREE_GAP under its parent, but siblings only keep the
        // tight SUB_GAP apart (measured 27 then 9 on the shipped outline).
        let child_top = cursor + if index == 0 { first_gap } else { m.sub_gap };
        let anchor_start = (x + width / 2.0, y + height);
        let anchor_end = if left {
            (child_x - child_width + child_width, child_top + child_height / 2.0)
        } else {
            (child_x, child_top + child_height / 2.0)
        };
        anchors.insert(child.id.clone(), (anchor_start, anchor_end));
        cursor = place_outline(
            child, child_x, child_top, depth + 1,
            if depth == 0 { index } else { branch },
            Some(topic.id.clone()), pal, m, left, out, anchors, index,
        );
    }
    cursor
}

// ---------------------------------------------------------------------------
// 时间轴: a spine with milestones standing on it. Measured against XMind:
// a milestone keeps its *bottom edge on the spine* (the spine leaves the central
// topic at its vertical centre), and its sub-tree grows away from that spine,
// 27px off the milestone. Horizontal spends x (milestones march right, their
// sub-trees alternating above / below); vertical spends y (milestones march
// down, sub-trees cascading away from the spine to the left / right).
// ---------------------------------------------------------------------------

const TIMELINE_PITCH: f64 = 100.0;
/// 时间轴 milestones sit 50px either side of the spine (measured).
const TIMELINE_SIDE: f64 = 50.0;
/// A sub-tree hangs 27px off its milestone; the first level steps by *centre*
/// (60), deeper levels by `levelX` (52).
const TIMELINE_GAP: f64 = 27.0;
const TIMELINE_FIRST: f64 = 60.0;
const TIMELINE_LEVEL: f64 = 52.0;
/// Vertical timelines advance each side by 36; the left milestone of a pair
/// additionally keeps 35px below its right partner (both measured).
const TIMELINE_ADVANCE: f64 = 36.0;
const TIMELINE_PAIR_GAP: f64 = 35.0;

/// How much room a sub-tree takes along the stacking axis. A milestone's
/// children flow away from it (so they add up); deeper nodes in a horizontal
/// timeline straddle their parent instead and only the tallest one counts.
fn timeline_span(topic: &Topic, depth: u32, m: Metrics, vertical: bool) -> f64 {
    let (width, height) = node_size(topic, depth, m);
    let height = height + label_block_height(&topic.labels, width);
    if topic.folded || topic.children.is_empty() { return height; }
    let block: f64 = topic.children.iter()
        .map(|c| timeline_span(c, depth + 1, m, vertical))
        .sum::<f64>()
        + m.sub_gap * (topic.children.len().saturating_sub(1)) as f64;
    if vertical || depth <= 1 { height + TIMELINE_GAP + block } else { height.max(block) }
}

/// Horizontal 时间轴: everything stacks along y, levels march along x.
#[allow(clippy::too_many_arguments)]
fn place_timeline_h(
    topic: &Topic, x: f64, top: f64, depth: u32, branch: usize, parent: Option<String>,
    pal: &ThemePalette, m: Metrics, out: &mut Vec<Placed>, anchors: &mut Anchors,
    perp: f64, child_index: usize,
) {
    let (width, height) = node_size(topic, depth, m);
    let mut node = make_node(topic, x, top, width, height, depth, Side::Right, branch, parent, pal, m);
    node.child_index = child_index;
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() { return; }
    let kids: Vec<&Topic> = topic.children.iter().collect();
    let spans: Vec<f64> = kids.iter().map(|c| timeline_span(c, depth + 1, m, false)).collect();
    let total: f64 = spans.iter().sum::<f64>()
        + m.sub_gap * (kids.len().saturating_sub(1)) as f64;
    // The milestone pushes its children away from the spine; every deeper node
    // straddles them.
    let mut cursor = if depth == 1 {
        if perp < 0.0 { top - TIMELINE_GAP - total }
        else { top + height + label_block_height(&topic.labels, width) + TIMELINE_GAP }
    } else {
        top + height / 2.0 - total / 2.0
    };
    for (index, child) in kids.iter().enumerate() {
        let span = spans[index];
        let (child_width, child_height) = node_size(child, depth + 1, m);
        let child_x = if depth == 1 {
            (x + width / 2.0) + TIMELINE_FIRST - child_width / 2.0
        } else {
            x + width + TIMELINE_LEVEL
        };
        let child_top = cursor + span / 2.0
            - (child_height + label_block_height(&child.labels, child_width)) / 2.0;
        let start = if depth == 1 {
            (x + width / 2.0, if perp < 0.0 { top } else { top + height })
        } else {
            (x + width, top + height / 2.0)
        };
        anchors.insert(child.id.clone(), (start, (child_x, child_top + child_height / 2.0)));
        place_timeline_h(
            child, child_x, child_top, depth + 1,
            if depth == 0 { index } else { branch },
            Some(topic.id.clone()), pal, m, out, anchors, perp, index,
        );
        cursor += span + m.sub_gap;
    }
}

/// Vertical 时间轴: every level cascades down and outwards, one step of 60
/// (centre to centre) away from the spine per level.
#[allow(clippy::too_many_arguments)]
fn place_timeline_v(
    topic: &Topic, x: f64, top: f64, depth: u32, branch: usize, parent: Option<String>,
    pal: &ThemePalette, m: Metrics, out: &mut Vec<Placed>, anchors: &mut Anchors,
    out_dir: f64, child_index: usize,
) {
    let (width, height) = node_size(topic, depth, m);
    let mut node = make_node(topic, x, top, width, height, depth, Side::Right, branch, parent, pal, m);
    node.child_index = child_index;
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() { return; }
    let kids: Vec<&Topic> = topic.children.iter().collect();
    let spans: Vec<f64> = kids.iter().map(|c| timeline_span(c, depth + 1, m, true)).collect();
    let mut cursor = top + height + label_block_height(&topic.labels, width) + TIMELINE_GAP;
    for (index, child) in kids.iter().enumerate() {
        let span = spans[index];
        let (child_width, _) = node_size(child, depth + 1, m);
        let child_x = (x + width / 2.0) + out_dir * TIMELINE_FIRST - child_width / 2.0;
        // Children cascade *below* their parent, so each one sits at the top of
        // the span it reserves — centring it would push the whole column down.
        let child_top = cursor;
        place_timeline_v(
            child, child_x, child_top, depth + 1,
            if depth == 0 { index } else { branch },
            Some(topic.id.clone()), pal, m, out, anchors, out_dir, index,
        );
        cursor += span + m.sub_gap;
    }
}

#[allow(clippy::too_many_arguments)]
fn place_timeline(
    root: &Topic, horizontal: bool, _upward: bool, pal: &ThemePalette, m: Metrics,
    out: &mut Vec<Placed>, anchors: &mut Anchors,
) {
    let (width, height) = node_size(root, 0, m);
    out.push(Placed {
        node: make_node(root, -width / 2.0, -height / 2.0, width, height, 0, Side::Right, 0, None, pal, m),
    });
    if root.folded { return; }
    if horizontal {
        // The spine leaves the central topic at its centre and the milestones
        // stand on it, bottom edge first.
        let mut x = width / 2.0 + TIMELINE_PITCH;
        for (index, child) in root.children.iter().enumerate() {
            let (child_width, child_height) = node_size(child, 1, m);
            let up = index % 2 == 0;
            anchors.insert(child.id.clone(), ((width / 2.0, 0.0), (x, 0.0)));
            place_timeline_h(
                child, x, -child_height, 1, index, Some(root.id.clone()), pal, m, out, anchors,
                if up { -1.0 } else { 1.0 }, index,
            );
            x += child_width + TIMELINE_PITCH;
        }
    } else {
        // Two independent cursors; the left milestone of each pair also trails
        // its right partner by its height plus 35.
        let mut cursors = [height / 2.0 + TIMELINE_SIDE; 2];
        let mut paired: Option<(f64, f64)> = None;
        for (index, child) in root.children.iter().enumerate() {
            let side = index % 2;
            let right = side == 0;
            let (child_width, child_height) = node_size(child, 1, m);
            let x = if right {
                TIMELINE_SIDE
            } else {
                -TIMELINE_SIDE - child_width
            };
            let mut y = cursors[side];
            if right {
                paired = Some((y, child_height));
            } else if let Some((right_y, right_h)) = paired {
                y = y.max(right_y + right_h + TIMELINE_PAIR_GAP);
            }
            anchors.insert(child.id.clone(), (
                (0.0, y + child_height / 2.0),
                (if right { x } else { x + child_width }, y + child_height / 2.0),
            ));
            let before = out.len();
            place_timeline_v(
                child, x, y, 1, index, Some(root.id.clone()), pal, m, out, anchors,
                if right { 1.0 } else { -1.0 }, index,
            );
            let bottom = out[before..].iter()
                .fold(f64::NEG_INFINITY, |acc, p| acc.max(p.node.y + p.node.height));
            cursors[side] = bottom + TIMELINE_ADVANCE;
        }
    }
}

// ---------------------------------------------------------------------------
// 鱼骨图: a spine leaving the skull; each pair of branches owns a bone that
// rises (or falls) away from it. Measured: the branch topic hangs ~349 from the
// skull, ±27 from its own causes, and the causes slide back toward the head
// with ≈0.53 x per y along the bone.
// ---------------------------------------------------------------------------

const BONE_PITCH: f64 = 400.0;
const BONE_REACH: f64 = 258.5;
const BONE_SLOPE: f64 = 0.53;
/// The first cause tucks this far past its branch topic (measured 34).
const BONE_CAUSE_OFFSET: f64 = 34.0;
const BONE_LEVEL: f64 = 52.0;
const BONE_TIP_GAP: f64 = 27.0;
const BONE_SPINE_GAP: f64 = 50.0;
/// Where the first bone meets the spine, and how far apart the bones land on it.
const BONE_SPINE_START: f64 = 58.0;
const BONE_SPINE_PITCH: f64 = 470.0;
/// Short horizontal stub between a bone and the cause it carries.
const BONE_STUB: f64 = 40.0;

/// Room taken by a cause list, stacked the way 鱼骨图 stacks them.
fn bone_block(topic: &Topic, depth: u32, m: Metrics) -> f64 {
    if topic.folded || topic.children.is_empty() { return 0.0; }
    topic.children.iter()
        .map(|c| timeline_span(c, depth + 1, m, false))
        .sum::<f64>()
        + m.sub_gap * (topic.children.len().saturating_sub(1)) as f64
}

/// Sub-causes of one cause: stacked, centred on the cause, one level further
/// from the head.
#[allow(clippy::too_many_arguments)]
fn place_bone_branch(
    topic: &Topic, x: f64, top: f64, depth: u32, branch: usize, parent: Option<String>,
    pal: &ThemePalette, m: Metrics, out: &mut Vec<Placed>, anchors: &mut Anchors,
    dir: f64, child_index: usize,
) {
    let (width, height) = node_size(topic, depth, m);
    let side = if dir > 0.0 { Side::Right } else { Side::Left };
    let mut node = make_node(topic, x, top, width, height, depth, side, branch, parent, pal, m);
    node.child_index = child_index;
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() { return; }
    let kids: Vec<&Topic> = topic.children.iter().collect();
    let spans: Vec<f64> = kids.iter().map(|c| timeline_span(c, depth + 1, m, false)).collect();
    let total: f64 = spans.iter().sum::<f64>()
        + m.sub_gap * (kids.len().saturating_sub(1)) as f64;
    let mut cursor = top + height / 2.0 - total / 2.0;
    for (index, child) in kids.iter().enumerate() {
        let span = spans[index];
        let (child_width, child_height) = node_size(child, depth + 1, m);
        let child_x = if dir > 0.0 {
            x + width + BONE_LEVEL
        } else {
            x - BONE_LEVEL - child_width
        };
        let child_top = cursor + span / 2.0
            - (child_height + label_block_height(&child.labels, child_width)) / 2.0;
        place_bone_branch(
            child, child_x, child_top, depth + 1,
            if depth == 0 { index } else { branch },
            Some(topic.id.clone()), pal, m, out, anchors, dir, index,
        );
        cursor += span + m.sub_gap;
    }
}

#[allow(clippy::too_many_arguments)]
fn place_fishbone(
    root: &Topic, left: bool, pal: &ThemePalette, m: Metrics,
    out: &mut Vec<Placed>, anchors: &mut Anchors,
) {
    let (width, height) = node_size(root, 0, m);
    out.push(Placed {
        node: make_node(root, -width / 2.0, -height / 2.0,
            width, height, 0, Side::Right, 0, None, pal, m),
    });
    if root.folded { return; }
    // The skeleton name describes where the *bones* lean, not where the skull
    // is: 鱼骨图（左） keeps the head on the left and runs its tail rightwards
    // (measured: every level-1 topic has a positive x offset from the head).
    let dir = if left { 1.0 } else { -1.0 };
    let skull = if left { width / 2.0 } else { -width / 2.0 };
    let mut bone = 0usize;
    for (index, child) in root.children.iter().enumerate() {
        let up = index % 2 == 0;
        if index % 2 == 0 && index > 0 { bone += 1; }
        let (child_width, child_height) = node_size(child, 1, m);
        // Even branches sit above the spine and their causes flow back down
        // toward it; odd ones hang below and flow up.
        let block = bone_block(child, 1, m);
        // `BONE_REACH` is measured to the branch topic's *near* edge, so a left
        // growing fishbone has to clear the box before it starts counting.
        let bone_x = skull + dir * bone as f64 * BONE_PITCH;
        let topic_x = if dir > 0.0 {
            bone_x + BONE_REACH
        } else {
            bone_x - BONE_REACH - child_width
        };
        let topic_top = if up {
            -(BONE_SPINE_GAP + block) - BONE_TIP_GAP - child_height
        } else {
            BONE_SPINE_GAP + block + BONE_TIP_GAP
        };
        // Each bone is a *straight* slanted line that starts on the spine, one
        // `BONE_SPINE_PITCH` further from the head than the previous one
        // (measured 58 then ≈470 apart), and ends at its branch topic.
        let spine_x = skull + dir * (BONE_SPINE_START + bone as f64 * BONE_SPINE_PITCH);
        anchors.insert(
            child.id.clone(),
            ((spine_x, 0.0), (topic_x + child_width / 2.0, topic_top + child_height / 2.0)),
        );
        let mut node = make_node(
            child, topic_x, topic_top, child_width, child_height, 1,
            if dir > 0.0 { Side::Right } else { Side::Left }, index,
            Some(root.id.clone()), pal, m);
        node.style.line_class = "straight".into();
        out.push(Placed { node });
        let kids: Vec<&Topic> = child.children.iter().collect();
        let spans: Vec<f64> = kids.iter().map(|c| timeline_span(c, 2, m, false)).collect();
        let total: f64 = spans.iter().sum::<f64>()
            + m.sub_gap * (kids.len().saturating_sub(1)) as f64;
        // Causes start 27 away from the branch topic and drift back toward the
        // head as they go.
        let mut cursor = if up {
            topic_top + child_height + BONE_TIP_GAP
        } else {
            topic_top - BONE_TIP_GAP - total
        };
        let mut first_center: Option<f64> = None;
        for (kid_index, cause) in kids.iter().enumerate() {
            let span = spans[kid_index];
            let (cause_width, cause_height) = node_size(cause, 2, m);
            let cause_top = cursor + span / 2.0 - cause_height / 2.0;
            let cause_center = cause_top + cause_height / 2.0;
            let first = *first_center.get_or_insert(cause_center);
            // The causes ride the bone: the first one tucks 34px past its branch
            // topic, and each step toward the spine slides it ≈0.53 per y further
            // toward the head (measured on both 鱼骨图 directions).
            let progress = if up { cause_center - first } else { first - cause_center };
            let topic_near = if dir > 0.0 { topic_x + child_width } else { topic_x };
            let near = topic_near - dir * (BONE_CAUSE_OFFSET + BONE_SLOPE * progress);
            let cause_x = if dir > 0.0 { near } else { near - cause_width };
            let (start, end) = if dir > 0.0 {
                ((cause_x - BONE_STUB, cause_center), (cause_x, cause_center))
            } else {
                ((cause_x + cause_width + BONE_STUB, cause_center), (cause_x + cause_width, cause_center))
            };
            anchors.insert(cause.id.clone(), (start, end));
            place_bone_branch(
                cause, cause_x, cause_top, 2,
                index,
                Some(child.id.clone()), pal, m, out, anchors, dir, kid_index,
            );
            cursor += span + m.sub_gap;
        }
    }
}

// ---------------------------------------------------------------------------

fn side_for(structure: Structure, index: usize, total: usize, explicit: Option<Side>) -> Side {
    if let Some(side) = explicit { return side; }
    let half = total.div_ceil(2);
    match structure {
        Structure::Anticlockwise => if index < half { Side::Left } else { Side::Right },
        Structure::LogicLeft | Structure::TreeLeft | Structure::FishboneLeft | Structure::BraceLeft => Side::Left,
        Structure::Balanced | Structure::Clockwise => if index < half { Side::Right } else { Side::Left },
        _ => Side::Right,
    }
}

/// Geometry of one connector: the stroked path plus, for tapered branches,
/// the centreline the wedge is built from.
/// Sample a quadratic bezier so a tapered wedge can follow the same curve.
fn quad_points(p0: (f64, f64), c: (f64, f64), p1: (f64, f64), steps: usize) -> Vec<(f64, f64)> {
    (0..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            let u = 1.0 - t;
            (
                u * u * p0.0 + 2.0 * u * t * c.0 + t * t * p1.0,
                u * u * p0.1 + 2.0 * u * t * c.1 + t * t * p1.1,
            )
        })
        .collect()
}

fn line_points(p0: (f64, f64), p1: (f64, f64), steps: usize) -> Vec<(f64, f64)> {
    (0..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            (p0.0 + (p1.0 - p0.0) * t, p0.1 + (p1.1 - p0.1) * t)
        })
        .collect()
}

/// Sample a cubic bezier, for tapered wedges and rounded elbows.
fn cubic_points(
    p0: (f64, f64), c1: (f64, f64), c2: (f64, f64), p1: (f64, f64), steps: usize,
) -> Vec<(f64, f64)> {
    (0..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            let u = 1.0 - t;
            (
                u * u * u * p0.0 + 3.0 * u * u * t * c1.0 + 3.0 * u * t * t * c2.0 + t * t * t * p1.0,
                u * u * u * p0.1 + 3.0 * u * u * t * c1.1 + 3.0 * u * t * t * c2.1 + t * t * t * p1.1,
            )
        })
        .collect()
}

/// Offset a polyline into a closed wedge that tapers from `w1` to `w2`.
fn taper_polygon(points: &[(f64, f64)], w1: f64, w2: f64) -> String {
    let count = points.len();
    if count < 2 { return String::new(); }
    let mut left: Vec<(f64, f64)> = Vec::with_capacity(count);
    let mut right: Vec<(f64, f64)> = Vec::with_capacity(count);
    for (index, point) in points.iter().enumerate() {
        let t = index as f64 / (count - 1) as f64;
        let half = (w1 + (w2 - w1) * t) / 2.0;
        let prev = points[index.saturating_sub(1)];
        let next = points[(index + 1).min(count - 1)];
        let (dx, dy) = (next.0 - prev.0, next.1 - prev.1);
        let length = (dx * dx + dy * dy).sqrt().max(0.001);
        let (nx, ny) = (-dy / length, dx / length);
        left.push((point.0 + nx * half, point.1 + ny * half));
        right.push((point.0 - nx * half, point.1 - ny * half));
    }
    let mut path = String::new();
    for (index, (x, y)) in left.iter().enumerate() {
        path.push_str(if index == 0 { "M" } else { " L" });
        path.push_str(&format!(" {:.1} {:.1}", x, y));
    }
    for (x, y) in right.iter().rev() {
        path.push_str(&format!(" L {:.1} {:.1}", x, y));
    }
    path.push_str(" Z");
    path
}

/// `M/L` path for a polyline.
fn polyline_path(points: &[(f64, f64)]) -> String {
    let mut out = String::new();
    for (index, (x, y)) in points.iter().enumerate() {
        out.push_str(if index == 0 { "M" } else { " L" });
        out.push_str(&format!(" {x:.1} {y:.1}"));
    }
    out
}

/// Evenly resample a polyline by arc length, so a tapered wedge can follow a
/// folded connector instead of bulging at the corners.
fn polyline_points(points: &[(f64, f64)], steps: usize) -> Vec<(f64, f64)> {
    if points.len() < 2 { return points.to_vec(); }
    let mut lengths = vec![0.0_f64];
    for index in 1..points.len() {
        let (a, b) = (points[index - 1], points[index]);
        lengths.push(lengths[index - 1] + ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt());
    }
    let total = lengths[lengths.len() - 1].max(0.001);
    (0..=steps).map(|step| {
        let dist = total * step as f64 / steps as f64;
        let mut seg = 1;
        while seg < lengths.len() - 1 && lengths[seg] < dist { seg += 1; }
        let span = (lengths[seg] - lengths[seg - 1]).max(0.001);
        let t = ((dist - lengths[seg - 1]) / span).clamp(0.0, 1.0);
        let (a, b) = (points[seg - 1], points[seg]);
        (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
    }).collect()
}

/// `fold` / `roundedfold` from the official `brushes.ts`
/// (`skewElbow*` at 2/3 of the gap, `horn*` at 1/2 with a rounded knee).
/// The shipped renderer supplies an explicit `control` point from the parent
/// topic shape; half the gap is our calibrated equivalent (FINDINGS §24).
fn fold_geometry(
    start: (f64, f64), control: (f64, f64), end: (f64, f64), vertical: bool, rounded: bool,
) -> (String, Vec<(f64, f64)>) {
    let ratio = if rounded { 0.5 } else { 2.0 / 3.0 };
    let flex = if vertical {
        (end.0, control.1 + (end.1 - control.1) * ratio)
    } else {
        (control.0 + (end.0 - control.0) * ratio, end.1)
    };
    if !rounded {
        let pts = [start, control, flex, end];
        return (polyline_path(&pts), polyline_points(&pts, 24));
    }
    let (vx, vy) = (flex.0 - control.0, flex.1 - control.1);
    let len = (vx * vx + vy * vy).sqrt().max(1.0);
    let tail = if vertical { (end.1 - flex.1).abs() } else { (end.0 - flex.0).abs() };
    let corner = (len * 0.25).min(tail * 0.5).max(1.0);
    let before = (flex.0 - vx / len * corner, flex.1 - vy / len * corner);
    let after = if vertical {
        (flex.0, flex.1 + (end.1 - flex.1).signum() * corner)
    } else {
        (flex.0 + (end.0 - flex.0).signum() * corner, flex.1)
    };
    let path = format!(
        "M {:.1} {:.1} L {:.1} {:.1} L {:.1} {:.1} Q {:.1} {:.1}, {:.1} {:.1} L {:.1} {:.1}",
        start.0, start.1, control.0, control.1, before.0, before.1,
        flex.0, flex.1, after.0, after.1, end.0, end.1,
    );
    (path, polyline_points(&[start, control, before, flex, after, end], 24))
}

/// Explicit branch endpoints, keyed by the child id: `(where it leaves the
/// parent, where it meets the child)`. 树形图 / 时间轴 / 鱼骨图 place children
/// below, above or diagonally, so the generic "parent's right edge → child's
/// left edge" rule would draw the branch straight through both boxes.
type Anchors = HashMap<String, ((f64, f64), (f64, f64))>;

/// Connection classes captured from the desktop bundle's
/// `org.xmind.branchConnection.*` strings that the 43 shipped 骨架 presets
/// never use.  Older / hand-authored files still contain them; without an
/// explicit branch they silently fell through to the generic curve.
fn is_structural_class(class: &str) -> bool {
    matches!(
        class,
        "none" | "treeTableNoConnections" | "arrowedCurve"
            | "brace" | "brace2" | "brace3" | "brace4" | "brace5"
            | "fish" | "fishbone" | "matrix" | "timeline" | "sidedTimeline"
    )
}

/// Geometry for those structural classes.  `None` means "use the ordinary
/// line-class path" (arrowedCurve keeps the calibrated cubic spine).
fn structural_path(
    class: &str, start: (f64, f64), end: (f64, f64),
) -> Option<(String, Vec<(f64, f64)>)> {
    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    let poly = |pts: Vec<(f64, f64)>| (polyline_path(&pts), pts);
    match class {
        // 树型表格 / 矩阵图 can explicitly ask for no connectors at all.
        "none" | "treeTableNoConnections" => Some((String::new(), Vec::new())),
        // 括号图 variants: the same bracket with a tighter / looser S-bend.
        "brace" | "brace2" | "brace3" | "brace4" | "brace5" => {
            let k = match class {
                "brace2" => 0.15, "brace3" => 0.35,
                "brace4" => 0.55, "brace5" => 0.75, _ => 0.25,
            };
            let hx = start.0 + dx * 0.35;
            let c1 = (hx, start.1 + dy * k);
            let c2 = (end.0 - dx * 0.25, end.1 - dy * k);
            let path = format!(
                "M {:.1} {:.1} H {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                start.0, start.1, hx, c1.0, c1.1, c2.0, c2.1, end.0, end.1,
            );
            let mut samples = cubic_points((hx, start.1), c1, c2, end, 24);
            samples.insert(0, start);
            Some((path, samples))
        }
        // 鱼骨图: a short horizontal lead-in, then the slanted bone.
        "fish" | "fishbone" => {
            let knee = (start.0 + dx * 0.3, start.1);
            Some(poly(vec![start, knee, end]))
        }
        // 矩阵图: a rectangular grid run between two cells.
        "matrix" => {
            let mid = (start.0 + dx * 0.5, start.1);
            Some(poly(vec![start, mid, (mid.0, end.1), end]))
        }
        // 时间轴: the spine runs level, then ticks down to the milestone.
        "timeline" | "sidedTimeline" => {
            let corner = (end.0, start.1);
            Some(poly(vec![start, corner, end]))
        }
        _ => None,
    }
}

/// The root topic's effective line class: a 骨架 switch writes it into
/// `root.style`, a real XMind file carries it in `theme.centralTopic`.
fn root_line_class(doc: &Document, pal: &ThemePalette) -> String {
    let raw = doc
        .sheet()
        .root
        .style
        .as_ref()
        .and_then(|s| s.line_class.clone())
        .or_else(|| {
            pal.sheet_theme
                .as_ref()
                .and_then(|t| t.get(0, sk::LINE_CLASS).map(str::to_string))
        })
        .unwrap_or_default();
    raw.rsplit('.').next().unwrap_or("").to_string()
}

/// Y where a horizontal branch meets a topic box.
///
/// For a normal (filled) shape this is the box centre.  For 下划线 / 双下划线
/// the shipped renderer puts the connector **on the rule**: CDP over
/// `example.xmind` measured all 126 attach points at `rect.bottom`, with
/// `topic-node-border` a zero-height stroke whose width equals the whole
/// `rect.w`.  So both ends of the connector land on the topic's own rule,
/// reading as one continuous line rather than cutting through the text.
///
/// Three painters must agree on this (see FINDINGS §40):
///   * CSS `.node.underline::after` — full box width, stroke centred on
///     `box.bottom` (`styles.css`);
///   * `export.rs` — `<line x1=box.left x2=box.right y=box.bottom>`;
///   * here — the connector endpoint.
/// The old code used a label-width `border-bottom` inside the box, which made
/// the endpoint poke past the rule by ~7px on x and ~3px on y.
fn branch_anchor_y(node: &LaidOutNode) -> f64 {
    if node.style.underline {
        node.y + node.height
    } else {
        node.y + node.height / 2.0
    }
}

/// X where a branch leaves its parent.  CDP measurements on the shipped
/// renderer (test2 / example2, FINDINGS §53) put the connector start exactly on
/// the topic box edge for filled shapes as well as underlines — the old
/// `h_pad * pad` text-area inset made the line appear to grow out of the box.
fn branch_start_x(parent: &LaidOutNode, right: bool) -> f64 {
    if right { parent.x + parent.width } else { parent.x }
}

fn build_edges(
    placed: &[Placed], pal: &ThemePalette, vertical: bool, upward: bool,
    anchors: &Anchors,
) -> Vec<Edge> {
    let positions: HashMap<String, LaidOutNode> = placed
        .iter()
        .map(|p| (p.node.id.clone(), p.node.clone()))
        .collect();
    let mut edges = Vec::new();
    for item in placed {
        let parent_id = match &item.node.parent_id {
            Some(id) => id.clone(),
            None => continue,
        };
        let Some(parent) = positions.get(&parent_id) else { continue };
        let node = &item.node;
        // Official renderer (`AbstractStructure.getAttachedConnectionInfo`):
        // a connector takes its line shape / width from the *start* (parent)
        // branch and its colour from the *end* (child) branch.  Reading all of
        // it from the child is why a 骨架 switch never reached level 2+.
        let line = &parent.style;
        let style = &node.style;
        let class = line.line_class.rsplit('.').next().unwrap_or("curve");

        let (start, end) = if let Some(pair) = anchors.get(&node.id) {
            *pair
        } else if vertical {
            let py = if upward { parent.y } else { parent.y + parent.height };
            let cy = if upward { node.y + node.height } else { node.y };
            ((parent.x + parent.width / 2.0, py), (node.x + node.width / 2.0, cy))
        } else {
            // Both ends sit on the topics' own anchor line: a filled shape
            // uses its centre, an underline shape uses its full-width bottom
            // rule (measured on the shipped XMind, see `branch_anchor_y`).
            let start_y = branch_anchor_y(parent);
            let end_y = branch_anchor_y(node);
            match node.side {
                Side::Right => (
                    (branch_start_x(parent, true), start_y),
                    (node.x, end_y),
                ),
                Side::Left => (
                    (branch_start_x(parent, false), start_y),
                    (node.x + node.width, end_y),
                ),
            }
        };

        // Tapered wedges are decided up front: their spine follows XMind's
        // wedge geometry instead of the plain curve (see below).  Structural
        // classes (braces, bones, grids, spines) are stroked shapes and must
        // never be swallowed by a wedge.
        let tapered = line.line_tapered
            && !matches!(class, "elbow" | "roundedElbow" | "arrowedCurve")
            && !is_structural_class(class)
            && style.arrow_end == "none";

        let (path, samples) = if let Some(geometry) = structural_path(class, start, end) {
            geometry
        } else if vertical {
            let dy = end.1 - start.1;
            let control = (start.0, start.1 + dy * 0.5);
            match class {
                "straight" | "horizontal" => (
                    polyline_path(&[start, end]), line_points(start, end, 24),
                ),
                "elbow" => {
                    let mid = (start.1 + end.1) / 2.0;
                    (format!(
                        "M {:.1} {:.1} V {:.1} H {:.1} V {:.1}",
                        start.0, start.1, mid, end.0, end.1
                    ), vec![start, (start.0, mid), (end.0, mid), end])
                }
                "roundedElbow" => {
                    // Two rounded knees on the vertical structure's elbow.
                    let mid = (start.1 + end.1) / 2.0;
                    let r = 8.0_f64.min((end.1 - start.1).abs() / 2.0);
                    let dy = (end.1 - start.1).signum();
                    let dx = (end.0 - start.0).signum();
                    (format!(
                        "M {:.1} {:.1} V {:.1} Q {:.1} {:.1}, {:.1} {:.1} H {:.1} Q {:.1} {:.1}, {:.1} {:.1} V {:.1}",
                        start.0, start.1, mid - dy * r, start.0, mid, start.0 + dx * r, mid,
                        end.0 - dx * r, end.0, mid, end.0, mid + dy * r, end.1,
                    ), vec![start, (start.0, mid), (end.0, mid), end])
                }
                "fold" => fold_geometry(start, control, end, true, false),
                "roundedfold" => fold_geometry(start, control, end, true, true),
                "curve" if tapered => {
                    // 锥形分支: the spine leaves the parent steeply and eases
                    // into the child horizontally — measured off the shipped
                    // wedge (`M 17.3 0.4 Q 42.2 -361.4, 152 -362`).
                    let cp = (end.0, start.1 + dy * 0.2);
                    (
                        format!(
                            "M {:.1} {:.1} Q {:.1} {:.1}, {:.1} {:.1}",
                            start.0, start.1, cp.0, cp.1, end.0, end.1
                        ),
                        quad_points(start, cp, end, 24),
                    )
                }
                _ => {
                    // 曲线: horizontal tangent at both ends. The control points
                    // are what the shipped renderer emits (0.75 / 0.5 of the gap).
                    let c1 = (start.0, start.1 + dy * 0.75);
                    let c2 = (end.0, end.1 - dy * 0.5);
                    (format!(
                        "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                        start.0, start.1, c1.0, c1.1, c2.0, c2.1, end.0, end.1
                    ), cubic_points(start, c1, c2, end, 24))
                }
            }
        } else {
            let dx = end.0 - start.0;
            let control = (start.0 + dx * 0.5, start.1);
            match class {
                "straight" | "horizontal" => (
                    polyline_path(&[start, end]), line_points(start, end, 24),
                ),
                "elbow" => {
                    let mid = start.0 + dx * 0.5;
                    (
                        format!(
                            "M {:.1} {:.1} H {:.1} V {:.1} H {:.1}",
                            start.0, start.1, mid, end.1, end.0,
                        ),
                        vec![start, (mid, start.1), (mid, end.1), end],
                    )
                }
                "roundedElbow" => {
                    let mid = start.0 + dx * 0.5;
                    let sign = if dx >= 0.0 { 1.0 } else { -1.0 };
                    let dir = if end.1 >= start.1 { 1.0 } else { -1.0 };
                    let r = 8.0_f64.min((end.1 - start.1).abs() / 2.0);
                    (
                        format!(
                            "M {:.1} {:.1} H {:.1} Q {:.1} {:.1}, {:.1} {:.1} V {:.1} Q {:.1} {:.1}, {:.1} {:.1} H {:.1}",
                            start.0, start.1,
                            mid - sign * r, mid, start.1, mid, start.1 + dir * r,
                            end.1 - dir * r, mid, end.1, mid + sign * r, end.1,
                            end.0,
                        ),
                        vec![start, (mid, start.1), (mid, end.1), end],
                    )
                }
                "fold" => fold_geometry(start, control, end, false, false),
                "roundedfold" => fold_geometry(start, control, end, false, true),
                // `bight` is XMind's arc.  A tapered branch keeps the arc as
                // its spine instead of falling back to the generic curve.
                "bight" => {
                    let c1 = (start.0 + dx * 0.55, start.1);
                    let c2 = (end.0 - dx * 0.55, end.1);
                    (
                        format!(
                            "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                            start.0, start.1, c1.0, c1.1, c2.0, c2.1, end.0, end.1
                        ),
                        cubic_points(start, c1, c2, end, 24),
                    )
                }
                "curve" if tapered => {
                    // 锥形分支: steep out of the parent, horizontal into the child.
                    let cp = (start.0 + dx * 0.2, end.1);
                    (
                        format!(
                            "M {:.1} {:.1} Q {:.1} {:.1}, {:.1} {:.1}",
                            start.0, start.1, cp.0, cp.1, end.0, end.1
                        ),
                        quad_points(start, cp, end, 24),
                    )
                }
                _ => {
                    // 曲线: `M 54 0 C 93.75 0, 80.5 -80, 107 -80` in the shipped
                    // renderer — controls at 0.75 and 0.5 of the gap, both at
                    // the end's own y, so the line leaves and arrives level.
                    let c1 = (start.0 + dx * 0.75, start.1);
                    let c2 = (end.0 - dx * 0.5, end.1);
                    (
                        format!(
                            "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                            start.0, start.1, c1.0, c1.1, c2.0, c2.1, end.0, end.1
                        ),
                        cubic_points(start, c1, c2, end, 24),
                    )
                }
            }
        };

        let width = line.line_width.max(1.0);
        let color = if node.depth == 1 {
            pal.branches[node.branch % pal.branches.len()].clone()
        } else {
            style.line_color.clone()
        };
        // Normalise to the tokens `dashArray()` understands.  Passing an
        // arbitrary `line-pattern` through to `stroke-dasharray` makes WebView
        // drop the attribute, so e.g. `handdrawn-dash` looked solid.
        let dash = match line.line_pattern.as_str() {
            "" | "solid" | "none" | "handdrawn-solid" | "hand-drawn-solid" => None,
            "dash" | "handdrawn-dash" | "hand-drawn-dash" => Some("dash".to_string()),
            "dot" | "handdrawn-dot" | "hand-drawn-dot" => Some("dot".to_string()),
            "round-dot" => Some("round-dot".to_string()),
            "dash-dot" | "dashdot" => Some("dash-dot".to_string()),
            "dash-dot-dot" | "dashdotdot" => Some("dash-dot-dot".to_string()),
            other if other.starts_with("dash") => Some("dash".to_string()),
            _ => None,
        };
        // `arrowedCurve` is a curve that always ends in an arrow head.
        if path.is_empty() { continue; }
        let arrow = if class == "arrowedCurve" && style.arrow_end == "none" {
            "triangle".to_string()
        } else {
            style.arrow_end.clone()
        };
        let path = if tapered {
            taper_polygon(&samples, width, (width * 0.3).max(0.8))
        } else { path };
        edges.push(Edge {
            id: format!("{}->{}", parent_id, node.id),
            from: parent_id.clone(),
            to: node.id.clone(),
            path,
            color,
            width,
            tapered,
            dash,
            arrow,
        });
    }
    edges
}

// ---------------------------------------------------------------------------
// 括号图: a curly brace per parent instead of connectors
// ---------------------------------------------------------------------------

fn build_braces(placed: &[Placed], pal: &ThemePalette, variant: &str) -> Vec<Decor> {
    let mut children: HashMap<String, Vec<&Placed>> = HashMap::new();
    for item in placed {
        if let Some(parent) = &item.node.parent_id {
            children.entry(parent.clone()).or_default().push(item);
        }
    }
    let mut decor = Vec::new();
    for item in placed {
        let Some(list) = children.get(&item.node.id) else { continue };
        let parent = &item.node;
        let mut kids: Vec<&&Placed> = list.iter().collect();
        kids.sort_by(|a, b| a.node.y.partial_cmp(&b.node.y).unwrap_or(std::cmp::Ordering::Equal));
        let first = match kids.first() { Some(k) => k, None => continue };
        let last = kids[kids.len() - 1];

        // The brace lives in the gutter between parent and children. Keeping its
        // tip halfway across (instead of hugging the parent) clears the ±8px
        // collapse disc that sits right on the parent's right edge.
        let parent_right = parent.x + parent.width;
        let gap = (first.node.x - parent_right).max(12.0);
        // `branchConnection.brace2..5` tighten / loosen the bracket's bend;
        // the shipped 骨架 presets use roundedElbow, which keeps factor 1.0
        // and therefore the geometry calibrated in §24.
        let bend = match variant {
            "brace2" => 1.4, "brace3" => 0.7,
            "brace4" => 1.8, "brace5" => 0.5, _ => 1.0,
        };
        let span = (gap * 0.2 * bend).clamp(4.0, 10.0);
        let tip = parent_right + gap * 0.5;
        let waist = tip + span;
        let arm = waist + span;
        let r = span;
        let top = first.node.y + first.node.height / 2.0;
        let bottom = last.node.y + last.node.height / 2.0;
        let mid = parent.y + parent.height / 2.0;
        let color = kids[0].node.style.line_color.clone();

        let mut path = format!(
            "M {:.1} {:.1} Q {:.1} {:.1}, {:.1} {:.1} L {:.1} {:.1} \
             Q {:.1} {:.1}, {:.1} {:.1} Q {:.1} {:.1}, {:.1} {:.1} L {:.1} {:.1} \
             Q {:.1} {:.1}, {:.1} {:.1}",
            arm, top, waist, top, waist, top + r,
            waist, mid - r,
            waist, mid, tip, mid,
            waist, mid, waist, mid + r,
            waist, bottom - r,
            waist, bottom, arm, bottom,
        );
        // A stub from the parent's right edge to the brace tip…
        path.push_str(&format!(" M {:.1} {:.1} H {:.1}", parent.x + parent.width, mid, tip));
        // …and one from the brace to every child.
        for kid in &kids {
            path.push_str(&format!(
                " M {:.1} {:.1} H {:.1}",
                waist, kid.node.y + kid.node.height / 2.0, kid.node.x - 2.0
            ));
        }
        decor.push(Decor {
            path,
            color: if parent.depth == 0 {
                pal.branches.first().cloned().unwrap_or_else(|| s("#F9423A"))
            } else { color },
            width: 1.4,
            dash: None,
        });
    }
    decor
}

// ---------------------------------------------------------------------------
// 树型表格: one column per depth, one row per *leaf*
//
// Measured off the shipped renderer: no connectors at all, 51px per leaf row, a
// parent cell centred over the rows of its own subtree (逻辑思考 sits on the same
// line as its first child), thin vertical rules between the columns, and a
// central topic centred over the whole table.
// ---------------------------------------------------------------------------

const TABLE_PAD: f64 = 26.0;
const TABLE_MIN_COL: f64 = 90.0;
const TABLE_ROOT_COL: f64 = 150.0;
const TABLE_CELL_H: f64 = 19.0;
const TABLE_ROW_H: f64 = 51.0;
const TABLE_HEAD_H: f64 = 48.0;

/// A text-only cell: no box, no fill — 树型表格 / 矩阵图 render their topics as
/// plain labels, so the shape must not paint anything.
fn bare_cell(node: &mut LaidOutNode, size: u16, weight: u16, align: &str) {
    // Cells supply their own inset through `pad`; the generic topic text
    // padding would double it (and the matrix labels sit flush by design).
    node.text_pad = 0.0;
    node.style.fill = "none".into();
    node.style.stroke = "none".into();
    node.style.stroke_width = 0.0;
    node.style.opacity = 1.0;
    node.style.color = s("#0D0D0D");
    node.style.font_size = size;
    node.style.font_weight = weight;
    node.style.align = align.into();
    node.style.shape = "rect".into();
    let (path, closed) = crate::shape::outline("rect", node.width, node.height);
    node.shape_path = path;
    node.shape_closed = closed;
}

fn compute_table(doc: &Document, pal: &ThemePalette, m: Metrics) -> Layout {
    let sheet = doc.sheet();
    let root = &sheet.root;
    let row_h = if doc.compact { 40.0 } else { TABLE_ROW_H };
    let cell_h = if doc.compact { 17.0 } else { TABLE_CELL_H };
    let cell_size: u16 = if doc.compact { 12 } else { 13 };
    let head_size: u16 = if doc.compact { 22 } else { 26 };

    /// Column widths = the widest label in that column, plus cell padding; also
    /// counts the leaf rows the table will need.
    fn measure(
        topic: &Topic, depth: u32, cell_size: u16, head_size: u16,
        col_w: &mut HashMap<u32, f64>, leaves: &mut usize,
    ) {
        let size = if depth == 0 { head_size } else { cell_size };
        if depth > 0 && (topic.folded || topic.children.is_empty()) {
            *leaves += 1;
        }
        let width = text_width(&topic.title, size) + TABLE_PAD * 2.0;
        let min = if depth == 0 { TABLE_ROOT_COL } else { TABLE_MIN_COL };
        let entry = col_w.entry(depth).or_insert(min);
        *entry = entry.max(width);
        if topic.folded {
            return;
        }
        for child in &topic.children {
            measure(child, depth + 1, cell_size, head_size, col_w, leaves);
        }
    }

    let mut col_w: HashMap<u32, f64> = HashMap::new();
    let mut leaves = 0usize;
    measure(root, 0, cell_size, head_size, &mut col_w, &mut leaves);
    let depth_count = col_w.len().max(1) as u32;
    let mut x_off: HashMap<u32, f64> = HashMap::new();
    let mut cursor = PAD;
    for depth in 0..depth_count {
        x_off.insert(depth, cursor);
        cursor += col_w.get(&depth).copied().unwrap_or(TABLE_MIN_COL);
    }
    let table_right = cursor;
    let table_h = (leaves as f64 * row_h).max(row_h);

    /// Depth-first: leaves consume one row each, parents span their children.
    #[allow(clippy::too_many_arguments)]
    fn place(
        topic: &Topic, depth: u32, branch: usize, parent: Option<String>, child_index: usize,
        cursor: &mut f64, x_off: &HashMap<u32, f64>, col_w: &HashMap<u32, f64>,
        row_h: f64, cell_h: f64, table_h: f64, cell_size: u16, head_size: u16,
        pal: &ThemePalette, m: Metrics,
        nodes: &mut Vec<(usize, LaidOutNode)>, seq: &mut usize,
    ) -> (f64, f64) {
        let my_seq = *seq;
        *seq += 1;
        let width = col_w.get(&depth).copied().unwrap_or(TABLE_MIN_COL);
        let x = x_off.get(&depth).copied().unwrap_or(PAD);
        let top = *cursor;
        if topic.folded || topic.children.is_empty() {
            *cursor += row_h;
        } else {
            for (index, child) in topic.children.iter().enumerate() {
                place(
                    child, depth + 1, if depth == 0 { index } else { branch },
                    Some(topic.id.clone()), index, cursor, x_off, col_w, row_h,
                    cell_h, table_h, cell_size, head_size, pal, m, nodes, seq,
                );
            }
        }
        let bottom = *cursor;
        let (y, height) = if depth == 0 {
            (PAD + table_h / 2.0 - TABLE_HEAD_H / 2.0, TABLE_HEAD_H)
        } else {
            ((top + bottom) / 2.0 - cell_h / 2.0, cell_h)
        };
        let mut node = make_node(topic, x, y, width, height, depth, Side::Right, branch, parent, pal, m);
        node.cell = true;
        node.pad = TABLE_PAD;
        node.child_index = child_index;
        if depth == 0 {
            bare_cell(&mut node, head_size, 700, "center");
        } else {
            bare_cell(&mut node, cell_size, 400, "left");
        }
        nodes.push((my_seq, node));
        (top, bottom)
    }

    // Children need their spans before the parent's own y is known, so nodes
    // are pushed post-order; restore document order for the renderer.
    let mut collected: Vec<(usize, LaidOutNode)> = Vec::new();
    let mut cursor = PAD;
    let mut seq = 0usize;
    place(
        root, 0, 0, None, 0, &mut cursor, &x_off, &col_w, row_h, cell_h,
        table_h, cell_size, head_size, pal, m, &mut collected, &mut seq,
    );
    collected.sort_by_key(|(order, _)| *order);
    let nodes: Vec<LaidOutNode> = collected.into_iter().map(|(_, node)| node).collect();

    // Column rules. The shipped table only draws the vertical ones — unless
    // the theme asks for `treeTableNoConnections` / `none`.
    let mut decor: Vec<Decor> = Vec::new();
    if !matches!(root_line_class(doc, pal).as_str(), "none" | "treeTableNoConnections") {
        for depth in 1..depth_count {
            let Some(x) = x_off.get(&depth).copied() else { continue };
            decor.push(Decor {
                path: format!("M {:.1} {:.1} V {:.1}", x, PAD, PAD + table_h),
                color: pal.edge.clone(),
                width: 1.0,
                dash: None,
            });
        }
    }

    let (links, frames) = build_decorations(&nodes, doc, pal);
    Layout {
        nodes,
        edges: Vec::new(),
        decor,
        links,
        frames,
        width: table_right + PAD,
        height: table_h + PAD * 2.0,
        theme: pal.clone(),
        structure: sheet.structure,
    }
}

// ---------------------------------------------------------------------------
// 矩阵图: the central topic on top, one band of content per main branch
//
// Measured off the shipped renderer: the level-1 label is right-aligned in its
// own left column (32px ahead of the level-2 column), each level-2 topic stacks
// its children vertically to the right and carries an underline instead of a
// box, and only the level-2 → level-3 links are drawn. Groups sit 17px apart,
// 82px under the central topic.
// ---------------------------------------------------------------------------

const MATRIX_LABEL_GAP: f64 = 32.0;
const MATRIX_GROUP_GAP: f64 = 17.0;
const MATRIX_ROOT_GAP: f64 = 82.0;
const MATRIX_ROOT_H: f64 = 48.0;
const MATRIX_LABEL_SIZE: u16 = 15;
const MATRIX_LABEL_H: f64 = 24.0;

#[allow(clippy::too_many_arguments)]
fn place_matrix_branch(
    topic: &Topic, x: f64, center_y: f64, depth: u32, branch: usize, parent: Option<String>,
    child_index: usize, pal: &ThemePalette, m: Metrics, out: &mut Vec<Placed>,
) {
    let (width, height) = node_size(topic, depth, m);
    let mut node = make_node(
        topic, x, center_y - height / 2.0, width, height, depth, Side::Right,
        branch, parent, pal, m);
    node.child_index = child_index;
    if depth == 2 {
        // 二级主题只有一条下划线，没有盒子（官方矩阵图如此）。
        let ink = node.style.line_color.clone();
        node.style.fill = "none".into();
        node.style.stroke = ink;
        node.style.stroke_width = 2.0;
        node.style.underline = true;
        node.style.shape = "underline".into();
        let (path, closed) = crate::shape::outline("underline", width, height);
        node.shape_path = path;
        node.shape_closed = closed;
    } else if depth > 2 {
        let size = node.style.font_size;
        bare_cell(&mut node, size, 400, "left");
    }
    out.push(Placed { node });
    if topic.folded || topic.children.is_empty() {
        return;
    }
    let heights: Vec<f64> = topic.children.iter().map(|c| subtree_height(c, depth + 1, m)).collect();
    let total: f64 = heights.iter().sum::<f64>()
        + m.sub_gap * (topic.children.len().saturating_sub(1)) as f64;
    let mut cursor = center_y - total / 2.0;
    for (index, child) in topic.children.iter().enumerate() {
        place_matrix_branch(
            child, x + width + m.h_gap, cursor + heights[index] / 2.0, depth + 1,
            branch, Some(topic.id.clone()), index, pal, m, out,
        );
        cursor += heights[index] + m.sub_gap;
    }
}

fn compute_matrix(doc: &Document, pal: &ThemePalette, m: Metrics) -> Layout {
    let sheet = doc.sheet();
    let root = &sheet.root;

    // The level-1 labels share a right edge, so the widest one sets the column.
    let label_w = if root.folded {
        0.0
    } else {
        root.children.iter()
            .map(|c| text_width(&c.title, MATRIX_LABEL_SIZE))
            .fold(0.0f64, f64::max)
    };
    let body_x = label_w + MATRIX_LABEL_GAP;

    let mut placed: Vec<Placed> = Vec::new();
    let mut top = MATRIX_ROOT_H + MATRIX_ROOT_GAP;
    let mut block_right = body_x;

    if !root.folded {
        for (index, child) in root.children.iter().enumerate() {
            let grandchildren: &[Topic] = if child.folded { &[] } else { &child.children };
            let mut group: Vec<Placed> = Vec::new();
            let mut cursor = 0.0f64;
            for (position, grandchild) in grandchildren.iter().enumerate() {
                let mut buf: Vec<Placed> = Vec::new();
                place_matrix_branch(
                    grandchild, body_x, 0.0, 2, index, Some(child.id.clone()),
                    position, pal, m, &mut buf,
                );
                let min_y = buf.iter().map(|p| p.node.y).fold(f64::INFINITY, f64::min);
                let max_y = buf.iter().map(|p| p.node.y + p.node.height)
                    .fold(f64::NEG_INFINITY, f64::max);
                for mut item in buf.drain(..) {
                    item.node.y = item.node.y - min_y + cursor;
                    block_right = block_right.max(item.node.x + item.node.width);
                    group.push(item);
                }
                cursor += (max_y - min_y) + m.sub_gap;
            }
            let group_h = (cursor - m.sub_gap).max(MATRIX_LABEL_H);

            let label_width = text_width(&child.title, MATRIX_LABEL_SIZE);
            let mut label = make_node(
                child, body_x - MATRIX_LABEL_GAP - label_width,
                top + (group_h - MATRIX_LABEL_H) / 2.0, label_width, MATRIX_LABEL_H,
                1, Side::Right, index, Some(root.id.clone()), pal, m);
            label.child_index = index;
            bare_cell(&mut label, MATRIX_LABEL_SIZE, 700, "right");
            placed.push(Placed { node: label });

            for mut item in group.drain(..) {
                item.node.y += top;
                placed.push(item);
            }
            top += group_h + MATRIX_GROUP_GAP;
        }
    }

    // The central topic is a wide banner over the whole matrix.
    let block_w = block_right.max(150.0);
    let mut banner = make_node(root, 0.0, 0.0, block_w, MATRIX_ROOT_H, 0, Side::Right, 0, None, pal, m);
    banner.style.fill = pal.bg.clone();
    banner.style.stroke = s("#000229");
    banner.style.stroke_width = 1.0;
    banner.style.color = s("#0D0D0D");
    banner.style.font_size = 26;
    banner.style.font_weight = 700;
    banner.style.align = "center".into();
    banner.pad = 0.0;
    banner.text_pad = 0.0;
    let (path, closed) = crate::shape::outline("rect", block_w, MATRIX_ROOT_H);
    banner.shape_path = path;
    banner.shape_closed = closed;
    placed.insert(0, Placed { node: banner });

    // Only the level-2 → level-3 links exist, and they leave the underline's
    // right end instead of a box edge.
    let mut anchors: Anchors = HashMap::new();
    {
        let by_id: HashMap<&str, &LaidOutNode> =
            placed.iter().map(|p| (p.node.id.as_str(), &p.node)).collect();
        for item in &placed {
            if item.node.depth < 3 {
                continue;
            }
            let Some(parent) = item.node.parent_id.as_deref().and_then(|id| by_id.get(id)) else {
                continue;
            };
            anchors.insert(item.node.id.clone(), (
                (parent.x + parent.width, parent.y + parent.height / 2.0),
                (item.node.x, item.node.y + item.node.height / 2.0),
            ));
        }
    }

    let min_x = placed.iter().map(|p| p.node.x).fold(f64::INFINITY, f64::min);
    let min_y = placed.iter().map(|p| p.node.y).fold(f64::INFINITY, f64::min);
    let max_x = placed.iter().map(|p| p.node.x + p.node.width).fold(f64::NEG_INFINITY, f64::max);
    let max_y = placed.iter().map(|p| p.node.y + p.node.height).fold(f64::NEG_INFINITY, f64::max);
    let shift_x = PAD - min_x;
    let shift_y = PAD - min_y;
    for item in &mut placed {
        item.node.x += shift_x;
        item.node.y += shift_y;
    }
    for ((sx, sy), (ex, ey)) in anchors.values_mut() {
        *sx += shift_x;
        *sy += shift_y;
        *ex += shift_x;
        *ey += shift_y;
    }

    let depth_of: HashMap<&str, u32> =
        placed.iter().map(|p| (p.node.id.as_str(), p.node.depth)).collect();
    let mut edges = if matches!(root_line_class(doc, pal).as_str(), "none" | "treeTableNoConnections") {
        Vec::new()
    } else {
        build_edges(&placed, pal, false, false, &anchors)
    };
    edges.retain(|e| depth_of.get(e.from.as_str()).copied().unwrap_or(0) >= 2);

    let nodes: Vec<LaidOutNode> = placed.into_iter().map(|p| p.node).collect();
    let (links, frames) = build_decorations(&nodes, doc, pal);
    Layout {
        nodes,
        edges,
        decor: Vec::new(),
        links,
        frames,
        width: (max_x - min_x + PAD * 2.0).max(320.0),
        height: (max_y - min_y + PAD * 2.0).max(240.0),
        theme: pal.clone(),
        structure: sheet.structure,
    }
}

// ---------------------------------------------------------------------------
// 联系 / 外框 / 概要 — decoration geometry
// ---------------------------------------------------------------------------

fn str_of(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or("").to_string()
}

fn node_center(node: &LaidOutNode) -> (f64, f64) {
    (node.x + node.width / 2.0, node.y + node.height / 2.0)
}

/// Where the ray from a node's centre towards `target` leaves its box.
fn edge_point(node: &LaidOutNode, target: (f64, f64)) -> (f64, f64) {
    let (cx, cy) = node_center(node);
    let dx = target.0 - cx;
    let dy = target.1 - cy;
    let tx = if dx.abs() < 0.001 { f64::INFINITY } else { (node.width / 2.0 + 3.0) / dx.abs() };
    let ty = if dy.abs() < 0.001 { f64::INFINITY } else { (node.height / 2.0 + 3.0) / dy.abs() };
    let t = tx.min(ty);
    (cx + dx * t, cy + dy * t)
}

/// Bounding box of an inclusive sibling range, expanded to whole subtrees so
/// a 外框 / 概要 wraps the branches it covers rather than just the row labels.
fn range_bounds_from(all: &[&LaidOutNode], start: &str, end: &str) -> Option<(f64, f64, f64, f64)> {
    let first = *all.iter().find(|n| n.id == start)?;
    let last = *all.iter().find(|n| n.id == end)?;
    let lo = first.child_index.min(last.child_index);
    let hi = first.child_index.max(last.child_index);
    let mut ids: HashSet<String> = all
        .iter()
        .filter(|n| {
            n.parent_id.as_deref() == first.parent_id.as_deref()
                && n.side == first.side
                && n.child_index >= lo
                && n.child_index <= hi
        })
        .map(|n| n.id.clone())
        .collect();
    if ids.is_empty() {
        return None;
    }
    loop {
        let before = ids.len();
        for node in all {
            if let Some(parent) = &node.parent_id {
                if ids.contains(parent) {
                    ids.insert(node.id.clone());
                }
            }
        }
        if ids.len() == before {
            break;
        }
    }
    let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for node in all.iter().filter(|n| ids.contains(&n.id)) {
        x0 = x0.min(node.x);
        y0 = y0.min(node.y);
        x1 = x1.max(node.x + node.width);
        y1 = y1.max(node.y + node.height);
    }
    if !x0.is_finite() {
        return None;
    }
    Some((x0, y0, x1 - x0, y1 - y0))
}

fn range_bounds(nodes: &[LaidOutNode], start: &str, end: &str) -> Option<(f64, f64, f64, f64)> {
    let refs: Vec<&LaidOutNode> = nodes.iter().collect();
    range_bounds_from(&refs, start, end)
}

fn rounded_box(x: f64, y: f64, w: f64, h: f64, radius: f64) -> String {
    let r = radius.min(w / 2.0).min(h / 2.0);
    let (x1, y1) = (x + w, y + h);
    let mut d = format!("M {:.1} {:.1} H {:.1}", x + r, y, x1 - r);
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1}", x1, y, x1, y + r));
    d.push_str(&format!(" V {:.1}", y1 - r));
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1}", x1, y1, x1 - r, y1));
    d.push_str(&format!(" H {:.1}", x + r));
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1}", x, y1, x, y1 - r));
    d.push_str(&format!(" V {:.1}", y + r));
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1} Z", x, y, x + r, y));
    d
}

/// XMind's 概要 brace: hugs a range and points at the summary topic to its right.
fn brace_path(x: f64, y: f64, w: f64, h: f64) -> String {
    let (xr, y1, my) = (x + w, y + h, y + h / 2.0);
    let mut d = format!("M {:.1} {:.1} H {:.1}", x, y, xr - 10.0);
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1}", xr, y, xr, y + 10.0));
    d.push_str(&format!(" V {:.1} L {:.1} {:.1} L {:.1} {:.1}", my - 12.0, xr + 14.0, my, xr, my + 12.0));
    d.push_str(&format!(" V {:.1}", y1 - 10.0));
    d.push_str(&format!(" Q {:.1} {:.1} {:.1} {:.1}", xr, y1, xr - 10.0, y1));
    d.push_str(&format!(" H {:.1}", x));
    d
}

/// XMind's own 概要 format: the summary topic lives in `children.summary`
/// while a sibling of that group, `summaries[]`, carries `range: "(a,b)"`,
/// `topicId` and the brace's `shape-class`.  Files written by this app use
/// `topic.extra.summaryRange` instead (see `collect_summaries`).
fn native_summary_range(item: &Value, siblings: &[Topic]) -> Option<(String, String)> {
    if let Some(obj) = item.get("range").and_then(Value::as_object) {
        return Some((str_of(obj.get("startId")), str_of(obj.get("endId"))));
    }
    let text = item.get("range").and_then(Value::as_str)?;
    let inner = text.trim().trim_start_matches('(').trim_end_matches(')');
    let mut parts = inner.split(',');
    let a = parts.next()?.trim().parse::<usize>().ok()?;
    let b = parts.next()?.trim().parse::<usize>().ok()?;
    let (a, b) = (a.min(b), a.max(b));
    Some((siblings.get(a)?.id.clone(), siblings.get(b)?.id.clone()))
}

/// `line-width` in theme JSON is pt (1pt = 4/3 px); bare numbers are px.
fn summary_width_px(value: &str) -> f64 {
    let text = value.trim();
    let (number, pt) = if let Some(raw) = text.strip_suffix("pt") {
        (raw.trim(), true)
    } else {
        (text.trim_end_matches("px").trim(), false)
    };
    let n: f64 = number.parse().unwrap_or(1.8);
    (if pt { n * 4.0 / 3.0 } else { n }).clamp(0.5, 12.0)
}

/// `}` brace to the right of a sibling run.  Measured on example2.xmind:
/// curly `M 10 1 C 46 1, 0 h/2, 36 h/2 C 0 h/2, 46 h-1, 10 h-1`, square
/// `M 10 1 L 23 1 L 23 h-1 L 10 h-1 M 23 h/2 L 36 h/2`; both stroke `#0D0D0D`
/// at 2px.
fn native_summary_brace(curly: bool, x: f64, y: f64, h: f64) -> String {
    let (top, bot, mid) = (y + 1.0, y + h - 1.0, y + h / 2.0);
    if curly {
        format!(
            "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
            x + 10.0, top, x + 46.0, top, x, mid, x + 36.0, mid,
            x, mid, x + 46.0, bot, x + 10.0, bot,
        )
    } else {
        format!(
            "M {:.1} {:.1} L {:.1} {:.1} L {:.1} {:.1} L {:.1} {:.1} M {:.1} {:.1} L {:.1} {:.1}",
            x + 10.0, top, x + 23.0, top, x + 23.0, bot, x + 10.0, bot,
            x + 23.0, mid, x + 36.0, mid,
        )
    }
}

fn theme_prop<'a>(layer: Option<&'a Value>, key: &str) -> Option<&'a str> {
    layer.and_then(|p| p.get(key)).and_then(Value::as_str)
}

/// Effective style of a 概要 topic: the `summaryTopic` layer (no plate, blue
/// 2px outline, Montserrat 14) plus whatever the topic's own style overrides.
fn native_summary_style(
    sum: &Topic, branch: usize, pal: &ThemePalette, theme: Option<&Value>,
) -> EffectiveStyle {
    let mut st = style_for(sum, 2, branch, pal);
    let layer = |name: &str| theme.and_then(|t| t.get(name)).and_then(|l| l.get("properties"));
    let prop = theme_prop;
    let st_layer = layer("summaryTopic");
    st.fill = "none".into();
    st.stroke = prop(st_layer, "border-line-color").map(theme_style::color)
        .filter(|c| c != "none").unwrap_or_else(|| s("#233ED9"));
    st.stroke_width = prop(st_layer, "border-line-width").and_then(theme_style::to_px)
        .unwrap_or(2.0).max(1.0);
    if prop(st_layer, "fill-pattern") != Some("none") {
        if let Some(fill) = prop(st_layer, "svg:fill") { st.fill = theme_style::color(fill); }
    }
    st.color = prop(st_layer, "fo:color").map(theme_style::color)
        .filter(|c| c != "none" && !theme_style::is_inherited(c))
        .unwrap_or_else(|| s("#0D0D0D"));
    if let Some(size) = prop(st_layer, "fo:font-size").and_then(theme_style::pt) {
        st.font_size = (size.round() as u16).clamp(6, 96);
    }
    if let Some(weight) = prop(st_layer, "fo:font-weight").and_then(theme_style::font_weight) {
        st.font_weight = weight;
    }
    if let Some(family) = prop(st_layer, "fo:font-family") {
        st.font_family = Some(theme_style::font_stack(family));
    }
    if let Some(shape) = prop(st_layer, "shape-class") { st.shape = theme_style::shape(shape); }
    st.underline = false;
    if let Some(patch) = &sum.style {
        if let Some(fill) = patch.fill.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            st.fill = theme_style::color(fill);
            if st.fill != "none" && patch.color.is_none() {
                st.color = readable_on(&st.fill).into();
            }
        }
        if let Some(color) = patch.color.as_ref().filter(|v| !theme_style::is_inherited(v)) {
            st.color = theme_style::color(color);
        }
        if let Some(bold) = patch.bold { st.font_weight = if bold { 700 } else { 400 }; }
        if let Some(size) = patch.font_size { st.font_size = size; }
        if let Some(family) = &patch.font_family { st.font_family = Some(theme_style::font_stack(family)); }
    }
    st
}

/// Ids of 概要 topics already registered in a native `summaries[]` table.
/// Those are drawn once by `place_native_summaries`; the floating-topic pass
/// and the legacy `collect_summaries` pass must not draw them a second time.
fn collect_native_summary_ids(topic: &Topic, out: &mut HashSet<String>) {
    if let Some(list) = topic.extra.get("summaries").and_then(Value::as_array) {
        for item in list {
            if let Some(id) = item.get("topicId").and_then(Value::as_str) {
                out.insert(id.to_string());
            }
        }
    }
    for child in topic.children.iter()
        .chain(topic.detached.iter())
        .chain(topic.summary.iter())
        .chain(topic.callout.iter())
    {
        collect_native_summary_ids(child, out);
    }
}

/// A native 概要 topic is a real branch root: its attached children grow to
/// the right and are connected with the sheet's ordinary branch lines.  The
/// main-tree pass never sees them because XMind keeps the whole subtree in
/// `children.summary` under the range's parent (FINDINGS §49).  Lay them out
/// here, after 同级主题对齐 and the stage shift, so their widths stay their
/// own instead of being stretched to the main tree's level width.
fn place_summary_children(
    parent_topic: &Topic, parent: &LaidOutNode, depth: u32, branch: usize,
    pal: &ThemePalette, m: Metrics, gap: f64, center_y: f64,
    out: &mut Vec<Placed>,
) {
    if parent_topic.folded || parent_topic.children.is_empty() { return; }
    let heights: Vec<f64> = parent_topic.children.iter()
        .map(|kid| subtree_height(kid, depth, m)).collect();
    let total: f64 = heights.iter().sum::<f64>()
        + m.sub_gap * (heights.len().saturating_sub(1)) as f64;
    let mut cursor = center_y - total / 2.0;
    for (index, kid) in parent_topic.children.iter().enumerate() {
        let h = heights[index];
        let child_center = cursor + h / 2.0;
        let (w, kh) = node_size(kid, depth, m);
        let x = parent.x + parent.width + gap;
        let mut node = make_node(
            kid, x, child_center - kh / 2.0, w, kh, depth, Side::Right, branch,
            Some(parent.id.clone()), pal, m,
        );
        node.child_index = index;
        out.push(Placed { node: node.clone() });
        place_summary_children(kid, &node, depth + 1, branch, pal, m, gap, child_center, out);
        cursor += h + m.sub_gap;
    }
}

/// Lay out every native 概要 topic and its brace, then append both to the
/// stage.  Called after the main/floating trees are placed and shifted.
fn place_native_summaries(
    topic: &Topic, placed: &mut Vec<Placed>, edges: &mut Vec<Edge>,
    pal: &ThemePalette, m: Metrics, frames: &mut Vec<Frame>,
    theme: Option<&Value>, branch: usize,
) {
    for group in [&topic.children, &topic.detached, &topic.summary, &topic.callout] {
        let kids: Vec<&Topic> = group.iter().collect();
        for kid in kids {
            place_native_summaries(kid, placed, edges, pal, m, frames, theme, branch);
        }
    }
    let Some(list) = topic.extra.get("summaries").and_then(Value::as_array) else { return; };
    let theme_color = theme.and_then(|t| t.get("summary"))
        .and_then(|l| l.get("properties")).and_then(|p| p.get("line-color"))
        .and_then(Value::as_str).map(theme_style::color)
        .filter(|c| c != "none");
    for item in list {
        // 概要线型 in the style panel writes these three keys on this very
        // `summaries[]` entry; the theme layer is only the fallback.
        let props = item.get("style").and_then(|v| v.get("properties"));
        let prop = |key: &str| props.and_then(|p| p.get(key)).and_then(Value::as_str);
        let frame_color = prop("line-color").map(theme_style::color)
            .filter(|c| c != "none").or_else(|| theme_color.clone())
            .unwrap_or_else(|| s("#0D0D0D"));
        let brace_width = prop("line-width").map(summary_width_px).unwrap_or(1.8);
        let curly = prop("shape-class").map(|v| v.ends_with("curly")).unwrap_or(false);
        let topic_id = str_of(item.get("topicId"));
        let Some(sum) = topic.summary.iter().find(|t| t.id == topic_id) else { continue; };
        let Some((start_id, end_id)) = native_summary_range(item, &topic.children) else { continue; };
        let (x, y, w, h) = {
            let mut found = Vec::new();
            let mut collecting = false;
            for child in &topic.children {
                if child.id == start_id { collecting = true; }
                if collecting {
                    if let Some(p) = placed.iter().find(|p| p.node.id == child.id) {
                        found.push((p.node.x, p.node.y, p.node.x + p.node.width, p.node.y + p.node.height));
                    }
                }
                if child.id == end_id { break; }
            }
            if found.is_empty() { continue; }
            let (x0, y0, x1, y1) = found.iter().copied().fold(
                (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
                |(ax, ay, bx, by), (cx, cy, dx, dy)| (ax.min(cx), ay.min(cy), bx.max(dx), by.max(dy)),
            );
            (x0, y0, x1 - x0, y1 - y0)
        };
        let brace_x = x + w + 10.0;
        let brace_y = y - 3.5;
        let brace_h = h + 7.0;
        frames.push(Frame {
            id: sum.id.clone(),
            kind: "summary".into(),
            title: String::new(),
            path: native_summary_brace(curly, brace_x, brace_y, brace_h),
            color: frame_color.clone(),
            width: brace_width,
            label_x: brace_x,
            label_y: brace_y,
            parent_id: Some(topic.id.clone()),
            start_id: start_id.clone(),
            end_id: end_id.clone(),
            start_x: brace_x + 10.0,
            start_y: brace_y,
            end_x: brace_x + 10.0,
            end_y: brace_y + brace_h,
        });
        let (sw, sh) = node_size(sum, 2, m);
        let sx = x + w + 47.0;
        let sy = y + h / 2.0 - sh / 2.0;
        let mut node = make_node(sum, sx, sy, sw, sh, 2, Side::Right, branch, Some(topic.id.clone()), pal, m);
        node.style = native_summary_style(sum, branch, pal, theme);
        let (path, closed) = crate::shape::outline(&node.style.shape, sw, sh);
        node.shape_path = path;
        node.shape_closed = closed;
        node.parent_id = None; // 概要 topics are not part of the branch tree
        // The summary topic is a branch root of its own.  XMind stacks its
        // attached children just below the topic's centre (measured +8px on
        // test2.xmind) and leaves ~27px before their left edge.
        let root_node = node.clone();
        let mut subtree = vec![Placed { node }];
        let child_gap = (m.h_gap / 2.0).max(16.0);
        let stack_center = sy + sh / 2.0 + m.sub_gap;
        place_summary_children(
            sum, &root_node, 3, branch, pal, m, child_gap, stack_center, &mut subtree,
        );
        let empty_anchors: Anchors = HashMap::new();
        let mut subtree_edges = build_edges(&subtree, pal, false, false, &empty_anchors);
        edges.append(&mut subtree_edges);
        placed.extend(subtree);
    }
}

fn collect_summaries<'a>(topic: &'a Topic, out: &mut Vec<&'a Topic>) {
    for child in topic
        .summary
        .iter()
        .chain(topic.children.iter())
        .chain(topic.detached.iter())
        .chain(topic.callout.iter())
    {
        if child.extra.contains_key("summaryRange") {
            out.push(child);
        }
        collect_summaries(child, out);
    }
}

fn build_decorations(
    nodes: &[LaidOutNode], doc: &Document, pal: &ThemePalette,
) -> (Vec<Link>, Vec<Frame>) {
    let extra = &doc.sheet().extra;
    let branches = &pal.branches;
    // `theme.relationship` owns the ink of 联系 lines: a dashed near-black 2px
    // stroke, not the first branch hue (which is white on some palettes and
    // made the line invisible on a white canvas).
    let rel = extra.get("theme").and_then(|t| t.get("relationship"))
        .and_then(|r| r.get("properties"));
    let rel_color = rel.and_then(|p| p.get("line-color")).and_then(Value::as_str)
        .map(theme_style::color).filter(|c| c != "none")
        .unwrap_or_else(|| s("#0D0D0D"));
    let rel_width = rel.and_then(|p| p.get("line-width")).and_then(Value::as_str)
        .and_then(theme_style::to_px).unwrap_or(2.0);
    let rel_dash = rel.and_then(|p| p.get("line-pattern")).and_then(Value::as_str)
        .map(|v| v == "dash" || v == "dashed").unwrap_or(false);
    let mut links = Vec::new();
    if let Some(list) = extra.get("relationships").and_then(Value::as_array) {
        for item in list {
            let (id, from, to) = (str_of(item.get("id")), str_of(item.get("end1Id")), str_of(item.get("end2Id")));
            let (Some(a), Some(b)) = (
                nodes.iter().find(|n| n.id == from),
                nodes.iter().find(|n| n.id == to),
            ) else { continue };
            let (ac, bc) = (node_center(a), node_center(b));
            let point = |group: &str, index: &str| -> Option<(f64, f64)> {
                let raw = item.get(group)?.get(index)?;
                Some((raw.get("x")?.as_f64()?, raw.get("y")?.as_f64()?))
            };
            // XMind stores the exact cubic: endpoints are centre + lineEndPoints,
            // controls are endpoint + controlPoints.  Fall back to a curved
            // approximation for relationships written without those fields.
            let (p0, p1, path) = match (point("lineEndPoints", "0"), point("lineEndPoints", "1"),
                                        point("controlPoints", "0"), point("controlPoints", "1")) {
                (Some(e0), Some(e1), Some(c0), Some(c1)) => {
                    let p0 = (ac.0 + e0.0, ac.1 + e0.1);
                    let p1 = (bc.0 + e1.0, bc.1 + e1.1);
                    let q0 = (p0.0 + c0.0, p0.1 + c0.1);
                    let q1 = (p1.0 + c1.0, p1.1 + c1.1);
                    (p0, p1, format!(
                        "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                        p0.0, p0.1, q0.0, q0.1, q1.0, q1.1, p1.0, p1.1,
                    ))
                }
                _ => {
                    let (p0, p1) = (edge_point(a, bc), edge_point(b, ac));
                    let (dx, dy) = (p1.0 - p0.0, p1.1 - p0.1);
                    let len = (dx * dx + dy * dy).sqrt().max(1.0);
                    let bend = (len * 0.16).min(64.0) + 18.0;
                    let (cx, cy) = (
                        (p0.0 + p1.0) / 2.0 - dy / len * bend,
                        (p0.1 + p1.1) / 2.0 + dx / len * bend,
                    );
                    (p0, p1, format!("M {:.1} {:.1} Q {:.1} {:.1} {:.1} {:.1}", p0.0, p0.1, cx, cy, p1.0, p1.1))
                }
            };
            links.push(Link {
                id,
                from,
                to,
                title: str_of(item.get("title")),
                path,
                color: rel_color.clone(),
                width: rel_width,
                dash: rel_dash.then(|| "9 3".to_string()),
                arrow: rel.and_then(|p| p.get("arrow-end-class")).and_then(Value::as_str)
                    .map(|v| !v.ends_with(".none")).unwrap_or(true),
                label_x: (p0.0 + p1.0) / 2.0,
                label_y: (p0.1 + p1.1) / 2.0,
            });
        }
    }

    let mut frames = Vec::new();
    let colour = |index: usize| {
        if branches.is_empty() { s("#8A63D2") } else { branches[index % branches.len()].clone() }
    };
    if let Some(list) = extra.get("boundaries").and_then(Value::as_array) {
        for item in list {
            let (start, end) = match item.get("range") {
                Some(Value::Object(range)) => (str_of(range.get("startId")), str_of(range.get("endId"))),
                Some(Value::String(text)) => {
                    let inner = text.trim().trim_start_matches('(').trim_end_matches(')');
                    let mut parts = inner.split(',');
                    (parts.next().unwrap_or("").trim().to_string(), parts.next().unwrap_or("").trim().to_string())
                }
                _ => (String::new(), String::new()),
            };
            let Some((x, y, w, h)) = range_bounds(nodes, &start, &end) else { continue };
            let pad = 14.0;
            frames.push(Frame {
                id: str_of(item.get("id")),
                kind: "boundary".into(),
                title: str_of(item.get("title")),
                path: rounded_box(x - pad, y - pad, w + pad * 2.0, h + pad * 2.0, 14.0),
                color: colour(frames.len()),
                width: 1.8,
                label_x: x - pad + 12.0,
                label_y: y - pad + 18.0,
                parent_id: crate::ops::parent_id_of(doc.root(), &start),
                start_x: x - pad,
                start_y: y - pad,
                end_x: x - pad,
                end_y: y + h + pad,
                start_id: start,
                end_id: end,
            });
        }
    }
    let mut summaries = Vec::new();
    collect_summaries(doc.root(), &mut summaries);
    let mut native_ids = HashSet::new();
    collect_native_summary_ids(doc.root(), &mut native_ids);
    for topic in summaries {
        if native_ids.contains(&topic.id) { continue; }
        let Some((start, end)) = topic.extra.get("summaryRange").map(|range| {
            (str_of(range.get("startId")), str_of(range.get("endId")))
        }) else { continue };
        let Some((x, y, w, h)) = range_bounds(nodes, &start, &end) else { continue };
        let pad = 12.0;
        frames.push(Frame {
            id: topic.id.clone(),
            kind: "summary".into(),
            title: String::new(),
            path: brace_path(x - 6.0, y - pad, w + 12.0, h + pad * 2.0),
            color: colour(frames.len()),
            width: 1.8,
            label_x: x,
            label_y: y - pad,
            parent_id: crate::ops::parent_id_of(doc.root(), &start),
            // XMind's summary handles sit on the brace's two tips.
            start_x: x - 6.0,
            start_y: y - pad,
            end_x: x - 6.0,
            end_y: y + h + pad,
            start_id: start,
            end_id: end,
        });
    }
    (links, frames)
}

// ---------------------------------------------------------------------------

pub fn compute_layout(doc: &Document) -> Layout {
    if doc.sheets.is_empty() {
        return compute_layout(&Document::default());
    }
    let sheet = doc.sheet();
    let mut pal = palette(doc.theme);
    // 骨架 is a sheet-level style, exactly like `sheet.theme`: read it once
    // here so every depth layer (including newly added topics) sees it.
    pal.skeleton = SkeletonLayers::from_value(sheet.extra.get(SKELETON_KEY));
    // FINDINGS §26 option A: read `sheet.theme` through the official StyleKey
    // cascade instead of painting every file with our own hard-coded palette.
    let sheet_theme = SheetTheme::from_value(sheet.extra.get("theme"));
    // `fo:text-align` is honoured by the shipped renderer even when the sheet
    // theme fails our `foreign` test (a real theme re-tagged as
    // `colorThemeId: XMindRS-*` on save).  Inject just that key instead of the
    // whole theme: its `line-class` / `line-tapered` values would otherwise
    // rewrite every connector in such a file (FINDINGS §46 / §47).
    for (index, depth) in [0u32, 1, 2].into_iter().enumerate() {
        if let Some(v) = sheet_theme.get(depth, sk::TEXT_ALIGN) {
            if matches!(v, "left" | "center" | "right") {
                pal.theme_align[index] = Some(v.to_string());
            }
        }
    }
    // The canvas colour is a sheet property, not part of the style cascade.
    // Honour it even when a real XMind theme was re-tagged with one of our
    // palette ids on save (`colorThemeId: XMindRS-*`) — otherwise those files
    // silently fall back to a white canvas (FINDINGS §46).
    if let Some(bg) = sheet_theme.background() { pal.bg = bg; }
    // `sheet_theme` is moved into `pal` just below, so remember whether the
    // file carries a theme that XMind itself cannot resolve.
    let unresolved_theme = !sheet_theme.has_theme && sheet.extra.contains_key("theme");
    if sheet_theme.has_theme {
        // `read_palette` normally puts these in `branch_colors`; this covers
        // documents built in memory or switched to another sheet.
        if doc.branch_colors.is_none() {
            let colors = sheet_theme.multi_line_colors();
            if colors.len() >= 2 { pal.branches = colors; }
        }
        pal.sheet_theme = Some(sheet_theme);
    }
    if let Some(bg) = &doc.background { pal.bg = bg.clone(); }
    if let Some(colors) = &doc.branch_colors {
        if !colors.is_empty() { pal.branches = colors.clone(); }
    }
    if let Some(center) = &doc.center_color {
        if !center.is_empty() { pal.center = center.clone(); }
    }
    if !doc.rainbow {
        let single = pal.branches.first().cloned().unwrap_or_else(|| s("#F9423A"));
        pal.branches = vec![single; pal.branches.len().max(1)];
    }
    let structure = sheet.structure;

    if matches!(structure, Structure::TreeTable) {
        return compute_table(doc, &pal, Metrics::new(doc.compact).with_theme(pal.sheet_theme.as_ref()));
    }
    if matches!(structure, Structure::Matrix) {
        return compute_matrix(doc, &pal, Metrics::new(doc.compact).with_theme(pal.sheet_theme.as_ref()));
    }

    let brace = matches!(structure, Structure::BraceRight | Structure::BraceLeft);
    let mut m = if brace { Metrics::brace(doc.compact) } else { Metrics::new(doc.compact) }
        .with_theme(pal.sheet_theme.as_ref());
    // A real sheet theme re-tagged with one of our palette ids is unresolved
    // in the shipped renderer, which falls back to 30px marker icons (34px
    // slots).  Native themes keep 36px / 40px (FINDINGS §43 / §47).
    if unresolved_theme {
        m.marker_icon = 30.0;
    }
    if matches!(structure, Structure::LogicRight | Structure::LogicLeft) {
        // 逻辑图 bundles its branches into a 160px fan before the first topic.
        m.root_gap = if doc.compact { 96.0 } else { 160.0 };
    }
    let root = &sheet.root;
    let (root_width, root_height) = node_size(root, 0, m);
    let root_half = root_width / 2.0;
    let vertical = structure.vertical();
    let upward = matches!(structure, Structure::OrgUp);

    let mut placed: Vec<Placed> = Vec::new();
    let mut anchors: Anchors = HashMap::new();

    if matches!(structure, Structure::FishboneLeft | Structure::FishboneRight) {
        place_fishbone(root, structure == Structure::FishboneLeft, &pal, m, &mut placed, &mut anchors);
    } else if matches!(structure, Structure::TreeRight | Structure::TreeLeft) {
        // 树形图 is an indented outline, not a logic chart: children hang under
        // their parent and shift right (left) by 0.75 × the parent's width.
        let (_, root_height) = node_size(root, 0, m);
        placed.push(Placed {
            node: make_node(root, -root_half, 0.0, root_width, root_height, 0, Side::Right, 0, None, &pal, m),
        });
        if !root.folded {
            let left = structure == Structure::TreeLeft;
            let mut cursor = root_height;
            // XMind indents from the parent's *left* edge (0.75 × its width for
            // the central topic), not from its right edge.
            let indent = root_width * 0.75;
            for (index, child) in root.children.iter().enumerate() {
                let (child_width, child_height) = node_size(child, 1, m);
                // `place_outline` subtracts `width` itself for a left-growing
                // outline, so pass the child's right edge here.
                let child_x = if left {
                    -root_half + root_width - indent
                } else {
                    -root_half + indent
                };
                // 树形图 gives the first branch 50px below the central topic and
                // then packs the rest with the standard 36px branch gap (measured).
                let child_y = cursor + if index == 0 { TREE_BRANCH_GAP } else { m.v_gap };
                anchors.insert(child.id.clone(), (
                    (0.0, root_height),
                    (if left { child_x - child_width / 2.0 } else { child_x + child_width / 2.0 },
                     child_y + child_height / 2.0),
                ));
                cursor = place_outline(
                    child, child_x, child_y, 1, index, Some(root.id.clone()),
                    &pal, m, left, &mut placed, &mut anchors, index,
                );
            }
        }
    } else if matches!(structure, Structure::Timeline) {
        // 时间轴: milestones ride a vertical spine, alternating left/right.
        place_timeline(root, false, upward, &pal, m, &mut placed, &mut anchors);
    } else if matches!(structure, Structure::TimelineHorizontal) {
        place_timeline(root, true, upward, &pal, m, &mut placed, &mut anchors);
    } else if vertical {
        let rows = max_row_height(root, 0, m);
        place_vertical(root, 0.0, 0, 0, None, &rows, upward, &pal, m, &mut placed, 0);
    } else {
        // The root is placed by hand (its children need separate left/right
        // stacks), so `place_horizontal`'s own `folded` early-return never sees
        // it. Honour the flag here or the − badge on the central topic does
        // nothing visible.
        placed.push(Placed {
            node: make_node(root, -root_half, -root_height / 2.0, root_width, root_height, 0, Side::Right, 0, None, &pal, m),
        });
        if !root.folded {
            let total = root.children.len();
            // 平衡图 fills the right half until the running branch height passes
            // half of the total, so tall branches stay together. On the sample
            // that is 3 right / 5 left — a plain ⌈n/2⌉ split (4/4) put 灵感/创意
            // on the wrong side.
            let balanced_split = if structure == Structure::Balanced && total > 1 {
                let heights: Vec<f64> =
                    root.children.iter().map(|c| subtree_height(c, 1, m)).collect();
                let sum: f64 = heights.iter().sum();
                let mut acc = 0.0;
                let mut split = 0usize;
                for h in &heights {
                    if acc + h > sum / 2.0 {
                        break;
                    }
                    acc += h;
                    split += 1;
                }
                Some(split.clamp(1, total - 1))
            } else {
                None
            };
            let mut sides = Vec::with_capacity(total);
            for (index, child) in root.children.iter().enumerate() {
                let side = match (child.side, balanced_split) {
                    (Some(explicit), _) => explicit,
                    (None, Some(split)) => {
                        if index < split { Side::Right } else { Side::Left }
                    }
                    (None, None) => side_for(structure, index, total, None),
                };
                sides.push((index, side));
            }
            let mut columns: Columns = HashMap::new();
            for (index, side) in &sides {
                collect_columns(&root.children[*index], 1, *side, &mut columns, m);
            }
            // `alignment-by-level` is global per depth: keep the column pitch in
            // step with `apply_alignment`, otherwise the widened left-hand boxes
            // would eat into the next column's starting x.
            if doc.sibling_align {
                let mut by_depth: HashMap<u32, f64> = HashMap::new();
                for ((_, depth), width) in &columns {
                    let entry = by_depth.entry(*depth).or_insert(0.0);
                    *entry = entry.max(*width);
                }
                for ((_, depth), width) in columns.iter_mut() {
                    *width = by_depth[depth];
                }
            }
            let right_count = sides.iter().filter(|(_, s)| *s == Side::Right).count();
            // Balanced / clockwise / anticlockwise space their branch *centres*
            // symmetrically around the central topic when both halves hold the
            // same number of leaf branches (FINDINGS §47).  Maps whose branches
            // have their own subtrees keep the older top-edge stack measured in
            // §24.5, so their bbox match is untouched.
            // test2.xmind (FINDINGS §53): with exactly one attached branch the
            // shipped renderer centres that branch on the central topic even
            // when it owns a subtree.  Top-edge stacking only applies to the
            // multi-branch samples measured in §24.5 / §47.
            let centred_stacks = total == 1
                || (matches!(structure,
                        Structure::Balanced | Structure::Clockwise | Structure::Anticlockwise)
                    && !doc.compact
                    && right_count > 0 && right_count * 2 == total
                    && root.children.iter().all(|c| c.children.is_empty()));
            for side in [Side::Right, Side::Left] {
                let mut members: Vec<usize> = sides.iter()
                    .filter(|(_, s)| *s == side)
                    .map(|(i, _)| *i)
                    .collect();
                if members.is_empty() { continue; }
                // Clockwise: after the right half, continue clockwise along the
                // left half bottom-to-top (XMind's classic arrangement). 平衡图
                // stacks the left half the same way in the shipped renderer.
                if (matches!(structure, Structure::Clockwise | Structure::Balanced)
                    && side == Side::Left)
                    || (structure == Structure::Anticlockwise && side == Side::Right)
                {
                    members.reverse();
                }
                let heights: Vec<f64> = members.iter().map(|i| subtree_height(&root.children[*i], 1, m)).collect();
                if centred_stacks {
                    // Centre-to-centre pitch: natural packing, but never closer
                    // than MIN_BRANCH_PITCH for small labels.  Tall image cards
                    // already exceed that pitch and keep their v_gap.
                    let gaps: Vec<f64> = (0..members.len().saturating_sub(1))
                        .map(|i| {
                            // Distance between two shape centres: half of each
                            // shape, plus the *upper* topic's label block, which
                            // hangs into the gap (measured on 23.07: a 2-label
                            // branch grew its pitch from 39 to 93).
                            let (upper_width, upper) = node_size(&root.children[members[i]], 1, m);
                            let (_, lower) = node_size(&root.children[members[i + 1]], 1, m);
                            let upper_labels = label_block_height(
                                &root.children[members[i]].labels, upper_width);
                            (upper / 2.0 + upper_labels + m.v_gap + lower / 2.0)
                                .max(MIN_BRANCH_PITCH)
                        })
                        .collect();
                    let span: f64 = gaps.iter().sum();
                    let mut centre = -span / 2.0;
                    for (position, index) in members.iter().enumerate() {
                        place_horizontal(
                            &root.children[*index], centre, 1, side, *index,
                            Some(root.id.clone()), &columns, root_half, &pal, m, &mut placed, *index,
                        );
                        if let Some(gap) = gaps.get(position) { centre += gap; }
                    }
                } else {
                    let stack: f64 = heights.iter().sum::<f64>()
                        + m.v_gap * (members.len().saturating_sub(1)) as f64;
                    // XMind centres each side's stack on the central topic's *top*
                    // edge, not on its middle (measured on 顺时针 / 平衡 / 逻辑图).
                    let mut cursor = -stack / 2.0 - root_height / 2.0;
                    for (position, index) in members.iter().enumerate() {
                        let h = heights[position];
                        let center = child_centre(&root.children[*index], 1, cursor, h, m);
                        place_horizontal(
                            &root.children[*index], center, 1, side, *index,
                            Some(root.id.clone()), &columns, root_half, &pal, m, &mut placed, *index,
                        );
                        cursor += h + m.v_gap;
                    }
                }
            }
        }
    }

    // 括号图 paints its topics as plain labels — the braces carry the
    // structure, so a filled pill fights them. XMind also right-aligns the
    // first level against its brace and sets it bold.
    if brace {
        for item in &mut placed {
            if item.node.depth == 0 { continue; }
            item.node.style.fill = "none".into();
            item.node.style.stroke = "none".into();
            item.node.style.stroke_width = 0.0;
            if item.node.depth == 1 {
                item.node.style.font_weight = 700;
                item.node.style.align = "right".into();
            }
        }
    }

    // 同级主题对齐: every topic of a level gets the widest width of that level.
    if doc.sibling_align && !vertical {
        apply_alignment(&mut placed);
    }

    // Floating (detached) topics, summaries and callouts are not part of the
    // main tree: XMind gives them an optional `position` relative to the map
    // centre and draws no edge from the central topic. Render each as its own
    // small right-growing subtree so real user files don't lose nodes.
    let root_center = placed
        .iter()
        .find(|p| p.node.id == root.id)
        .map(|p| (p.node.x + p.node.width / 2.0, p.node.y + p.node.height / 2.0))
        .unwrap_or((0.0, 0.0));
    let fallback_y = placed
        .iter()
        .map(|p| p.node.y + p.node.height)
        .fold(f64::NEG_INFINITY, f64::max)
        + m.row_gap;
    let mut claimed_summaries = HashSet::new();
    collect_native_summary_ids(root, &mut claimed_summaries);
    let floating: Vec<&Topic> = root
        .detached
        .iter()
        .chain(root.summary.iter())
        .chain(root.callout.iter())
        .collect();
    for (index, topic) in floating.iter().enumerate() {
        // A native 概要 is placed (with its brace and summaryTopic styling) by
        // `place_native_summaries`; drawing it here too would show a second,
        // unstyled copy of the same topic.
        if claimed_summaries.contains(&topic.id) { continue; }
        // A 概要 topic sits just right of the range it summarises, regardless
        // of whatever absolute `position` the file happens to carry.
        let summary_bounds = topic.extra.get("summaryRange").and_then(|range| {
            let start = range.get("startId").and_then(Value::as_str)?;
            let end = range.get("endId").and_then(Value::as_str)?;
            let refs: Vec<&LaidOutNode> = placed.iter().map(|item| &item.node).collect();
            range_bounds_from(&refs, start, end)
        });
        let (cx, cy) = if let Some((x, y, w, h)) = summary_bounds {
            (x + w + 96.0, y + h / 2.0)
        } else {
            match &topic.position {
                Some(p) => (root_center.0 + p.x, root_center.1 + p.y),
                None => (
                    root_center.0,
                    fallback_y + index as f64 * (44.0 + m.v_gap * 2.0),
                ),
            }
        };
        let mut columns: Columns = HashMap::new();
        collect_columns(topic, 1, Side::Right, &mut columns, m);
        let mut branch = Vec::new();
        place_horizontal(
            topic, 0.0, 1, Side::Right, index, None, &columns, -m.h_gap, &pal, m, &mut branch, 0,
        );
        // A detached topic starts its own (uncoloured) subtree: the shipped
        // renderer paints its children with the neutral 20% swatch instead of
        // the branch hue used by the main tree.
        if pal.sheet_theme.as_ref().map(|t| t.has_theme).unwrap_or(false) {
            for item in branch.iter_mut().filter(|p| p.node.depth >= 2) {
                item.node.style.fill = blend_over("#0D0D0D", "#ffffff", 0.2);
                item.node.style.color = s("#333333");
                item.node.style.line_color = s("#0D0D0D");
            }
        }
        if let Some(first) = branch.first() {
            let dx = cx - (first.node.x + first.node.width / 2.0);
            let dy = cy - (first.node.y + first.node.height / 2.0);
            for item in &mut branch {
                item.node.x += dx;
                item.node.y += dy;
            }
            placed.extend(branch);
        }
    }

    // Document-level defaults fill in what a topic does not override.
    if doc.font_family.is_some() || doc.line_width.is_some() {
        for item in &mut placed {
            if item.node.style.font_family.is_none() {
                item.node.style.font_family = doc.font_family.clone();
            }
            if let Some(width) = doc.line_width {
                if item.node.style.line_width <= 3.0 {
                    item.node.style.line_width = width;
                }
            }
        }
    }

    let min_x = placed.iter().map(|p| p.node.x).fold(f64::INFINITY, f64::min);
    let min_y = placed.iter().map(|p| p.node.y).fold(f64::INFINITY, f64::min);
    let shift_x = PAD - min_x;
    let shift_y = PAD - min_y;
    for item in &mut placed {
        item.node.x += shift_x;
        item.node.y += shift_y;
    }
    for ((sx, sy), (ex, ey)) in anchors.values_mut() {
        *sx += shift_x;
        *sy += shift_y;
        *ex += shift_x;
        *ey += shift_y;
    }

    let root_class = root_line_class(doc, &pal);
    let no_connections = matches!(root_class.as_str(), "none" | "treeTableNoConnections");
    let mut edges = if brace && !no_connections {
        Vec::new()
    } else {
        build_edges(&placed, &pal, vertical, upward, &anchors)
    };
    let decor = if brace && !no_connections {
        build_braces(&placed, &pal, &root_class)
    } else {
        Vec::new()
    };
    // Real XMind files keep 概要 topics in `children.summary` + a `summaries[]`
    // range table.  Append those nodes/braces after the stage is shifted, then
    // let the stage grow so the right-most summary is not clipped.
    let mut native_frames = Vec::new();
    {
        let theme = sheet.extra.get("theme");
        place_native_summaries(root, &mut placed, &mut edges, &pal, m, &mut native_frames, theme, 0);
    }
    let nodes: Vec<LaidOutNode> = placed.into_iter().map(|p| p.node).collect();
    let (links, mut frames) = build_decorations(&nodes, doc, &pal);
    frames.extend(native_frames);
    let (nx0, ny0, nx1, ny1) = nodes.iter().fold(
        (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
        |(ax, ay, bx, by), n| (
            ax.min(n.x), ay.min(n.y),
            bx.max(n.x + n.width), by.max(n.y + n.height),
        ),
    );
    Layout {
        nodes,
        edges,
        decor,
        links,
        frames,
        width: (nx1 - nx0 + PAD * 2.0).max(480.0),
        height: (ny1 - ny0 + PAD * 2.0).max(320.0),
        theme: pal,
        structure,
    }
}

/// Widen every topic of a level to the widest one (同级主题对齐). XMind's
/// `alignment-by-level: actived` is global per depth, not per branch or side:
/// on a two-branch probe all six depth-2 topics shared one 222px box even
/// though their labels ranged from one glyph to sixteen.
fn apply_alignment(placed: &mut [Placed]) {
    let mut widths: HashMap<u32, f64> = HashMap::new();
    for item in placed.iter() {
        let entry = widths.entry(item.node.depth).or_insert(0.0);
        *entry = entry.max(item.node.width);
    }
    for item in placed.iter_mut() {
        let target = widths[&item.node.depth];
        if (target - item.node.width).abs() < 0.5 { continue; }
        if item.node.side == Side::Left {
            item.node.x -= target - item.node.width;
        }
        resize_node(&mut item.node, target);
    }
}

pub fn effective_style(topic: &Topic, depth: u32, branch: usize, pal: &ThemePalette) -> EffectiveStyle {
    style_for(topic, depth, branch, pal)
}

pub fn topic_style_patch(fill: Option<String>, color: Option<String>) -> TopicStyle {
    TopicStyle { fill, color, ..TopicStyle::default() }
}
