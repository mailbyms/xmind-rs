//! IPC surface. The WebView never touches the filesystem or the network:
//! every operation goes through a Rust command here.

use crate::state::{AppState, Snapshot};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;
use xmind_core::{
    ops, Document, Layout, Side, SkeletonLayers, Structure, ThemeId, Topic, TopicStyle,
    ALL_STRUCTURES,
};

/// Intrinsic size of an image resource, in canvas pixels.
///
/// XMind sizes an image topic from the artwork itself: a 140×140 SVG becomes a
/// 178×198 card, a 60×60 sticker a 128×118 one.  Real themes therefore cannot
/// be reproduced by measuring the label alone.  Stickers are SVGs with an
/// explicit root `width`/`height`; PNG/JPEG carry the size in their headers.
/// This is derived from the bytes, never stored in `content.json`.
fn intrinsic_image_size(bytes: &[u8]) -> Option<(f64, f64)> {
    if bytes.len() >= 24 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?) as f64;
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?) as f64;
        return (w > 0.0 && h > 0.0).then_some((w, h));
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let lower = head.to_ascii_lowercase();
    let start = lower.find("<svg")?;
    let end = lower[start..].find('>')? + start;
    let tag = &head[start..end];
    let tag_lower = tag.to_ascii_lowercase();
    let attr = |name: &str| -> Option<f64> {
        let at = tag_lower.find(name)?;
        let rest = &tag[at + name.len()..];
        let a = rest.find('"')?;
        let b = rest[a + 1..].find('"')? + a + 1;
        rest[a + 1..b].trim().trim_end_matches("px").trim().parse::<f64>().ok()
    };
    let w = attr(" width=").or_else(|| attr("width="))?;
    let h = attr(" height=").or_else(|| attr("height="))?;
    (w > 0.0 && h > 0.0).then_some((w, h))
}

/// Copy the measured artwork size onto every topic that references it.
fn apply_image_sizes(topic: &mut Topic, sizes: &HashMap<String, (f64, f64)>) {
    if let Some(id) = &topic.image {
        topic.image_size = sizes.get(id).copied();
    }
    for child in topic.children.iter_mut().chain(topic.detached.iter_mut())
        .chain(topic.summary.iter_mut()).chain(topic.callout.iter_mut())
    {
        apply_image_sizes(child, sizes);
    }
}

fn mutate<F>(state: &State<'_, AppState>, action: F) -> Result<Snapshot, String>
where
    F: FnOnce(&mut Document),
{
    state.begin_mutation();
    {
        let mut document = state.document.lock().unwrap();
        action(&mut document);
    }
    Ok(state.snapshot())
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureInfo {
    pub id: Structure,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub data_dir: String,
    pub theme: ThemeId,
    pub recent: Vec<String>,
    pub structures: Vec<StructureInfo>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let settings = state.settings.lock().unwrap();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.layout.root.to_string_lossy().to_string(),
        theme: settings.theme,
        recent: settings.recent.clone(),
        structures: ALL_STRUCTURES
            .iter()
            .map(|s| StructureInfo { id: *s, label: s.label() })
            .collect(),
    })
}

#[tauri::command]
pub fn app_set_theme(state: State<'_, AppState>, theme: ThemeId) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        doc.theme = theme;
        // Regenerate the embedded XMind sheet theme so the file looks the same
        // when opened in real XMind.
        doc.sheet_mut()
            .extra
            .insert("theme".into(), xmind_file::theme_for(theme));
    })?;
    state.settings.lock().unwrap().theme = theme;
    let _ = state.save_settings();
    Ok(state.snapshot())
}

#[tauri::command]
pub fn app_set_active_sheet(state: State<'_, AppState>, index: usize) -> Result<Snapshot, String> {
    let count = state.document.lock().unwrap().sheets.len();
    if index >= count {
        return Err("画布不存在".into());
    }
    mutate(&state, |doc| doc.active_sheet = index)
}

#[tauri::command]
pub fn app_clear_recent(state: State<'_, AppState>) -> Result<Snapshot, String> {
    state.settings.lock().unwrap().recent.clear();
    let _ = state.save_settings();
    Ok(state.snapshot())
}

