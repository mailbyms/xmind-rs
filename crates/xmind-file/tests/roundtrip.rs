//! Round-trip fidelity against real .xmind templates extracted from the
//! installed XMind app (see research/FINDINGS.md). Skips when the local
//! fixtures are not present, so the crate still builds on a clean checkout.

use std::io::Read;
use std::path::PathBuf;
use std::fs;
use xmind_file::{read_xmind, to_svg, write_xmind};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../research/xmind-samples/static/mas-demo/思维导图用法.xmind")
}

fn default_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../research/xmind-samples/static/snowbird/resource/templates/default.xmind")
}

#[test]
fn real_xmind_roundtrip_preserves_tree_theme_and_resources() {
    let source = fixture();
    if !source.exists() {
        eprintln!("fixture missing, skipping: {}", source.display());
        return;
    }
    let loaded = read_xmind(&source).expect("read real xmind");
    let document = loaded.document.clone();
    assert_eq!(document.sheets.len(), 1);
    assert!(!document.root().children.is_empty());
    assert!(document.sheet().extra.contains_key("theme"), "embedded theme must survive");
    assert!(document.root().extra.contains_key("extensions"), "sheet extensions must survive");

    let resources: Vec<(String, Vec<u8>)> = loaded
        .resources
        .iter()
        .map(|r| (r.name.clone(), r.bytes.clone()))
        .collect();
    assert!(!resources.is_empty(), "template should embed images");

    let target = std::env::temp_dir().join("xmind-rs-roundtrip.xmind");
    write_xmind(&target, &document, &resources, loaded.thumbnail.as_deref())
        .expect("write xmind");

    let again = read_xmind(&target).expect("re-read our own xmind");
    assert_eq!(again.document.root().title, document.root().title);
    assert_eq!(again.document.root().children.len(), document.root().children.len());
    assert_eq!(again.document.root().children[0].title, document.root().children[0].title);
    assert_eq!(again.resources.len(), resources.len());
    assert!(again.document.sheet().extra.contains_key("theme"));
    assert!(again.document.root().extra.contains_key("extensions"));
    assert_eq!(
        again.document.root().children[0].image,
        document.root().children[0].image,
        "xap:resources references must survive"
    );

    // Container shape must match the real thing.
    let file = fs::File::open(&target).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut names = Vec::new();
    for index in 0..zip.len() {
        names.push(zip.by_index(index).unwrap().name().unwrap().to_string());
    }
    for expected in ["content.json", "metadata.json", "manifest.json", "content.xml"] {
        assert!(names.iter().any(|n| n == expected), "missing {expected}");
    }
    let manifest: serde_json::Value = {
        let mut entry = zip.by_name("manifest.json").unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut entry, &mut text).unwrap();
        serde_json::from_str(&text).unwrap()
    };
    let entries = manifest["file-entries"].as_object().unwrap();
    assert!(entries.contains_key("content.json"));
    assert!(entries.contains_key("metadata.json"));
    assert!(entries.keys().any(|k| k.starts_with("resources/")));

    if std::env::var_os("XMIND_DUMP").is_some() {
        let dump = std::env::temp_dir().join("xmind-rs-fidelity.xmind");
        fs::copy(&target, &dump).unwrap();
        eprintln!("fidelity dump: {}", dump.display());
    } else {
        let _ = fs::remove_file(&target);
    }
}

