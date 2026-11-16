//! Tree editing operations. The Rust-side document is the single source of
//! truth; the WebView only sends intent and receives a fresh layout.

use crate::{Document, Position, Sheet, Side, Structure, Topic, TopicStyle};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// All four child groups XMind stores under `children`:
/// attached (normal branches), detached (floating topics), summary, callout.
pub fn child_groups(topic: &Topic) -> impl Iterator<Item = &Topic> {
    topic
        .children
        .iter()
        .chain(topic.detached.iter())
        .chain(topic.summary.iter())
        .chain(topic.callout.iter())
}

fn child_groups_mut(topic: &mut Topic) -> [&mut Vec<Topic>; 4] {
    [
        &mut topic.children,
        &mut topic.detached,
        &mut topic.summary,
        &mut topic.callout,
    ]
}

pub fn find<'a>(root: &'a Topic, id: &str) -> Option<&'a Topic> {
    if root.id == id {
        return Some(root);
    }
    child_groups(root).find_map(|child| find(child, id))
}

pub fn find_mut<'a>(root: &'a mut Topic, id: &str) -> Option<&'a mut Topic> {
    if root.id == id {
        return Some(root);
    }
    for group in child_groups_mut(root) {
        if let Some(found) = group.iter_mut().find_map(|child| find_mut(child, id)) {
            return Some(found);
        }
    }
    None
}

pub fn parent_id_of(root: &Topic, id: &str) -> Option<String> {
    for child in child_groups(root) {
        if child.id == id {
            return Some(root.id.clone());
        }
        if let Some(found) = parent_id_of(child, id) {
            return Some(found);
        }
    }
    None
}

/// Detach a topic from whichever group holds it. Floating topics live in
/// `detached`, not `children`, so a plain `children.retain` would lose them.
fn detach_from_parent(doc: &mut Document, id: &str) -> Option<Topic> {
    let parent_id = parent_id_of(doc.root(), id)?;
    let parent = find_mut(doc.root_mut(), &parent_id)?;
    for group in child_groups_mut(parent) {
        if let Some(position) = group.iter().position(|child| child.id == id) {
            return Some(group.remove(position));
        }
    }
    None
}

pub fn parent_mut<'a>(root: &'a mut Topic, id: &str) -> Option<&'a mut Topic> {
    let parent = parent_id_of(root, id)?;
    find_mut(root, &parent)
}

pub fn path_to(root: &Topic, id: &str) -> Vec<String> {
    fn walk(node: &Topic, id: &str, acc: &mut Vec<String>) -> bool {
        acc.push(node.title.clone());
        if node.id == id {
            return true;
        }
        for child in child_groups(node) {
            if walk(child, id, acc) {
                return true;
            }
        }
        acc.pop();
        false
    }
    let mut acc = Vec::new();
    walk(root, id, &mut acc);
    acc
}

pub fn add_child(doc: &mut Document, parent_id: &str, title: &str) -> Option<String> {
    let root = doc.root_mut();
    let parent = find_mut(root, parent_id)?;
    let child = Topic::new(title);
    let id = child.id.clone();
    parent.folded = false;
    parent.children.push(child);
    Some(id)
}

pub fn add_sibling(doc: &mut Document, id: &str, title: &str) -> Option<String> {
    let root = doc.root_mut();
    if root.id == id {
        let child = Topic::new(title);
        let new_id = child.id.clone();
        root.children.push(child);
        return Some(new_id);
    }
    let parent = parent_id_of(root, id)?;
    let node = find_mut(root, &parent)?;
    let child = Topic::new(title);
    let new_id = child.id.clone();
    for group in child_groups_mut(node) {
        if let Some(index) = group.iter().position(|c| c.id == id) {
            group.insert(index + 1, child);
            return Some(new_id);
        }
    }
    None
}

/// Locate a child inside one of a parent's four groups.
fn slot_of(parent: &Topic, id: &str) -> Option<(usize, usize)> {
    let groups = [&parent.children, &parent.detached, &parent.summary, &parent.callout];
    groups.iter().enumerate().find_map(|(g, group)| {
        group.iter().position(|child| child.id == id).map(|pos| (g, pos))
    })
}

/** Insert a sibling *before* `id` (XMind's Shift+Enter / 主题（之前）). */
pub fn add_sibling_before(doc: &mut Document, id: &str, title: &str) -> Option<String> {
    let root = doc.root_mut();
    if root.id == id {
        let child = Topic::new(title);
        let new_id = child.id.clone();
        root.children.insert(0, child);
        return Some(new_id);
    }
    let parent_id = parent_id_of(root, id)?;
    let parent = find_mut(root, &parent_id)?;
    let child = Topic::new(title);
    let new_id = child.id.clone();
    for group in child_groups_mut(parent) {
        if let Some(index) = group.iter().position(|c| c.id == id) {
            group.insert(index, child);
            return Some(new_id);
        }
    }
    None
}

