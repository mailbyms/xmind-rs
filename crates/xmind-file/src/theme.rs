//! Generate and patch a `sheet.theme` object in the same vocabulary XMind uses,
//! so maps created by this app open with the intended colours in real XMind too.
//!
//! A 配色方案 lives in three places inside that object, which is exactly where
//! the shipped app keeps it (`research/FINDINGS.md` §14):
//!
//! * `colorThemeId` — which palette is selected (panel state);
//! * `map.properties["color-list"]` / `["multi-line-colors"]` — the branch cycle;
//! * `centralTopic.properties["svg:fill"]` / `["fo:color"]` — the centre topic.

use serde_json::{json, Map, Value};
use xmind_core::{new_id, palette, ThemeId};

/// Prefix used for the palettes this app writes. XMind's own smart-colour ids
/// are derived from the swatch values (`活力-#F22816-Dazzle`), so a stable
/// prefix keeps ours recognisable on the way back in.
pub const PALETTE_ID_PREFIX: &str = "XMindRS-";

/// `#rrggbb` → `#ffffff` / `#000000`, matching `layout::readable_on`.
fn ink_on(hex: &str) -> &'static str {
    let raw = hex.trim_start_matches('#');
    let channel = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&raw[range], 16).unwrap_or(0) as f64
    };
    let (r, g, b) = match raw.len() {
        6 | 8 => (channel(0..2), channel(2..4), channel(4..6)),
        _ => return "#ffffff",
    };
    if (r * 299.0 + g * 587.0 + b * 114.0) / 1000.0 > 150.0 { "#000000" } else { "#ffffff" }
}

/// Style slot (`centralTopic`, `map`, …) inside a theme object.
fn slot<'a>(theme: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let entry = theme
        .entry(key.to_string())
        .or_insert_with(|| json!({ "id": new_id(), "properties": {} }));
    if !entry.is_object() {
        *entry = json!({ "id": new_id(), "properties": {} });
    }
    let obj = entry.as_object_mut().unwrap();
    if !obj.contains_key("id") {
        obj.insert("id".into(), json!(new_id()));
    }
    if !obj.get("properties").map(Value::is_object).unwrap_or(false) {
        obj.insert("properties".into(), json!({}));
    }
    obj.get_mut("properties").unwrap().as_object_mut().unwrap()
}

/// Overlay the document's 配色方案 on an existing (or freshly generated) theme.
/// Everything untouched by the palette is left exactly as it was.
pub fn apply_palette(
    theme: &mut Value,
    palette_id: Option<&str>,
    branches: Option<&[String]>,
    center: Option<&str>,
) {
    if !theme.is_object() {
        *theme = theme_for(ThemeId::Classic);
    }
    let obj = theme.as_object_mut().unwrap();

    if let Some(colors) = branches.filter(|c| !c.is_empty()) {
        let list = colors.join(" ");
        let props = slot(obj, "map");
        props.insert("color-list".into(), json!(list));
        props.insert("multi-line-colors".into(), json!(list));
    }
    if let Some(fill) = center.filter(|c| !c.is_empty() && *c != "default") {
        let props = slot(obj, "centralTopic");
        props.insert("svg:fill".into(), json!(fill));
        props.insert("fo:color".into(), json!(ink_on(fill)));
    }
    if let Some(id) = palette_id.filter(|v| !v.is_empty() && *v != "default") {
        obj.insert("colorThemeId".into(), json!(format!("{PALETTE_ID_PREFIX}{id}")));
    } else if branches.map(|c| !c.is_empty()).unwrap_or(false) {
        obj.insert("colorThemeId".into(), json!(format!("{PALETTE_ID_PREFIX}custom")));
    }
}

/// XMind pads short colour cycles by repeating them (`活力` ships three branch
/// colours but writes six slots).  Collapse the repetition so the cycle matches
/// the palette definitions and `paletteByColors` can recognise the theme.
fn shorten_cycle(mut colors: Vec<String>) -> Vec<String> {
    let n = colors.len();
    for period in 1..n {
        if n % period == 0 && (0..n).all(|i| colors[i] == colors[i % period]) {
            colors.truncate(period);
            break;
        }
    }
    colors
}

/// Inverse of [`apply_palette`]: read the palette state out of a stored theme.
/// Returns `(palette id, branch cycle, centre fill)`; each is `None` when the
/// theme does not carry that piece.
pub fn read_palette(theme: &Value) -> (Option<String>, Option<Vec<String>>, Option<String>) {
    let id = theme
        .get("colorThemeId")
        .and_then(Value::as_str)
        .map(|v| v.trim_start_matches(PALETTE_ID_PREFIX).to_string())
        .filter(|v| !v.is_empty());

    let props = theme.pointer("/map/properties");
    let colors = props
        // `multi-line-colors` is the actual branch cycle; `color-list` is the
        // whole palette (white / light grey / hues / near-black).  Foreign
        // themes such as Energy ship both, and using the latter as branch
        // colours paints branches with the neutral swatches.
        .and_then(|p| p.get("multi-line-colors").or_else(|| p.get("color-list")))
        .and_then(Value::as_str)
        .map(|list| {
            shorten_cycle(
                list.split_whitespace()
                    .filter(|c| c.starts_with('#'))
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
            )
        })
        // A single swatch is not a cycle; treat it as "no palette colours".
        .filter(|list| list.len() >= 2);

    let center = theme
        .pointer("/centralTopic/properties/svg:fill")
        .and_then(Value::as_str)
        .filter(|c| c.starts_with('#') && c.len() >= 4)
        .map(str::to_string);

    (id, colors, center)
}