#[test]
fn default_template_warning_xml_is_not_treated_as_content() {
    let source = default_fixture();
    if !source.exists() {
        eprintln!("fixture missing, skipping: {}", source.display());
        return;
    }
    let loaded = read_xmind(&source).expect("read default template");
    assert_eq!(loaded.document.root().title, "Central Topic");
    assert!(!loaded.document.root().title.contains("该文件无法正常打开"));

    // The real template carries both a real content.json and the fixed
    // multi-language warning placeholder in content.xml.
    {
        let file = fs::File::open(&source).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut xml = String::new();
        zip.by_name("content.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("该文件无法正常打开") || xml.contains("This file can not be opened"));
        assert!(zip.by_name("content.json").is_ok());
    }

    // An archive carrying only that placeholder must be rejected, not parsed
    // into a bogus "map" made of warning text.
    let fake = std::env::temp_dir().join("xmind-rs-warning-only.xmind");
    {
        use std::io::Write;
        let file = fs::File::create(&fake).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("content.xml", options).unwrap();
        writer
            .write_all(xmind_file::CONTENT_XML_PLACEHOLDER.as_bytes())
            .unwrap();
        writer.finish().unwrap();
    }
    let error = match read_xmind(&fake) {
        Ok(_) => panic!("warning-only archive must not become a document"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("content.json"),
        "unexpected error: {error}"
    );
    let _ = fs::remove_file(&fake);
}

#[test]
fn new_document_writes_valid_xmind_container() {
    let mut document = xmind_core::Document::new("测试导图");
    let theme = xmind_file::theme_for(document.theme);
    document.sheet_mut().extra.insert("theme".into(), theme);
    let target = std::env::temp_dir().join("xmind-rs-new.xmind");
    write_xmind(&target, &document, &[], None).unwrap();
    let again = read_xmind(&target).unwrap();
    assert_eq!(again.document.root().title, "中心主题");
    assert_eq!(again.document.root().children.len(), 4);
    assert!(again.document.sheet().extra.contains_key("theme"));
    let _ = fs::remove_file(&target);
}

#[test]
fn skeleton_layers_survive_a_save_and_reopen() {
    let mut document = xmind_core::Document::new("骨架往返");
    xmind_core::set_skeleton_layers(&mut document, &xmind_core::SkeletonLayers::mind_map());
    let target = std::env::temp_dir().join("xmind-rs-skeleton.xmind");
    write_xmind(&target, &document, &[], None).unwrap();
    let again = read_xmind(&target).unwrap();
    let value = again.document.sheet().extra.get(xmind_core::SKELETON_KEY).cloned()
        .expect("sheet-level skeleton layers must be written into content.json");
    let layers = xmind_core::SkeletonLayers::from_value(Some(&value)).expect("read back");
    assert_eq!(layers, xmind_core::SkeletonLayers::mind_map());
    let _ = fs::remove_file(&target);
}

/// FINDINGS §39: the six quick themes below the 配色方案 drop-down are chosen
/// per scheme, so the active index must survive a save/reopen.
#[test]
fn palette_variant_survives_a_save_and_reopen() {
    let mut document = xmind_core::Document::new("配色方案往返");
    document.palette = Some("classic-classic".into());
    document.palette_variant = Some(3);
    document.palette_dirty = true;
    let target = std::env::temp_dir().join("xmind-rs-palette-variant.xmind");
    write_xmind(&target, &document, &[], None).unwrap();
    let content = entry_text(&target, "content.json");
    assert!(content.contains("xmindRsPaletteVariant"), "private key missing: {content}");
    let again = read_xmind(&target).unwrap();
    assert_eq!(again.document.palette_variant, Some(3));
    assert_eq!(again.document.palette.as_deref(), Some("classic-classic"));
    let _ = fs::remove_file(&target);
}

fn entry_text(path: &std::path::Path, name: &str) -> String {
    let file = fs::File::open(path).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut entry = zip.by_name(name).unwrap();
    let mut text = String::new();
    entry.read_to_string(&mut text).unwrap();
    text
}

/// The strongest fidelity guarantee: for every real template shipped inside
/// the installed XMind, our re-serialized content.json must be *identical* at
/// the JSON value level. No lost theme/extensions/notes/style/markers/image
/// attributes, and no invented `direction` fields.
#[test]
fn every_real_template_content_json_is_byte_faithful() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../research/xmind-samples");
    let mut checked = 0;
    let mut paths = Vec::new();
    fn collect(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect(&path, out);
                } else if path.extension().is_some_and(|e| e == "xmind") {
                    out.push(path);
                }
            }
        }
    }
    collect(&root, &mut paths);
    assert!(!paths.is_empty(), "real XMind templates should be present");

    for (index, source) in paths.iter().enumerate() {
        let loaded = read_xmind(source).expect("read template");
        let resources: Vec<(String, Vec<u8>)> = loaded
            .resources
            .iter()
            .map(|r| (r.name.clone(), r.bytes.clone()))
            .collect();
        let extras: Vec<(String, Vec<u8>)> = loaded
            .other_files
            .iter()
            .map(|f| (f.name.clone(), f.bytes.clone()))
            .collect();
        let target = std::env::temp_dir().join(format!("xmind-rs-faithful-{index}.xmind"));
        xmind_file::write_xmind_with_extras(
            &target,
            &loaded.document,
            &resources,
            loaded.thumbnail.as_deref(),
            &extras,
        )
        .expect("write template");

        let before: serde_json::Value =
            serde_json::from_str(&entry_text(source, "content.json")).unwrap();
        let after: serde_json::Value =
            serde_json::from_str(&entry_text(&target, "content.json")).unwrap();
        assert_eq!(
            before,
            after,
            "content.json changed for {}",
            source.display()
        );

        let manifest: serde_json::Value =
            serde_json::from_str(&entry_text(&target, "manifest.json")).unwrap();
        assert!(manifest["file-entries"].is_object(), "manifest shape");
        assert!(manifest["file-entries"]["content.json"].is_object());
        let _ = fs::remove_file(&target);
        checked += 1;
    }
    assert!(checked >= 3, "expected to validate all shipped templates");
}