/** Wrap `id` in a fresh parent topic (XMind's Ctrl+Enter / 父主题). */
pub fn insert_parent(doc: &mut Document, id: &str, title: &str) -> Option<String> {
    if doc.root().id == id {
        return None;
    }
    let parent_id = parent_id_of(doc.root(), id)?;
    let (group_index, position) = slot_of(find(doc.root(), &parent_id)?, id)?;
    let parent = find_mut(doc.root_mut(), &parent_id)?;
    let groups = child_groups_mut(parent);
    let topic = groups[group_index].remove(position);
    let mut wrapper = Topic::new(title);
    let wrapper_id = wrapper.id.clone();
    wrapper.folded = false;
    wrapper.children.push(topic);
    groups[group_index].insert(position, wrapper);
    Some(wrapper_id)
}

/** A free-floating topic (or a 标注 callout) placed relative to the centre. */
pub fn add_floating(doc: &mut Document, x: f64, y: f64, title: &str, callout: bool) -> Option<String> {
    let mut topic = Topic::new(title);
    topic.position = Some(Position { x, y });
    let id = topic.id.clone();
    let root = doc.root_mut();
    if callout {
        root.callout.push(topic);
    } else {
        root.detached.push(topic);
    }
    Some(id)
}

fn clone_with_new_ids(topic: &Topic) -> Topic {
    let mut copy = topic.clone();
    copy.id = crate::new_id();
    for group in [&mut copy.children, &mut copy.detached, &mut copy.summary, &mut copy.callout] {
        for child in group.iter_mut() {
            *child = clone_with_new_ids(child);
        }
    }
    copy
}

/** Duplicate a topic together with its whole subtree (Ctrl+D / 复制). */
pub fn duplicate_topic(doc: &mut Document, id: &str) -> Option<String> {
    if doc.root().id == id {
        return None;
    }
    let original = find(doc.root(), id)?.clone();
    let copy = clone_with_new_ids(&original);
    let new_id = copy.id.clone();
    let parent_id = parent_id_of(doc.root(), id)?;
    let parent = find_mut(doc.root_mut(), &parent_id)?;
    for group in child_groups_mut(parent) {
        if let Some(index) = group.iter().position(|c| c.id == id) {
            group.insert(index + 1, copy);
            return Some(new_id);
        }
    }
    None
}

/** Delete *only* the topic: its attached children move up into its slot. */
pub fn delete_single(doc: &mut Document, id: &str) -> bool {
    if doc.root().id == id {
        return false;
    }
    let Some(parent_id) = parent_id_of(doc.root(), id) else { return false };
    let Some((group_index, position)) = slot_of(
        find(doc.root(), &parent_id).unwrap_or(doc.root()), id,
    ) else { return false };
    let taken = {
        let Some(parent) = find_mut(doc.root_mut(), &parent_id) else { return false };
        let groups = child_groups_mut(parent);
        groups[group_index].remove(position)
    };
    let mut removed = taken;
    let children = std::mem::take(&mut removed.children);
    let detached = std::mem::take(&mut removed.detached);
    let summaries = std::mem::take(&mut removed.summary);
    let callouts = std::mem::take(&mut removed.callout);
    {
        let Some(parent) = find_mut(doc.root_mut(), &parent_id) else { return false };
        let groups = child_groups_mut(parent);
        for (offset, child) in children.into_iter().enumerate() {
            groups[group_index].insert(position + offset, child);
        }
    }
    let root = doc.root_mut();
    root.detached.extend(detached);
    root.summary.extend(summaries);
    root.callout.extend(callouts);
    true
}

/** 缩进: become the last child of the previous sibling. */
pub fn indent(doc: &mut Document, id: &str) -> bool {
    if doc.root().id == id {
        return false;
    }
    let Some(parent_id) = parent_id_of(doc.root(), id) else { return false };
    let Some((group_index, position)) = slot_of(
        find(doc.root(), &parent_id).unwrap_or(doc.root()), id,
    ) else { return false };
    if position == 0 || group_index != 0 {
        return false;
    }
    let previous_id = {
        let Some(parent) = find(doc.root(), &parent_id) else { return false };
        parent.children[position - 1].id.clone()
    };
    let Some(topic) = detach_from_parent(doc, id) else { return false };
    let Some(previous) = find_mut(doc.root_mut(), &previous_id) else { return false };
    previous.folded = false;
    previous.children.push(topic);
    true
}

/** 减少缩进: become the next sibling of the current parent. */
pub fn outdent(doc: &mut Document, id: &str) -> bool {
    let Some(parent_id) = parent_id_of(doc.root(), id) else { return false };
    if parent_id == doc.root().id {
        return false;
    }
    let Some(grand_id) = parent_id_of(doc.root(), &parent_id) else { return false };
    let Some((group_index, position)) = slot_of(
        find(doc.root(), &grand_id).unwrap_or(doc.root()), &parent_id,
    ) else { return false };
    let Some(topic) = detach_from_parent(doc, id) else { return false };
    let Some(grand) = find_mut(doc.root_mut(), &grand_id) else { return false };
    let groups = child_groups_mut(grand);
    let at = (position + 1).min(groups[group_index].len());
    groups[group_index].insert(at, topic);
    true
}