#[tauri::command]
pub fn app_log(message: String) {
    crate::state::startup_log(&format!("renderer: {message}"));
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn doc_new(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let theme = state.settings.lock().unwrap().theme;
    let mut document = Document::new("未命名思维导图");
    document.theme = theme;
    document
        .sheet_mut()
        .extra
        .insert("theme".into(), xmind_file::theme_for(theme));
    // A new map starts on the first 思维导图 skeleton (all three layers are
    // solid rounded rectangles), so levels 3/4/5 have plates too.
    ops::set_skeleton_layers(&mut document, &SkeletonLayers::mind_map());
    state.replace_document(document, None, None);
    Ok(state.snapshot())
}

/// Explicit crash recovery. Startup deliberately does *not* call this: the
/// shipped XMind always opens a clean "未命名" map instead of the document
/// left behind by the previous session. The debounced snapshot stays on disk
/// so a future "恢复未保存的导图" command can load it on demand.
#[tauri::command]
pub fn doc_restore(state: State<'_, AppState>) -> Result<Option<Snapshot>, String> {
    match state.read_recovery() {
        Some(document) => {
            state.replace_document(document, None, None);
            state.dirty.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(Some(state.snapshot()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn doc_save_recovery(state: State<'_, AppState>) -> Result<(), String> {
    state.write_recovery()
}

#[tauri::command]
pub fn doc_open(state: State<'_, AppState>, path: String) -> Result<Snapshot, String> {
    let source = PathBuf::from(&path);
    let loaded = xmind_file::read_any(&source).map_err(|e| e.to_string())?;
    let mut document = loaded.document;
    let mut ids = HashMap::new();
    let mut image_sizes = HashMap::new();
    for resource in &loaded.resources {
        if let Ok(id) = state.resources.import(&resource.name, &resource.bytes) {
            ids.insert(resource.name.clone(), id.clone());
            if let Some(size) = intrinsic_image_size(&resource.bytes) {
                image_sizes.insert(id, size);
            }
        }
    }
    xmind_file::remap_image_ids(&mut document, &ids);
    for sheet in &mut document.sheets {
        apply_image_sizes(&mut sheet.root, &image_sizes);
    }
    document.theme = state.settings.lock().unwrap().theme;
    document.title = source
        .file_stem()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| document.title.clone());
    state.replace_document(document, Some(source.clone()), loaded.thumbnail);
    state.set_extra_files(
        loaded
            .other_files
            .iter()
            .map(|f| (f.name.clone(), f.bytes.clone()))
            .collect(),
    );
    state.push_recent(&source);
    Ok(state.snapshot())
}

#[tauri::command]
pub fn doc_save(state: State<'_, AppState>, path: Option<String>) -> Result<Snapshot, String> {
    let target = match path {
        Some(value) => PathBuf::from(value),
        None => state
            .current_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "NEED_PATH".to_string())?,
    };
    let target = if target.extension().is_none() {
        target.with_extension("xmind")
    } else {
        target
    };
    let document = state.document.lock().unwrap().clone();
    let resources = state
        .resources
        .export_ids(&ops::collect_images(&document));
    let thumbnail = state.thumbnail.lock().unwrap().clone();
    let extras = state.extra_files.lock().unwrap().clone();
    xmind_file::write_xmind_with_extras(
        &target,
        &document,
        &resources,
        thumbnail.as_deref(),
        &extras,
    )
    .map_err(|e| e.to_string())?;
    *state.current_path.lock().unwrap() = Some(target.clone());
    state.dirty.store(false, std::sync::atomic::Ordering::Relaxed);
    state.push_recent(&target);
    Ok(state.snapshot())
}

#[tauri::command]
pub fn doc_export(state: State<'_, AppState>, path: String, format: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let document = state.document.lock().unwrap().clone();
    if format.eq_ignore_ascii_case("xmind") {
        let resources = state.resources.export_ids(&ops::collect_images(&document));
        let thumbnail = state.thumbnail.lock().unwrap().clone();
        let extras = state.extra_files.lock().unwrap().clone();
        return xmind_file::write_xmind_with_extras(
            &target,
            &document,
            &resources,
            thumbnail.as_deref(),
            &extras,
        )
        .map_err(|e| e.to_string());
    }
    let parsed = xmind_file::ExportFormat::parse(&format)
        .ok_or_else(|| format!("不支持的导出格式: {format}"))?;
    let bytes = xmind_file::export_document(&document, parsed);
    xmind_file::write_atomic(&target, &bytes).map_err(|e| e.to_string())
}

/// 「导出分支为…」/「打印分支…」: the selected topic becomes the central topic
/// and everything outside its subtree is dropped, exactly like XMind's
/// branch-scoped export.
#[tauri::command]
pub fn doc_branch_svg(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let document = state.document.lock().unwrap();
    let branch = ops::branch_document(&document, &id).ok_or_else(|| "找不到该分支".to_string())?;
    Ok(xmind_file::to_svg(&branch))
}

#[tauri::command]
pub fn doc_export_branch(
    state: State<'_, AppState>, path: String, format: String, id: String,
) -> Result<(), String> {
    let document = state.document.lock().unwrap();
    let branch = ops::branch_document(&document, &id).ok_or_else(|| "找不到该分支".to_string())?;
    let parsed = xmind_file::ExportFormat::parse(&format)
        .ok_or_else(|| format!("不支持的导出格式: {format}"))?;
    let bytes = xmind_file::export_document(&branch, parsed);
    xmind_file::write_atomic(&PathBuf::from(&path), &bytes).map_err(|e| e.to_string())
}

/// PNG / PDF are rasterised in the WebView (it owns the fonts and can deflate
/// through `CompressionStream`), so Rust only has to drop the bytes on disk.
#[tauri::command]
pub fn doc_write_bytes(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| e.to_string())?;
    xmind_file::write_atomic(&PathBuf::from(&path), &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn doc_layout(state: State<'_, AppState>) -> Result<Layout, String> {
    Ok(xmind_core::compute_layout(&state.document.lock().unwrap()))
}

// ---------------------------------------------------------------------------
// Topic editing
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn doc_add_child(state: State<'_, AppState>, id: String, title: Option<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        ops::add_child(doc, &id, title.as_deref().unwrap_or("新主题"));
    })
}

#[tauri::command]
pub fn doc_add_sibling(state: State<'_, AppState>, id: String, title: Option<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        ops::add_sibling(doc, &id, title.as_deref().unwrap_or("新主题"));
    })
}

// The full XMind menu tree needs a few more structural edits than the toolbar.
// All of them still go through `mutate`, so they are one undo step each.
#[tauri::command]
pub fn doc_add_sibling_before(state: State<'_, AppState>, id: String, title: Option<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::add_sibling_before(doc, &id, title.as_deref().unwrap_or("新主题")); })
}

#[tauri::command]
pub fn doc_insert_parent(state: State<'_, AppState>, id: String, title: Option<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::insert_parent(doc, &id, title.as_deref().unwrap_or("新主题")); })
}

#[tauri::command]
pub fn doc_add_floating(
    state: State<'_, AppState>, x: f64, y: f64, title: Option<String>, callout: Option<bool>,
) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        ops::add_floating(doc, x, y, title.as_deref().unwrap_or("自由主题"), callout.unwrap_or(false));
    })
}

