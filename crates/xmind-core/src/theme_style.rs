//! `sheet.theme` → effective topic style.
//!
//! Ported from XMind's official (now DEPRECATED) `xmind-viewer` /
//! SnowbrushRenderer, where `StyleKey` + `Theme` + `LayeredStyleManager`
//! decide what a topic looks like.  The shipped viewer resolves each key in
//! this order:
//!
//! ```text
//! beforeUser (structure forced) → topic.style (user) → parent fallback
//! → beforeTheme (structure forced) → sheet.theme[class] → defaultStyles
//! ```
//!
//! `beforeUser` / `beforeTheme` belong to the 2020 geometry (elbow lines,
//! fish-head shapes) and are deliberately **not** ported: our curves were
//! calibrated against the current desktop build (FINDINGS §24).  What we do
//! port is the theme lookup itself:
//!
//! * `ClassType` maps `depth 0 / 1 / 2 / 3+` to `centralTopic / mainTopic /
//!   subTopic / level3`; `map` carries canvas colours and the branch colour
//!   cycle.  `level3` exists in XMind's own SDK themes (`xmind-sdk-js`) and
//!   overrides `subTopic` for the third level and below, falling back to it
//!   key by key when it omits a property.
//! * `StyleKey` names are kept verbatim, so unknown keys survive parsing.
//! * `line-width` / `border-line-width` are written as `"3pt"` but rendered as
//!   **3 px**: the desktop bundle emits `stroke-width="3"` for that value, and
//!   the official viewer does `parseInt(getStyleValue(LINE_WIDTH))`.  So the
//!   unit conversion is an identity on the numeric part — `to_px()` strips
//!   `pt`/`px` and deliberately does *not* multiply by 4/3.  Font sizes keep
//!   the raw number for the same reason (§24 metrics were calibrated in px).
//! * `defaultStyles` is consulted only for files that did **not** originate
//!   here.  Our own `theme_for()` is a write-back artefact (it lives in
//!   `sheet.extra` so real XMind sees our palette) and is skipped entirely;
//!   applying its 2020-style values would turn new maps into grey plates with
//!   elbow connectors.
//! * `line-class` / `line-color` / `border-line-*` ignore the 2020 defaults:
//!   branch hues come from `multi-line-colors`, and our curve geometry is
//!   calibrated against the current desktop renderer (FINDINGS §24).
//!
//! XMind writes transparent fills as `#RRGGBBAA`, e.g. `#00000000`.  Those
//! are normalised to `none` so the WebView and the SVG exporter agree.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// `common/constants/styles.ts::StyleKey`, exactly as XMind spells them in
/// `content.json`.  Only the keys we render are listed; `Props` keeps the rest.
pub mod key {
    pub const FONT_FAMILY: &str = "fo:font-family";
    pub const FONT_SIZE: &str = "fo:font-size";
    pub const FONT_STYLE: &str = "fo:font-style";
    pub const FONT_WEIGHT: &str = "fo:font-weight";
    pub const TEXT_COLOR: &str = "fo:color";
    pub const TEXT_ALIGN: &str = "fo:text-align";
    pub const TEXT_TRANSFORM: &str = "fo:text-transform";
    pub const TEXT_DECORATION: &str = "fo:text-decoration";

    pub const LINE_CLASS: &str = "line-class";
    pub const LINE_COLOR: &str = "line-color";
    pub const LINE_WIDTH: &str = "line-width";
    pub const SHAPE_CLASS: &str = "shape-class";
    pub const BORDER_LINE_COLOR: &str = "border-line-color";
    pub const BORDER_LINE_WIDTH: &str = "border-line-width";
    pub const FILL_COLOR: &str = "svg:fill";
    pub const MULTI_LINE_COLORS: &str = "multi-line-colors";
    pub const COLOR_LIST: &str = "color-list";
    pub const LINE_TAPERED: &str = "line-tapered";
}

