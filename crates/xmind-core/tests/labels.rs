//! 标签 (labels) hang under the topic as 23px pills.  Two things must hold:
//! the layout reserves their vertical space (so a sibling can never cover
//! them), and every chip stays inside the topic's width — long labels wrap to
//! a new row instead of spilling sideways.
use xmind_core::{compute_layout, ops, Document, LaidOutNode, Layout};

fn tree() -> (Document, Vec<String>) {
    let mut doc = Document::new("中心主题");
    let root = doc.root().id.clone();
    let ids = ["分支 1", "分支 2", "分支 3", "分支 4", "分支 5", "分支 6"]
        .iter()
        .map(|title| ops::add_child(&mut doc, &root, title).unwrap())
        .collect();
    (doc, ids)
}

fn node<'a>(nodes: &'a [LaidOutNode], id: &str) -> &'a LaidOutNode {
    nodes.iter().find(|n| n.id == id).expect("node in layout")
}

/// Nothing may be drawn on top of a label: on the same side, every node that
/// starts below a labelled topic has to start below its last chip.
fn assert_labels_are_clear(layout: &Layout) {
    for node in layout.nodes.iter().filter(|n| !n.label_chips.is_empty()) {
        let bottom = node.label_chips.iter()
            .map(|chip| node.y + chip.y + 23.0)
            .fold(f64::NEG_INFINITY, f64::max);
        for other in &layout.nodes {
            if other.id == node.id || other.side != node.side { continue; }
            if (other.x - node.x).abs() > 0.5 || other.y < node.y { continue; }
            assert!(other.y >= bottom - 0.01,
                "{} (y {}) covers the labels of {} (bottom {bottom})",
                other.title, other.y, node.title);
        }
    }
}

#[test]
fn labels_reserve_space_in_the_layout() {
    let (mut doc, ids) = tree();
    let before = compute_layout(&doc);
    // Any branch that has another branch stacked right below it on the same
    // side will do.
    let target = ids.iter()
        .map(|id| node(&before.nodes, id))
        .find(|n| before.nodes.iter().any(|o| o.id != n.id && o.side == n.side
            && (o.x - n.x).abs() < 0.5 && o.y > n.y))
        .expect("a branch with a stacked neighbour");
    let neighbour = before.nodes.iter()
        .filter(|o| o.id != target.id && o.side == target.side
            && (o.x - target.x).abs() < 0.5 && o.y > target.y)
        .min_by(|a, b| a.y.partial_cmp(&b.y).unwrap())
        .expect("the neighbour below");
    let neighbour_before = neighbour.y;

    // Enough labels to exceed the natural branch pitch (130): eight rows are
    // ~209px of pills.
    let labels: Vec<String> = (0..8).map(|i| format!("标签 {i}")).collect();
    assert!(ops::set_labels(&mut doc, &target.id, labels));

    let after = compute_layout(&doc);
    assert_labels_are_clear(&after);
    let grown = node(&after.nodes, &neighbour.id).y;
    assert!(grown > neighbour_before + 40.0,
        "the stacked neighbour must move down: {neighbour_before} -> {grown}");
}

#[test]
fn chips_wrap_inside_the_topic_width() {
    let (mut doc, ids) = tree();
    ops::set_labels(&mut doc, &ids[1], vec![
        "这是一个很长的标签文字用来观察换行行为".into(),
        "第二标签".into(),
        "第三标签".into(),
    ]);
    let layout = compute_layout(&doc);
    let topic = node(&layout.nodes, &ids[1]);
    assert_eq!(topic.label_chips.len(), 3, "one chip per label");
    let mut tops: Vec<i64> = Vec::new();
    for chip in &topic.label_chips {
        assert!(chip.x >= -0.01, "chip starts left of the box: {chip:?}");
        assert!(chip.x + chip.width <= topic.width + 0.01,
            "chip overflows the box: {chip:?} / {}", topic.width);
        let top = (chip.y - topic.height).round() as i64;
        if !tops.contains(&top) { tops.push(top); }
    }
    assert!(!tops.is_empty());
    assert_eq!(tops[0], 4, "the first row sits 4px under the shape");
    // Rows are centred under the shape.
    for chip in &topic.label_chips {
        if (chip.y - topic.height).round() as i64 != tops[0] { continue; }
        let right = topic.width - (chip.x + chip.width);
        assert!((chip.x - right).abs() < 0.51,
            "chip row is not centred: left {} right {right}", chip.x);
    }
    assert_labels_are_clear(&layout);
}

#[test]
fn a_wide_topic_fits_short_labels_on_one_row() {
    let (mut doc, _) = tree();
    let root = doc.root().id.clone();
    ops::set_labels(&mut doc, &root, vec!["标签一".into(), "标签二".into()]);
    let layout = compute_layout(&doc);
    let topic = node(&layout.nodes, &root);
    let rows: Vec<i64> = topic.label_chips.iter()
        .map(|chip| (chip.y - topic.height).round() as i64)
        .collect();
    assert_eq!(rows.iter().min(), rows.iter().max(),
        "short labels share a row when they fit: {rows:?}");
    assert!(topic.label_chips[0].x + topic.label_chips[0].width
        <= topic.label_chips[1].x + 0.01, "chips must not overlap");
}