#[tauri::command]
pub fn doc_duplicate(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::duplicate_topic(doc, &id); })
}

#[tauri::command]
pub fn doc_delete_single(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::delete_single(doc, &id); })
}

#[tauri::command]
pub fn doc_indent(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::indent(doc, &id); })
}

#[tauri::command]
pub fn doc_outdent(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::outdent(doc, &id); })
}

#[tauri::command]
pub fn doc_fold_all(state: State<'_, AppState>, folded: bool) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_fold_all(doc, folded); })
}

#[tauri::command]
pub fn doc_focus_branch(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::focus_branch(doc, &id); })
}

#[tauri::command]
pub fn doc_reset_position(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_position(doc, &id, None); })
}

#[tauri::command]
pub fn doc_add_sheet_from_topic(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::add_sheet_from_topic(doc, &id); })
}

#[tauri::command]
pub fn doc_delete(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::delete(doc, &id); })
}

#[tauri::command]
pub fn doc_rename(state: State<'_, AppState>, id: String, title: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::rename(doc, &id, &title); })
}

/// Live in-place edit: the canvas relays every keystroke here, so the layout
/// engine re-measures the topic (and all its siblings) on each change. The
/// whole session still counts as one undo step; see `AppState::EditSession`.
#[tauri::command]
pub fn doc_edit_begin(state: State<'_, AppState>, id: String) {
    state.live_edit_begin(&id);
}