/// One `style.properties` object, keyed by the raw `StyleKey`.
pub type Props = BTreeMap<String, String>;

/* `styleManager/defaultStyles.ts` — only the keys our EffectiveStyle knows. */
static DEFAULT_CENTRAL: &[(&str, &str)] = &[
    (key::FONT_SIZE, "28pt"),
    (key::FONT_STYLE, "normal"),
    (key::FONT_WEIGHT, "normal"),
    (key::TEXT_ALIGN, "center"),
    (key::TEXT_COLOR, "#FFFFFF"),
    (key::TEXT_TRANSFORM, "manual"),
    (key::TEXT_DECORATION, "none"),
    (key::SHAPE_CLASS, "org.xmind.topicShape.roundedRect"),
    (key::LINE_CLASS, "org.xmind.branchConnection.curve"),
    (key::LINE_COLOR, "#333333"),
    (key::LINE_WIDTH, "2pt"),
    (key::FILL_COLOR, "#2A7AC2"),
    (key::BORDER_LINE_COLOR, "none"),
    (key::BORDER_LINE_WIDTH, "0pt"),
];

static DEFAULT_MAIN: &[(&str, &str)] = &[
    (key::FONT_SIZE, "16pt"),
    (key::FONT_STYLE, "normal"),
    (key::FONT_WEIGHT, "normal"),
    (key::TEXT_ALIGN, "left"),
    (key::TEXT_COLOR, "#333333"),
    (key::TEXT_TRANSFORM, "manual"),
    (key::TEXT_DECORATION, "none"),
    (key::SHAPE_CLASS, "org.xmind.topicShape.roundedRect"),
    (key::LINE_CLASS, "org.xmind.branchConnection.roundedElbow"),
    (key::LINE_COLOR, "#333333"),
    (key::LINE_WIDTH, "1pt"),
    (key::FILL_COLOR, "#E8E8E8"),
    (key::BORDER_LINE_COLOR, "#333333"),
    (key::BORDER_LINE_WIDTH, "1pt"),
];

static DEFAULT_SUB: &[(&str, &str)] = &[
    (key::FONT_SIZE, "12pt"),
    (key::FONT_STYLE, "normal"),
    (key::FONT_WEIGHT, "normal"),
    (key::TEXT_ALIGN, "center"),
    (key::TEXT_COLOR, "#0A0E16"),
    (key::TEXT_TRANSFORM, "manual"),
    (key::TEXT_DECORATION, "none"),
    (key::SHAPE_CLASS, "org.xmind.topicShape.underline"),
    (key::LINE_CLASS, "org.xmind.branchConnection.roundedElbow"),
    (key::LINE_COLOR, "#232323"),
    (key::LINE_WIDTH, "1pt"),
    (key::FILL_COLOR, "none"),
    (key::BORDER_LINE_COLOR, "#232323"),
    (key::BORDER_LINE_WIDTH, "1pt"),
];

fn default_value(depth: u32, key: &str) -> Option<&'static str> {
    let table = match depth {
        0 => DEFAULT_CENTRAL,
        1 => DEFAULT_MAIN,
        _ => DEFAULT_SUB,
    };
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// `sheet.extra` key holding the active 骨架 preset's per-depth style.  XMind
/// keeps a skeleton in `sheet.theme` layers, so *every* topic of a depth gets
/// it — including topics created after the preset was applied.  Our first
/// implementation only patched the topics that existed at click time, which
/// is why a freshly added third-level topic lost the preset's plate.
pub const SKELETON_KEY: &str = "xmindRsSkeleton";

