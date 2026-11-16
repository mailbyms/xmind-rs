//! `sheet.theme` → EffectiveStyle (FINDINGS §26, option A).
//!
//! The fixture is the real theme block of `example.xmind`: mainTopic is
//! `shape-class: underline` with a transparent `svg:fill`, subTopic omits the
//! shape entirely (XMind's defaultStyles supplies `underline`), and `map`
//! carries the six rainbow branch colours.

use serde_json::{json, Value};
use xmind_core::{compute_layout, Document, Topic, TopicStyle};

fn example_theme() -> Value {
    json!({
        "map": { "properties": {
            "svg:fill": "#F7F7FA",
            "multi-line-colors": "#F04137 #F8932E #FEC938 #A0C347 #06ABD0 #832A96",
            "line-tapered": "tapered"
        }},
        "centralTopic": { "properties": {
            "fo:font-family": "Montserrat",
            "fo:font-size": "28pt",
            "fo:font-weight": "700",
            "fo:color": "#000000",
            "svg:fill": "#FFFFFF",
            "line-width": "3",
            "line-color": "#374C75",
            "border-line-color": "#374C75",
            "border-line-width": "0",
            "shape-class": "org.xmind.topicShape.roundedRect"
        }},
        "mainTopic": { "properties": {
            "fo:font-family": "Montserrat",
            "fo:font-size": "18pt",
            "fo:font-weight": "600",
            "fo:color": "#091C34",
            "fo:text-align": "left",
            "svg:fill": "#00000000",
            "line-width": "2",
            "border-line-width": "2",
            "shape-class": "org.xmind.topicShape.underline",
            "line-class": "org.xmind.branchConnection.bight"
        }},
        "subTopic": { "properties": {
            "fo:font-family": "Montserrat",
            "fo:font-size": "14pt",
            "fo:font-weight": "400",
            "fo:color": "#091C34",
            "fo:text-align": "left",
            "line-class": "org.xmind.branchConnection.bight"
        }}
    })
}

fn document(theme: Option<Value>) -> Document {
    let mut doc = Document::new("主题验证");
    doc.sheets[0].root.children[0].children.push(Topic::new("二级主题"));
    if let Some(theme) = theme {
        doc.sheets[0].extra.insert("theme".into(), theme);
    }
    doc
}

#[test]
fn theme_turns_plates_into_text_and_underlines() {
    let layout = compute_layout(&document(Some(example_theme())));
    let root = layout.nodes.iter().find(|n| n.depth == 0).unwrap();
    let main = layout.nodes.iter().find(|n| n.depth == 1).unwrap();
    let sub = layout.nodes.iter().find(|n| n.depth == 2).unwrap();

    // Central topic: white plate, black ink, 28pt / 700 from the theme.
    assert_eq!(root.style.fill, "#FFFFFF");
    assert_eq!(root.style.color, "#000000");
    assert_eq!(root.style.font_size, 28);
    assert_eq!(root.style.font_weight, 700);
    assert!(root.style.font_family.as_deref().unwrap_or("").contains("Montserrat"));

    // Main topic: no plate at all (#00000000), underline shape, theme ink.
    assert_eq!(main.style.fill, "none");
    assert_eq!(main.style.shape, "underline");
    assert!(main.style.underline);
    assert_eq!(main.style.color, "#091C34");
    assert_eq!(main.style.font_size, 18);
    assert_eq!(main.style.font_weight, 600);
    assert_eq!(main.style.align, "left");
    // The rule takes the branch hue and the theme's 2px border width.
    assert_eq!(main.style.underline_color, "#F04137");
    assert_eq!(main.style.underline_width, 2.0);
    assert_eq!(main.style.stroke, "none", "the SVG outline must not draw a second rule");
    assert_eq!(main.shape_closed, false);

    // subTopic has no shape-class in the file: defaultStyles supplies underline.
    assert_eq!(sub.style.shape, "underline");
    assert!(sub.style.underline);
    assert_eq!(sub.style.fill, "none");
    assert_eq!(sub.style.font_size, 14);

    // map layer: canvas colour, branch cycle and tapered connectors.
    assert_eq!(layout.theme.bg, "#F7F7FA");
    assert_eq!(layout.theme.branches[0], "#F04137");
    assert!(layout.theme.sheet_theme.is_some());
    assert!(layout.edges.iter().any(|e| e.tapered), "line-tapered: tapered must survive");
}

