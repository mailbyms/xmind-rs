//! 联系 / 概要 / 外框 and free-position dragging are real document operations
//! that must show up in the computed layout and survive remove/rename.
use xmind_core::{compute_layout, ops, Document};

fn tree() -> (Document, String, String, String) {
    let mut doc = Document::new("中心主题");
    let root = doc.root().id.clone();
    let first = ops::add_child(&mut doc, &root, "分支 1").unwrap();
    let second = ops::add_child(&mut doc, &root, "分支 2").unwrap();
    ops::add_child(&mut doc, &first, "子主题").unwrap();
    (doc, root, first, second)
}

#[test]
fn relationship_becomes_a_curved_link() {
    let (mut doc, _, first, second) = tree();
    assert!(ops::add_relationship(&mut doc, &first, &second, "关联").is_some());
    let layout = compute_layout(&doc);
    assert_eq!(layout.links.len(), 1);
    let link = &layout.links[0];
    assert_eq!(link.from, first);
    assert_eq!(link.to, second);
    assert_eq!(link.title, "关联");
    assert!(link.path.starts_with("M ") && link.path.contains(" Q "));
    assert!(link.label_x.is_finite() && link.label_y.is_finite());

    // A 联系 needs two distinct, existing topics.
    assert!(ops::add_relationship(&mut doc, &first, &first, "自环").is_none());
    assert!(ops::add_relationship(&mut doc, &first, "missing", "x").is_none());
}

#[test]
fn boundary_and_summary_wrap_the_child_range() {
    let (mut doc, root, _, _) = tree();
    let (start, end) = ops::decor_range(doc.root(), &root).unwrap();
    // Document::new ships four sample branches; the range covers all children.
    assert_eq!(start, doc.root().children.first().unwrap().id);
    assert_eq!(end, doc.root().children.last().unwrap().id);
    assert_ne!(start, end);

    let boundary = ops::add_boundary(&mut doc, &root, "范围").unwrap();
    let summary = ops::add_summary(&mut doc, &root, "概要").unwrap();
    let layout = compute_layout(&doc);
    assert_eq!(layout.frames.len(), 2, "one 外框 + one 概要 brace");
    assert!(layout.frames.iter().any(|f| f.kind == "boundary" && f.id == boundary && f.title == "范围"));
    assert!(layout.frames.iter().any(|f| f.kind == "summary" && f.id == summary));
    assert!(layout.nodes.iter().any(|n| n.id == summary && n.title == "概要"),
        "the 概要 itself must be a real, editable topic");

    assert!(ops::rename_decor(&mut doc, "boundary", &boundary, "改名了"));
    assert!(compute_layout(&doc).frames.iter().any(|f| f.title == "改名了"));
    assert!(ops::remove_decor(&mut doc, "boundary", &boundary));
    assert!(ops::remove_decor(&mut doc, "summary", &summary));
    let cleared = compute_layout(&doc);
    assert!(cleared.frames.is_empty());
    assert!(!cleared.nodes.iter().any(|n| n.id == summary));
}

#[test]
fn range_handles_move_the_ends_of_a_frame() {
    let (mut doc, root, first, _) = tree();
    ops::add_child(&mut doc, &root, "分支 5").unwrap();
    // A brace only ever spans siblings on one side, so take a real run from
    // the layout instead of assuming document order.
    let layout = compute_layout(&doc);
    let run: Vec<String> = layout.nodes.iter()
        .filter(|n| n.parent_id.as_deref() == Some(root.as_str())
            && n.side == xmind_core::Side::Right && !n.cell)
        .map(|n| n.id.clone())
        .collect();
    assert!(run.len() >= 3, "need three siblings on one side to slide the range");

    let summary = ops::add_summary_with_range(
        &mut doc, &run[0], Some((&run[0], &run[1])), "概要",
    ).unwrap();
    let layout = compute_layout(&doc);
    let frame = layout.frames.iter().find(|f| f.id == summary).unwrap();
    assert_eq!(frame.start_id, run[0]);
    assert_eq!(frame.end_id, run[1]);
    assert_eq!(frame.parent_id.as_deref(), Some(root.as_str()));
    assert!(frame.end_y > frame.start_y, "the two handles sit on the brace tips");

    // Slide both ends: one sibling wider at the bottom, one narrower at the top.
    assert!(ops::set_decor_range(&mut doc, "summary", &summary, &run[1], &run[2]));
    let moved = compute_layout(&doc);
    let frame = moved.frames.iter().find(|f| f.id == summary).unwrap();
    assert_eq!((frame.start_id.as_str(), frame.end_id.as_str()),
        (run[1].as_str(), run[2].as_str()));
    assert!(frame.end_y > frame.start_y);

    // A range may not leave the sibling group, nor point at a missing topic.
    let grandchild = ops::find(doc.root(), &first).unwrap().children[0].id.clone();
    assert!(!ops::set_decor_range(&mut doc, "summary", &summary, &run[0], &grandchild));
    assert!(!ops::set_decor_range(&mut doc, "summary", &summary, "missing", &run[1]));
    assert!(!ops::set_decor_range(&mut doc, "boundary", &summary, &run[1], &run[2]),
        "a summary id is not a boundary id");
}

