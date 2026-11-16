//! Folding must actually hide the collapsed branches in EVERY structure, not
//! just flip a flag in the model. The balanced/map path places the root's
//! children by hand, which used to bypass `place_horizontal`'s folded check.
use xmind_core::{compute_layout, ops, Document, Structure};

fn tree() -> (Document, String, String, String) {
    let mut doc = Document::new("中心主题");
    let root = doc.root().id.clone();
    let first = ops::add_child(&mut doc, &root, "分支 1").unwrap();
    let second = ops::add_child(&mut doc, &root, "分支 2").unwrap();
    let grandchild = ops::add_child(&mut doc, &first, "子主题").unwrap();
    let _ = second;
    (doc, root, first, grandchild)
}

#[test]
fn folding_the_central_topic_hides_every_branch() {
    let (mut doc, root, _, _) = tree();
    let visible = compute_layout(&doc).nodes.len();
    let hidden: usize = visible - 1;
    assert!(visible > 2, "expected a real tree, got {visible} nodes");

    assert!(ops::toggle_fold(&mut doc, &root));
    let folded = compute_layout(&doc);
    assert_eq!(folded.nodes.len(), 1, "only the central topic may remain");
    assert!(folded.nodes[0].folded);
    // XMind's collapsed disc counts the whole hidden subtree (2 branches + 1
    // grandchild here), not just the direct children.
    assert_eq!(folded.nodes[0].hidden_count, hidden);
    assert!(folded.edges.is_empty(), "no connector to a hidden branch");

    assert!(ops::set_fold(&mut doc, &root, false));
    assert_eq!(compute_layout(&doc).nodes.len(), visible);
}

#[test]
fn folding_a_branch_hides_its_own_children_only() {
    let (mut doc, _, first, grandchild) = tree();
    assert!(ops::toggle_fold(&mut doc, &first));
    let layout = compute_layout(&doc);
    assert!(layout.nodes.iter().any(|n| n.id == first && n.folded));
    assert!(!layout.nodes.iter().any(|n| n.id == grandchild));
    assert!(layout.nodes.iter().any(|n| n.depth == 0));
}

#[test]
fn folding_works_in_matrix_and_table_structures() {
    for structure in [Structure::Matrix, Structure::TreeTable] {
        let (mut doc, root, _, _) = tree();
        doc.set_structure(structure);
        let before = compute_layout(&doc).nodes.len();
        assert!(ops::toggle_fold(&mut doc, &root));
        let after = compute_layout(&doc).nodes.len();
        assert_eq!(after, 1, "{structure:?}: folding left {after} nodes (was {before})");
    }
}