#[test]
fn user_style_still_wins_over_the_theme() {
    let mut doc = document(Some(example_theme()));
    doc.sheets[0].root.children[0].style = Some(TopicStyle {
        fill: Some("#123456".into()),
        color: Some("#FFFFFF".into()),
        shape_class: Some("org.xmind.topicShape.ellipse".into()),
        ..TopicStyle::default()
    });
    let layout = compute_layout(&doc);
    let main = layout.nodes.iter().find(|n| n.depth == 1).unwrap();
    assert_eq!(main.style.fill, "#123456");
    assert_eq!(main.style.color, "#FFFFFF", "explicit ink is never auto-flipped");
    assert_eq!(main.style.shape, "ellipse");
    assert!(!main.style.underline);
    assert!(main.shape_closed);
}

#[test]
fn a_document_without_a_theme_keeps_its_own_palette() {
    let layout = compute_layout(&document(None));
    let main = layout.nodes.iter().find(|n| n.depth == 1).unwrap();
    let sub = layout.nodes.iter().find(|n| n.depth == 2).unwrap();
    assert_eq!(main.style.fill, layout.theme.branches[main.branch % layout.theme.branches.len()]);
    assert!(!main.style.underline);
    assert!(!sub.style.underline);
    assert_eq!(layout.theme.bg, "#ffffff");
    assert!(layout.theme.sheet_theme.is_none());
}

#[test]
fn our_own_write_back_theme_never_drives_rendering() {
    let theme = json!({
        "colorThemeId": "XMindRS-Classic",
        "map": { "properties": {
            "multi-line-colors": "#F04137 #F8932E",
            "line-tapered": "none"
        }},
        "mainTopic": { "properties": {
            "shape-class": "org.xmind.topicShape.underline",
            "line-class": "org.xmind.branchConnection.roundedElbow"
        }},
        "subTopic": { "properties": { "fo:font-size": "14pt" }}
    });
    let layout = compute_layout(&document(Some(theme)));
    let main = layout.nodes.iter().find(|n| n.depth == 1).unwrap();
    let sub = layout.nodes.iter().find(|n| n.depth == 2).unwrap();
    // doc_new writes this same theme object into sheet.extra.  It must stay a
    // pure write-back artefact: coloured plates, curve/tapered connectors.
    assert!(layout.theme.sheet_theme.is_none());
    assert_eq!(main.style.fill, layout.theme.branches[main.branch % layout.theme.branches.len()]);
    assert!(!main.style.underline);
    assert_eq!(sub.style.shape, "roundedRect");
    assert!(layout.edges.iter().any(|e| e.tapered));
}

#[test]
fn explicit_canvas_background_overrides_the_theme_map() {
    let mut doc = document(Some(example_theme()));
    doc.background = Some("#101010".into());
    let layout = compute_layout(&doc);
    assert_eq!(layout.theme.bg, "#101010");
}

#[test]
fn level3_theme_overlays_deep_topics_and_keeps_the_font_stack() {
    let mut theme = example_theme();
    theme.as_object_mut().unwrap().insert("level3".into(), json!({
        "properties": {
            "fo:font-size": "20pt",
            "line-width": "1pt",
            "shape-class": "org.xmind.topicShape.roundedRect"
        }
    }));
    let mut doc = document(Some(theme));
    doc.sheets[0].root.children[0].children[0]
        .children
        .push(Topic::new("三级主题"));
    let layout = compute_layout(&doc);

    let deep = layout.nodes.iter().find(|n| n.depth == 3).expect("depth-3 node");
    assert_eq!(deep.style.font_size, 20);
    assert_eq!(deep.style.line_width, 1.0, "1pt is one CSS px, not 1.333");
    assert_eq!(deep.style.shape, "roundedRect");
    // level3 leaves out fo:font-family → subTopic still supplies Montserrat,
    // and the desktop's NeverMind + CJK fallbacks are appended.
    let family = deep.style.font_family.as_deref().unwrap_or("");
    assert!(family.starts_with("'Montserrat'"));
    assert!(family.contains("'NeverMind'"));
    assert!(family.contains("'Microsoft YaHei'"));
    assert!(family.ends_with("sans-serif"), "{family}");

    let sub = layout.nodes.iter().find(|n| n.depth == 2).unwrap();
    assert_eq!(sub.style.font_size, 14, "level3 must not leak into level 2");
}

#[test]
fn pt_line_widths_are_stripped_not_scaled() {
    let mut theme = example_theme();
    theme.as_object_mut().unwrap().get_mut("centralTopic").unwrap()
        .get_mut("properties").unwrap()
        .as_object_mut().unwrap()
        .insert("line-width".into(), json!("3pt"));
    let layout = compute_layout(&document(Some(theme)));
    let root = layout.nodes.iter().find(|n| n.depth == 0).unwrap();
    // bundle 8846.js emits stroke-width="3" for "line-width":"3pt".
    assert_eq!(root.style.line_width, 3.0);
}
