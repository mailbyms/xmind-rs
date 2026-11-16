//! Horizontal padding inside a topic + XMind's 按层级对齐 (`sibling_align`).
//! Measured on the shipped renderer: the label is inset by 29/18/6 px on each
//! side for depth 0/1/2+, and `alignment-by-level: actived` gives every topic
//! of a level the same box width (a two-branch probe shared one 222px box).
use xmind_core::{compute_layout, Document, Topic};

fn branch(title: &str, children: &[&str]) -> Topic {
    let mut topic = Topic::new(title);
    topic.children = children.iter().map(|t| Topic::new(*t)).collect();
    topic
}

fn doc_with(align: bool) -> Document {
    let mut doc = Document::new("对齐测试");
    doc.sibling_align = align;
    doc.root_mut().children = vec![
        branch("甲分支", &["短", "中等长度标题", "这是一个相当长的子主题标题文字"]),
        branch("乙分支很长很长", &["A", "BBBBBBBB", "CCCCCCCCCCCCCCCCCCCC"]),
    ];
    doc
}

#[test]
fn label_padding_is_split_between_both_sides() {
    let layout = compute_layout(&doc_with(false));
    for node in &layout.nodes {
        let expected = match node.depth { 0 => 29.0, 1 => 18.0, _ => 6.0 };
        // A centred label is inset symmetrically by CSS but gains nothing from
        // `textPad` — padding would only shrink its wrap width.
        let want = if node.style.align == "left" { expected } else { 0.0 };
        assert!((node.text_pad - want).abs() < 0.01,
            "depth {} align {} text_pad={} expected {}", node.depth, node.style.align, node.text_pad, want);
    }
    let root = layout.nodes.iter().find(|n| n.depth == 0).unwrap();
    assert_eq!(root.lines, 1);
}

#[test]
fn alignment_by_level_widens_every_topic_of_a_depth() {
    let before = compute_layout(&doc_with(false));
    let after = compute_layout(&doc_with(true));
    let widths = |layout: &xmind_core::Layout, depth: u32| -> Vec<f64> {
        layout.nodes.iter().filter(|n| n.depth == depth).map(|n| n.width).collect()
    };
    let plain = widths(&before, 2);
    assert!(plain.iter().max_by(|a, b| a.total_cmp(b)).unwrap()
        - plain.iter().min_by(|a, b| a.total_cmp(b)).unwrap() > 10.0,
        "unaligned siblings must differ: {plain:?}");
    let aligned = widths(&after, 2);
    assert_eq!(aligned.len(), 6);
    let max = aligned.iter().copied().fold(0.0, f64::max);
    assert!(aligned.iter().all(|w| (w - max).abs() < 0.01),
        "all depth-2 topics must share one width: {aligned:?}");
    assert!((max - *plain.iter().max_by(|a, b| a.total_cmp(b)).unwrap()).abs() < 0.01,
        "alignment only widens, never shrinks");
    // Left-hand topics grow towards the left, so their right edges stay on the
    // column boundary (the boundary itself moves when columns are unified).
    let left_after = after.nodes.iter().filter(|n| n.depth == 2 && n.side == xmind_core::Side::Left)
        .map(|n| n.x + n.width).collect::<Vec<_>>();
    if left_after.len() > 1 {
        let first = left_after[0];
        assert!(left_after.iter().all(|v| (v - first).abs() < 0.01),
            "left-side boxes must end on one column edge: {left_after:?}");
    }
}