fn has_children(topic: &Topic) -> bool {
    !topic.children.is_empty()
        || !topic.detached.is_empty()
        || !topic.summary.is_empty()
        || !topic.callout.is_empty()
}

/** 折叠/展开所有子分支. The central topic itself is never folded. */
pub fn set_fold_all(doc: &mut Document, folded: bool) {
    fn walk(topic: &mut Topic, folded: bool, is_root: bool) {
        if !is_root && has_children(topic) {
            topic.folded = folded;
        }
        for group in child_groups_mut(topic) {
            for child in group.iter_mut() {
                walk(child, folded, false);
            }
        }
    }
    walk(doc.root_mut(), folded, true);
}

/** 仅显示该分支: fold every branch except the path to `id`. */
pub fn focus_branch(doc: &mut Document, id: &str) -> bool {
    fn path(topic: &Topic, id: &str, acc: &mut Vec<String>) -> bool {
        acc.push(topic.id.clone());
        if topic.id == id {
            return true;
        }
        for child in child_groups(topic) {
            if path(child, id, acc) {
                return true;
            }
        }
        acc.pop();
        false
    }
    let mut chain = Vec::new();
    if !path(doc.root(), id, &mut chain) {
        return false;
    }
    let keep: HashSet<String> = chain.into_iter().collect();
    fn walk(topic: &mut Topic, keep: &HashSet<String>, is_root: bool) {
        if !is_root && has_children(topic) {
            topic.folded = !keep.contains(&topic.id);
        }
        for group in child_groups_mut(topic) {
            for child in group.iter_mut() {
                walk(child, keep, false);
            }
        }
    }
    walk(doc.root_mut(), &keep, true);
    true
}

/** New canvas whose centre is a fresh-id copy of the selected subtree. */
pub fn add_sheet_from_topic(doc: &mut Document, id: &str) -> Option<usize> {
    let source = clone_with_new_ids(find(doc.root(), id)?);
    let index = doc.sheets.len();
    let title = source.title.clone();
    doc.sheets.push(Sheet {
        id: crate::new_id(),
        title,
        root: source,
        structure: Structure::Clockwise,
        extra: Default::default(),
    });
    doc.active_sheet = index;
    Some(index)
}

pub fn delete(doc: &mut Document, id: &str) -> bool {
    if doc.root().id == id {
        return false;
    }
    detach_from_parent(doc, id).is_some()
}

pub fn rename(doc: &mut Document, id: &str, title: &str) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.title = title.to_string();
            topic.title_unedited = false;
            true
        }
        None => false,
    }
}

pub fn set_note(doc: &mut Document, id: &str, note: &str) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.note = note.to_string();
            true
        }
        None => false,
    }
}

pub fn set_labels(doc: &mut Document, id: &str, labels: Vec<String>) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.labels = labels;
            true
        }
        None => false,
    }
}

pub fn toggle_marker(doc: &mut Document, id: &str, marker: &str) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            if let Some(index) = topic.markers.iter().position(|m| m == marker) {
                topic.markers.remove(index);
            } else {
                topic.markers.push(marker.to_string());
            }
            true
        }
        None => false,
    }
}

pub fn set_href(doc: &mut Document, id: &str, href: Option<String>) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.href = href;
            true
        }
        None => false,
    }
}

pub fn set_position(doc: &mut Document, id: &str, position: Option<Position>) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.position = position;
            true
        }
        None => false,
    }
}

pub fn set_style(doc: &mut Document, id: &str, patch: TopicStyle) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            let mut style = topic.style.clone().unwrap_or_default();
            style.merge(&patch);
            topic.style = Some(style);
            true
        }
        None => false,
    }
}

pub fn clear_style(doc: &mut Document, id: &str) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.style = None;
            true
        }
        None => false,
    }
}

/// Apply a three-layer 骨架 preset to the attached topic tree.
///
/// A shipped skeleton is not just a layout: its theme has `centralTopic`,
/// `mainTopic` **and** `subTopic` layers.  The official viewer resolves a
/// connector's `line-class` / `line-width` from the *parent* branch
/// (`AbstractStructure.getAttachedConnectionInfo` → `startBranch`), so every
/// level has to carry its own layer.  Writing only the centre and the first
/// level is what used to leave level 2+ connectors on the built-in curve.
///
/// Floating / summary / callout topics keep their own theme layers and are
/// deliberately not touched here.
pub fn apply_skeleton_styles(
    doc: &mut Document,
    central: &TopicStyle,
    main: &TopicStyle,
    sub: &TopicStyle,
    tapered: Option<bool>,
) {
    fn patch(topic: &mut Topic, layer: &TopicStyle, tapered: Option<bool>) {
        let mut style = topic.style.clone().unwrap_or_default();
        style.merge(layer);
        if let Some(value) = tapered {
            style.line_tapered = Some(value);
        }
        topic.style = Some(style);
    }
    fn walk(topic: &mut Topic, layer: &TopicStyle, tapered: Option<bool>) {
        patch(topic, layer, tapered);
        for child in &mut topic.children {
            walk(child, layer, tapered);
        }
    }
    let root = doc.root_mut();
    patch(root, central, tapered);
    for child in &mut root.children {
        patch(child, main, tapered);
        for grandchild in &mut child.children {
            walk(grandchild, sub, tapered);
        }
    }
}

