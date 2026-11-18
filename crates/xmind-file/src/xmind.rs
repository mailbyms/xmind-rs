use crate::{legacy, markdown, theme, FileError};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    path::Path,
};
use xmind_core::{
    new_id, ops::migrate_legacy_summaries, Document, Position, Sheet, Side, Structure, Topic,
    TopicStyle,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

/// XMind ships this fixed multi-language warning as `content.xml` in every
/// modern file so XMind 8 doesn't silently corrupt it. We write the same bytes.
pub const CONTENT_XML_PLACEHOLDER: &str = include_str!("../assets/content-warning.xml");

pub struct EmbeddedResource {
    pub name: String,
    pub bytes: Vec<u8>,
}

pub struct LoadedDocument {
    pub document: Document,
    pub resources: Vec<EmbeddedResource>,
    pub thumbnail: Option<Vec<u8>>,
    pub metadata: Value,
    /// Anything else in the archive (META-INF, custom attachments, ...).
    /// Kept verbatim so re-saving a third-party .xmind never drops data.
    pub other_files: Vec<EmbeddedResource>,
}

pub fn read_any(path: &Path) -> Result<LoadedDocument, FileError> {
    match crate::document_extension(path).as_str() {
        "xmind" => read_xmind(path),
        "json" => Ok(LoadedDocument {
            document: crate::read_text_document(path)?,
            resources: Vec::new(),
            thumbnail: None,
            metadata: json!({}),
            other_files: Vec::new(),
        }),
        "md" | "markdown" | "txt" => Ok(LoadedDocument {
            document: markdown::from_markdown(&std::fs::read_to_string(path)?),
            resources: Vec::new(),
            thumbnail: None,
            metadata: json!({}),
            other_files: Vec::new(),
        }),
        other => Err(FileError::Message(format!("暂不支持的文件类型: .{other}"))),
    }
}

pub fn read_xmind(path: &Path) -> Result<LoadedDocument, FileError> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let mut content_json: Option<String> = None;
    let mut content_xml: Option<String> = None;
    let mut metadata_text: Option<String> = None;
    let mut thumbnail: Option<Vec<u8>> = None;
    let mut resources: Vec<EmbeddedResource> = Vec::new();
    let mut other_files: Vec<EmbeddedResource> = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name()?.into_owned();
        if name.ends_with('/') || name.ends_with('\\') {
            continue; // zip directory marker, e.g. "resources/"
        }
        if name.eq_ignore_ascii_case("content.json") {
            let mut text = String::new();
            entry.read_to_string(&mut text)?;
            content_json = Some(text);
        } else if name.eq_ignore_ascii_case("content.xml") {
            let mut text = String::new();
            entry.read_to_string(&mut text)?;
            content_xml = Some(text);
        } else if name.eq_ignore_ascii_case("metadata.json") {
            let mut text = String::new();
            entry.read_to_string(&mut text)?;
            metadata_text = Some(text);
        } else if name.eq_ignore_ascii_case("Thumbnails/thumbnail.png") {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            thumbnail = Some(bytes);
        } else if name.eq_ignore_ascii_case("manifest.json") {
            // Rebuilt from scratch on save; never treat it as an image.
        } else if let Some(safe) = resource_name_in_archive(&name) {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            if !bytes.is_empty() {
                resources.push(EmbeddedResource { name: safe, bytes });
            }
        } else if let Some(safe) = sanitize_archive_path(&name) {
            // Unknown but harmless entry: preserve it byte-for-byte.
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            other_files.push(EmbeddedResource { name: safe, bytes });
        }
    }

    let metadata: Value = metadata_text
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or_else(|| json!({}));

    let mut document = if let Some(text) = content_json {
        from_content_json(&text)?
    } else if let Some(text) = content_xml {
        if is_warning_placeholder(&text) {
            return Err(FileError::Message(
                "这个 .xmind 只有旧版兼容占位文件，没有 content.json，无法读取内容".into(),
            ));
        }
        legacy::from_content_xml(&text)?
    } else {
        return Err(FileError::Message(
            "这个 .xmind 包里既没有 content.json 也没有 content.xml".into(),
        ));
    };
    document.ensure_sheet();
    // Keep metadata for a faithful re-save (creator, author, thumbnail origin).
    document
        .extra
        .insert("__metadata".into(), metadata.clone());
    Ok(LoadedDocument { document, resources, thumbnail, metadata, other_files })
}

fn is_warning_placeholder(text: &str) -> bool {
    text.contains("该文件无法正常打开") || text.contains("This file can not be opened normally")
}