/// One depth layer of a 骨架 preset, derived from the shipped desktop's own
/// `sheet.theme` bytes (`research/skeleton-themes.json`, FINDINGS §27).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonLayer {
    /// Short shape name consumed by `shape::outline`.
    pub shape: String,
    /// False when the original theme layer says `svg:fill: none` (no plate).
    /// True = no `svg:fill` key, so XMind's colour-theme engine paints it.
    pub filled: bool,
    /// `border-line-width` in CSS px (0 = no outline).
    pub border: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonLayers {
    pub central: SkeletonLayer,
    pub main: SkeletonLayer,
    /// Everything at depth >= 2 (none of the 43 shipped presets has a level3
    /// layer, so the subTopic layer covers levels 3, 4, 5 … too).
    pub sub: SkeletonLayer,
}

impl SkeletonLayers {
    /// The shipped default new map is the first 思维导图 card: all three
    /// layers are solid rounded rectangles with no explicit fill/border.
    pub fn mind_map() -> Self {
        let plate = || SkeletonLayer { shape: "roundedRect".into(), filled: true, border: 0.0 };
        Self { central: plate(), main: plate(), sub: plate() }
    }

    pub fn from_value(value: Option<&Value>) -> Option<Self> {
        serde_json::from_value(value?.clone()).ok()
    }

    pub fn layer(&self, depth: u32) -> &SkeletonLayer {
        match depth { 0 => &self.central, 1 => &self.main, _ => &self.sub }
    }
}

/// Parsed `sheet.theme`, carried inside `ThemePalette` so every layout helper
/// that already receives `&pal` can resolve styles without new parameters.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetTheme {
    pub has_theme: bool,
    /// True for a theme written by real XMind.  Our own `theme_for()` themes
    /// set `has_theme = false` and never reach `compute_layout`.
    pub foreign: bool,
    pub map: Props,
    pub central_topic: Props,
    pub main_topic: Props,
    pub sub_topic: Props,
    /// Optional fourth layer from the official SDK themes (`level3`).
    pub level_3: Props,
}

impl SheetTheme {
    pub fn from_value(value: Option<&Value>) -> Self {
        let Some(obj) = value.and_then(Value::as_object) else {
            return Self::default();
        };
        let read = |name: &str| -> Props {
            obj.get(name)
                .and_then(|v| v.get("properties"))
                .and_then(Value::as_object)
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| scalar(v).map(|s| (k.clone(), s)))
                        .collect()
                })
                .unwrap_or_default()
        };
        let map = read("map");
        let central_topic = read("centralTopic");
        let main_topic = read("mainTopic");
        let sub_topic = read("subTopic");
        let level_3 = read("level3");
        let foreign = !obj
            .get("colorThemeId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .starts_with("XMindRS-");
        // `theme_for()` is a *write-back* artefact: doc_new puts it in the
        // sheet so real XMind sees our palette, but this app renders from the
        // Document's own palette/branch colours.  Applying those bytes here
        // would silently switch new maps to `line-tapered: none` and elbow
        // connectors.  Only themes written by another app drive the canvas.
        let has_theme = foreign
            && (!map.is_empty()
                || !central_topic.is_empty()
                || !main_topic.is_empty()
                || !sub_topic.is_empty()
                || !level_3.is_empty());
        Self { has_theme, foreign, map, central_topic, main_topic, sub_topic, level_3 }
    }

    pub fn layer(&self, depth: u32) -> &Props {
        match depth {
            0 => &self.central_topic,
            1 => &self.main_topic,
            d if d >= 3 && !self.level_3.is_empty() => &self.level_3,
            _ => &self.sub_topic,
        }
    }

    /// Theme layer only — no `defaultStyles` fallback.  A `level3` theme is
    /// an *overlay* on `subTopic`: keys it leaves out still come from there.
    pub fn get(&self, depth: u32, key: &str) -> Option<&str> {
        self.layer(depth)
            .get(key)
            .or_else(|| (depth >= 3).then(|| self.sub_topic.get(key)).flatten())
            .map(String::as_str)
    }

    /// Official cascade: theme → `defaultStyles` (foreign files only).
    ///
    /// XMind writes the literal `"inherited"` when a theme layer should take
    /// the value from the branch-colour engine (or its parent layer) rather
    /// than spelling it out.  It is **not** a CSS colour: feeding it to an SVG
    /// `fill` silently falls back to black, which is why foreign themes used
    /// to render as black plates with black labels.  `apply_theme_layer`
    /// derives those values from the active branch hue; here we only make sure
    /// they never leak into a paint property or pick up a 2020 default.
    pub fn resolve(&self, depth: u32, key: &str) -> Option<&str> {
        match self.get(depth, key) {
            Some(v) if is_inherited(v) => None,
            Some(v) => Some(v),
            None if self.foreign => default_value(depth, key),
            None => None,
        }
    }

    pub fn map_get(&self, key: &str) -> Option<&str> {
        self.map.get(key).map(String::as_str)
    }

    /// Canvas colour from `map/properties/svg:fill`.
    pub fn background(&self) -> Option<String> {
        self.map_get(key::FILL_COLOR).map(color)
    }

    /// `multi-line-colors` (or the older `color-list`) branch cycle.
    pub fn multi_line_colors(&self) -> Vec<String> {
        self.map_get(key::MULTI_LINE_COLORS)
            .or_else(|| self.map_get(key::COLOR_LIST))
            .map(|list| {
                list.split_whitespace()
                    .filter(|c| c.starts_with('#'))
                    .map(color)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `line-tapered`: "tapered" / "none".
    pub fn line_tapered(&self) -> Option<bool> {
        self.map_get(key::LINE_TAPERED)
            .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "none" | "false" | "0"))
    }

    pub fn font_size(&self, depth: u32) -> Option<u16> {
        self.resolve(depth, key::FONT_SIZE)
            .and_then(pt)
            .map(|v| (v.round() as u16).clamp(6, 96))
    }
}

