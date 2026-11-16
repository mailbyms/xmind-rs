//! Long topic labels wrap onto extra lines instead of being clipped, and a
//! short label keeps the exact size it always had.
use xmind_core::{compute_layout, Document};

fn root_of(title: &str) -> xmind_core::LaidOutNode {
    let mut doc = Document::new(title);
    doc.root_mut().title = title.to_string();
    let layout = compute_layout(&doc);
    layout.nodes.into_iter().find(|n| n.depth == 0).expect("root topic")
}

#[test]
fn short_label_stays_one_line_with_its_original_size() {
    let node = root_of("中心主题");
    assert_eq!(node.lines, 1);
    // 4 CJK glyphs * 30px + 58px padding; 30px * 1.333 + 30px vertical pad.
    assert!((node.width - 178.0).abs() < 0.1, "width={}", node.width);
    assert!((node.height - 69.99).abs() < 0.1, "height={}", node.height);
}

#[test]
fn long_label_wraps_and_grows_the_topic_box() {
    let short = root_of("中心主题");
    let long = root_of("逐字输入时主题盒子会跟着变宽并且自动折行不会裁切文字很长很长很长");
    assert!((long.width - 340.0).abs() < 0.1, "width={}", long.width);
    assert!(long.lines >= 3, "lines={}", long.lines);
    assert!(long.height > short.height + 60.0, "height={}", long.height);
    // Every extra line adds exactly one line box (30px * 1.333).
    let extra = long.height - short.height;
    assert!((extra - (long.lines - 1) as f64 * 39.99).abs() < 0.2, "extra={extra}");
}

#[test]
fn explicit_newline_is_a_real_line() {
    let node = root_of("第一行\n第二行");
    assert_eq!(node.lines, 2);
    assert!(node.height > 100.0, "height={}", node.height);
}

#[test]
fn custom_width_changes_the_wrap_limit() {
    let mut doc = Document::new("逐字输入时主题盒子会跟着变宽并且自动折行不会裁切文字很长很长很长");
    doc.root_mut().custom_width = Some(600.0);
    let wide = compute_layout(&doc).nodes.into_iter().find(|n| n.depth == 0).unwrap();
    let narrow = root_of("逐字输入时主题盒子会跟着变宽并且自动折行不会裁切文字很长很长很长");
    assert!(wide.lines < narrow.lines, "wide={} narrow={}", wide.lines, narrow.lines);
}
