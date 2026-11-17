//! 骨架 is a sheet-level style: five topic levels must all keep the preset's
//! plate, including topics created *after* the preset was applied.
//! Fact source: the 43 `sheet.theme` snapshots extracted from the shipped
//! desktop bundle (`research/skeleton-themes.json`, FINDINGS §38).
use xmind_core::{compute_layout, ops, Document, SkeletonLayer, SkeletonLayers};

fn chain(doc: &mut Document, levels: usize) -> Vec<String> {
    let mut ids = vec![doc.root().id.clone()];
    for i in 0..levels {
        let parent = ids.last().unwrap().clone();
        ids.push(ops::add_child(doc, &parent, &format!("L{}", i + 1)).unwrap());
    }
    ids
}

fn layers(sub_shape: &str, sub_filled: bool) -> SkeletonLayers {
    let plate = |shape: &str, filled: bool| SkeletonLayer {
        shape: shape.into(), filled, border: 0.0,
    };
    SkeletonLayers {
        central: plate("roundedRect", true),
        main: plate("roundedRect", true),
        sub: plate(sub_shape, sub_filled),
    }
}

fn styles(doc: &Document, ids: &[String]) -> Vec<(String, String, bool)> {
    let layout = compute_layout(doc);
    ids.iter()
        .map(|id| {
            let n = layout.nodes.iter().find(|n| &n.id == id).expect("placed topic");
            (n.style.shape.clone(), n.style.fill.clone(), n.style.underline)
        })
        .collect()
}

#[test]
fn mind_map_preset_fills_all_five_levels_even_for_topics_added_later() {
    let mut doc = Document::new("未命名");
    let ids = chain(&mut doc, 4);
    ops::set_skeleton_layers(&mut doc, &layers("roundedRect", true));
    let before = styles(&doc, &ids);
    assert_eq!(before.len(), 5);
    for (depth, (shape, fill, underline)) in before.iter().enumerate() {
        assert_eq!(shape, "roundedRect", "level {depth} shape");
        assert_ne!(fill, "none", "level {depth} must be a filled plate");
        assert!(!underline, "level {depth} must not be an underline");
    }
    // Level 3+ uses the 20% branch wash with darkened ink, not the solid hue.
    assert_ne!(before[1].1, before[2].1);

    // A topic added after the preset was chosen inherits the same sub layer.
    let late = ops::add_child(&mut doc, ids.last().unwrap(), "L5").unwrap();
    let mut all = ids.clone();
    all.push(late);
    let after = styles(&doc, &all);
    assert_eq!(after.len(), 6);
    for row in &after[2..] {
        assert_eq!(row.0, "roundedRect");
        assert_ne!(row.1, "none", "late topics keep their plate");
    }
    assert_eq!(after[5].1, after[4].1, "all depth >= 2 share the sub layer");
}

#[test]
fn underline_preset_keeps_deeper_levels_unfilled() {
    let mut doc = Document::new("未命名");
    let ids = chain(&mut doc, 4);
    ops::set_skeleton_layers(&mut doc, &layers("underline", false));
    let rows = styles(&doc, &ids);
    assert_eq!(rows[0].0, "roundedRect");
    assert_ne!(rows[0].1, "none");
    assert_eq!(rows[1].0, "roundedRect");
    for row in &rows[2..] {
        assert_eq!(row.0, "underline");
        assert_eq!(row.1, "none");
        assert!(row.2, "underline shape must be flagged");
    }
}

#[test]
fn skeleton_layers_are_persisted_on_the_sheet() {
    let mut doc = Document::new("未命名");
    ops::set_skeleton_layers(&mut doc, &layers("roundedRect", true));
    let value = doc.sheet().extra.get(xmind_core::SKELETON_KEY).cloned().unwrap();
    let back = SkeletonLayers::from_value(Some(&value)).expect("roundtrip");
    assert_eq!(back, layers("roundedRect", true));
}