#[tauri::command]
pub fn doc_edit_text(state: State<'_, AppState>, id: String, title: String) -> Result<Snapshot, String> {
    state.live_edit_text(&id, &title)
}

#[tauri::command]
pub fn doc_edit_end(
    state: State<'_, AppState>, id: String, title: Option<String>, cancel: bool,
) -> Result<Snapshot, String> {
    state.live_edit_end(&id, title.as_deref(), cancel)
}

#[tauri::command]
pub fn doc_set_note(state: State<'_, AppState>, id: String, note: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_note(doc, &id, &note); })
}

#[tauri::command]
pub fn doc_set_labels(state: State<'_, AppState>, id: String, labels: Vec<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_labels(doc, &id, labels); })
}

#[tauri::command]
pub fn doc_toggle_marker(state: State<'_, AppState>, id: String, marker: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::toggle_marker(doc, &id, &marker); })
}

#[tauri::command]
pub fn doc_set_markers(
    state: State<'_, AppState>,
    id: String,
    markers: Vec<String>,
) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_markers(doc, &id, markers); })
}

#[tauri::command]
pub fn doc_set_style(state: State<'_, AppState>, id: String, style: TopicStyle) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_style(doc, &id, style); })
}

#[tauri::command]
pub fn doc_set_width(
    state: State<'_, AppState>,
    id: String,
    width: Option<f64>,
) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        if let Some(topic) = ops::find_mut(doc.root_mut(), &id) {
            topic.custom_width = width.map(|w| w.clamp(40.0, 800.0));
        }
    })
}

/// Canvas-tab settings. Each argument is optional so the panel can patch one
/// field at a time.
#[tauri::command]
pub fn doc_set_canvas(
    state: State<'_, AppState>,
    background: Option<String>,
    font_family: Option<String>,
    line_width: Option<f64>,
    rainbow: Option<bool>,
    compact: Option<bool>,
    sibling_align: Option<bool>,
    branch_colors: Option<Vec<String>>,
    palette: Option<String>,
    center_color: Option<String>,
    palette_variant: Option<u8>,
) -> Result<Snapshot, String> {
    let palette_touched = palette.is_some() || center_color.is_some()
        || branch_colors.is_some() || palette_variant.is_some();
    mutate(&state, |doc| {
        if let Some(value) = background {
            doc.background = if value.is_empty() || value == "default" { None } else { Some(value) };
        }
        if let Some(value) = font_family {
            doc.font_family = if value.is_empty() || value == "default" { None } else { Some(value) };
        }
        if let Some(value) = line_width {
            doc.line_width = if value <= 0.0 { None } else { Some(value) };
        }
        if let Some(value) = rainbow { doc.rainbow = value; }
        if let Some(value) = compact { doc.compact = value; }
        if let Some(value) = sibling_align { doc.sibling_align = value; }
        if let Some(value) = branch_colors {
            doc.branch_colors = if value.is_empty() { None } else { Some(value) };
        }
        if let Some(value) = palette {
            doc.palette = if value.is_empty() || value == "default" { None } else { Some(value) };
        }
        if let Some(value) = center_color {
            doc.center_color = if value.is_empty() || value == "default" { None } else { Some(value) };
        }
        if let Some(value) = palette_variant {
            doc.palette_variant = Some(value.min(5));
        }
        // Any of the palette fields means the user repainted the map, so
        // `sheet.theme` has to be rewritten on the next save.
        if palette_touched {
            doc.palette_dirty = true;
        }
    })
}