fn style(props: Value) -> Value {
    json!({ "id": new_id(), "properties": props })
}

pub fn theme_for(theme: ThemeId) -> Value {
    let pal = palette(theme);
    let font = "'NeverMind','Microsoft YaHei','PingFang SC',sans-serif";
    let mut obj = Map::new();
    obj.insert("id".into(), json!(new_id()));

    obj.insert("centralTopic".into(), style(json!({
        "svg:fill": pal.primary,
        "line-color": pal.primary,
        "shape-class": "org.xmind.topicShape.roundedRect",
        "line-class": "org.xmind.branchConnection.curve",
        "line-width": "3pt",
        "border-line-width": "0pt",
        "fo:color": "#ffffff",
        "fo:font-family": font,
        "fo:font-weight": 500,
        "fo:font-size": "30pt",
        "fo:text-align": "center"
    })));
    obj.insert("mainTopic".into(), style(json!({
        "shape-class": "org.xmind.topicShape.roundedRect",
        "line-class": "org.xmind.branchConnection.roundedElbow",
        "line-width": "2pt",
        "fo:font-family": font,
        "fo:font-weight": 500,
        "fo:font-size": "18pt",
        "fo:text-align": "left"
    })));
    obj.insert("subTopic".into(), style(json!({
        "shape-class": "org.xmind.topicShape.underline",
        "line-class": "org.xmind.branchConnection.roundedElbow",
        "line-width": "2pt",
        "fo:font-family": font,
        "fo:font-weight": 400,
        "fo:font-size": "14pt",
        "fo:text-align": "left"
    })));
    obj.insert("summaryTopic".into(), style(json!({
        "svg:fill": "none",
        "border-line-color": pal.primary,
        "shape-class": "org.xmind.topicShape.roundedRect",
        "fo:font-family": font,
        "fo:font-size": "14pt"
    })));
    obj.insert("calloutTopic".into(), style(json!({
        "svg:fill": pal.primary,
        "fo:color": "#ffffff",
        "callout-shape-class": "org.xmind.calloutTopicShape.balloon.roundedRect",
        "fo:font-family": font,
        "fo:font-size": "14pt"
    })));
    obj.insert("floatingTopic".into(), style(json!({
        "svg:fill": pal.panel,
        "border-line-color": pal.border,
        "shape-class": "org.xmind.topicShape.roundedRect",
        "fo:font-family": font,
        "fo:font-weight": 600,
        "fo:font-size": "14pt"
    })));
    obj.insert("boundary".into(), style(json!({
        "svg:fill": "none",
        "line-color": pal.primary,
        "shape-class": "org.xmind.boundaryShape.roundedRect",
        "line-width": "2pt",
        "line-pattern": "dash",
        "fo:font-family": font
    })));
    obj.insert("summary".into(), style(json!({
        "line-color": pal.primary,
        "shape-class": "org.xmind.summaryShape.round",
        "line-width": "2pt"
    })));
    obj.insert("relationship".into(), style(json!({
        "line-color": pal.muted,
        "shape-class": "org.xmind.relationshipShape.curved",
        "line-width": "2",
        "line-pattern": "dash",
        "arrow-end-class": "org.xmind.arrowShape.triangle"
    })));
    obj.insert("map".into(), style(json!({
        "svg:fill": pal.bg,
        "multi-line-colors": pal.branches.join(" "),
        "color-list": pal.branches.join(" "),
        "line-tapered": "none"
    })));
    obj.insert("importantTopic".into(), style(json!({
        "svg:fill": "#d02f48", "fo:color": "#ffffff", "fill-style": "solid"
    })));
    obj.insert("minorTopic".into(), style(json!({
        "svg:fill": "#f49d00", "fill-style": "solid"
    })));
    obj.insert("expiredTopic".into(), style(json!({
        "fo:text-decoration": "line-through", "fill-style": "solid"
    })));
    obj.insert("global".into(), style(json!({})));
    obj.insert("colorThemeId".into(), json!(format!("XMindRS-{theme:?}")));
    obj.insert("skeletonThemeId".into(), json!(new_id()));
    Value::Object(obj)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padded_cycle_collapses_to_its_period() {
        let colors = ["#A", "#B", "#C", "#A", "#B", "#C"].map(str::to_string).to_vec();
        assert_eq!(shorten_cycle(colors), vec!["#A", "#B", "#C"]);
        let rainbow: Vec<String> = (0..12).map(|i| format!("#{i:02X}")).collect();
        assert_eq!(shorten_cycle(rainbow.clone()), rainbow, "a real 12-hue ring stays");
    }

    #[test]
    fn palette_roundtrips_through_a_theme_object() {
        let mut theme = theme_for(ThemeId::Classic);
        let branches = ["#F22816".to_string(), "#F2B807".into(), "#233ED9".into()];
        apply_palette(&mut theme, Some("vivid-energy"), Some(&branches), Some("#0D0D0D"));

        let (id, colors, center) = read_palette(&theme);
        assert_eq!(id.as_deref(), Some("vivid-energy"));
        assert_eq!(colors.as_deref(), Some(branches.as_slice()));
        assert_eq!(center.as_deref(), Some("#0D0D0D"));
        assert_eq!(theme.pointer("/centralTopic/properties/fo:color").unwrap(), "#ffffff");
    }
}
