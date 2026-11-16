//! Branch-connector geometry: XMind's 曲线 must bow, not run straight.
use xmind_core::{compute_layout, Document};

/// Distance of `p` from the segment `a`–`b`.
fn chord_distance(a: (f64, f64), b: (f64, f64), p: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = (dx * dx + dy * dy).sqrt().max(1e-6);
    ((p.0 - a.0) * dy - (p.1 - a.1) * dx).abs() / length
}

/// Parse `M x y C c1x c1y, c2x c2y, x y`.
fn parse_cubic(d: &str) -> Option<[(f64, f64); 4]> {
    let cleaned = d.replace(',', " ");
    let mut it = cleaned.split_whitespace();
    assert_eq!(it.next()?, "M");
    let mut nums = Vec::new();
    for word in it {
        if word == "C" { continue; }
        nums.push(word.parse::<f64>().ok()?);
    }
    if nums.len() != 8 { return None; }
    Some([
        (nums[0], nums[1]),
        (nums[2], nums[3]),
        (nums[4], nums[5]),
        (nums[6], nums[7]),
    ])
}

/// Worst distance of the curve's midpoint from its chord.
fn bow(d: &str) -> f64 {
    let [_p0, c1, c2, p1] = parse_cubic(d).expect("cubic path");
    // The curve at t = 0.5 for a cubic with known end points: sample properly.
    let p0 = parse_cubic(d).unwrap()[0];
    let mut worst = 0.0_f64;
    for step in 1..8 {
        let t = step as f64 / 8.0;
        let u = 1.0 - t;
        let x = u * u * u * p0.0 + 3.0 * u * u * t * c1.0 + 3.0 * u * t * t * c2.0 + t * t * t * p1.0;
        let y = u * u * u * p0.1 + 3.0 * u * u * t * c1.1 + 3.0 * u * t * t * c2.1 + t * t * t * p1.1;
        worst = worst.max(chord_distance(p0, p1, (x, y)));
    }
    worst
}

fn straight_doc() -> Document {
    let mut doc = Document::new("曲线");
    // `Document::new` ships a four-branch sample; these tests want an exact
    // three-branch map so edge counts are unambiguous.
    doc.root_mut().children.clear();
    let root_id = doc.root().id.clone();
    for title in ["上", "中", "下"] {
        xmind_core::add_child(&mut doc, &root_id, title);
    }
    doc
}

#[test]
fn curve_connectors_leave_and_arrive_level() {
    let mut doc = straight_doc();
    // Official rule (FINDINGS §27): a connector's `line-class` / taper switch
    // comes from the *parent* branch.  Set it on the centre topic.
    let root_id = doc.root().id.clone();
    let mut style = xmind_core::TopicStyle::default();
    style.line_class = Some("org.xmind.branchConnection.curve".into());
    style.line_tapered = Some(false);
    xmind_core::set_style(&mut doc, &root_id, style);

    let layout = compute_layout(&doc);
    let edges: Vec<_> = layout.edges.iter().filter(|e| !e.tapered).collect();
    assert_eq!(edges.len(), 3, "three stroked branches");

    let mut bowed = 0;
    for edge in &edges {
        let [p0, c1, c2, p1] = parse_cubic(&edge.path).expect("cubic path");
        let dx = p1.0 - p0.0;
        assert!(dx.abs() > 1.0, "horizontal gap: {dx}");
        // Control points: 0.75 of the gap on the parent side, 0.5 on the child
        // side, each level with the end it belongs to.
        assert!((c1.0 - (p0.0 + dx * 0.75)).abs() < 0.2, "c1.x {}", c1.0);
        assert!((c2.0 - (p1.0 - dx * 0.5)).abs() < 0.2, "c2.x {}", c2.0);
        assert!((c1.1 - p0.1).abs() < 0.2, "level take-off");
        assert!((c2.1 - p1.1).abs() < 0.2, "level touch-down");
        if (p1.1 - p0.1).abs() > 4.0 && bow(&edge.path) > 1.0 {
            bowed += 1;
        }
    }
    assert!(bowed >= 2, "offset branches must visibly bow");
}

#[test]
fn tapered_wedges_keep_a_curved_spine() {
    let mut doc = straight_doc();
    let root_id = doc.root().id.clone();
    let mut style = xmind_core::TopicStyle::default();
    style.line_class = Some("org.xmind.branchConnection.curve".into());
    style.line_tapered = Some(true);
    xmind_core::set_style(&mut doc, &root_id, style);
    let ids: Vec<String> = doc.root().children.iter().map(|t| t.id.clone()).collect();

    let layout = compute_layout(&doc);
    let tapered: Vec<_> = layout.edges.iter().filter(|e| ids.contains(&e.to)).collect();
    assert_eq!(tapered.len(), 3);
    for edge in &tapered {
        assert!(edge.tapered, "line-tapered must produce a wedge");
        assert!(edge.path.ends_with('Z'), "closed wedge outline");
        // The outline is sampled along the spine, so it is far longer than the
        // four-point triangle a straight branch would emit.
        assert!(edge.path.len() > 120, "sampled spine, not a bare line");
    }
}

fn layer(class: &str) -> xmind_core::TopicStyle {
    let mut style = xmind_core::TopicStyle::default();
    style.line_class = Some(format!("org.xmind.branchConnection.{class}"));
    style.line_pattern = Some("solid".into());
    style.line_width = Some("2pt".into());
    style
}

