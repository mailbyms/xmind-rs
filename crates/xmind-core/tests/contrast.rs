//! Text ink must stay readable on the white canvas for every 骨架 × 配色 combo.
//!
//! The failure this guards: a skeleton without a filled plate (下划线/双下划线)
//! or with a hatch tile leaves the label sitting on white, while the palette ink
//! was chosen from the *branch colour* — a dark palette then paints white on
//! white (contrast 1.0).
use xmind_core::{compute_layout, set_style, Document, TopicStyle};

fn doc_with_branches() -> Document {
    let mut doc = Document::new("对比度");
    let root_id = doc.root().id.clone();
    for title in ["一", "二", "三"] {
        xmind_core::add_child(&mut doc, &root_id, title);
    }
    // Deep topics are plain text; they need a red line too.
    let first = doc.root().children[0].id.clone();
    xmind_core::add_child(&mut doc, &first, "深");
    doc
}

/// A palette whose branch hues are all dark enough for XMind to pick white ink.
fn dark_palette(doc: &mut Document) {
    doc.branch_colors = Some(vec!["#0D0D0D".into(), "#233ED9".into(), "#99142F".into()]);
    doc.center_color = Some("#0D0D0D".into());
}

fn node_of<'a>(nodes: &'a [xmind_core::LaidOutNode], title: &str) -> &'a xmind_core::LaidOutNode {
    nodes.iter().find(|n| n.title == title).expect("node")
}

fn ink_on(nodes: &[xmind_core::LaidOutNode], title: &str) -> String {
    node_of(nodes, title).style.color.clone()
}

/// `black` is what the contrast pass writes; deeper topics keep the plain
/// `#0D0D0D` they always had — both read as dark ink.
fn is_dark(ink: &str) -> bool {
    matches!(ink, "black" | "#0D0D0D")
}

#[test]
fn underline_skeletons_flip_white_ink_to_black() {
    let mut doc = doc_with_branches();
    dark_palette(&mut doc);
    // 思维导图 2 / 组织结构图 4 style: no plate at all.
    for child in doc.root().children.clone() {
        let mut style = TopicStyle::default();
        style.shape_class = Some("org.xmind.topicShape.underline".into());
        set_style(&mut doc, &child.id, style);
    }
    let mut root_style = TopicStyle::default();
    root_style.shape_class = Some("org.xmind.topicShape.doubleunderline".into());
    let root_id = doc.root().id.clone();
    set_style(&mut doc, &root_id, root_style);

    let layout = compute_layout(&doc);
    for node in &layout.nodes {
        assert_eq!(node.style.fill, "none", "underline shapes paint no plate");
        assert!(is_dark(&node.style.color), "{} must not be white-on-white", node.title);
    }
}

#[test]
fn hatch_tiles_use_dark_ink() {
    let mut doc = doc_with_branches();
    dark_palette(&mut doc);
    for child in doc.root().children.clone() {
        let mut style = TopicStyle::default();
        style.shape_class = Some("org.xmind.topicShape.roundedRect".into());
        style.fill_pattern = Some("hachure".into());
        style.line_pattern = Some("handdrawn-solid".into());
        set_style(&mut doc, &child.id, style);
    }

    let layout = compute_layout(&doc);
    for node in layout.nodes.iter().filter(|n| n.depth == 1) {
        assert_eq!(node.style.fill_pattern, "hachure");
        assert!(is_dark(&node.style.color), "{} sits on a white hatch tile", node.title);
    }
}

#[test]
fn solid_plates_keep_xminds_own_ink() {
    let mut doc = doc_with_branches();
    dark_palette(&mut doc);
    let layout = compute_layout(&doc);
    // XMind paints white on a dark plate; that choice must survive.
    assert_eq!(ink_on(&layout.nodes, "一"), "white");
    assert_eq!(node_of(&layout.nodes, "一").style.fill, "#233ED9");

    doc.branch_colors = Some(vec!["#F3D321".into()]);
    let layout = compute_layout(&doc);
    assert_eq!(ink_on(&layout.nodes, "一"), "black", "yellow plate takes black ink");
}

#[test]
fn plain_canvas_text_follows_the_background() {
    let mut doc = doc_with_branches();
    // Deep topics are bare text on the canvas.
    let layout = compute_layout(&doc);
    assert!(is_dark(&ink_on(&layout.nodes, "深")));
    assert_eq!(layout.theme.bg, "#ffffff");

    // On a dark canvas the same bare text has to flip.
    doc.background = Some("#12161d".into());
    let layout = compute_layout(&doc);
    assert_eq!(ink_on(&layout.nodes, "深"), "white");
}