/// Unknown archive entries must survive a save, and manifest.json must never
/// be mistaken for an image resource.
#[test]
fn unknown_archive_entries_survive_and_manifest_is_not_a_resource() {
    let source = fixture();
    let loaded = read_xmind(&source).unwrap();
    assert!(
        !loaded.resources.iter().any(|r| r.name.ends_with(".json")),
        "manifest.json leaked into the resource store"
    );
    assert_eq!(loaded.resources.len(), 8, "real SVG resources only");

    let custom = ("META-INF/custom.xml".to_string(), b"<custom/>".to_vec());
    let resources: Vec<(String, Vec<u8>)> = loaded
        .resources
        .iter()
        .map(|r| (r.name.clone(), r.bytes.clone()))
        .collect();
    let target = std::env::temp_dir().join("xmind-rs-extras.xmind");
    xmind_file::write_xmind_with_extras(
        &target,
        &loaded.document,
        &resources,
        None,
        &[custom.clone()],
    )
    .unwrap();
    assert_eq!(entry_text(&target, "META-INF/custom.xml"), "<custom/>");
    let again = read_xmind(&target).unwrap();
    assert_eq!(again.other_files.len(), 1);
    assert_eq!(again.other_files[0].name, "META-INF/custom.xml");
    assert_eq!(again.other_files[0].bytes, custom.1);
    let _ = fs::remove_file(&target);
}

/// A 配色方案 must be written into `sheet.theme` (where real XMind keeps it)
/// and read back on open, so saving and reopening keeps the colours.
#[test]
fn color_palette_survives_roundtrip() {
    let source = fixture();
    if !source.exists() {
        eprintln!("fixture missing, skipping: {}", source.display());
        return;
    }
    let mut document = read_xmind(&source).unwrap().document;
    document.palette = Some("vivid-energy".into());
    document.center_color = Some("#0D0D0D".into());
    document.branch_colors = Some(vec![
        "#F22816".into(), "#F2B807".into(), "#233ED9".into(), "#F22816".into(),
    ]);
    document.palette_dirty = true;

    let target = std::env::temp_dir().join("xmind-rs-palette.xmind");
    write_xmind(&target, &document, &[], None).unwrap();

    let theme: serde_json::Value = serde_json::from_str(&entry_text(&target, "content.json")).unwrap();
    let sheet = &theme[0]["theme"];
    assert_eq!(sheet["colorThemeId"], "XMindRS-vivid-energy");
    assert_eq!(sheet["map"]["properties"]["color-list"], "#F22816 #F2B807 #233ED9 #F22816");
    assert_eq!(sheet["centralTopic"]["properties"]["svg:fill"], "#0D0D0D");
    assert_eq!(sheet["centralTopic"]["properties"]["fo:color"], "#ffffff");

    // Reopen: the palette state must come back from the theme.
    let again = read_xmind(&target).unwrap().document;
    assert_eq!(again.palette.as_deref(), Some("vivid-energy"));
    assert_eq!(again.center_color.as_deref(), Some("#0D0D0D"));
    assert_eq!(again.branch_colors.as_deref(), document.branch_colors.as_deref());
    assert!(!again.palette_dirty, "a freshly opened file has no pending palette edit");

    // A second save without touching the palette must be byte-stable.
    let first = entry_text(&target, "content.json");
    let target2 = std::env::temp_dir().join("xmind-rs-palette-2.xmind");
    write_xmind(&target2, &again, &[], None).unwrap();
    assert_eq!(first, entry_text(&target2, "content.json"));

    let _ = fs::remove_file(&target);
    let _ = fs::remove_file(&target2);
}