/// Regression for "切换骨架时第二级及以下的线条样式不会发生变化": a shipped
/// preset is a three-layer theme (central / main / **sub**) and the parent
/// branch is the one that supplies each connector's line shape.
#[test]
fn skeleton_layers_reach_every_level() {
    let mut doc = xmind_core::Document::new("三层");
    doc.root_mut().children.clear();
    let root_id = doc.root().id.clone();
    let a = xmind_core::add_child(&mut doc, &root_id, "A").unwrap();
    let b = xmind_core::add_child(&mut doc, &a, "B").unwrap();
    let c = xmind_core::add_child(&mut doc, &b, "C").unwrap();

    xmind_core::apply_skeleton_styles(
        &mut doc, &layer("straight"), &layer("fold"), &layer("roundedfold"), Some(false),
    );
    let deep = doc.root().children[0].children[0].children[0].style.as_ref().unwrap();
    assert_eq!(deep.line_class.as_deref(), Some("org.xmind.branchConnection.roundedfold"));
    assert_eq!(deep.line_tapered, Some(false));

    let layout = compute_layout(&doc);
    let edge_to = |id: &str| layout.edges.iter().find(|e| e.to == id).expect("connector");
    // root → A uses the central layer, A → B the main layer, B → C the sub
    // layer.  A plain fold has no quadratic knee; a roundedfold does.
    let e_a = edge_to(&a);
    assert!(!e_a.path.contains('Q') && !e_a.path.contains('C'), "straight: {}", e_a.path);
    let e_b = edge_to(&b);
    assert!(!e_b.path.contains('Q') && e_b.path.contains('L'), "fold: {}", e_b.path);
    let e_c = edge_to(&c);
    assert!(e_c.path.contains('Q'), "roundedfold: {}", e_c.path);
    assert!(layout.edges.iter().all(|e| !e.tapered), "none/tapered switch is global");
}

/// A child's own `line-class` must not override the connector leaving its
/// parent (official `AbstractStructure.getAttachedConnectionInfo`).
#[test]
fn connector_shape_comes_from_the_parent_layer() {
    let mut doc = straight_doc();
    let root_id = doc.root().id.clone();
    xmind_core::set_style(&mut doc, &root_id, layer("straight"));
    let ids: Vec<String> = doc.root().children.iter().map(|t| t.id.clone()).collect();
    for id in &ids {
        xmind_core::set_style(&mut doc, id, layer("roundedElbow"));
    }
    let mut root_style = xmind_core::TopicStyle::default();
    root_style.line_tapered = Some(false);
    xmind_core::set_style(&mut doc, &root_id, root_style);

    let layout = compute_layout(&doc);
    assert_eq!(layout.edges.len(), 3);
    for edge in &layout.edges {
        assert!(!edge.tapered);
        assert!(!edge.path.contains('Q') && !edge.path.contains('C'), "{}", edge.path);
    }
}

/// Switching from a hand-drawn preset to a plain one must not leave the old
/// dash pattern or taper switch behind.
#[test]
fn skeleton_switch_clears_stale_line_pattern() {
    let mut doc = straight_doc();
    let id = doc.root().children[0].id.clone();
    let mut stale = xmind_core::TopicStyle::default();
    stale.line_pattern = Some("handdrawn-dash".into());
    stale.line_tapered = Some(true);
    xmind_core::set_style(&mut doc, &id, stale);

    xmind_core::apply_skeleton_styles(
        &mut doc, &layer("curve"), &layer("curve"), &layer("curve"), Some(false),
    );
    let style = doc.root().children[0].style.as_ref().unwrap();
    assert_eq!(style.line_pattern.as_deref(), Some("solid"));
    assert_eq!(style.line_tapered, Some(false));
    let layout = compute_layout(&doc);
    assert!(layout.edges.iter().all(|e| e.dash.is_none() && !e.tapered));
}

/// The desktop bundle contains `branchConnection.brace / fish / matrix /
/// timeline / none / arrowedCurve` classes the 43 presets never use.  They
/// must not silently degrade into the generic calibrated curve.
#[test]
fn structural_line_classes_get_their_own_geometry() {
    let mut seen: Vec<String> = Vec::new();
    for class in ["brace", "brace3", "fish", "matrix", "timeline", "arrowedCurve"] {
        let mut doc = straight_doc();
        let root_id = doc.root().id.clone();
        let mut style = layer(class);
        style.line_tapered = Some(false);
        xmind_core::set_style(&mut doc, &root_id, style);
        let layout = compute_layout(&doc);
        assert_eq!(layout.edges.len(), 3, "{class} should draw all three branches");
        assert!(layout.edges.iter().all(|e| !e.tapered), "{class} must stay stroked");
        if class == "arrowedCurve" {
            assert!(layout.edges.iter().all(|e| e.arrow == "triangle"));
            assert!(layout.edges[0].path.contains('C'), "arrowed curve keeps its cubic spine");
        }
        seen.push(layout.edges[0].path.clone());
    }
    // Every structural shape differs from its neighbours — in particular the
    // brace variants must not collapse into one path.
    for pair in seen.windows(2) {
        assert_ne!(pair[0], pair[1], "structural classes must be distinguishable");
    }
    assert_ne!(seen[0], seen[1], "brace vs brace3 bend differs");

    let mut doc = straight_doc();
    let root_id = doc.root().id.clone();
    xmind_core::set_style(&mut doc, &root_id, layer("none"));
    assert!(compute_layout(&doc).edges.is_empty(), "`none` draws no connectors");
}