/// Only real resource payloads belong in the content-addressed store. Modern
/// XMind uses `resources/<sha256>.<ext>`; XMind 8 used `xap:attachments/`.
fn resource_name_in_archive(name: &str) -> Option<String> {
    let normalized = name.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    let prefix = if lower.starts_with("resources/") {
        Some("resources/")
    } else if lower.starts_with("xap:resources/") {
        Some("xap:resources/")
    } else if lower.starts_with("attachments/") {
        Some("attachments/")
    } else if lower.starts_with("xap:attachments/") {
        Some("xap:attachments/")
    } else {
        None
    }?;
    let tail = &normalized[prefix.len()..];
    sanitize_resource_name(tail)
}

/// Reject path traversal / absolute paths for entries we pass through.
fn sanitize_archive_path(name: &str) -> Option<String> {
    let normalized = name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || normalized.contains(':')
    {
        return None;
    }
    Some(normalized)
}

pub fn sanitize_resource_name(name: &str) -> Option<String> {
    let base = name.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(name);
    let base = base.strip_prefix("xap:").unwrap_or(base);
    if base.is_empty() || base.contains("..") || base.contains('\\') {
        return None;
    }
    Some(base.to_string())
}

/// Replace archive resource filenames with the content-addressed ids used by
/// our local store, everywhere in the tree (including detached/callout topics).
pub fn remap_image_ids(doc: &mut Document, ids: &HashMap<String, String>) {
    fn walk(topic: &mut Topic, ids: &HashMap<String, String>) {
        if let Some(current) = &topic.image {
            if let Some(id) = ids.get(current) {
                topic.image = Some(id.clone());
            }
        }
        for child in topic.children.iter_mut().chain(topic.detached.iter_mut())
            .chain(topic.summary.iter_mut()).chain(topic.callout.iter_mut())
        {
            walk(child, ids);
        }
    }
    for sheet in &mut doc.sheets {
        walk(&mut sheet.root, ids);
    }
}

/// Write a standards-shaped .xmind. `resources` are the files referenced by
/// the document; `thumbnail` is preserved from the original file when present.
pub fn write_xmind(
    path: &Path,
    doc: &Document,
    resources: &[(String, Vec<u8>)],
    thumbnail: Option<&[u8]>,
) -> Result<(), FileError> {
    write_xmind_with_extras(path, doc, resources, thumbnail, &[])
}

/// Same as `write_xmind`, but also re-emits unknown archive entries captured by
/// `read_xmind`, so a third-party .xmind is not stripped on save.
pub fn write_xmind_with_extras(
    path: &Path,
    doc: &Document,
    resources: &[(String, Vec<u8>)],
    thumbnail: Option<&[u8]>,
    extras: &[(String, Vec<u8>)],
) -> Result<(), FileError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("xmind.tmp");
    {
        let file = File::create(&tmp)?;
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        let sheets: Vec<Value> = doc.sheets.iter().map(|s| sheet_to_json(s, doc)).collect();
        writer.start_file("content.json", options)?;
        writer.write_all(serde_json::to_string_pretty(&Value::Array(sheets))?.as_bytes())?;

        let mut metadata = doc
            .extra
            .get("__metadata")
            .cloned()
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({
                "creator": { "name": "XMind RS", "version": env!("CARGO_PKG_VERSION") }
            }));
        if let Some(obj) = metadata.as_object_mut() {
            if let Some(sheet) = doc.sheets.get(doc.active_sheet) {
                obj.insert("activeSheetId".into(), json!(sheet.id));
            }
        }
        writer.start_file("metadata.json", options)?;
        writer.write_all(serde_json::to_string_pretty(&metadata)?.as_bytes())?;

        // Fixed XMind-8 compatibility placeholder.
        writer.start_file("content.xml", options)?;
        writer.write_all(CONTENT_XML_PLACEHOLDER.as_bytes())?;

        let mut entries = Map::new();
        entries.insert("content.json".into(), json!({}));
        entries.insert("metadata.json".into(), json!({}));
        if thumbnail.is_some() {
            entries.insert("Thumbnails/thumbnail.png".into(), json!({}));
        }
        for (name, _) in resources {
            entries.insert(format!("resources/{name}"), json!({}));
        }
        let mut safe_extras: Vec<&(String, Vec<u8>)> = Vec::new();
        for item in extras {
            let Some(safe) = sanitize_archive_path(&item.0) else { continue };
            if entries.contains_key(&safe) {
                continue;
            }
            entries.insert(safe, json!({}));
            safe_extras.push(item);
        }
        writer.start_file("manifest.json", options)?;
        writer.write_all(
            serde_json::to_string_pretty(&json!({ "file-entries": Value::Object(entries) }))?
                .as_bytes(),
        )?;

        if let Some(bytes) = thumbnail {
            writer.start_file("Thumbnails/thumbnail.png", options)?;
            writer.write_all(bytes)?;
        }
        for (name, bytes) in resources {
            writer.start_file(format!("resources/{name}"), options)?;
            writer.write_all(bytes)?;
        }
        for (name, bytes) in safe_extras {
            writer.start_file(name.as_str(), options)?;
            writer.write_all(bytes)?;
        }
        writer.finish()?;
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::remove_file(path).ok();
            std::fs::rename(&tmp, path)?;
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// content.json -> model
// ---------------------------------------------------------------------------

