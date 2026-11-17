//! Document model. Mirrors XMind's `content.json` vocabulary while keeping a
//! shape that is convenient to edit from Rust.
//!
//! Fidelity rule: anything we don't understand (theme, extensions, boundaries,
//! relationships, summaries, legacy notes, ...) is kept verbatim in `extra`
//! and written back unchanged. Opening a real .xmind and saving it must never
//! strip another app's data.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

pub type Extras = Map<String, Value>;

pub fn new_id() -> String {
    Uuid::new_v4().simple().to_string()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ThemeId {
    #[default]
    Classic,
    Dark,
    Ocean,
    Forest,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

/// Branch structures XMind writes as `structureClass`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Structure {
    #[default]
    Balanced,
    Clockwise,
    Anticlockwise,
    LogicRight,
    LogicLeft,
    TreeRight,
    TreeLeft,
    OrgDown,
    OrgUp,
    /// 时间轴（垂直）: a vertical spine, milestones alternating left/right.
    Timeline,
    /// 时间轴（水平）: the same spine rotated, milestones marching right.
    TimelineHorizontal,
    FishboneRight,
    FishboneLeft,
    BraceRight,
    BraceLeft,
    TreeTable,
    Matrix,
}

impl Structure {
    pub fn from_class(class: &str) -> Self {
        match class {
            "org.xmind.ui.map.clockwise" => Self::Clockwise,
            "org.xmind.ui.map.anticlockwise" => Self::Anticlockwise,
            "org.xmind.ui.map.unbalanced" | "org.xmind.ui.map" | "org.xmind.ui.map.floating" => Self::Balanced,
            "org.xmind.ui.logic.right" => Self::LogicRight,
            "org.xmind.ui.logic.left" => Self::LogicLeft,
            "org.xmind.ui.tree.right" => Self::TreeRight,
            "org.xmind.ui.tree.left" => Self::TreeLeft,
            "org.xmind.ui.org-chart.down" => Self::OrgDown,
            "org.xmind.ui.org-chart.up" => Self::OrgUp,
            "org.xmind.ui.timeline.vertical" | "org.xmind.ui.timeline.through.vertical" => Self::Timeline,
            "org.xmind.ui.timeline.horizontal" | "org.xmind.ui.timeline.sided.horizontal" => Self::TimelineHorizontal,
            "org.xmind.ui.fishbone.rightHeaded" => Self::FishboneRight,
            "org.xmind.ui.fishbone.leftHeaded" => Self::FishboneLeft,
            "org.xmind.ui.brace.right" => Self::BraceRight,
            "org.xmind.ui.brace.left" => Self::BraceLeft,
            "org.xmind.ui.treetable" | "org.xmind.ui.treetable.toptitle" => Self::TreeTable,
            "org.xmind.ui.spreadsheet"
            | "org.xmind.ui.spreadsheet.column"
            | "org.xmind.ui.structure.spreadsheet.row"
            | "org.xmind.ui.structure.column.spreadsheet" => Self::Matrix,
            _ => Self::Clockwise, // XMind's default for a new map
        }
    }

    pub fn class(self) -> &'static str {
        match self {
            Self::Balanced => "org.xmind.ui.map.unbalanced",
            Self::Clockwise => "org.xmind.ui.map.clockwise",
            Self::Anticlockwise => "org.xmind.ui.map.anticlockwise",
            Self::LogicRight => "org.xmind.ui.logic.right",
            Self::LogicLeft => "org.xmind.ui.logic.left",
            Self::TreeRight => "org.xmind.ui.tree.right",
            Self::TreeLeft => "org.xmind.ui.tree.left",
            Self::OrgDown => "org.xmind.ui.org-chart.down",
            Self::OrgUp => "org.xmind.ui.org-chart.up",
            Self::Timeline => "org.xmind.ui.timeline.vertical",
            Self::TimelineHorizontal => "org.xmind.ui.timeline.horizontal",
            Self::FishboneRight => "org.xmind.ui.fishbone.rightHeaded",
            Self::FishboneLeft => "org.xmind.ui.fishbone.leftHeaded",
            Self::BraceRight => "org.xmind.ui.brace.right",
            Self::BraceLeft => "org.xmind.ui.brace.left",
            Self::TreeTable => "org.xmind.ui.treetable",
            Self::Matrix => "org.xmind.ui.spreadsheet",
        }
    }

    pub fn vertical(self) -> bool {
        matches!(self, Self::OrgDown | Self::OrgUp | Self::Timeline)
    }

    pub fn all_left(self) -> bool {
        matches!(self, Self::LogicLeft | Self::TreeLeft | Self::FishboneLeft | Self::BraceLeft)
    }

    pub fn spread_both(self) -> bool {
        matches!(self, Self::Balanced | Self::Clockwise | Self::Anticlockwise | Self::FishboneRight | Self::FishboneLeft)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Balanced => "思维导图（左右平衡）",
            Self::Clockwise => "思维导图（顺时针）",
            Self::Anticlockwise => "思维导图（逆时针）",
            Self::LogicRight => "逻辑图（向右）",
            Self::LogicLeft => "逻辑图（向左）",
            Self::TreeRight => "树状图（向右）",
            Self::TreeLeft => "树状图（向左）",
            Self::OrgDown => "组织结构图（向下）",
            Self::OrgUp => "组织结构图（向上）",
            Self::Timeline => "时间线（垂直）",
            Self::TimelineHorizontal => "时间线（水平）",
            Self::FishboneRight => "鱼骨图（右）",
            Self::FishboneLeft => "鱼骨图（左）",
            Self::BraceRight => "括号图（向右）",
            Self::BraceLeft => "括号图（向左）",
            Self::TreeTable => "树型表格",
            Self::Matrix => "矩阵图",
        }
    }
}