pub fn set_side(doc: &mut Document, id: &str, side: Option<Side>) -> bool {
    let root = doc.root_mut();
    let is_root_child = root.children.iter().any(|child| child.id == id);
    if !is_root_child {
        return false;
    }
    match find_mut(root, id) {
        Some(topic) => {
            topic.side = side;
            true
        }
        None => false,
    }
}

pub fn set_image(doc: &mut Document, id: &str, resource: Option<String>) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.image = resource;
            true
        }
        None => false,
    }
}

pub fn toggle_fold(doc: &mut Document, id: &str) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) if !topic.children.is_empty() => {
            topic.folded = !topic.folded;
            true
        }
        _ => false,
    }
}

pub fn set_fold(doc: &mut Document, id: &str, folded: bool) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            topic.folded = folded && !topic.children.is_empty();
            true
        }
        None => false,
    }
}

/// Reparent a subtree; destination is validated before detaching so a failed
/// move can never lose a branch.
pub fn move_topic(doc: &mut Document, id: &str, new_parent_id: &str, index: usize) -> bool {
    {
        let root = doc.root();
        if id == new_parent_id || root.id == id {
            return false;
        }
        let Some(source) = find(root, id) else { return false };
        if find(source, new_parent_id).is_some() {
            return false; // new parent is inside the subtree being moved
        }
        if find(root, new_parent_id).is_none() {
            return false;
        }
    }
    let Some(mut detached) = detach_from_parent(doc, id) else { return false };
    // A floating topic that is dragged back into the tree must lose its old
    // absolute offset, or re-floating it later would snap back.
    detached.position = None;
    let target = find_mut(doc.root_mut(), new_parent_id).expect("validated above");
    let at = index.min(target.children.len());
    target.children.insert(at, detached);
    target.folded = false;
    true
}

/// Drop a topic on empty canvas: XMind turns it into a floating topic whose
/// `position` is an offset from the central topic's centre. The whole subtree
/// travels with it, and a floating topic can be dropped again to reposition.
pub fn move_to_free_position(doc: &mut Document, id: &str, x: f64, y: f64) -> bool {
    if doc.root().id == id || find(doc.root(), id).is_none() {
        return false;
    }
    let Some(mut topic) = detach_from_parent(doc, id) else { return false };
    topic.position = Some(Position { x, y });
    doc.root_mut().detached.push(topic);
    true
}

// ---------------------------------------------------------------------------
// Decor objects: 联系 (relationships), 外框 (boundaries) and 概要 (summaries).
// Relationships and boundaries are stored under XMind's own sheet-level keys
// inside `extra`, so real .xmind files round-trip unchanged and our own files
// stay readable by XMind. A 概要 is a real topic in the *parent's*
// `children.summary`, registered by a `summaries[]` entry on that same parent
// with a literal sibling-index `range: "(a,b)"` and its `topicId`.  Older files
// written by this app used `topic.extra.summaryRange`; those are still read.
// ---------------------------------------------------------------------------

fn extra_array<'a>(extra: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    let entry = extra.entry(key.to_string()).or_insert_with(|| Value::Array(Vec::new()));
    if !entry.is_array() {
        *entry = Value::Array(Vec::new());
    }
    entry.as_array_mut().expect("array inserted above")
}

fn decor_object<'a>(extra: &'a mut Map<String, Value>, key: &str, id: &str) -> Option<&'a mut Value> {
    extra_array(extra, key)
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
}

/// Inclusive sibling range a 外框 / 概要 wraps. A topic with children covers
/// its own children; a leaf covers itself and its siblings.
pub fn decor_range(root: &Topic, anchor: &str) -> Option<(String, String)> {
    let topic = find(root, anchor)?;
    let group = if !topic.children.is_empty() {
        &topic.children
    } else {
        let parent_id = parent_id_of(root, anchor)?;
        &find(root, &parent_id)?.children
    };
    if group.is_empty() {
        return Some((anchor.to_string(), anchor.to_string()));
    }
    Some((group.first()?.id.clone(), group.last()?.id.clone()))
}

pub fn add_relationship(doc: &mut Document, from: &str, to: &str, title: &str) -> Option<String> {
    if from == to || from.is_empty() || to.is_empty() {
        return None;
    }
    if find(doc.root(), from).is_none() || find(doc.root(), to).is_none() {
        return None;
    }
    let id = crate::new_id();
    extra_array(&mut doc.sheet_mut().extra, "relationships").push(json!({
        "id": id,
        "end1Id": from,
        "end2Id": to,
        "title": title,
    }));
    Some(id)
}