pub fn from_content_json(text: &str) -> Result<Document, FileError> {
    let value: Value = serde_json::from_str(text)?;
    let sheets: Vec<Sheet> = match &value {
        Value::Array(items) => items.iter().filter_map(parse_sheet).collect(),
        Value::Object(_) => {
            if let Some(items) = value.get("sheets").and_then(Value::as_array) {
                items.iter().filter_map(parse_sheet).collect()
            } else {
                parse_sheet(&value).into_iter().collect()
            }
        }
        _ => Vec::new(),
    };
    let mut document = Document {
        title: sheets.first().map(|s| s.title.clone()).unwrap_or_else(|| "未命名思维导图".into()),
        theme: Default::default(),
        active_sheet: 0,
        sheets,
        background: None,
        font_family: None,
        line_width: None,
        rainbow: true,
        compact: false,
        sibling_align: false,
        branch_colors: None,
        palette: None,
        center_color: None,
        palette_variant: None,
        palette_dirty: false,
        extra: Default::default(),
    };
    document.ensure_sheet();
    // The six quick themes below the drop-down are ours, so their index travels
    // in a private sheet key.  Real XMind ignores unknown keys on open.
    document.palette_variant = document
        .sheets
        .first()
        .and_then(|s| s.extra.get("xmindRsPaletteVariant"))
        .and_then(Value::as_u64)
        .map(|v| (v as u8).min(5));
    // 配色方案 lives in `sheet.theme` (see `theme::read_palette`). Reading it
    // back means a saved map reopens with the palette it was painted with
    // instead of falling back to the default one.
    if let Some(theme) = document.sheets.first().and_then(|s| s.extra.get("theme")).cloned() {
        let (palette, colors, center) = theme::read_palette(&theme);
        document.palette = palette;
        document.branch_colors = colors;
        document.center_color = center;
        // Real XMind stores 同级主题对齐 as `theme.centralTopic.properties
        // ["alignment-by-level"] = "actived"` (their spelling). Without this,
        // files like example2.xmind reopen with every sibling sized to its own
        // label even though the shipped renderer draws one common width.
        document.sibling_align = alignment_by_level(&theme);
    }
    // Old files kept 概要 in a private extension XMind cannot read; upgrade
    // them to `children.summary` + `summaries[]` so re-saving fixes the file.
    migrate_legacy_summaries(&mut document);
    Ok(document)
}

/// XMind's 按层级对齐 flag lives in the theme's central-topic layer. The
/// shipped value is `"actived"` (sic); accept the obvious spellings too.
fn alignment_by_level(theme: &Value) -> bool {
    match theme
        .get("centralTopic")
        .and_then(|v| v.get("properties"))
        .and_then(|v| v.get("alignment-by-level"))
    {
        Some(Value::String(v)) => matches!(v.as_str(), "actived" | "activated" | "true" | "on"),
        Some(Value::Bool(v)) => *v,
        _ => false,
    }
}

/// Keep the native flag in step with the format-panel checkbox so toggling it
/// in xmind-rs and saving produces a file XMind reads the same way. XMind
/// writes `"inactived"` when the option is off, but many templates carry no
/// key at all — both forms must survive an open/save byte-faithfully.
fn sync_alignment_by_level(theme: &mut Value, active: bool) {
    let Some(obj) = theme.as_object_mut() else { return; };
    let current = obj
        .get("centralTopic")
        .and_then(|v| v.get("properties"))
        .and_then(|v| v.get("alignment-by-level"));
    let wanted = if active { "actived" } else { "inactived" };
    if let Some(Value::String(v)) = current {
        if v == wanted { return; }
    } else if current.is_none() && !active {
        return;
    }
    let central = obj.entry("centralTopic".to_string()).or_insert_with(|| json!({}));
    if !central.is_object() { *central = json!({}); }
    let props = central
        .as_object_mut()
        .expect("object checked above")
        .entry("properties".to_string())
        .or_insert_with(|| json!({}));
    if !props.is_object() { *props = json!({}); }
    props.as_object_mut().expect("object checked above")
        .insert("alignment-by-level".into(), json!(wanted));
}

