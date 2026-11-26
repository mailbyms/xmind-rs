//! In-box marker sizing (FINDINGS §62).
//!
//! The shipped renderer sizes a marker from the topic's **own** font size —
//! `markerImageSize = { width: titleTextFontSize }` — with a white ring of
//! `size/6` and a fixed `-8` spacing between slots.  A document-wide icon size
//! makes a 14px sub-topic carry 30/36px icons that are taller than its 32px
//! box, which both puffs the topic out and looks out of proportion with its
//! text.  These assertions pin the per-depth sizes and the slot arithmetic.
use xmind_core::{compute_layout, Document, Layout, LaidOutNode, Topic};

fn marked(mut topic: Topic, markers: &[&str]) -> Topic {
    topic.markers = markers.iter().map(|m| m.to_string()).collect();
    topic
}

/// `Document::new` already ships a central topic with four branches; give the
/// root four markers (the §48 baseline) and grow one branch three levels deep.
fn doc() -> Document {
    let mut doc = Document::new("标记尺寸");
    doc.root_mut().markers = ["priority-1", "task-oct", "flag-red", "star-red"]
        .iter().map(|m| m.to_string()).collect();
    let deep = marked(Topic::new("三级主题"), &["priority-4", "flag-green", "task-start"]);
    let sub = marked(
        Topic { children: vec![deep], ..Topic::new("二级主题") },
        &["priority-3", "star-green"],
    );
    let branch = marked(
        Topic { children: vec![sub], ..Topic::new("一级主题") },
        &["priority-2", "task-done", "flag-blue", "star-red"],
    );
    doc.root_mut().children.push(branch);
    doc
}

fn node<'a>(layout: &'a Layout, title: &str) -> &'a LaidOutNode {
    layout.nodes.iter().find(|n| n.title == title)
        .unwrap_or_else(|| panic!("no node titled {title}"))
}

fn slot(n: &LaidOutNode) -> f64 { n.marker_size + 2.0 * n.marker_ring }

#[test]
fn marker_icon_matches_the_topic_font_size() {
    let layout = compute_layout(&doc());
    for (title, font) in [
        ("中心主题", 30.0), ("一级主题", 18.0), ("二级主题", 14.0), ("三级主题", 14.0),
    ] {
        let n = node(&layout, title);
        assert_eq!(f64::from(n.style.font_size), font, "{title} font size");
        assert!((n.marker_size - font).abs() < 0.01,
            "{title}: marker icon {} should equal its font size {font}", n.marker_size);
        assert!((n.marker_ring - font / 6.0).abs() < 0.01, "{title} ring {}", n.marker_ring);
        assert!((n.marker_step - (slot(n) - 8.0)).abs() < 0.01, "{title} step {}", n.marker_step);
    }
}

#[test]
fn marker_row_never_grows_the_topic_box() {
    let layout = compute_layout(&doc());
    for n in &layout.nodes {
        if n.markers.is_empty() { continue; }
        // The slot is `4/3 × font`, exactly the CSS line box, so the row can
        // never be taller than the text area (let alone the whole shape).
        assert!(slot(n) <= n.height + 0.01,
            "{}: {:.2}px marker slot inside a {:.1}px box", n.title, slot(n), n.height);
        assert!(n.marker_size < n.height,
            "{}: {:.1}px icon inside a {:.1}px box", n.title, n.marker_size, n.height);
    }
}

#[test]
fn marker_width_uses_overlapping_slots() {
    let layout = compute_layout(&doc());
    for n in &layout.nodes {
        if n.markers.is_empty() { continue; }
        let count = n.markers.len() as f64;
        let expected = count * slot(n) + (count - 1.0) * -8.0 + 10.0;
        assert!((n.marker_width - expected).abs() < 0.01,
            "{}: marker_width {} expected {expected}", n.title, n.marker_width);
    }
    // Four 30px icons in the central box: 4·40 − 3·8 + 10 = 146 reserve, and
    // 29 + 146 + 120(title) + 29 = 324 (§48 baseline, unchanged).
    let root = node(&layout, "中心主题");
    assert!((root.marker_width - 146.0).abs() < 0.5, "root reserve {}", root.marker_width);
    assert!((root.width - 324.0).abs() < 0.5, "root box {}", root.width);
    // Three 14px icons on a 32px sub-topic: 3·18.67 − 2·8 + 10 = 50.
    let deep = node(&layout, "三级主题");
    assert!((deep.marker_width - 50.0).abs() < 0.5, "deep reserve {}", deep.marker_width);
}

#[test]
fn marker_width_zero_without_markers() {
    let plain = compute_layout(&Document::new("无标记"));
    assert_eq!(plain.nodes[0].marker_width, 0.0);
    assert_eq!(plain.nodes[0].marker_size, 30.0, "icon size is still the font size");
}