pub const ALL_STRUCTURES: [Structure; 17] = [
    Structure::Clockwise,
    Structure::Balanced,
    Structure::Anticlockwise,
    Structure::LogicRight,
    Structure::LogicLeft,
    Structure::TreeRight,
    Structure::TreeLeft,
    Structure::OrgDown,
    Structure::OrgUp,
    Structure::Timeline,
    Structure::TimelineHorizontal,
    Structure::FishboneRight,
    Structure::FishboneLeft,
    Structure::BraceRight,
    Structure::BraceLeft,
    Structure::TreeTable,
    Structure::Matrix,
];

/// XMind style properties (`topic.style.properties`). Key names on the right
/// are the exact constants the shipped renderer writes (module 1117.js).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TopicStyle {
    pub fill: Option<String>,          // svg:fill
    pub stroke: Option<String>,        // border-line-color
    pub color: Option<String>,         // fo:color
    pub bold: Option<bool>,            // fo:font-weight
    pub font_size: Option<u16>,        // fo:font-size, pt
    pub font_family: Option<String>,   // fo:font-family
    pub shape_class: Option<String>,   // shape-class
    pub line_class: Option<String>,    // line-class
    pub line_color: Option<String>,    // line-color
    pub line_width: Option<String>,    // line-width
    pub style_id: Option<String>,      // style.id / styleId
    /* ---- additions for the right panel (2026-11-14) ---- */
    pub italic: Option<bool>,          // fo:font-style
    pub strike: Option<bool>,          // fo:text-decoration: line-through
    pub align: Option<String>,         // fo:text-align
    pub text_case: Option<String>,     // fo:text-transform
    pub fill_pattern: Option<String>,  // fill-pattern
    pub border_width: Option<String>,  // border-line-width
    pub border_pattern: Option<String>,// border-line-pattern
    pub arrow_end: Option<String>,     // arrow-end-class
    pub line_pattern: Option<String>,  // line-pattern
    pub line_tapered: Option<bool>,    // line-tapered
    pub opacity: Option<f64>,          // svg:opacity
}

impl TopicStyle {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Merge `patch` into `self`, ignoring fields the patch leaves unset.
    pub fn merge(&mut self, patch: &Self) {
        macro_rules! merge {
            ($($field:ident),* $(,)?) => {
                $( if patch.$field.is_some() { self.$field = patch.$field.clone(); } )*
            };
        }
        merge!(
            fill, stroke, color, bold, font_size, font_family, shape_class, line_class,
            line_color, line_width, italic, strike, align, text_case, fill_pattern,
            border_width, border_pattern, arrow_end, line_pattern, line_tapered, opacity,
        );
    }
}

/* ---- value helpers shared by the panel and the renderer ---- */