fn side_str(side: Option<Side>) -> &'static str {
    match side {
        Some(Side::Left) => "left",
        Some(Side::Right) => "right",
        None => "",
    }
}

pub fn value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .or_else(|| map.get("title"))
            .and_then(value_string),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn value_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn parse_sheet(value: &Value) -> Option<Sheet> {
    let mut extra = value.as_object()?.clone();
    let root_value = extra.get("rootTopic").cloned()?;
    let root = parse_topic(&root_value);
    let id = extra.get("id").and_then(value_string).unwrap_or_else(new_id);
    let title = extra
        .get("title")
        .and_then(value_string)
        .unwrap_or_else(|| "画布 1".into());
    let structure = root
        .structure_class
        .as_deref()
        .map(Structure::from_class)
        .or_else(|| {
            extra
                .get("extensions")
                .and_then(Value::as_array)?
                .iter()
                .find(|e| {
                    e.get("provider").and_then(Value::as_str)
                        == Some("org.xmind.ui.skeleton.structure.style")
                })
                .and_then(|e| e.get("content"))
                .and_then(|c| c.get("centralTopic"))
                .and_then(value_string)
                .map(|v| Structure::from_class(&v))
        })
        .unwrap_or(Structure::Clockwise);
    // Keys we model explicitly are re-emitted by `sheet_to_json`; the rest
    // (theme, extensions, legend, coreVersion, topicPositioning...) stay here.
    // `class` is optional in real files: some templates omit it on sheets and
    // root topics. Only new documents get one from us.
    extra.insert("__hasClass".into(), json!(value.get("class").is_some()));
    for key in ["id", "class", "title", "rootTopic"] {
        extra.remove(key);
    }
    Some(Sheet { id, title, root, structure, extra })
}

fn parse_children(value: Option<&Value>, key: &str) -> Vec<Topic> {
    let Some(value) = value else { return Vec::new() };
    let list = match value {
        // Bare arrays only ever mean "attached"; other child groups are
        // object-keyed so we don't accidentally duplicate the whole tree.
        Value::Array(items) if key == "attached" => Some(items.clone()),
        Value::Array(_) => None,
        Value::Object(map) => map
            .get(key)
            .and_then(|v| v.as_array().cloned())
            .or_else(|| map.get(key).and_then(|v| v.get("topics")).and_then(Value::as_array).cloned()),
        _ => None,
    };
    list.unwrap_or_default().iter().map(parse_topic).collect()
}

