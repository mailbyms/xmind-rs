//! Connector attachment points measured on the shipped renderer.
//!
//! CDP on test2.xmind / example2.xmind (FINDINGS §53) shows a branch leaving
//! exactly at the parent topic's box edge, whether the shape is filled or an
//! underline.  The old `h_pad` inset made lines appear to grow out of the box.

use xmind_core::{compute_layout, set_style, Document, Topic, TopicStyle};

fn branch(title: &str, children: &[&str]) -> Topic {
    let mut topic = Topic::new(title);
    topic.children = children.iter().map(|t| Topic::new(*t)).collect();
    topic
}

fn line_style(class: &str) -> TopicStyle {
    let mut style = TopicStyle::default();
    style.line_class = Some(format!("org.xmind.branchConnection.{class}"));
    style.line_tapered = Some(false);
    style
}

fn first_point(path: &str) -> (f64, f64) {
    let cleaned = path.replace(',', " ");
    let mut it = cleaned.split_whitespace();
    assert_eq!(it.next(), Some("M"), "unexpected path: {path}");
    let x = it.next().unwrap().parse::<f64>().unwrap();
    let y = it.next().unwrap().parse::<f64>().unwrap();
    (x, y)
}

#[test]
fn connector_starts_on_the_parent_box_edge() {
    for class in ["roundedfold", "roundedElbow", "curve"] {
        let mut doc = Document::new("attachment");
        doc.root_mut().children.clear();
        let root_id = doc.root().id.clone();
        let child_id = xmind_core::add_child(&mut doc, &root_id, "一级").unwrap();
        let grand_id = xmind_core::add_child(&mut doc, &child_id, "二级").unwrap();
        set_style(&mut doc, &root_id, line_style(class));
        set_style(&mut doc, &child_id, line_style(class));

        let layout = compute_layout(&doc);
        let root = layout.nodes.iter().find(|n| n.id == root_id).unwrap();
        let child = layout.nodes.iter().find(|n| n.id == child_id).unwrap();
        let first = layout.edges.iter().find(|e| e.to == child_id).unwrap();
        let second = layout.edges.iter().find(|e| e.to == grand_id).unwrap();

        let (x1, _) = first_point(&first.path);
        assert!(
            (x1 - (root.x + root.width)).abs() < 0.2,
            "{class}: root connector starts at {x1}, box edge at {}", root.x + root.width,
        );
        let (x2, _) = first_point(&second.path);
        assert!(
            (x2 - (child.x + child.width)).abs() < 0.2,
            "{class}: child connector starts at {x2}, box edge at {}", child.x + child.width,
        );
    }
}

#[test]
fn a_single_attached_branch_centres_on_the_root() {
    let mut doc = Document::new("single branch");
    doc.root_mut().children = vec![branch("唯一分支", &["甲", "乙"])];
    let layout = compute_layout(&doc);
    let root = layout.nodes.iter().find(|n| n.depth == 0).unwrap();
    let child = layout.nodes.iter().find(|n| n.depth == 1).unwrap();
    let root_centre = root.y + root.height / 2.0;
    let child_centre = child.y + child.height / 2.0;
    assert!(
        (root_centre - child_centre).abs() < 0.2,
        "single branch centre {child_centre} must match root centre {root_centre}",
    );
}