/// A map painted by real XMind must keep its colours when we open and render
/// it: the sheet theme's branch cycle and central fill drive the canvas.
#[test]
fn foreign_theme_colours_reach_the_canvas() {
    let source = fixture();
    if !source.exists() {
        eprintln!("fixture missing, skipping: {}", source.display());
        return;
    }
    let document = read_xmind(&source).unwrap().document;
    let color_list = document.branch_colors.clone().expect("color-list should load");
    assert!(color_list.len() >= 2);
    let center = document.center_color.clone().expect("central fill should load");
    assert!(center.starts_with('#'));

    let layout = xmind_core::compute_layout(&document);
    assert_eq!(layout.theme.branches, color_list);
    let root = layout.nodes.iter().find(|n| n.depth == 0).unwrap();
    assert_eq!(root.style.fill, center);
    // The label must be dark ink when the centre is painted light.  A real
    // theme states it explicitly (`fo:color: #000000`); a file without one
    // gets `readable_on`'s CSS keyword `black` instead.
    if center.to_uppercase() == "#FFFFFF" {
        assert!(
            matches!(root.style.color.as_str(), "black" | "#000000" | "#000"),
            "unexpected ink on a white central topic: {}", root.style.color
        );
    }
}

/// Underline shapes have no plate, so the SVG exporter must emit the theme's
/// rule (branch hue + border width) instead of an empty rectangle.
#[test]
fn underline_shapes_export_their_theme_colour() {
    let mut document = xmind_core::Document::new("SVG 主题");
    document.sheets[0].extra.insert("theme".into(), serde_json::json!({
        "map": { "properties": { "multi-line-colors": "#F04137 #F8932E" }},
        "mainTopic": { "properties": {
            "svg:fill": "#00000000",
            "shape-class": "org.xmind.topicShape.underline",
            "border-line-width": "2"
        }},
        "subTopic": { "properties": {} }
    }));
    let svg = to_svg(&document);
    assert!(svg.contains("<line"), "underline rules should be exported: {svg}");
    assert!(svg.contains("stroke=\"#F04137\""), "rule ink must follow the branch hue: {svg}");
    assert!(svg.contains("stroke-width=\"2.0\""), "rule width follows border-line-width: {svg}");
}

/// A tapered connector is a filled wedge in the editor and dashed connectors
/// keep their `line-pattern`; the SVG (and therefore PNG/PDF) export must match.
#[test]
fn svg_export_keeps_wedge_fill_and_dash() {
    let mut document = xmind_core::Document::new("线型导出");
    document.root_mut().children.truncate(1);
    let root_id = document.root().id.clone();
    let mut style = xmind_core::TopicStyle::default();
    style.line_class = Some("org.xmind.branchConnection.curve".into());
    style.line_tapered = Some(false);
    style.line_pattern = Some("handdrawn-dash".into());
    xmind_core::set_style(&mut document, &root_id, style);

    let dashed = to_svg(&document);
    assert!(dashed.contains("stroke-dasharray=\"5 4\""), "dash lost: {dashed}");

    let mut style = xmind_core::TopicStyle::default();
    style.line_tapered = Some(true);
    style.line_pattern = Some("solid".into());
    xmind_core::set_style(&mut document, &root_id, style);
    let wedge = to_svg(&document);
    assert!(!wedge.contains("stroke-dasharray"), "stale dash: {wedge}");
    let outline = wedge
        .lines()
        .find(|line| line.starts_with("<path") && line.contains("stroke=\"none\""))
        .expect("a filled wedge path");
    assert!(outline.contains("fill=\"#"), "wedge must be filled: {outline}");
}