fn parse_markers(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.as_str().map(str::to_string).or_else(|| {
                        item.get("markerId")
                            .or_else(|| item.get("id"))
                            .and_then(value_string)
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// XMind stores markers as objects — `[{"markerId":"priority-1"}]` — never as
/// bare strings: the desktop app silently rejects the whole file (canvas stays
/// empty) when it meets a string array.
fn markers_json(markers: &[String]) -> Value {
    Value::Array(markers.iter().map(|m| json!({ "markerId": m })).collect())
}

fn parse_labels(value: Option<&Value>) -> Vec<String> {    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(value_string).collect())
        .unwrap_or_default()
}

fn parse_note(value: Option<&Value>) -> String {
    let Some(value) = value else { return String::new() };
    value
        .get("plain")
        .and_then(|p| p.get("content"))
        .and_then(value_string)
        .or_else(|| value.get("text").and_then(value_string))
        .or_else(|| value_string(value))
        .unwrap_or_default()
}

fn parse_style(value: Option<&Value>) -> Option<TopicStyle> {
    let props = value?.get("properties")?;
    let get = |key: &str| -> Option<String> {
        props.get(key).and_then(value_string).or_else(|| {
            props.as_object()?.iter()
                .find(|(k, _)| k.ends_with(&format!(":{key}")) || k.as_str() == key)
                .and_then(|(_, v)| value_string(v))
        })
    };
    let style = TopicStyle {
        fill: get("fill"),
        stroke: get("border-line-color").or_else(|| get("stroke")),
        color: get("color"),
        bold: get("font-weight").map(|v| v == "bold" || v == "700" || v == "600"),
        font_size: get("font-size").and_then(|v| v.trim_end_matches("pt").trim().parse::<u16>().ok()),
        font_family: get("font-family"),
        shape_class: props.get("shape-class").and_then(value_string),
        line_class: props.get("line-class").and_then(value_string),
        line_color: props.get("line-color").and_then(value_string),
        line_width: props.get("line-width").and_then(value_string),
        style_id: value?.get("id").and_then(value_string),
        italic: get("font-style").map(|v| v == "italic" || v == "oblique"),
        strike: get("text-decoration").map(|v| v.contains("line-through")),
        align: get("text-align").filter(|v| v != "inherit"),
        text_case: get("text-transform").filter(|v| v != "none"),
        fill_pattern: props.get("fill-pattern").and_then(value_string),
        border_width: props.get("border-line-width").and_then(value_string),
        border_pattern: props.get("border-line-pattern").and_then(value_string),
        arrow_end: props.get("arrow-end-class").and_then(value_string),
        line_pattern: props.get("line-pattern").and_then(value_string),
        line_tapered: props.get("line-tapered").and_then(value_bool),
        opacity: props.get("svg:opacity").and_then(value_number),
    };
    if style.is_empty() { None } else { Some(style) }
}

pub fn parse_topic(value: &Value) -> Topic {
    let mut extra = value.as_object().cloned().unwrap_or_default();
    let id = extra.get("id").and_then(value_string).unwrap_or_else(new_id);
    let title = extra
        .get("title")
        .and_then(value_string)
        .unwrap_or_else(|| "未命名主题".into());
    let children_value = extra.get("children").cloned();
    let note = parse_note(extra.get("notes"));
    extra.insert("__noteOriginal".into(), json!(note));

    let image = extra
        .get("image")
        .and_then(|v| v.get("src").or_else(|| Some(v)))
        .and_then(value_string)
        .and_then(|src| sanitize_resource_name(src.strip_prefix("xap:").unwrap_or(&src)));

    let side = extra
        .get("direction")
        .and_then(value_string)
        .and_then(|v| match v.to_ascii_lowercase().as_str() {
            "left" => Some(Side::Left),
            "right" => Some(Side::Right),
            _ => None,
        })
        .or_else(|| {
            extra.get("position").and_then(|p| p.get("x")).and_then(Value::as_f64)
                .filter(|x| x.abs() > 1.0)
                .map(|x| if x < 0.0 { Side::Left } else { Side::Right })
        });

    let position = extra.get("position").and_then(|p| {
        Some(Position {
            x: p.get("x")?.as_f64()?,
            y: p.get("y")?.as_f64()?,
        })
    });
    let folded = extra.get("branch").and_then(Value::as_str) == Some("folded")
        || extra.get("folded").and_then(Value::as_bool).unwrap_or(false);
    let markers = parse_markers(extra.get("markers"));
    let labels = parse_labels(extra.get("labels"));
    let style = parse_style(extra.get("style"));
    let structure_class = extra.get("structureClass").and_then(value_string);
    let href = extra.get("href").and_then(value_string);
    let title_unedited = extra.get("titleUnedited").and_then(Value::as_bool).unwrap_or(false);
    let custom_width = extra.get("customWidth").and_then(Value::as_f64);

    // Snapshot the raw JSON of fields whose shape XMind may extend (image
    // align/width/height, marker objects, ...). If the model value is
    // untouched we re-emit these bytes verbatim instead of rebuilding them.
    for (raw_key, source_key) in [
        ("__rawImage", "image"),
        ("__rawMarkers", "markers"),
        ("__rawLabels", "labels"),
        ("__rawDirection", "direction"),
        ("__rawCustomWidth", "customWidth"),
        ("__rawPosition", "position"),
        ("__rawChildren", "children"),
    ] {
        if let Some(raw) = extra.get(source_key).cloned() {
            extra.insert(raw_key.into(), raw);
        }
    }
    extra.insert("__hasClass".into(), json!(extra.get("class").is_some()));
    let parsed_child_count = parse_children(children_value.as_ref(), "attached").len()
        + parse_children(children_value.as_ref(), "detached").len()
        + parse_children(children_value.as_ref(), "summary").len()
        + parse_children(children_value.as_ref(), "callout").len();
    extra.insert("__parsedChildCount".into(), json!(parsed_child_count));
    extra.insert("__parsedImage".into(), json!(image.clone().unwrap_or_default()));
    extra.insert("__parsedMarkers".into(), json!(markers.clone()));
    extra.insert("__parsedLabels".into(), json!(labels.clone()));
    extra.insert("__parsedSide".into(), json!(side_str(side)));
    extra.insert("__parsedCustomWidth".into(), json!(custom_width));
    extra.insert(
        "__parsedPosition".into(),
        position.as_ref().map(|p| json!([p.x, p.y])).unwrap_or(Value::Null),
    );

    // `notes` and `style` are intentionally kept in `extra`: they may carry
    // rich html notes / unknown style properties that we must not destroy.
    for key in [
        "id", "title", "titleUnedited", "structureClass", "children", "branch",
        "folded", "markers", "labels", "image", "href", "position",
        "customWidth", "direction",
    ] {
        extra.remove(key);
    }

    Topic {
        id,
        title,
        note,
        folded,
        children: parse_children(children_value.as_ref(), "attached"),
        detached: parse_children(children_value.as_ref(), "detached"),
        summary: parse_children(children_value.as_ref(), "summary"),
        callout: parse_children(children_value.as_ref(), "callout"),
        markers,
        labels,
        image,
        image_size: None,
        style,
        side,
        structure_class,
        href,
        position,
        title_unedited,
        custom_width,
        extra,
    }
}

// ---------------------------------------------------------------------------
// model -> content.json
// ---------------------------------------------------------------------------

fn sheet_to_json(sheet: &Sheet, doc: &Document) -> Value {
    let mut obj = sheet.extra.clone();
    obj.retain(|key, _| !key.starts_with("__"));
    obj.insert("id".into(), json!(sheet.id));
    if sheet.extra.get("__hasClass").and_then(Value::as_bool).unwrap_or(true) {
        obj.insert("class".into(), json!("sheet"));
    }
    obj.insert("title".into(), json!(sheet.title));
    obj.insert("rootTopic".into(), topic_to_json(&sheet.root, true));

    // Keep a third-party theme verbatim unless this document actually carries
    // a 配色方案, in which case only the palette-owned keys are patched.
    let mut theme = match sheet.extra.get("theme") {
        Some(existing) => existing.clone(),
        None => theme::theme_for(doc.theme),
    };
    // Only patch when the palette was changed here; a theme that came from the
    // file (ours or real XMind's) must survive a plain open/save untouched.
    if doc.palette_dirty {
        theme::apply_palette(
            &mut theme,
            doc.palette.as_deref(),
            doc.branch_colors.as_deref(),
            doc.center_color.as_deref(),
        );
    }
    sync_alignment_by_level(&mut theme, doc.sibling_align);
    obj.insert("theme".into(), theme);
    insert_or_remove(
        &mut obj,
        "xmindRsPaletteVariant",
        doc.palette_variant.map(|v| json!(v)),
    );
    Value::Object(obj)
}

fn insert_or_remove(obj: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(v) => { obj.insert(key.into(), v); }
        None => { obj.remove(key); }
    }
}

fn set_prop(props: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(v) = value {
        props.insert(key.into(), json!(v));
    }
}

pub fn topic_to_json(topic: &Topic, is_root: bool) -> Value {
    let mut obj = topic.extra.clone();
    obj.retain(|key, _| !key.starts_with("__"));
    obj.insert("id".into(), json!(topic.id));
    obj.insert("title".into(), json!(topic.title));
    if is_root && topic.extra.get("__hasClass").and_then(Value::as_bool).unwrap_or(true) {
        obj.insert("class".into(), json!("topic"));
    }
    insert_or_remove(&mut obj, "titleUnedited", topic.title_unedited.then(|| json!(true)));
    insert_or_remove(&mut obj, "structureClass", topic.structure_class.as_ref().map(|v| json!(v)));

    let mut children = Map::new();
    for (key, list) in [
        ("attached", &topic.children),
        ("detached", &topic.detached),
        ("summary", &topic.summary),
        ("callout", &topic.callout),
    ] {
        if !list.is_empty() {
            let items: Vec<Value> = list.iter().map(|child| topic_to_json(child, false)).collect();
            children.insert(key.into(), Value::Array(items));
        }
    }
    let child_count = topic.children.len() + topic.detached.len()
        + topic.summary.len() + topic.callout.len();
    let parsed_count = topic.extra.get("__parsedChildCount")
        .and_then(Value::as_u64).unwrap_or(0) as usize;
    if child_count == 0 && parsed_count == 0 {
        if let Some(raw) = topic.extra.get("__rawChildren") {
            obj.insert("children".into(), raw.clone());
        } else {
            obj.remove("children");
        }
    } else {
        insert_or_remove(&mut obj, "children", (!children.is_empty()).then(|| Value::Object(children)));
    }
    insert_or_remove(&mut obj, "branch", topic.folded.then(|| json!("folded")));
    obj.remove("folded");

    // Restore the exact raw JSON when a field was not edited in our model.
    fn unchanged(extra: &Map<String, Value>, key: &str, current: &Value) -> bool {
        extra.get(key).is_some_and(|parsed| parsed == current)
    }
    fn sync_list(
        obj: &mut Map<String, Value>,
        extra: &Map<String, Value>,
        key: &str,
        parsed_key: &str,
        raw_key: &str,
        current: &[String],
        to_json: fn(&[String]) -> Value,
    ) {
        if unchanged(extra, parsed_key, &json!(current)) {
            if let Some(raw) = extra.get(raw_key) {
                obj.insert(key.into(), raw.clone());
                return;
            }
        }
        if !current.is_empty() || obj.contains_key(key) {
            obj.insert(key.into(), to_json(current));
        }
    }
    // Markers get their own path: an unedited raw array is only worth keeping when
    // it already uses `markerId` objects. Bare strings (what this app used to write,
    // and what the desktop app refuses) must be re-emitted in the object form so a
    // load + save repairs such a file instead of copying the defect forward.
    let raw_markers_usable = topic
        .extra
        .get("__rawMarkers")
        .and_then(Value::as_array)
        .is_some_and(|entries| entries.iter().all(|m| m.get("markerId").is_some()));
    if unchanged(&topic.extra, "__parsedMarkers", &json!(topic.markers)) && raw_markers_usable {
        if let Some(raw) = topic.extra.get("__rawMarkers") {
            obj.insert("markers".into(), raw.clone());
        }
    } else if !topic.markers.is_empty() || obj.contains_key("markers") {
        obj.insert("markers".into(), markers_json(&topic.markers));
    }
    sync_list(&mut obj, &topic.extra, "labels", "__parsedLabels", "__rawLabels", &topic.labels, |v| json!(v));

    match &topic.image {
        Some(id) => {
            if unchanged(&topic.extra, "__parsedImage", &json!(id)) {
                if let Some(raw) = topic.extra.get("__rawImage") {
                    obj.insert("image".into(), raw.clone());
                }
            } else {
                let mut image_obj = topic
                    .extra
                    .get("__rawImage")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                image_obj.insert("src".into(), json!(format!("xap:resources/{id}")));
                obj.insert("image".into(), Value::Object(image_obj));
            }
        }
        None => { obj.remove("image"); }
    }
    let current_side = json!(side_str(topic.side));
    if unchanged(&topic.extra, "__parsedSide", &current_side) {
        match topic.extra.get("__rawDirection") {
            Some(raw) => { obj.insert("direction".into(), raw.clone()); }
            None => { obj.remove("direction"); }
        }
    } else {
        insert_or_remove(&mut obj, "direction", (!side_str(topic.side).is_empty()).then(|| current_side));
    }
    insert_or_remove(&mut obj, "href", topic.href.as_ref().map(|v| json!(v)));
    // Numbers: XMind writes ints (e.g. "customWidth":150, "position":{"x":-120}),
    // while our model uses f64. Restore the exact raw JSON when unedited.
    let width_now = json!(topic.custom_width);
    if unchanged(&topic.extra, "__parsedCustomWidth", &width_now) {
        if let Some(raw) = topic.extra.get("__rawCustomWidth") {
            obj.insert("customWidth".into(), raw.clone());
        }
    } else {
        insert_or_remove(&mut obj, "customWidth", topic.custom_width.map(|v| json!(v)));
    }
    let position_now = topic
        .position
        .as_ref()
        .map(|p| json!([p.x, p.y]))
        .unwrap_or(Value::Null);
    if unchanged(&topic.extra, "__parsedPosition", &position_now) {
        if let Some(raw) = topic.extra.get("__rawPosition") {
            obj.insert("position".into(), raw.clone());
        }
    } else {
        insert_or_remove(
            &mut obj,
            "position",
            topic.position.as_ref().map(|p| json!({ "x": p.x, "y": p.y })),
        );
    }
    // Notes: keep the original rich (html/text) object untouched unless the
    // user actually changed the plain text.
    let original = topic.extra.get("__noteOriginal").and_then(Value::as_str).unwrap_or("");
    if topic.note != original {
        if topic.note.is_empty() {
            obj.remove("notes");
        } else {
            obj.insert("notes".into(), json!({ "plain": { "content": topic.note } }));
        }
    }

    if let Some(style) = &topic.style {
        let raw = obj.get("style").cloned().unwrap_or_else(|| json!({}));
        let mut props = raw
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        set_prop(&mut props, "svg:fill", style.fill.clone());
        set_prop(&mut props, "border-line-color", style.stroke.clone());
        set_prop(&mut props, "fo:color", style.color.clone());
        set_prop(&mut props, "fo:font-family", style.font_family.clone());
        set_prop(&mut props, "shape-class", style.shape_class.clone());
        set_prop(&mut props, "line-class", style.line_class.clone());
        set_prop(&mut props, "line-color", style.line_color.clone());
        set_prop(&mut props, "line-width", style.line_width.clone());
        set_prop(&mut props, "fill-pattern", style.fill_pattern.clone());
        set_prop(&mut props, "border-line-width", style.border_width.clone());
        set_prop(&mut props, "border-line-pattern", style.border_pattern.clone());
        set_prop(&mut props, "arrow-end-class", style.arrow_end.clone());
        set_prop(&mut props, "line-pattern", style.line_pattern.clone());
        set_prop(&mut props, "fo:text-align", style.align.clone());
        set_prop(&mut props, "fo:text-transform", style.text_case.clone());
        if let Some(italic) = style.italic {
            props.insert("fo:font-style".into(), json!(if italic { "italic" } else { "normal" }));
        }
        if let Some(strike) = style.strike {
            props.insert("fo:text-decoration".into(), json!(if strike { "line-through" } else { "none" }));
        }
        if let Some(tapered) = style.line_tapered {
            props.insert("line-tapered".into(), json!(tapered));
        }
        if let Some(opacity) = style.opacity {
            props.insert("svg:opacity".into(), json!(opacity));
        }
        if let Some(bold) = style.bold {
            props.insert("fo:font-weight".into(), json!(if bold { 700 } else { 400 }));
        }
        if let Some(size) = style.font_size {
            props.insert("fo:font-size".into(), json!(format!("{size}pt")));
        }
        let sid = style
            .style_id
            .clone()
            .or_else(|| raw.get("id").and_then(value_string))
            .unwrap_or_else(new_id);
        let mut style_obj = raw.as_object().cloned().unwrap_or_default();
        style_obj.insert("id".into(), json!(sid));
        style_obj.insert("properties".into(), Value::Object(props));
        obj.insert("style".into(), Value::Object(style_obj));
    }

    Value::Object(obj)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WITH_FLAG: &str = r#"[{
        "id": "s1", "class": "sheet", "title": "画布 1",
        "rootTopic": {"id": "r1", "title": "中心主题", "structureClass": "org.xmind.ui.logic.right",
            "children": {"attached": [
                {"id": "a", "title": "甲", "children": {"attached": [
                    {"id": "a1", "title": "短"}, {"id": "a2", "title": "很长的子主题标题文字"}]}},
                {"id": "b", "title": "乙", "children": {"attached": [
                    {"id": "b1", "title": "X"}, {"id": "b2", "title": "另一个很长的子主题标题"}]}}
            ]}},
        "theme": {"centralTopic": {"properties": {"alignment-by-level": "actived"}}}
    }]"#;

    #[test]
    fn alignment_by_level_is_read_from_real_xmind_themes() {
        let on = from_content_json(WITH_FLAG).expect("parse");
        assert!(on.sibling_align, "actived must turn 同级主题对齐 on");
        let off = WITH_FLAG.replace("actived", "inactived");
        assert!(!from_content_json(&off).expect("parse").sibling_align);
        let absent = WITH_FLAG.replace(
            r#"{"alignment-by-level": "actived"}"#, "{}",
        );
        assert!(!from_content_json(&absent).expect("parse").sibling_align);
    }

    #[test]
    fn toggling_alignment_writes_the_native_flag() {
        let mut doc = from_content_json(WITH_FLAG).expect("parse");
        let sheet = &doc.sheets[0];
        let theme = sheet.extra.get("theme").cloned().expect("theme");
        assert_eq!(
            theme.get("centralTopic").and_then(|v| v.get("properties"))
                .and_then(|v| v.get("alignment-by-level")).and_then(Value::as_str),
            Some("actived")
        );
        doc.sibling_align = false;
        let written = sheet_to_json(&doc.sheets[0], &doc);
        assert_eq!(
            written.get("theme").and_then(|v| v.get("centralTopic"))
                .and_then(|v| v.get("properties"))
                .and_then(|v| v.get("alignment-by-level")).and_then(Value::as_str),
            Some("inactived"),
            "XMind spells the disabled state inactived"
        );
        // A theme without the key must stay that way (byte-faithful roundtrip).
        let absent = from_content_json(&WITH_FLAG.replace(
            r#"{"alignment-by-level": "actived"}"#, "{}",
        )).expect("parse");
        let written = sheet_to_json(&absent.sheets[0], &absent);
        assert!(written.get("theme").and_then(|v| v.get("centralTopic"))
            .and_then(|v| v.get("properties"))
            .and_then(|v| v.get("alignment-by-level")).is_none());
    }
}