#[tauri::command]
pub fn doc_clear_style(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        ops::clear_style(doc, &id);
        if let Some(topic) = ops::find_mut(doc.root_mut(), &id) {
            topic.extra.remove("style");
        }
    })
}

#[tauri::command]
pub fn doc_set_side(state: State<'_, AppState>, id: String, side: Option<Side>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_side(doc, &id, side); })
}

#[tauri::command]
pub fn doc_set_image(state: State<'_, AppState>, id: String, resource: Option<String>) -> Result<Snapshot, String> {
    // Stickers inserted through the 插入 panel go through the resource store;
    // measure them too so the topic becomes the same card XMind would draw.
    let size = resource.as_deref()
        .and_then(|r| std::fs::read(state.resources.path_of(r)).ok())
        .and_then(|bytes| intrinsic_image_size(&bytes));
    mutate(&state, |doc| {
        ops::set_image(doc, &id, resource);
        if let Some(topic) = ops::find_mut(doc.root_mut(), &id) {
            topic.image_size = size;
        }
    })
}

#[tauri::command]
pub fn doc_toggle_fold(state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::toggle_fold(doc, &id); })
}

#[tauri::command]
pub fn doc_set_fold(state: State<'_, AppState>, id: String, folded: bool) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_fold(doc, &id, folded); })
}

#[tauri::command]
pub fn doc_move(state: State<'_, AppState>, id: String, new_parent_id: String, index: usize) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::move_topic(doc, &id, &new_parent_id, index); })
}

/// Drop on empty canvas → floating topic at (x, y) relative to the map centre.
#[tauri::command]
pub fn doc_move_free(state: State<'_, AppState>, id: String, x: f64, y: f64) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::move_to_free_position(doc, &id, x, y); })
}

/// Insert a 联系 / 概要 / 外框. `id` is the anchor topic (and the first end of
/// a 联系); `targetId` is the second end for a 联系. `rangeStart` / `rangeEnd`
/// carry an explicit multi-selection, exactly like XMind's 概要 over a box-
/// selected run of sibling topics.
#[tauri::command]
pub fn doc_add_decor(
    state: State<'_, AppState>, kind: String, id: String,
    target_id: Option<String>, title: String,
    range_start: Option<String>, range_end: Option<String>,
) -> Result<Snapshot, String> {
    let valid = {
        let document = state.document.lock().unwrap();
        let root = document.root();
        match kind.as_str() {
            "relation" => target_id.as_deref().is_some_and(|to| {
                to != id && ops::find(root, &id).is_some() && ops::find(root, to).is_some()
            }),
            "boundary" | "summary" => ops::decor_range(root, &id).is_some(),
            _ => false,
        }
    };
    if !valid {
        return Err("无法添加：请先选中合适的主题".into());
    }
    mutate(&state, |doc| {
        let range = match (range_start.as_deref(), range_end.as_deref()) {
            (Some(start), Some(end)) => Some((start, end)),
            _ => None,
        };
        match kind.as_str() {
            "relation" => { ops::add_relationship(doc, &id, target_id.as_deref().unwrap_or(""), &title); }
            "boundary" => { ops::add_boundary_with_range(doc, &id, range, &title); }
            "summary" => { ops::add_summary_with_range(doc, &id, range, &title); }
            _ => {}
        }
    })
}

#[tauri::command]
pub fn doc_remove_decor(state: State<'_, AppState>, kind: String, id: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::remove_decor(doc, &kind, &id); })
}

#[tauri::command]
pub fn doc_rename_decor(
    state: State<'_, AppState>, kind: String, id: String, title: String,
) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::rename_decor(doc, &kind, &id, &title); })
}

/// Drag one end of a 外框 / 概要 (XMind's range handles).
#[tauri::command]
pub fn doc_set_decor_range(
    state: State<'_, AppState>, kind: String, id: String, start_id: String, end_id: String,
) -> Result<Snapshot, String> {
    let valid = {
        let document = state.document.lock().unwrap();
        ops::same_sibling_range(&document, &start_id, &end_id)
    };
    if !valid {
        return Err("无法调整范围：两端必须属于同一父主题、同一侧".into());
    }
    mutate(&state, |doc| { ops::set_decor_range(doc, &kind, &id, &start_id, &end_id); })
}