/// An explicit selection wins over the single-topic fallback, but only when
/// both ends are real siblings (same parent) — XMind's 概要/外框 ranges are
/// always inclusive sibling ranges on one branch of the map.
fn resolve_range(
    root: &Topic,
    anchor: &str,
    range: Option<(&str, &str)>,
) -> Option<(String, String)> {
    if let Some((start, end)) = range {
        if find(root, start).is_some()
            && find(root, end).is_some()
            && parent_id_of(root, start).is_some()
            && parent_id_of(root, start) == parent_id_of(root, end)
        {
            return Some((start.to_string(), end.to_string()));
        }
    }
    decor_range(root, anchor)
}

pub fn add_boundary_with_range(
    doc: &mut Document,
    anchor: &str,
    range: Option<(&str, &str)>,
    title: &str,
) -> Option<String> {
    let (start_id, end_id) = resolve_range(doc.root(), anchor, range)?;
    let id = crate::new_id();
    extra_array(&mut doc.sheet_mut().extra, "boundaries").push(json!({
        "id": id,
        "range": { "startId": start_id, "endId": end_id },
        "title": title,
    }));
    Some(id)
}

/// XMind writes `summaries[].range` as a *literal* index pair into the
/// parent's `children.attached` array, e.g. `"(0,1)"`, not topic ids.
fn sibling_indices(parent: &Topic, start: &str, end: &str) -> Option<(usize, usize)> {
    let a = parent.children.iter().position(|t| t.id == start)?;
    let b = parent.children.iter().position(|t| t.id == end)?;
    Some((a.min(b), a.max(b)))
}

/// Parents whose native `summaries[]` table registers a given 概要 topic.
fn native_summary_parents(topic: &Topic, id: &str, out: &mut Vec<String>) {
    if let Some(list) = topic.extra.get("summaries").and_then(Value::as_array) {
        if list.iter().any(|item| item.get("topicId").and_then(Value::as_str) == Some(id)) {
            out.push(topic.id.clone());
        }
    }
    for child in child_groups(topic) {
        native_summary_parents(child, id, out);
    }
}

/// Drop a 概要's registration as well as the topic itself, otherwise XMind
/// keeps an empty brace pointing at a topic that no longer exists.
fn remove_summary_refs(topic: &mut Topic, id: &str) {
    if let Some(list) = topic.extra.get_mut("summaries").and_then(Value::as_array_mut) {
        list.retain(|item| item.get("topicId").and_then(Value::as_str) != Some(id));
    }
    let empty = topic.extra.get("summaries")
        .and_then(Value::as_array).is_some_and(|list| list.is_empty());
    if empty {
        topic.extra.remove("summaries");
    }
    for group in child_groups_mut(topic) {
        for child in group.iter_mut() {
            remove_summary_refs(child, id);
        }
    }
}

pub fn add_summary_with_range(
    doc: &mut Document,
    anchor: &str,
    range: Option<(&str, &str)>,
    title: &str,
) -> Option<String> {
    let (start_id, end_id) = resolve_range(doc.root(), anchor, range)?;
    // The brace belongs to the *parent* of the selected siblings, not to the
    // central topic.  XMind reads `summaries[]` off that parent and looks the
    // topic up in its `children.summary`.
    let parent_id = parent_id_of(doc.root(), &start_id)?;
    let (a, b) = sibling_indices(find(doc.root(), &parent_id)?, &start_id, &end_id)?;
    let topic = Topic::new(title);
    let id = topic.id.clone();
    let parent = find_mut(doc.root_mut(), &parent_id)?;
    {
        let list = extra_array(&mut parent.extra, "summaries");
        list.push(json!({
            "id": crate::new_id(),
            "range": format!("({a},{b})"),
            "topicId": id.clone(),
            // XMind's own "insert 概要" writes the brace shape here; without
            // it the app falls back to the theme's square brace.
            "style": {
                "id": crate::new_id(),
                "properties": { "shape-class": "org.xmind.summaryShape.curly" },
            },
        }));
    }
    parent.summary.push(topic);
    Some(id)
}

pub fn add_boundary(doc: &mut Document, anchor: &str, title: &str) -> Option<String> {
    add_boundary_with_range(doc, anchor, None, title)
}

pub fn add_summary(doc: &mut Document, anchor: &str, title: &str) -> Option<String> {
    add_summary_with_range(doc, anchor, None, title)
}

fn collect_legacy_summary_topics(topic: &Topic, out: &mut Vec<Topic>) {
    for child in child_groups(topic) {
        if child.extra.contains_key("summaryRange") {
            out.push(child.clone());
        }
        collect_legacy_summary_topics(child, out);
    }
}