/// A title with explicit line breaks (official files use `\r\n`) and the
/// native 概要 brace must both survive into SVG — and therefore into the
/// PNG/PDF rasterised from it.  Flattening the title into one `<text>` made
/// `test2.xmind` lose two lines and clip the last topic at the image edge.
#[test]
fn svg_export_keeps_multiline_titles_and_decor() {
    let mut doc = xmind_core::Document::new("多行导出");
    doc.sheets[0].extra.insert("theme".into(), serde_json::json!({
        "relationship": { "properties": { "line-pattern": "dash" }}
    }));
    let root = doc.root().id.clone();
    let child = xmind_core::ops::add_child(&mut doc, &root, "第一行\r\n第二行\r\n第三行\r").unwrap();
    xmind_core::ops::add_summary(&mut doc, &root, "概要").unwrap();
    xmind_core::ops::add_relationship(&mut doc, &root, &child, "联系").unwrap();

    let svg = to_svg(&doc);
    assert!(!svg.contains('\r'), "CR must not leak into the SVG: {svg}");
    assert!(svg.matches("<tspan").count() >= 3, "three lines expected: {svg}");
    for line in ["第一行", "第二行", "第三行"] {
        assert!(svg.contains(line), "missing line {line}: {svg}");
    }

    let layout = xmind_core::compute_layout(&doc);
    let frame = layout.frames.iter().find(|f| f.kind == "summary").expect("概要 brace");
    assert!(svg.contains(&frame.path[..24]), "brace path missing from export: {svg}");
    assert!(svg.contains("link-arrow-0"), "联系 arrow marker missing: {svg}");
    assert!(svg.contains("stroke-dasharray=\"9 3\""), "联系 dash array missing: {svg}");
    assert!(svg.contains("paint-order=\"stroke\""), "decor labels need halo: {svg}");
}