/// `"inherited"` (case-insensitive) means "ask the parent/branch engine".
pub fn is_inherited(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("inherited")
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// `#RRGGBBAA` → `#RRGGBB`, fully transparent → `none`.
pub fn color(value: &str) -> String {
    let v = value.trim();
    if v.is_empty() || v.eq_ignore_ascii_case("none") || v.eq_ignore_ascii_case("transparent") {
        return "none".into();
    }
    if let Some(hex) = v.strip_prefix('#') {
        let ascii_hex = hex.as_bytes().iter().all(|b| b.is_ascii_hexdigit());
        match hex.len() {
            8 if ascii_hex => {
                let alpha = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255);
                if alpha == 0 { return "none".into(); }
                if alpha == 255 { return format!("#{}", &hex[..6]); }
                // XMind paints translucent plates over the (opaque) canvas.
                // CSS/SVG in this app cannot carry alpha through the contrast
                // helpers, so composite against white once, up front.  The
                // shipped renderer uses exactly this 20%-alpha branch wash:
                // `#F22816` → `rgba(242,40,22,.2)` → `#FCD4D0`.
                let a = alpha as f64 / 255.0;
                let channel = |i: usize| -> u8 {
                    let c = u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0) as f64;
                    (c * a + 255.0 * (1.0 - a)).round().clamp(0.0, 255.0) as u8
                };
                return format!("#{:02x}{:02x}{:02x}", channel(0), channel(2), channel(4));
            }
            6 if ascii_hex => return format!("#{hex}"),
            3 if ascii_hex => {
                return format!("#{}{}{}{}{}{}", &hex[0..1], &hex[0..1], &hex[1..2], &hex[1..2], &hex[2..3], &hex[2..3]);
            }
            _ => {}
        }
    }
    v.to_string()
}

/// `org.xmind.topicShape.underline` → `underline` (our `shape::outline` names).
pub fn shape(value: &str) -> String {
    value.rsplit('.').next().unwrap_or(value).to_string()
}

/// `12pt` / `12` / `12px` → 12.0.  Font-size only; see `to_px` for widths.
pub fn pt(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_end_matches("pt")
        .trim_end_matches("px")
        .trim()
        .parse::<f64>()
        .ok()
}