/// Upgrade 概要 topics written by older builds of this app.  They carried a
/// private `extra.summaryRange = {startId,endId}` and were parked under the
/// central topic, so the original XMind never drew them.  On load we move each
/// one to the parent that owns the covered siblings and register it in that
/// parent's native `summaries[]` table.  Files without the private key are
/// left byte-for-byte untouched.
pub fn migrate_legacy_summaries(doc: &mut Document) -> usize {
    let mut legacy = Vec::new();
    collect_legacy_summary_topics(doc.root(), &mut legacy);
    if legacy.is_empty() {
        return 0;
    }
    let mut planned = Vec::new();
    let mut ids = HashSet::new();
    for topic in legacy {
        let Some(range) = topic.extra.get("summaryRange") else { continue };
        let start = range.get("startId").and_then(Value::as_str).unwrap_or_default().to_string();
        let end = range.get("endId").and_then(Value::as_str).unwrap_or_default().to_string();
        let Some(parent_id) = parent_id_of(doc.root(), &start) else { continue };
        if parent_id_of(doc.root(), &end).as_deref() != Some(parent_id.as_str()) {
            continue;
        }
        let Some((a, b)) = find(doc.root(), &parent_id)
            .and_then(|parent| sibling_indices(parent, &start, &end)) else { continue };
        ids.insert(topic.id.clone());
        planned.push((parent_id, a, b, topic));
    }
    if planned.is_empty() {
        return 0;
    }
    for id in &ids {
        remove_topic_by_id(doc.root_mut(), id);
    }
    let mut count = 0;
    for (parent_id, a, b, mut topic) in planned {
        topic.extra.remove("summaryRange");
        let id = topic.id.clone();
        let Some(parent) = find_mut(doc.root_mut(), &parent_id) else { continue };
        {
            let list = extra_array(&mut parent.extra, "summaries");
            list.push(json!({
                "id": crate::new_id(),
                "range": format!("({a},{b})"),
                "topicId": id,
                "style": {
                    "id": crate::new_id(),
                    "properties": { "shape-class": "org.xmind.summaryShape.curly" },
                },
            }));
        }
        parent.summary.push(topic);
        count += 1;
    }
    count
}

/// Whether two topics form a legal 外框 / 概要 range: real siblings that sit on
/// the same side of the map.
///
/// `Topic::side` is *not* trustworthy here: XMind usually omits it for the
/// children of the central topic and lets the layout split the two halves, so
/// the side has to come from the laid-out node (a brace would otherwise jump
/// across the centre).
pub fn same_sibling_range(doc: &Document, start: &str, end: &str) -> bool {
    let root = doc.root();
    let (Some(first), Some(last)) = (find(root, start), find(root, end)) else {
        return false;
    };
    match (parent_id_of(root, start), parent_id_of(root, end)) {
        (Some(left), Some(right)) if left == right => {
            let layout = crate::compute_layout(doc);
            let side_of = |id: &str| {
                layout.nodes.iter().find(|node| node.id == id).map(|node| node.side)
            };
            match (side_of(start), side_of(end)) {
                (Some(left), Some(right)) => left == right,
                _ => first.side == last.side,
            }
        }
        _ => false,
    }
}

/// Move the ends of an existing 外框 / 概要 (XMind's `summary-resize-handle-*`).
/// The two ends must stay siblings on the same side of the map, otherwise the
/// brace would have to jump across the central topic.
pub fn set_decor_range(doc: &mut Document, kind: &str, id: &str, start: &str, end: &str) -> bool {
    if !same_sibling_range(doc, start, end) {
        return false;
    }
    match kind {
        "summary" => {
            // Native files: the range lives on the parent, as literal indices.
            let mut parents = Vec::new();
            native_summary_parents(doc.root(), id, &mut parents);
            if !parents.is_empty() {
                let mut updated = false;
                for parent_id in parents {
                    let Some((a, b)) = find(doc.root(), &parent_id)
                        .and_then(|p| sibling_indices(p, start, end)) else { continue };
                    let Some(parent) = find_mut(doc.root_mut(), &parent_id) else { continue };
                    let Some(list) = parent.extra.get_mut("summaries").and_then(Value::as_array_mut) else { continue };
                    for item in list.iter_mut()
                        .filter(|it| it.get("topicId").and_then(Value::as_str) == Some(id))
                    {
                        if let Some(object) = item.as_object_mut() {
                            object.insert("range".into(), json!(format!("({a},{b})")));
                            updated = true;
                        }
                    }
                }
                return updated;
            }
            // Legacy self-made documents keep the range on the 概要 topic.
            let root = doc.root_mut();
            let Some(topic) = find_mut(root, id) else { return false };
            let Some(range) = topic.extra.get("summaryRange") else { return false };
            let anchor = range
                .get("anchorId")
                .and_then(Value::as_str)
                .unwrap_or(start)
                .to_string();
            topic.extra.insert(
                "summaryRange".into(),
                json!({ "startId": start, "endId": end, "anchorId": anchor }),
            );
            true
        }
        "boundary" => {
            let Some(value) = decor_object(&mut doc.sheet_mut().extra, "boundaries", id) else {
                return false;
            };
            let Some(object) = value.as_object_mut() else { return false };
            object.insert("range".into(), json!({ "startId": start, "endId": end }));
            true
        }
        _ => false,
    }
}