/// Branch connections the panel offers (module 1117.js `BRANCH_CONNECTION`).
pub const LINE_CLASSES: [(&str, &str); 7] = [
    ("org.xmind.branchConnection.curve", "曲线"),
    ("org.xmind.branchConnection.straight", "直线"),
    ("org.xmind.branchConnection.elbow", "折线"),
    ("org.xmind.branchConnection.roundedElbow", "圆角折线"),
    ("org.xmind.branchConnection.bight", "弧线"),
    ("org.xmind.branchConnection.fold", "折角"),
    ("org.xmind.branchConnection.roundedfold", "圆角折角"),
];

/// Arrow ends (`org.xmind.arrowShape.*`), in the order of the shipped grid.
pub const ARROW_CLASSES: [(&str, &str); 11] = [
    ("org.xmind.arrowShape.none", "无"),
    ("org.xmind.arrowShape.dot", "圆点"),
    ("org.xmind.arrowShape.triangle", "三角形"),
    ("org.xmind.arrowShape.spearhead", "尖头"),
    ("org.xmind.arrowShape.square", "方块"),
    ("org.xmind.arrowShape.diamond", "菱形"),
    ("org.xmind.arrowShape.herringbone", "鱼骨"),
    ("org.xmind.arrowShape.doublearrow", "双箭头"),
    ("org.xmind.arrowShape.antiTriangle", "反三角"),
    ("org.xmind.arrowShape.attached", "附着"),
    ("org.xmind.arrowShape.hook", "钩形"),
];

/// Line / border patterns.
pub const LINE_PATTERNS: [(&str, &str); 5] = [
    ("solid", "实线"),
    ("dash", "虚线"),
    ("hand-drawn-solid", "手绘实线"),
    ("hand-drawn-dash", "手绘虚线"),
    ("none", "无"),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    #[serde(default)]
    pub folded: bool,
    /// `children.attached` in content.json.
    #[serde(default)]
    pub children: Vec<Topic>,
    /// `children.detached` (floating topics), preserved on round-trip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detached: Vec<Topic>,
    /// `children.summary` / `children.callout`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub summary: Vec<Topic>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub callout: Vec<Topic>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<TopicStyle>,
    /// Which half of a balanced map this root-child belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<Side>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    #[serde(default)]
    pub title_unedited: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_width: Option<f64>,
    /// Unknown content.json fields, preserved verbatim. Kept as a *nested*
    /// container (not `flatten`) so serde never emits two keys with the same
    /// name when a raw key happens to match a modelled one.
    #[serde(rename = "__extra", default)]
    pub extra: Extras,
}

impl Topic {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            id: new_id(),
            title: title.into(),
            title_unedited: false,
            ..Default::default()
        }
    }

    pub fn with_children(title: impl Into<String>, children: Vec<Topic>) -> Self {
        let mut topic = Self::new(title);
        topic.children = children;
        topic
    }
}