/// Stroke width in CSS pixels.  XMind writes `"3pt"` in `sheet.theme`, but the
/// shipped renderer draws `stroke-width="3"` (bundle 8846.js) and the official
/// viewer uses `parseInt()` on the same value.  A pt→px factor of 4/3 would
/// make every branch 33% too thick; what we actually need is unit-stripping.
/// Bare numbers (`"2"`, newer files) are already pixels.
pub fn to_px(value: &str) -> Option<f64> {
    pt(value)
}

/// Rebuild a `fo:font-family` value as the desktop's stack: the theme's own
/// families first, then `NeverMind` and the CJK system fallbacks.  The shipped
/// bundle 8846.js writes
/// `'Montserrat','NeverMind','Microsoft YaHei','PingFang SC','Microsoft JhengHei','sans-serif',sans-serif`;
/// a theme that only says `Montserrat` must still get those fallbacks or
/// Chinese labels fall through to a serif face.  Generic families are emitted
/// unquoted (quoting `sans-serif` makes it a font *name*).
pub fn font_stack(value: &str) -> String {
    const GENERIC: &[&str] = &["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"];
    const FALLBACKS: &[&str] = &[
        "NeverMind", "Microsoft YaHei", "PingFang SC", "Microsoft JhengHei", "sans-serif",
    ];
    let mut candidates: Vec<String> = value
        .split(',')
        .map(|raw| raw.trim().trim_matches(|c| c == '\'' || c == '"').trim().to_string())
        .collect();
    candidates.extend(FALLBACKS.iter().map(|s| s.to_string()));
    let mut parts: Vec<String> = Vec::new();
    for name in candidates {
        if name.is_empty() || name == "$system$" { continue; }
        if parts.iter().any(|p| p.eq_ignore_ascii_case(&name)) { continue; }
        parts.push(name);
    }
    // A generic family terminates CSS matching, so keep it last even when the
    // theme quoted `'sans-serif'` in the middle of its own stack.
    parts.sort_by_key(|p| GENERIC.contains(&p.to_ascii_lowercase().as_str()));
    parts
        .iter()
        .map(|name| {
            if GENERIC.contains(&name.to_ascii_lowercase().as_str()) {
                name.clone()
            } else {
                format!("'{name}'")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// `700` / `bold` / `normal` → CSS font weight.
pub fn font_weight(value: &str) -> Option<u16> {
    match value.trim().to_ascii_lowercase().as_str() {
        "bold" => Some(700),
        "normal" | "" => Some(400),
        _ => value.trim().parse::<u16>().ok().map(|v| v.clamp(100, 900)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Value {
        json!({
            "map": { "properties": {
                "svg:fill": "#F7F7FA",
                "multi-line-colors": "#F04137 #F8932E #FEC938",
                "line-tapered": "tapered"
            }},
            "centralTopic": { "properties": {
                "fo:font-size": "28pt", "fo:color": "#000000", "svg:fill": "#FFFFFF",
                "shape-class": "org.xmind.topicShape.roundedRect", "border-line-width": "0"
            }},
            "mainTopic": { "properties": {
                "fo:font-size": "18pt", "fo:color": "#091C34", "svg:fill": "#00000000",
                "shape-class": "org.xmind.topicShape.underline", "line-class": "org.xmind.branchConnection.bight"
            }},
            "subTopic": { "properties": { "fo:font-size": "14pt", "fo:color": "#091C34" }}
        })
    }

    #[test]
    fn parses_layers_and_keeps_the_stylekey_names() {
        let theme = SheetTheme::from_value(Some(&sample()));
        assert!(theme.has_theme && theme.foreign);
        assert_eq!(theme.get(1, key::FILL_COLOR), Some("#00000000"));
        assert_eq!(theme.background().as_deref(), Some("#F7F7FA"));
        assert_eq!(theme.multi_line_colors(), vec!["#F04137", "#F8932E", "#FEC938"]);
        assert_eq!(theme.line_tapered(), Some(true));
        assert_eq!(theme.font_size(2), Some(14));
        assert_eq!(shape(theme.get(1, key::SHAPE_CLASS).unwrap()), "underline");
    }

    #[test]
    fn default_styles_fill_the_gaps_for_foreign_themes_only() {
        let theme = SheetTheme::from_value(Some(&sample()));
        // subTopic has no shape-class in the file; XMind's defaultStyles says underline.
        assert_eq!(theme.get(2, key::SHAPE_CLASS), None);
        assert_eq!(shape(theme.resolve(2, key::SHAPE_CLASS).unwrap()), "underline");
        assert_eq!(color(theme.get(1, key::FILL_COLOR).unwrap()), "none");

        let mut own = sample();
        own.as_object_mut().unwrap()
            .insert("colorThemeId".into(), json!("XMindRS-Classic"));
        let own_theme = SheetTheme::from_value(Some(&own));
        assert!(!own_theme.foreign);
        assert!(!own_theme.has_theme, "our own write-back theme must not drive the canvas");
        assert_eq!(own_theme.resolve(2, key::SHAPE_CLASS), None);
    }

    #[test]
    fn colour_and_number_helpers() {
        assert_eq!(color("#00000000"), "none");
        assert_eq!(color("#FFFFFFFF"), "#FFFFFF");
        assert_eq!(color("#AbCdEf"), "#AbCdEf");
        assert_eq!(color("none"), "none");
        assert_eq!(pt(" 2pt "), Some(2.0));
        assert_eq!(font_weight("bold"), Some(700));
        assert_eq!(font_weight("600"), Some(600));
        assert!(!SheetTheme::from_value(None).has_theme);
    }

    #[test]
    fn stroke_widths_strip_the_unit_without_scaling() {
        // bundle 8846.js: "line-width":"3pt" → stroke-width="3".
        assert_eq!(to_px("3pt"), Some(3.0));
        assert_eq!(to_px(" 1.5pt "), Some(1.5));
        assert_eq!(to_px("2"), Some(2.0));
        assert_eq!(to_px("2px"), Some(2.0));
        assert_eq!(to_px("auto"), None);
    }

    #[test]
    fn level3_overlays_sub_topic_key_by_key() {
        let mut value = sample();
        value.as_object_mut().unwrap().insert(
            "level3".into(),
            json!({ "properties": { "fo:font-size": "16pt", "line-width": "1pt" }}),
        );
        let theme = SheetTheme::from_value(Some(&value));
        assert!(theme.has_theme);
        assert_eq!(theme.get(3, key::FONT_SIZE), Some("16pt"));
        assert_eq!(theme.get(4, key::LINE_WIDTH), Some("1pt"));
        // Keys level3 leaves out still come from subTopic, then defaultStyles.
        assert_eq!(theme.get(3, key::TEXT_COLOR), Some("#091C34"));
        assert_eq!(shape(theme.resolve(3, key::SHAPE_CLASS).unwrap()), "underline");
        // Depth 2 is unaffected.
        assert_eq!(theme.font_size(2), Some(14));
        assert_eq!(theme.get(2, key::LINE_WIDTH), None);
        assert_eq!(theme.font_size(3), Some(16));
    }

    #[test]
    fn font_stack_appends_the_official_cjk_fallbacks() {
        assert_eq!(
            font_stack("Montserrat"),
            "'Montserrat', 'NeverMind', 'Microsoft YaHei', 'PingFang SC', 'Microsoft JhengHei', sans-serif"
        );
        let full = font_stack("'Montserrat','NeverMind','sans-serif',sans-serif");
        assert_eq!(full, font_stack("Montserrat"));
        assert!(full.ends_with("sans-serif"), "generic family is last");
    }
}