/// Restyle a native 概要 brace.  XMind keeps the brace shape, ink and width on
/// the *parent's* `summaries[]` entry under `style.properties`; the layout only
/// reads that table, so writing the values anywhere else would be lost on the
/// next layout or save.
pub fn set_summary_style(
    doc: &mut Document, id: &str,
    shape_class: Option<&str>, line_color: Option<&str>, line_width: Option<&str>,
) -> bool {
    let mut parents = Vec::new();
    native_summary_parents(doc.root(), id, &mut parents);
    if parents.is_empty() { return false; }
    let mut updated = false;
    for parent_id in parents {
        let Some(parent) = find_mut(doc.root_mut(), &parent_id) else { continue };
        let Some(list) = parent.extra.get_mut("summaries").and_then(Value::as_array_mut) else { continue };
        for item in list.iter_mut()
            .filter(|it| it.get("topicId").and_then(Value::as_str) == Some(id))
        {
            let Some(entry) = item.as_object_mut() else { continue };
            let style = entry.entry("style".to_string())
                .or_insert_with(|| json!({ "id": crate::new_id(), "properties": {} }));
            if !style.is_object() {
                *style = json!({ "id": crate::new_id(), "properties": {} });
            }
            let props = style.as_object_mut().expect("object inserted above")
                .entry("properties".to_string()).or_insert_with(|| json!({}));
            if !props.is_object() { *props = json!({}); }
            let map = props.as_object_mut().expect("object inserted above");
            if let Some(v) = shape_class { map.insert("shape-class".into(), json!(v)); }
            if let Some(v) = line_color { map.insert("line-color".into(), json!(v)); }
            if let Some(v) = line_width { map.insert("line-width".into(), json!(v)); }
            updated = true;
        }
    }
    updated
}

/// One-branch document for 「导出分支为…」/「打印分支…」: the chosen topic
/// becomes the central topic and the rest of the map is dropped, so the export
/// is cropped to that branch exactly like XMind's.
pub fn branch_document(doc: &Document, id: &str) -> Option<Document> {
    let branch = find(doc.root(), id)?.clone();
    // A crop is always fully expanded, and the branch keeps its own hue.
    let mut root = branch;
    root.folded = false;
    root.side = None;
    root.position = None;
    drop_sides(&mut root);

    let mut out = doc.clone();
    let mut sheet = doc.sheet().clone();
    sheet.root = root;
    out.sheets = vec![sheet];
    out.active_sheet = 0;
    out.title = format!("{}-{}", doc.title, find(doc.root(), id).map(|t| t.title.as_str()).unwrap_or(""));

    let layout = crate::compute_layout(doc);
    if let Some(node) = layout.nodes.iter().find(|item| item.id == id) {
        let total = layout.theme.branches.len();
        if total > 0 {
            let hue = layout.theme.branches[node.branch % total].clone();
            out.center_color = Some(hue.clone());
            out.branch_colors = Some(vec![hue]);
        }
    }
    Some(out)
}

/// Exported branches are re-laid out from scratch, so the left/right placement
/// of the original (much wider) balanced map must not leak in.
fn drop_sides(topic: &mut Topic) {
    topic.side = None;
    for group in child_groups_mut(topic) {
        for child in group.iter_mut() {
            drop_sides(child);
        }
    }
}

fn remove_topic_by_id(topic: &mut Topic, id: &str) -> bool {
    for group in child_groups_mut(topic) {
        if let Some(index) = group.iter().position(|child| child.id == id) {
            group.remove(index);
            return true;
        }
    }
    for group in child_groups_mut(topic) {
        for child in group.iter_mut() {
            if remove_topic_by_id(child, id) {
                return true;
            }
        }
    }
    false
}

pub fn remove_decor(doc: &mut Document, kind: &str, id: &str) -> bool {
    let key = match kind {
        "relation" => "relationships",
        "boundary" => "boundaries",
        "summary" => {
            let removed = remove_topic_by_id(doc.root_mut(), id);
            if removed {
                remove_summary_refs(doc.root_mut(), id);
            }
            return removed;
        }
        _ => return false,
    };
    let list = extra_array(&mut doc.sheet_mut().extra, key);
    let before = list.len();
    list.retain(|item| item.get("id").and_then(Value::as_str) != Some(id));
    before != list.len()
}

pub fn rename_decor(doc: &mut Document, kind: &str, id: &str, title: &str) -> bool {
    match kind {
        "relation" | "boundary" => {
            let key = if kind == "relation" { "relationships" } else { "boundaries" };
            if let Some(value) = decor_object(&mut doc.sheet_mut().extra, key, id) {
                if let Some(object) = value.as_object_mut() {
                    object.insert("title".into(), json!(title));
                    return true;
                }
            }
            false
        }
        "summary" => match find_mut(doc.root_mut(), id) {
            Some(topic) => {
                topic.title = title.to_string();
                topic.title_unedited = false;
                true
            }
            None => false,
        },
        _ => false,
    }
}