/// SVG export must be cropped to the drawn content. `compute_layout` keeps a
/// 480x320 minimum so the editor viewport never collapses, but a one-branch
/// export would then be a topic lost in white space (PNG/PDF inherit this).
#[test]
fn svg_export_crops_to_content() {
    let mut document = xmind_core::Document::new("分支导出");
    let root_id = document.root().id.clone();
    document.sheets[0].root.children.truncate(1);
    let child_id = document.root().children[0].id.clone();
    // Exporting a branch rebuilds the document around that topic, exactly like
    // the command does: the branch becomes the central topic.
    let branch = document
        .sheets
        .iter_mut()
        .find_map(|sheet| {
            let one = sheet.root.children.remove(0);
            Some(one)
        })
        .expect("a branch to export");
    document.sheets[0].root = branch;
    assert_ne!(document.root().id, root_id);
    assert_eq!(document.root().id, child_id, "the branch is now the centre");

    let svg = to_svg(&document);
    let view = svg
        .split("viewBox=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("viewBox present");
    let nums: Vec<f64> = view
        .split_whitespace()
        .map(|value| value.parse().expect("numeric viewBox"))
        .collect();
    assert_eq!(nums.len(), 4, "viewBox is x y w h: {view}");
    assert!(nums[2] < 480.0, "canvas should be cropped, got {view}");
    assert!(nums[3] < 320.0, "canvas should be cropped, got {view}");
    assert!(nums[2] > 40.0 && nums[3] > 24.0, "crop must keep the topic: {view}");
    // width/height mirror the viewBox so the rasteriser picks the same box.
    assert!(svg.contains(&format!("width=\"{:.0}\"", nums[2])), "width attr: {svg}");
    assert!(svg.contains(&format!("height=\"{:.0}\"", nums[3])), "height attr: {svg}");
    // The crop is not degenerate: the background rect covers the whole box.
    assert!(svg.contains(&format!(
        "x=\"{:.1}\" y=\"{:.1}\" width=\"{:.0}\" height=\"{:.0}\"",
        nums[0], nums[1], nums[2], nums[3]
    )));
}

/// SVG export must match the canvas: official font stack, per-topic family,
/// `ARROWLINEPATTERN` dashes and real (coloured) arrow markers.
#[test]
fn svg_exports_font_stack_dashes_and_arrow_markers() {
    let mut doc = xmind_core::Document::new("导出线条");
    doc.sheets[0].extra.insert("theme".into(), serde_json::json!({
        "centralTopic": { "properties": { "fo:font-family": "Montserrat" }},
        "mainTopic": { "properties": {} },
        "subTopic": { "properties": {} }
    }));
    let root_id = doc.root().id.clone();
    let mut root_style = xmind_core::TopicStyle::default();
    root_style.line_pattern = Some("dash-dot-dot".into());
    root_style.line_tapered = Some(false);
    xmind_core::set_style(&mut doc, &root_id, root_style);
    let child_ids: Vec<String> = doc.root().children.iter().map(|t| t.id.clone()).collect();
    for id in child_ids {
        let mut style = xmind_core::TopicStyle::default();
        style.arrow_end = Some("org.xmind.arrowShape.triangle".into());
        xmind_core::set_style(&mut doc, &id, style);
    }
    let svg = to_svg(&doc);

    assert!(svg.contains("NeverMind"), "官方字体栈 must be exported: {svg}");
    assert!(svg.contains("Microsoft YaHei"), "CJK fallback must be exported: {svg}");
    assert!(svg.contains("font-family=\"&apos;Montserrat&apos;"), "per-topic theme family: {svg}");
    assert!(svg.contains("stroke-dasharray=\"6 3 1.5 3 1.5 3\""), "dash-dot-dot: {svg}");
    assert!(svg.contains("<marker id=\"arrow-0\""), "arrow marker defs: {svg}");
    assert!(svg.contains("marker-end=\"url(#arrow-0)\""), "marker reference: {svg}");
    assert!(svg.contains("<path d=\"M0 -3.4 L6 0 L0 3.4 Z\""), "triangle body: {svg}");
}

/// XMind's desktop writer emits markers as `[{"markerId": "..."}]`
/// (research/asar-src/renderer/2907.js: `N.markers = D.map((e) => ({ markerId: e }))`).
/// A bare string array makes the shipped app refuse the file — the canvas stays at
/// "主题: 0" with no error dialog — so the shape is part of the format contract.
#[test]
fn markers_are_written_as_marker_id_objects() {
    let source = fixture();
    if !source.exists() {
        eprintln!("fixture missing, skipping: {}", source.display());
        return;
    }
    let loaded = read_xmind(&source).expect("read real xmind");
    let mut document = loaded.document.clone();
    let root_id = document.root().id.clone();
    {
        let root = document.root_mut();
        root.markers = vec!["priority-2".into(), "flag-red".into()];
    }
    let resources: Vec<(String, Vec<u8>)> = loaded
        .resources
        .iter()
        .map(|r| (r.name.clone(), r.bytes.clone()))
        .collect();
    let target = std::env::temp_dir().join("xmind-rs-marker-shape.xmind");
    write_xmind(&target, &document, &resources, None).expect("write xmind");

    let file = fs::File::open(&target).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut raw = String::new();
    zip.by_name("content.json").unwrap().read_to_string(&mut raw).unwrap();
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let markers = json[0]["rootTopic"]["markers"].clone();
    assert_eq!(
        markers,
        serde_json::json!([{ "markerId": "priority-2" }, { "markerId": "flag-red" }]),
        "markers must be markerId objects, got {markers}"
    );

    let again = read_xmind(&target).expect("re-read");
    assert_eq!(again.document.root().markers, vec!["priority-2".to_string(), "flag-red".to_string()]);
    assert_eq!(root_id, again.document.root().id);
}

/// A file written by an older build stored markers as bare strings, which the
/// desktop app refuses to open. Loading and saving it must repair the shape
/// instead of copying the raw array through untouched.
#[test]
fn resaving_repairs_legacy_string_markers() {
    use std::io::Write;
    let source = std::env::temp_dir().join("xmind-rs-legacy-markers.xmind");
    {
        let file = fs::File::create(&source).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("content.json", opts).unwrap();
        zip.write_all(br#"[{"class":"sheet","id":"s1","title":"s","rootTopic":{"id":"t1","class":"topic","title":"R","markers":["priority-2"]}}]"#).unwrap();
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(br#"{"file-entries":{"content.json":{}}}"#).unwrap();
        zip.start_file("metadata.json", opts).unwrap();
        zip.write_all(br#"{"activeSheetId":"s1"}"#).unwrap();
        zip.finish().unwrap();
    }

    let loaded = read_xmind(&source).expect("read legacy file");
    assert_eq!(loaded.document.root().markers, vec!["priority-2".to_string()]);
    let target = std::env::temp_dir().join("xmind-rs-legacy-markers-out.xmind");
    write_xmind(&target, &loaded.document, &[], None).expect("write");

    let file = fs::File::open(&target).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut raw = String::new();
    zip.by_name("content.json").unwrap().read_to_string(&mut raw).unwrap();
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        json[0]["rootTopic"]["markers"],
        serde_json::json!([{ "markerId": "priority-2" }]),
        "legacy string markers must be rewritten as objects: {raw}"
    );
}