#[test]
fn summary_is_registered_in_xminds_native_format() {
    let (mut doc, _, first, second) = tree();
    let a = doc.root().children.iter().position(|t| t.id == first).unwrap();
    let b = doc.root().children.iter().position(|t| t.id == second).unwrap();
    let id = ops::add_summary_with_range(
        &mut doc, &first, Some((&first, &second)), "概要",
    ).unwrap();

    // XMind reads `summaries[]` off the parent of the selected siblings and
    // indexes its `children.attached` literally: "(4,5)", not topic ids.
    let list = doc.root().extra.get("summaries")
        .and_then(|v| v.as_array()).expect("the parent must register the 概要");
    let item = list.iter()
        .find(|it| it.get("topicId").and_then(|v| v.as_str()) == Some(id.as_str()))
        .expect("registration points at the new topic");
    let expected = format!("({a},{b})");
    assert_eq!(item.get("range").and_then(|v| v.as_str()), Some(expected.as_str()));
    assert!(item.get("style").and_then(|s| s.get("properties"))
        .and_then(|p| p.get("shape-class")).and_then(|v| v.as_str())
        .is_some_and(|v| v.ends_with("curly")));
    assert!(doc.root().summary.iter().any(|t| t.id == id),
        "the 概要 lives in the parent's children.summary");
    assert!(ops::find(doc.root(), &id).unwrap().extra.get("summaryRange").is_none(),
        "no self-made extension: XMind must not need it");

    let layout = compute_layout(&doc);
    assert_eq!(layout.nodes.iter().filter(|n| n.id == id).count(), 1,
        "the 概要 is drawn exactly once");
    assert_eq!(layout.frames.iter().filter(|f| f.id == id).count(), 1,
        "one brace only");

    // Deleting removes the registration as well, so no empty brace survives.
    assert!(ops::remove_decor(&mut doc, "summary", &id));
    assert!(doc.root().extra.get("summaries").is_none());
    assert!(!compute_layout(&doc).nodes.iter().any(|n| n.id == id));
}

#[test]
fn native_summary_children_are_rendered_as_a_branch() {
    let (mut doc, _, first, second) = tree();
    let id = ops::add_summary_with_range(
        &mut doc, &first, Some((&first, &second)), "概要",
    ).unwrap();
    let kid_a = ops::add_child(&mut doc, &id, "概要子 1").unwrap();
    let kid_b = ops::add_child(&mut doc, &id, "概要子 2").unwrap();
    let grand = ops::add_child(&mut doc, &kid_b, "概要孙").unwrap();

    let layout = compute_layout(&doc);
    assert_eq!(layout.nodes.iter().filter(|n| n.id == id).count(), 1,
        "the 概要 itself is still drawn exactly once");
    for title in ["概要子 1", "概要子 2", "概要孙"] {
        assert!(layout.nodes.iter().any(|n| n.title == title),
            "missing summary descendant: {title}");
    }
    assert_eq!(layout.frames.iter().filter(|f| f.id == id).count(), 1,
        "one brace only, no duplicate summary frame");
    assert!(layout.edges.iter().any(|e| e.from == id && e.to == kid_a));
    assert!(layout.edges.iter().any(|e| e.from == id && e.to == kid_b));
    assert!(layout.edges.iter().any(|e| e.from == kid_b && e.to == grand));

    let sum = layout.nodes.iter().find(|n| n.id == id).unwrap();
    let child = layout.nodes.iter().find(|n| n.id == kid_a).unwrap();
    assert_eq!(child.parent_id.as_deref(), Some(id.as_str()));
    assert!(child.x > sum.x + sum.width,
        "summary children grow to the right of the 概要 topic");
}

#[test]
fn legacy_summary_is_upgraded_to_native_format() {
    let (mut doc, _, first, second) = tree();
    // What older builds wrote: a private extension plus a topic parked under
    // the central topic. XMind ignores both.
    let mut legacy = xmind_core::Topic::new("概要");
    legacy.extra.insert("summaryRange".into(), serde_json::json!({
        "startId": first, "endId": second, "anchorId": second,
    }));
    let id = legacy.id.clone();
    doc.root_mut().summary.push(legacy);

    assert_eq!(ops::migrate_legacy_summaries(&mut doc), 1);
    let migrated = ops::find(doc.root(), &id).expect("概要 topic survives the upgrade");
    assert!(!migrated.extra.contains_key("summaryRange"));
    assert_eq!(migrated.title, "概要");
    let list = doc.root().extra.get("summaries")
        .and_then(|v| v.as_array()).expect("native registration was added");
    let item = list.iter()
        .find(|it| it.get("topicId").and_then(|v| v.as_str()) == Some(id.as_str()))
        .expect("registration points at the migrated topic");
    let a = doc.root().children.iter().position(|t| t.id == first).unwrap();
    let b = doc.root().children.iter().position(|t| t.id == second).unwrap();
    assert_eq!(item.get("range").and_then(|v| v.as_str()), Some(format!("({a},{b})").as_str()));
    assert_eq!(ops::migrate_legacy_summaries(&mut doc), 0, "migration is idempotent");
    assert_eq!(compute_layout(&doc).nodes.iter().filter(|n| n.id == id).count(), 1);
}