/// Insert several children at once (AI expand).
pub fn add_children(doc: &mut Document, parent_id: &str, titles: &[String]) -> Option<Vec<String>> {
    let root = doc.root_mut();
    let parent = find_mut(root, parent_id)?;
    parent.folded = false;
    let mut ids = Vec::with_capacity(titles.len());
    for title in titles {
        let child = Topic::new(title.trim());
        ids.push(child.id.clone());
        parent.children.push(child);
    }
    Some(ids)
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

pub fn add_sheet(doc: &mut Document) -> usize {
    let index = doc.sheets.len();
    let mut root = Topic::new("中心主题");
    root.title_unedited = true;
    root.structure_class = Some(Structure::Clockwise.class().into());
    doc.sheets.push(Sheet {
        id: new_id(),
        title: format!("画布 {}", index + 1),
        root,
        structure: Structure::Clockwise,
        extra: Default::default(),
    });
    doc.active_sheet = index;
    index
}

pub fn remove_sheet(doc: &mut Document, index: usize) -> bool {
    if doc.sheets.len() <= 1 || index >= doc.sheets.len() {
        return false;
    }
    doc.sheets.remove(index);
    if doc.active_sheet >= doc.sheets.len() {
        doc.active_sheet = doc.sheets.len() - 1;
    }
    true
}

pub fn rename_sheet(doc: &mut Document, index: usize, title: &str) -> bool {
    match doc.sheets.get_mut(index) {
        Some(sheet) => {
            sheet.title = title.to_string();
            true
        }
        None => false,
    }
}

pub fn collect_images(doc: &Document) -> Vec<String> {
    fn walk(topic: &Topic, out: &mut Vec<String>) {
        if let Some(image) = &topic.image {
            out.push(image.clone());
        }
        for child in child_groups(topic) {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    for sheet in &doc.sheets {
        walk(&sheet.root, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

/// Apply a previously stored `extra` blob to a topic (used by undo/redo of
/// passthrough edits).
pub fn set_extra_value(doc: &mut Document, id: &str, key: &str, value: Option<Value>) -> bool {
    match find_mut(doc.root_mut(), id) {
        Some(topic) => {
            match value {
                Some(v) => { topic.extra.insert(key.to_string(), v); }
                None => { topic.extra.remove(key); }
            }
            true
        }
        None => false,
    }
}

pub struct DocStats {
    pub topics: usize,
    pub depth: usize,
    pub branches: usize,
    pub sheets: usize,
}

pub fn stats(doc: &Document) -> DocStats {
    fn walk(topic: &Topic, depth: usize, count: &mut usize, max_depth: &mut usize) {
        *count += 1;
        *max_depth = (*max_depth).max(depth);
        if topic.folded {
            return;
        }
        for child in child_groups(topic) {
            walk(child, depth + 1, count, max_depth);
        }
    }
    let mut count = 0;
    let mut max_depth = 0;
    walk(doc.root(), 0, &mut count, &mut max_depth);
    DocStats {
        topics: count,
        depth: max_depth + 1,
        branches: doc.root().children.len(),
        sheets: doc.sheets.len(),
    }
}

/// Compact plain-text outline used as AI context.
pub fn outline(doc: &Document, limit: usize) -> String {
    fn walk(topic: &Topic, depth: usize, out: &mut Vec<String>) {
        if out.len() >= 200 {
            return;
        }
        out.push(format!("{}{}", "  ".repeat(depth), topic.title));
        if topic.folded {
            return;
        }
        for child in child_groups(topic) {
            walk(child, depth + 1, out);
        }
    }
    let mut lines = Vec::new();
    walk(doc.root(), 0, &mut lines);
    lines.truncate(limit);
    lines.join("\n")
}

fn new_id() -> String {
    crate::new_id()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Position;

    #[test]
    fn floating_topics_are_editable_and_laid_out() {
        let mut doc = Document::new("测试");
        let root_id = doc.root().id.clone();
        let mut floating = Topic::new("浮动主题");
        floating.position = Some(Position { x: 240.0, y: 160.0 });
        let id = floating.id.clone();
        doc.root_mut().detached.push(floating);

        assert!(find(doc.root(), &id).is_some(), "detached topic must be findable");
        assert_eq!(parent_id_of(doc.root(), &id), Some(root_id));
        assert!(rename(&mut doc, &id, "改名后的浮动主题"));
        assert_eq!(find(doc.root(), &id).unwrap().title, "改名后的浮动主题");
        assert!(add_child(&mut doc, &id, "浮动子主题").is_some());

        let layout = crate::compute_layout(&doc);
        assert!(layout.nodes.iter().any(|n| n.id == id));
        assert!(layout.nodes.iter().any(|n| n.title == "浮动子主题"));
        assert!(layout.edges.iter().all(|e| e.to != id), "floating topic has no parent edge");

        assert!(delete(&mut doc, &id));
        assert!(find(doc.root(), &id).is_none());
    }

    #[test]
    fn move_topic_rejects_cycles_without_losing_the_branch() {
        let mut doc = Document::new("测试");
        let first = doc.root().children[0].id.clone();
        let grandchild = add_child(&mut doc, &first, "孙主题").unwrap();
        assert!(!move_topic(&mut doc, &first, &grandchild, 0));
        assert!(find(doc.root(), &first).is_some(), "failed move must not detach");
        assert!(find(doc.root(), &grandchild).is_some());

        let second = doc.root().children[1].id.clone();
        assert!(move_topic(&mut doc, &grandchild, &second, 0));
        assert_eq!(parent_id_of(doc.root(), &grandchild), Some(second));
        assert!(path_to(doc.root(), &grandchild).last().unwrap().contains("孙主题"));
    }
}