/// 样式面板 → 概要线型: brace shape / ink / thickness of one native 概要.
#[tauri::command]
pub fn doc_set_summary_style(
    state: State<'_, AppState>, id: String,
    shape_class: Option<String>, line_color: Option<String>, line_width: Option<String>,
) -> Result<Snapshot, String> {
    mutate(&state, |doc| {
        ops::set_summary_style(
            doc, &id, shape_class.as_deref(), line_color.as_deref(), line_width.as_deref(),
        );
    })
}

#[tauri::command]
pub fn doc_set_href(state: State<'_, AppState>, id: String, href: Option<String>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::set_href(doc, &id, href); })
}

#[tauri::command]
pub fn doc_set_structure(state: State<'_, AppState>, structure: Structure) -> Result<Snapshot, String> {
    mutate(&state, |doc| doc.set_structure(structure))
}

/// Apply one 骨架 preset. The shipped app treats a skeleton as a *style
/// bundle*: the structure class pair, the central/main/**sub** topic shapes
/// and line classes, the line pattern and the map-level `line-tapered` switch.
/// `shape` / `mainShape` / `line` are short class names (`roundedRect`,
/// `bight`, …) the presets carry.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn doc_apply_skeleton(
    state: State<'_, AppState>,
    structure: Structure,
    central: String,
    main: Option<String>,
    shape: Option<String>,
    main_shape: Option<String>,
    line: Option<String>,
    central_line: Option<String>,
    pattern: Option<String>,
    fill_pattern: Option<String>,
    sub_line: Option<String>,
    sub_shape: Option<String>,
    sub_pattern: Option<String>,
    sub_width: Option<String>,
    sub_fill: Option<String>,
    main_width: Option<String>,
    central_width: Option<String>,
    tapered: Option<String>,
    // Three depth layers from the original desktop theme bytes. Stored at
    // sheet level so newly created topics inherit the preset.
    layers: SkeletonLayers,
) -> Result<Snapshot, String> {
    let branch_class = |value: Option<String>| {
        format!("org.xmind.branchConnection.{}", value.unwrap_or_else(|| "curve".into()))
    };
    let topic_shape = |value: Option<String>| {
        format!("org.xmind.topicShape.{}", value.unwrap_or_else(|| "roundedRect".into()))
    };
    let pattern = pattern.unwrap_or_else(|| "solid".into());
    let fill_pattern = fill_pattern.unwrap_or_else(|| "solid".into());
    // Every field is written explicitly (with an XMind default when the preset
    // omits it), otherwise switching from e.g. a hand-drawn skeleton to a
    // plain one would leave the old `line-pattern` behind.
    let centre = TopicStyle {
        shape_class: Some(topic_shape(shape)),
        line_class: Some(branch_class(central_line)),
        line_width: Some(central_width.unwrap_or_else(|| "3pt".into())),
        line_pattern: Some(pattern.clone()),
        fill_pattern: Some(fill_pattern.clone()),
        ..Default::default()
    };
    let first = TopicStyle {
        shape_class: Some(topic_shape(main_shape)),
        line_class: Some(branch_class(line)),
        line_width: Some(main_width.unwrap_or_else(|| "2pt".into())),
        line_pattern: Some(pattern.clone()),
        fill_pattern: Some(fill_pattern.clone()),
        ..Default::default()
    };
    let deeper = TopicStyle {
        shape_class: Some(topic_shape(sub_shape)),
        line_class: Some(branch_class(sub_line)),
        line_width: Some(sub_width.unwrap_or_else(|| "2pt".into())),
        line_pattern: Some(sub_pattern.unwrap_or(pattern)),
        fill_pattern: Some(sub_fill.unwrap_or(fill_pattern)),
        ..Default::default()
    };
    // `map/properties/line-tapered` is one of none | normal | tapered.  Only
    // `tapered` draws the filled wedge; `none`/`normal` are stroked lines.
    let tapered = tapered.map(|value| value == "tapered");
    mutate(&state, |doc| {
        doc.set_skeleton(structure, &central, main.as_deref());
        ops::set_skeleton_layers(doc, &layers);
        ops::apply_skeleton_styles(doc, &centre, &first, &deeper, tapered);
    })
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn doc_add_sheet(state: State<'_, AppState>) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::add_sheet(doc); })
}

#[tauri::command]
pub fn doc_remove_sheet(state: State<'_, AppState>, index: usize) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::remove_sheet(doc, index); })
}

#[tauri::command]
pub fn doc_rename_sheet(state: State<'_, AppState>, index: usize, title: String) -> Result<Snapshot, String> {
    mutate(&state, |doc| { ops::rename_sheet(doc, index, &title); })
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn doc_undo(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let previous = state.undo.lock().unwrap().pop();
    if let Some(previous) = previous {
        let current = state.document.lock().unwrap().clone();
        state.redo.lock().unwrap().push(current);
        *state.document.lock().unwrap() = previous;
        state.dirty.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(state.snapshot())
}

#[tauri::command]
pub fn doc_redo(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let next = state.redo.lock().unwrap().pop();
    if let Some(next) = next {
        let current = state.document.lock().unwrap().clone();
        state.undo.lock().unwrap().push(current);
        *state.document.lock().unwrap() = next;
        state.dirty.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(state.snapshot())
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDto {
    pub id: String,
    pub mime: String,
    pub size: usize,
    pub data_url: String,
}

#[tauri::command]
pub fn resource_put(state: State<'_, AppState>, data: String, hint: String) -> Result<ResourceDto, String> {
    let bytes = xmind_resources::decode_base64(&data).map_err(|e| e.to_string())?;
    let meta = state.resources.put(&bytes, &hint).map_err(|e| e.to_string())?;
    Ok(ResourceDto {
        id: meta.id,
        mime: meta.mime,
        size: meta.size,
        data_url: meta.data_url,
    })
}

#[tauri::command]
pub fn resource_data(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    state.resources.data_url(&id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// AI (aicompat) — provider built lazily, network call off the UI thread
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ai_status(state: State<'_, AppState>) -> aicompat::AiStatus {
    state.ai.status()
}

#[tauri::command]
pub fn ai_get_config(state: State<'_, AppState>) -> aicompat::AiConfig {
    let mut config = state.ai.config();
    config.api_key.clear(); // never echo a stored credential back to JS
    config
}

#[tauri::command]
pub fn ai_set_config(state: State<'_, AppState>, config: aicompat::AiConfig) -> Result<aicompat::AiStatus, String> {
    let mut merged = config;
    if merged.api_key.is_empty() {
        merged.api_key = state.ai.config().api_key; // keep the saved key
    }
    state.ai.set_config(merged).map_err(|e| e.to_string())?;
    Ok(state.ai.status())
}

#[tauri::command]
pub fn ai_clear_config(state: State<'_, AppState>) -> Result<aicompat::AiStatus, String> {
    state
        .ai
        .set_config(aicompat::AiConfig::default())
        .map_err(|e| e.to_string())?;
    Ok(state.ai.status())
}

#[tauri::command]
pub async fn ai_expand(
    state: State<'_, AppState>,
    topic_id: String,
    instruction: String,
    count: usize,
) -> Result<Snapshot, String> {
    let (title, context) = {
        let document = state.document.lock().unwrap();
        let title = ops::find(document.root(), &topic_id)
            .map(|topic| topic.title.clone())
            .unwrap_or_else(|| "这个主题".into());
        (title, ops::outline(&document, 80))
    };
    let hub = state.ai.clone();
    let items = tauri::async_runtime::spawn_blocking(move || {
        hub.expand(&title, &context, &instruction, count.clamp(1, 12))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    state.begin_mutation();
    {
        let mut document = state.document.lock().unwrap();
        ops::add_children(&mut document, &topic_id, &items);
    }
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn ai_chat(state: State<'_, AppState>, message: String) -> Result<String, String> {
    let context = ops::outline(&state.document.lock().unwrap(), 60);
    let hub = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || hub.chat(&message, &context))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