#[test]
fn branch_document_is_cropped_to_the_subtree() {
    let (mut doc, root, first, _) = tree();
    ops::set_fold(&mut doc, &first, true);

    let branch = ops::branch_document(&doc, &first).expect("branch exists");
    assert_eq!(branch.sheets.len(), 1);
    assert_eq!(branch.active_sheet, 0);
    assert_eq!(branch.root().id, first);
    assert_eq!(branch.root().title, "分支 1");
    assert!(!branch.root().folded, "an exported branch is fully expanded");
    assert_eq!(branch.root().children.len(), 1);
    assert!(branch.title.contains("分支 1"));

    let layout = compute_layout(&branch);
    assert!(!layout.nodes.iter().any(|n| n.id == root), "the central topic is gone");
    assert!(layout.nodes.iter().any(|n| n.title == "子主题"));
    assert!(ops::branch_document(&doc, "missing").is_none());
}

#[test]
fn dropping_on_empty_canvas_creates_a_positioned_floating_topic() {
    let (mut doc, root, first, _) = tree();
    assert!(!ops::move_to_free_position(&mut doc, &root, 0.0, 0.0), "root cannot float");

    let before = compute_layout(&doc);
    let prior = before.nodes.iter().find(|n| n.id == first).unwrap().clone();
    assert!(ops::move_to_free_position(&mut doc, &first, 260.0, -140.0));
    assert_eq!(doc.root().detached.len(), 1);
    let position = doc.root().detached[0].position.as_ref().unwrap();
    assert_eq!((position.x, position.y), (260.0, -140.0));

    let after = compute_layout(&doc);
    let moved = after.nodes.iter().find(|n| n.id == first).unwrap();
    assert!((moved.x - prior.x).abs() > 20.0 || (moved.y - prior.y).abs() > 20.0,
        "the topic must actually move on the canvas");
    assert!(after.nodes.iter().any(|n| n.parent_id.as_deref() == Some(first.as_str())),
        "its subtree travels with it");

    // Dropping it back into the tree clears the now-stale absolute offset.
    assert!(ops::move_topic(&mut doc, &first, &root, 0));
    assert!(ops::find(doc.root(), &first).unwrap().position.is_none());
    assert!(doc.root().detached.is_empty());
}

#[test]
fn range_handles_stay_within_one_side_of_the_map() {
    let (mut doc, root, _, _) = tree();
    let layout = compute_layout(&doc);
    let siblings = |side: xmind_core::Side| -> Vec<String> {
        layout.nodes.iter()
            .filter(|n| n.parent_id.as_deref() == Some(root.as_str()) && n.side == side && !n.cell)
            .map(|n| n.id.clone())
            .collect()
    };
    let right = siblings(xmind_core::Side::Right);
    let left = siblings(xmind_core::Side::Left);
    assert!(right.len() >= 2 && !left.is_empty(), "sample document needs both halves");

    let summary = ops::add_summary_with_range(
        &mut doc, &right[0], Some((&right[0], &right[1])), "概要",
    ).unwrap();
    // Document::new never stores `side`; the guard must read it from the layout.
    assert!(doc.root().children.iter().all(|t| t.side.is_none()));

    // A brace can never jump across the central topic.
    assert!(!ops::same_sibling_range(&doc, &right[0], &left[0]));
    assert!(!ops::set_decor_range(&mut doc, "summary", &summary, &right[0], &left[0]));
    let kept = compute_layout(&doc).frames.into_iter()
        .find(|f| f.id == summary).expect("brace still there");
    assert_eq!(kept.start_id, right[0]);
    assert_eq!(kept.end_id, right[1]);

    // Inside one half the two ends may move as long as the run stays legal.
    let third = ops::add_child(&mut doc, &root, "分支 5").unwrap();
    assert!(!third.is_empty());
    let after = compute_layout(&doc);
    let run: Vec<String> = after.nodes.iter()
        .filter(|n| n.parent_id.as_deref() == Some(root.as_str())
            && n.side == xmind_core::Side::Right && !n.cell)
        .map(|n| n.id.clone())
        .collect();
    assert!(run.len() >= 3, "a fifth sibling makes the right half three deep");
    assert!(ops::set_decor_range(&mut doc, "summary", &summary, &run[0], &run[2]));
    let widened = compute_layout(&doc).frames.into_iter().find(|f| f.id == summary).unwrap();
    assert_eq!((widened.start_id.as_str(), widened.end_id.as_str()),
        (run[0].as_str(), run[2].as_str()));
}
