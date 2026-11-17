//! Branches that touch an 下划线 topic must land on its rule, not on the
//! vertical centre of the label.
//!
//! Measured on the shipped XMind with `example.xmind` (CDP 9222,
//! `target/verify/underline/orig-attach.json`): all 126 attach points satisfy
//! `y == rect.bottom == underlineY` and `dx <= 0.71` from the box's left/right
//! edge, while `topic-node-border` is a zero-height stroke spanning the whole
//! `rect.w`.  So the rule is the topic's bottom edge and the connector is a
//! continuation of it.  Three painters must agree on that geometry:
//! `styles.css` `.node.underline::after`, `layout::branch_anchor_y` and
//! `xmind-file::export.rs`'s `<line>` (see FINDINGS §40).
use xmind_core::{compute_layout, set_style, Document, TopicStyle};

fn underline_style() -> TopicStyle {
    let mut style = TopicStyle::default();
    style.shape_class = Some("org.xmind.topicShape.underline".into());
    // The test reads the first/last point of an SVG path, which only works for
    // a stroked curve.  A tapered wedge is a closed polygon (`... Z`) whose
    // last point is back at its start.
    style.line_tapered = Some(false);
    style
}

fn doc() -> Document {
    let mut doc = Document::new("下划线连线");
    let root = doc.root().id.clone();
    let a = xmind_core::add_child(&mut doc, &root, "一级甲").expect("first child");
    let _b = xmind_core::add_child(&mut doc, &root, "一级乙");
    let _c = xmind_core::add_child(&mut doc, &a, "二级甲");
    // Connector style (including line-tapered) is read from the *parent*
    // branch, so the root must opt out too; otherwise level-1 branches are
    // closed tapered wedges whose last path point is back at the start.
    let mut root_style = TopicStyle::default();
    root_style.line_tapered = Some(false);
    set_style(&mut doc, &root, root_style);
    doc
}

/// `(start_x, start_y, end_x, end_y)` of a stroked curve / polyline path.
fn endpoints(path: &str) -> (f64, f64, f64, f64) {
    let nums: Vec<f64> = path
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<f64>().unwrap())
        .collect();
    assert!(nums.len() >= 4, "unexpected path: {path}");
    (
        nums[0], nums[1],
        nums[nums.len() - 2], nums[nums.len() - 1],
    )
}

/// The shipped rule is the topic's bottom edge, centred on `box.bottom`.
fn rule_y(n: &xmind_core::LaidOutNode) -> f64 {
    n.y + n.height
}

#[test]
fn underline_topics_attach_branches_to_the_rule() {
    let mut doc = doc();
    let ids: Vec<String> = {
        let root = doc.root();
        let mut out: Vec<String> = root.children.iter().map(|c| c.id.clone()).collect();
        out.extend(root.children[0].children.iter().map(|c| c.id.clone()));
        out
    };
    for id in &ids { set_style(&mut doc, id, underline_style()); }
    let layout = compute_layout(&doc);
    let nodes = &layout.nodes;
    for id in &ids {
        let node = nodes.iter().find(|n| &n.id == id).expect("laid-out node");
        assert!(node.style.underline, "{} must be an underline shape", node.title);
        let edge = layout.edges.iter().find(|e| &e.to == id).expect("connector");
        assert!(!edge.tapered, "test wants a stroked curve: {}", edge.path);
        let (_, start_y, end_x, end_y) = endpoints(&edge.path);
        let want = rule_y(node);
        let centre = node.y + node.height / 2.0;
        assert!(
            (end_y - want).abs() < 0.2,
            "{}: branch ends at {end_y}, rule at {want} (box centre {centre}), path {}",
            node.title, edge.path,
        );
        assert!(want > centre + 1.0, "{}: rule must be below the box centre", node.title);
        // The rule spans the whole box, so the endpoint must sit exactly on
        // one of its ends rather than inside the text area.
        let left = node.x;
        let right = node.x + node.width;
        assert!(
            (end_x - left).abs() < 0.2 || (end_x - right).abs() < 0.2,
            "{}: branch ends at x={end_x}, rule spans {left}..{right}", node.title,
        );
        // A parent that is itself an underline shape sends its children out
        // from its own rule, with no historical h_pad inset.
        let parent = nodes.iter().find(|n| n.id == edge.from).expect("parent");
        if parent.style.underline {
            assert!(
                (start_y - rule_y(parent)).abs() < 0.2,
                "{}: parent branch starts at {start_y}, parent rule at {}",
                node.title, rule_y(parent),
            );
            let (sx, _, _, _) = endpoints(&edge.path);
            assert!(
                (sx - parent.x).abs() < 0.2
                    || (sx - (parent.x + parent.width)).abs() < 0.2,
                "{}: parent branch leaves at x={sx}, parent box {}..{}",
                node.title, parent.x, parent.x + parent.width,
            );
        }
    }
}

#[test]
fn filled_topics_still_attach_at_the_centre() {
    let doc = doc();
    let layout = compute_layout(&doc);
    for edge in &layout.edges {
        let node = layout.nodes.iter().find(|n| n.id == edge.to).expect("laid-out node");
        if edge.tapered { continue; }
        let (_, _, _, end_y) = endpoints(&edge.path);
        let centre = node.y + node.height / 2.0;
        assert!(
            (end_y - centre).abs() < 0.2,
            "{}: filled shape must keep the centre attachment ({end_y} vs {centre})",
            node.title,
        );
    }
}