impl Default for Topic {
    fn default() -> Self {
        Self {
            id: new_id(),
            title: String::new(),
            note: String::new(),
            folded: false,
            children: Vec::new(),
            detached: Vec::new(),
            summary: Vec::new(),
            callout: Vec::new(),
            markers: Vec::new(),
            labels: Vec::new(),
            image: None,
            style: None,
            side: None,
            structure_class: None,
            href: None,
            position: None,
            title_unedited: false,
            custom_width: None,
            extra: Extras::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub id: String,
    pub title: String,
    pub root: Topic,
    #[serde(default)]
    pub structure: Structure,
    /// `theme`, `extensions`, `legend`, `coreVersion`, `topicPositioning`, ...
    #[serde(rename = "__extra", default)]
    pub extra: Extras,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub title: String,
    /// Our renderer's palette; not the embedded XMind sheet theme (kept in extra).
    #[serde(default)]
    pub theme: ThemeId,
    #[serde(default)]
    pub active_sheet: usize,
    #[serde(default)]
    pub sheets: Vec<Sheet>,
    /* ---- canvas settings driven by the right panel's 画布 tab ---- */
    /// Explicit canvas background; `None` falls back to the theme palette.
    #[serde(default)]
    pub background: Option<String>,
    /// Default font for topics that carry no `font-family` of their own.
    #[serde(default)]
    pub font_family: Option<String>,
    /// Default branch line width in px.
    #[serde(default)]
    pub line_width: Option<f64>,
    /// Whether each branch keeps its own colour (XMind's 彩虹分支).
    #[serde(default = "default_true")]
    pub rainbow: bool,
    /// 紧凑型布局: tighter gaps between siblings.
    #[serde(default)]
    pub compact: bool,
    /// 同级主题对齐: give every topic of a level the same width. XMind leaves
    /// this **off** for a new map — topics are sized by their own label (the
    /// shipped renderer shows 68/73/96/54px boxes on one level).
    #[serde(default)]
    pub sibling_align: bool,
    /// 分支配色: explicit branch colour cycle (overrides the theme's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_colors: Option<Vec<String>>,
    /// 配色方案: id of the XMind palette currently applied (`vivid-energy`, …).
    /// The colours themselves live in `branch_colors`; this only drives the
    /// panel's selected state and its label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<String>,
    /// Central-topic fill supplied by the active 配色方案 (last swatch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center_color: Option<String>,
    /// Set when the user changed the 配色方案 in this session.  Only then is
    /// `sheet.theme` rewritten on save, so a file painted by real XMind keeps
    /// its theme bytes untouched.
    #[serde(default)]
    pub palette_dirty: bool,
    #[serde(rename = "__extra", default)]
    pub extra: Extras,
}

fn default_true() -> bool { true }

impl Document {
    /// Matches XMind's own "new map" skeleton (Central Topic + 4 Main Topics).
    pub fn new(title: impl Into<String>) -> Self {
        let mut root = Topic::new("中心主题");
        root.title_unedited = true;
        root.structure_class = Some(Structure::Clockwise.class().into());
        root.children = (1..=4)
            .map(|i| {
                let mut topic = Topic::new(format!("分支主题 {i}"));
                topic.title_unedited = true;
                topic
            })
            .collect();
        Self {
            title: title.into(),
            theme: ThemeId::Classic,
            active_sheet: 0,
            sheets: vec![Sheet {
                id: new_id(),
                title: "画布 1".into(),
                root,
                structure: Structure::Clockwise,
                extra: Extras::new(),
            }],
            background: None,
            font_family: None,
            line_width: None,
            rainbow: true,
            compact: false,
            sibling_align: false,
            branch_colors: None,
            palette: None,
            center_color: None,
            palette_dirty: false,
            extra: Extras::new(),
        }
    }

    pub fn ensure_sheet(&mut self) {
        if self.sheets.is_empty() {
            let mut root = Topic::new("中心主题");
            root.structure_class = Some(Structure::Clockwise.class().into());
            self.sheets.push(Sheet {
                id: new_id(),
                title: "画布 1".into(),
                root,
                structure: Structure::Clockwise,
                extra: Extras::new(),
            });
        }
        if self.active_sheet >= self.sheets.len() {
            self.active_sheet = 0;
        }
    }

    pub fn sheet(&self) -> &Sheet {
        &self.sheets.get(self.active_sheet).unwrap_or(&self.sheets[0])
    }

    pub fn sheet_mut(&mut self) -> &mut Sheet {
        self.ensure_sheet();
        let index = self.active_sheet;
        &mut self.sheets[index]
    }

    pub fn root(&self) -> &Topic {
        &self.sheet().root
    }

    pub fn root_mut(&mut self) -> &mut Topic {
        &mut self.sheet_mut().root
    }

    pub fn set_structure(&mut self, structure: Structure) {
        self.set_skeleton(structure, structure.class(), Some("org.xmind.ui.logic.right"));
    }

    /// Apply a 骨架 preset: the sheet's structure plus the exact
    /// `structureStyle` pair the shipped app stores in its extension entry.
    /// `central` / `main` are `org.xmind.ui.*` class names taken from the
    /// preset, so reopening the file in XMind keeps the original skeleton.
    pub fn set_skeleton(&mut self, structure: Structure, central: &str, main: Option<&str>) {
        let sheet = self.sheet_mut();
        sheet.structure = structure;
        sheet.root.structure_class = Some(central.into());
        // `org.xmind.ui.skeleton.structure.style` in the sheet extensions also
        // carries the structure; stale values make XMind switch back on open.
        if let Some(Value::Array(list)) = sheet.extra.get_mut("extensions") {
            for entry in list.iter_mut() {
                if entry.get("provider").and_then(Value::as_str)
                    == Some("org.xmind.ui.skeleton.structure.style")
                {
                    if let Some(content) = entry.get_mut("content") {
                        let mut next = serde_json::json!({ "centralTopic": central });
                        if let Some(main) = main {
                            next["mainTopic"] = Value::String(main.into());
                        }
                        *content = next;
                    }
                }
            }
        }
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new("未命名思维导图")
    }
}
