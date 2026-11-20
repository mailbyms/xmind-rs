use crate::{marker_icons::marker_icon_svg, xml_escape};
use base64::Engine as _;
use std::collections::HashMap;
use xmind_core::{compute_layout, node_title_lines, Document, LaidOutNode, ThemePalette, Topic};

/// Same stack as `--topic-font` in `src/styles.css` and the one the desktop
/// bundle writes into `fo:font-family`.  `fontEmbed.ts` embeds the two OFL
/// families into exported SVG so PNG/PDF rasterisation can actually use them.
pub const FONT_STACK: &str =
    "'Montserrat', 'NeverMind', 'Microsoft YaHei', 'PingFang SC', 'Microsoft JhengHei', sans-serif";

/// `ARROWLINEPATTERN` → SVG dash array.  Mirrors `dashArray()` in MapCanvas.tsx.
fn dash_attr(dash: Option<&str>) -> &'static str {
    match dash {
        Some("dash") => " stroke-dasharray=\"5 4\"",
        Some("dot") => " stroke-dasharray=\"1.5 3\"",
        Some("round-dot") => " stroke-dasharray=\"0 4\" stroke-linecap=\"round\"",
        Some("dash-dot") => " stroke-dasharray=\"6 3 1.5 3\"",
        Some("dash-dot-dot") => " stroke-dasharray=\"6 3 1.5 3 1.5 3\"",
        _ => "",
    }
}

/// Body of one `arrow-end-class` marker.  The canvas uses `context-stroke`;
/// a standalone SVG has no such context, so the exporter bakes in the edge
/// colour.  Mirrors `ArrowDefs` in `src/editor/MapCanvas.tsx`.
fn arrow_body(kind: &str, c: &str) -> Option<String> {
    let fill = |d: &str| format!("<path d=\"{d}\" fill=\"{c}\"/>");
    let line = |d: &str, w: f64| format!(
        "<path d=\"{d}\" fill=\"none\" stroke=\"{c}\" stroke-width=\"{w}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
    );
    Some(match kind {
        "normal" => line("M0 -3 L6 0 L0 3", 1.6),
        "dot" => format!("<circle cx=\"3\" cy=\"0\" r=\"2.6\" fill=\"{c}\"/>"),
        "triangle" => fill("M0 -3.4 L6 0 L0 3.4 Z"),
        "spearhead" => fill("M0 -3.6 L7 0 L0 3.6 L3 0 Z"),
        "square" => format!("<rect x=\"0\" y=\"-2.6\" width=\"5.2\" height=\"5.2\" fill=\"{c}\"/>"),
        "diamond" => fill("M0 0 L3.4 -3 L6.8 0 L3.4 3 Z"),
        "herringbone" => line("M0 -3 L4 0 L0 3 M3 -3 L7 0 L3 3", 1.4),
        "ring" => format!("<circle cx=\"3\" cy=\"0\" r=\"2.6\" fill=\"none\" stroke=\"{c}\" stroke-width=\"1.4\"/>"),
        "eye" => line("M0 0 L3.4 -2.4 L6.8 0 L3.4 2.4 Z", 1.4),
        "doublearrow" => fill("M0 -3 L4 0 L0 3 Z M4 -3 L8 0 L4 3 Z"),
        "squarering" => format!("<rect x=\"0.7\" y=\"-2.6\" width=\"4.6\" height=\"5.2\" fill=\"none\" stroke=\"{c}\" stroke-width=\"1.3\"/>"),
        "knot" => line("M0 -3 L5 3 M0 3 L5 -3", 1.4),
        "trianglering" => line("M0 -3.4 L6 0 L0 3.4 Z", 1.3),
        "antiTriangle" => fill("M0 0 L6 -3.4 L6 3.4 Z"),
        "attached" => fill("M0 0 L5 -2.4 L5 2.4 Z"),
        "hook" => line("M0 -3.4 Q5 -3.4 5 0 Q5 3.4 0 3.4", 1.6),
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Markdown,
    Opml,
    Svg,
    Json,
    Text,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "md" | "markdown" => Some(Self::Markdown),
            "opml" => Some(Self::Opml),
            "svg" => Some(Self::Svg),
            "json" => Some(Self::Json),
            "txt" | "text" => Some(Self::Text),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Opml => "opml",
            Self::Svg => "svg",
            Self::Json => "json",
            Self::Text => "txt",
        }
    }
}

pub fn export_document(doc: &Document, format: ExportFormat) -> Vec<u8> {
    match format {
        ExportFormat::Markdown => to_markdown(doc).into_bytes(),
        ExportFormat::Opml => to_opml(doc).into_bytes(),
        ExportFormat::Svg => to_svg(doc).into_bytes(),
        ExportFormat::Json => serde_json::to_string_pretty(doc)
            .unwrap_or_else(|_| "{}".into())
            .into_bytes(),
        ExportFormat::Text => to_text(doc).into_bytes(),
    }
}

pub fn to_markdown(doc: &Document) -> String {
    let mut out = format!("# {}\n\n", doc.root().title);
    fn walk(topic: &Topic, depth: usize, out: &mut String) {
        for child in &topic.children {
            out.push_str(&"  ".repeat(depth));
            out.push_str("- ");
            out.push_str(&child.title);
            out.push('\n');
            if !child.note.is_empty() {
                for line in child.note.lines() {
                    out.push_str(&"  ".repeat(depth + 1));
                    out.push_str("> ");
                    out.push_str(line);
                    out.push('\n');
                }
            }
            walk(child, depth + 1, out);
        }
    }
    walk(doc.root(), 0, &mut out);
    out
}

pub fn to_text(doc: &Document) -> String {
    fn walk(topic: &Topic, depth: usize, out: &mut String) {
        out.push_str(&"    ".repeat(depth));
        out.push_str(&topic.title);
        out.push('\n');
        for child in &topic.children {
            walk(child, depth + 1, out);
        }
    }
    let mut out = String::new();
    walk(doc.root(), 0, &mut out);
    out
}

pub fn to_opml(doc: &Document) -> String {
    fn outline(topic: &Topic, out: &mut String) {
        out.push_str(&format!(
            "<outline text=\"{}\"{}>\n",
            xml_escape(&topic.title),
            if topic.note.is_empty() {
                String::new()
            } else {
                format!(" _note=\"{}\"", xml_escape(&topic.note))
            }
        ));
        for child in &topic.children {
            outline(child, out);
        }
        out.push_str("</outline>\n");
    }
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n<head><title>");
    out.push_str(&xml_escape(&doc.title));
    out.push_str("</title></head>\n<body>\n");
    outline(doc.root(), &mut out);
    out.push_str("</body>\n</opml>\n");
    out
}

/// Standalone SVG built from the exact same Rust layout the editor renders, so
/// the export matches what the user sees on screen.
///
/// The canvas is cropped to the drawn content: `compute_layout` pads the map to
/// `PAD` and enforces a 480x320 minimum for the *editor* viewport, which would
/// leave a single-topic branch floating in empty white space.
/// Approximate bounds of a path built by our own layout (`M`/`L`/`C`/`Q`
/// only). Control points are included, so the crop can only grow — never cut
/// a 概要 brace or 联系 line that lives outside every topic box.
fn path_bounds(path: &str) -> Option<(f64, f64, f64, f64)> {
    let bytes = path.as_bytes();
    let mut nums = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_digit() || b == b'-' || b == b'+' || b == b'.' {
            let start = i;
            if b == b'-' || b == b'+' { i += 1; }
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') { i += 1; }
            if let Ok(value) = path[start..i].parse::<f64>() { nums.push(value); }
            continue;
        }
        i += 1;
    }
    if nums.len() < 2 { return None; }
    let xs = nums.iter().step_by(2).copied();
    let ys = nums.iter().skip(1).step_by(2).copied();
    Some((
        xs.clone().fold(f64::INFINITY, f64::min),
        ys.clone().fold(f64::INFINITY, f64::min),
        xs.fold(f64::NEG_INFINITY, f64::max),
        ys.fold(f64::NEG_INFINITY, f64::max),
    ))
}

/// One topic label as SVG.  The canvas uses `white-space: pre-wrap` and the
/// backend's greedy wrapper; emit one `<tspan>` per line so a title with
/// `\n` / `\r\n` (or an auto-wrapped long label) is not flattened into a
/// single, clipped `<text>` in the exported PNG/PDF.
fn svg_label(node: &LaidOutNode, pal: &ThemePalette) -> String {
    let lines = node_title_lines(node);
    let size = node.style.font_size;
    let line_height = f64::from(size) * 1.333;
    let is_card = node.image.is_some() && node.image_width > 0.0 && node.image_height > 0.0;
    let first = if is_card {
        // `.node.has-image` stacks the label 12px below the artwork; its
        // 1.333em line box puts the first baseline ~1.02em from the top.
        node.y + 12.0 + node.image_height + 12.0 + f64::from(size) * 1.02
    } else {
        node.y + node.height / 2.0
            - (lines.len().saturating_sub(1) as f64) * line_height / 2.0
            + f64::from(size) * 0.35
    };
    let (x, anchor) = if is_card {
        (node.x + 20.0, "")
    } else if !node.markers.is_empty() {
        // MapCanvas sets `paddingLeft: markerPad` on the box and lays the
        // marker row out inside it, so the label starts after BOTH.  Using
        // `text_pad` here (zero for marker topics) would paint the first
        // glyphs over the last icon, even with the left-align override below.
        (node.x + node.marker_pad + node.marker_width, "")
    } else if node.style.align == "center" {
        (node.x + node.width / 2.0, " text-anchor=\"middle\"")
    } else {
        (node.x + node.text_pad + node.marker_width, "")
    };
    let family = node.style.font_family.as_deref()
        .map(|f| format!(" font-family=\"{}\"", xml_escape(f)))
        .unwrap_or_default();
    let italic = if node.style.italic { " font-style=\"italic\"" } else { "" };
    let strike = if node.style.strike { " text-decoration=\"line-through\"" } else { "" };
    let mut out = format!(
        "<text x=\"{x:.1}\" y=\"{first:.1}\"{anchor} fill=\"{}\" font-size=\"{}\" font-weight=\"{}\"{family}{italic}{strike} xml:space=\"preserve\">",
        xml_escape(&node.style.color), node.style.font_size, node.style.font_weight,
    );
    for (index, line) in lines.iter().enumerate() {
        let dy = if index == 0 { String::new() } else { format!(" dy=\"{line_height:.1}\"") };
        out.push_str(&format!("<tspan x=\"{x:.1}\"{dy}>{}</tspan>", xml_escape(line)));
    }
    out.push_str("</text>\n");
    let _ = pal;
    out
}

/// Canvas marker chips are the exact 24x24 catalogue SVGs, shown at the
/// document's native icon size with a 3px white ring (`.marker-chip img`).
/// A data URL keeps each icon in its own SVG document, so the `mask`/`clip`
/// ids used by some catalogue entries cannot collide when several markers
/// share one export.
fn marker_icon_href(id: &str) -> Option<String> {
    let svg = marker_icon_svg(id)?;
    Some(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
    ))
}

/// Same fallbacks as `src/lib/markers.ts` for ids outside the 58-item
/// catalogue (legacy markers written by older XMind builds).
fn marker_fallback(id: &str) -> (String, &'static str) {
    let known = match id {
        "task-start" => Some(("▶", "#f9423a")),
        "task-done" => Some(("✓", "#f9423a")),
        "task-half" => Some(("½", "#f9423a")),
        "arrow-left" => Some(("←", "#f9423a")),
        "arrow-right" => Some(("→", "#f9423a")),
        "arrow-up" => Some(("↑", "#f9423a")),
        "arrow-down" => Some(("↓", "#f9423a")),
        "arrow-refresh" => Some(("↻", "#f9423a")),
        _ => None,
    };
    if let Some((glyph, color)) = known {
        return (glyph.into(), color);
    }
    let color = [
        ("red", "#e2483f"), ("orange", "#ef8b2c"), ("yellow", "#e3a008"),
        ("green", "#28a06a"), ("blue", "#2f7ee5"), ("purple", "#8255c6"),
        ("gray", "#7d8794"),
    ].into_iter().find(|(word, _)| id.ends_with(&format!("-{word}")))
        .map(|(_, color)| color).unwrap_or("#f9423a");
    let glyph = if let Some(digit) = id.strip_prefix("priority-") {
        digit.to_string()
    } else if id.starts_with("task-") {
        "◐".into()
    } else if id.starts_with("star-") {
        "★".into()
    } else if id.starts_with("flag-") {
        "⚑".into()
    } else if id.starts_with("people-") {
        "●".into()
    } else if id.starts_with("tag-") {
        "◆".into()
    } else {
        "•".into()
    };
    (glyph, color)
}

/// `Layout.marker_width` reserves `5 + n*(icon+2) - 2 + 15` px.  The chips
/// are `icon+2` wide except the last one (`icon`), and each icon is nudged 3px
/// (2px on the last chip) inside its chip by the canvas CSS.
fn svg_marker_row(node: &LaidOutNode, out: &mut String) {
    if node.markers.is_empty() { return; }
    let size = node.marker_size.max(1.0);
    let count = node.markers.len();
    let cy = node.y + node.height / 2.0;
    for (index, id) in node.markers.iter().enumerate() {
        let last = index + 1 == count;
        let x = node.x + node.marker_pad + 5.0
            + index as f64 * (size + 2.0)
            + if last { 2.0 } else { 3.0 };
        let cx = x + size / 2.0;
        // `box-shadow: 0 0 0 3px #fff` on a circular chip.
        out.push_str(&format!(
            "<circle cx=\"{cx:.1}\" cy=\"{cy:.1}\" r=\"{r:.1}\" fill=\"#fff\"/>\n",
            r = size / 2.0 + 3.0,
        ));
        if let Some(href) = marker_icon_href(id) {
            out.push_str(&format!(
                "<image x=\"{x:.1}\" y=\"{y:.1}\" width=\"{size:.1}\" height=\"{size:.1}\" \
                 preserveAspectRatio=\"xMidYMid meet\" href=\"{href}\"/>\n",
                y = cy - size / 2.0,
            ));
        } else {
            let (glyph, color) = marker_fallback(id);
            out.push_str(&format!(
                "<circle cx=\"{cx:.1}\" cy=\"{cy:.1}\" r=\"{r:.1}\" fill=\"{color}\"/>\n\
                 <text x=\"{cx:.1}\" y=\"{ty:.1}\" text-anchor=\"middle\" fill=\"#fff\" \
                 font-size=\"{fs:.1}\">{glyph}</text>\n",
                r = size / 2.0, ty = cy + size * 0.18, fs = size * 0.39,
                color = xml_escape(color), glyph = xml_escape(&glyph),
            ));
        }
    }
}

/// Labels hang 5px below the topic box (`.node-labels`), one rounded chip
/// each.  They are decorations, so they never grow the layout box — the
/// crop bounds are extended separately.
fn svg_labels(node: &LaidOutNode, out: &mut String) {
    if node.labels.is_empty() { return; }
    const H: f64 = 20.7;
    let top = node.y + node.height + 5.0;
    let mut x = node.x;
    for label in &node.labels {
        let em = 11.0;
        let width = label.chars().map(|c| if c.is_ascii() { em * 0.56 } else { em }).sum::<f64>() + 16.0;
        out.push_str(&format!(
            "<rect x=\"{x:.1}\" y=\"{top:.1}\" width=\"{w:.1}\" height=\"{H:.0}\" rx=\"5\" \
             fill=\"#fff\" fill-opacity=\"0.7\" stroke=\"#000\" stroke-opacity=\"0.1\"/>\n",
            w = width,
        ));
        out.push_str(&format!(
            "<text x=\"{tx:.1}\" y=\"{ty:.1}\" fill=\"#6f737b\" font-size=\"11\">{}</text>\n",
            xml_escape(label), tx = x + 7.0, ty = top + 13.0,
        ));
        x += width + 4.0;
    }
}

/// The artwork of a 贴纸 / 插画 / 本地图片 topic sits at (20,12) inside the
/// padded card.  `images` maps the layout's resource id to the data URL the
/// resource store already produced for the WebView.
fn svg_image(node: &LaidOutNode, images: &HashMap<String, String>, out: &mut String) {
    let Some(id) = node.image.as_deref() else { return };
    let Some(href) = images.get(id) else { return };
    if node.image_width <= 0.0 || node.image_height <= 0.0 { return; }
    // `.node.has-image` centres the artwork in the 20px/18px padded card;
    // only a full-width sticker ends up at the left inset itself.
    let content_w = (node.width - 38.0).max(node.image_width);
    let x = node.x + 20.0 + (content_w - node.image_width) / 2.0;
    out.push_str(&format!(
        "<image x=\"{x:.1}\" y=\"{y:.1}\" width=\"{w:.1}\" height=\"{h:.1}\" \
         preserveAspectRatio=\"xMidYMid meet\" href=\"{href}\"/>\n",
        y = node.y + 12.0,
        w = node.image_width, h = node.image_height,
    ));
}

/// Standalone SVG built from the exact same Rust layout the editor renders, so
/// the export matches what the user sees on screen.
///
/// The canvas is cropped to the drawn content: `compute_layout` pads the map to
/// `PAD` and enforces a 480x320 minimum for the *editor* viewport, which would
/// leave a single-topic branch floating in empty white space.
pub fn to_svg(doc: &Document) -> String {
    to_svg_with_images(doc, &HashMap::new())
}

/// Same export, with the document's image resources resolved to data URLs.
/// The WebView owns the resource store; callers that have it (the Tauri
/// commands) pass `id -> data:...` so artwork can be embedded in the SVG.
pub fn to_svg_with_images(doc: &Document, images: &HashMap<String, String>) -> String {
    let layout = compute_layout(doc);
    let pal = &layout.theme;
    // Breathing room around the cropped content, matching XMind's export.
    const MARGIN: f64 = 26.0;
    let (bx, by, bw, bh) = if layout.nodes.is_empty() {
        (0.0, 0.0, layout.width, layout.height)
    } else {
        let mut min_x = layout.nodes.iter().map(|n| n.x).fold(f64::INFINITY, f64::min);
        let mut min_y = layout.nodes.iter().map(|n| n.y).fold(f64::INFINITY, f64::min);
        let mut max_x = layout.nodes.iter().map(|n| n.x + n.width).fold(f64::NEG_INFINITY, f64::max);
        let mut max_y = layout.nodes.iter().map(|n| n.y + n.height).fold(f64::NEG_INFINITY, f64::max);
        // `.node-labels` hang below the shape; include them in the crop.
        for node in &layout.nodes {
            if !node.labels.is_empty() {
                max_y = max_y.max(node.y + node.height + 5.0 + 20.7);
            }
        }
        for path in layout.frames.iter().map(|f| f.path.as_str())
            .chain(layout.links.iter().map(|l| l.path.as_str())) {
            if let Some((x1, y1, x2, y2)) = path_bounds(path) {
                min_x = min_x.min(x1); min_y = min_y.min(y1);
                max_x = max_x.max(x2); max_y = max_y.max(y2);
            }
        }
        for frame in &layout.frames {
            min_x = min_x.min(frame.label_x); min_y = min_y.min(frame.label_y);
        }
        for link in &layout.links {
            min_x = min_x.min(link.label_x); min_y = min_y.min(link.label_y);
        }
        (
            min_x - MARGIN,
            min_y - MARGIN,
            max_x - min_x + MARGIN * 2.0,
            max_y - min_y + MARGIN * 2.0,
        )
    };
    let mut out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w:.0}\" height=\"{h:.0}\" viewBox=\"{x:.1} {y:.1} {w:.0} {h:.0}\">\n\
         <rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{w:.0}\" height=\"{h:.0}\" fill=\"{bg}\"/>\n\
         <g fill=\"none\" stroke-linecap=\"round\">\n",
        x = bx,
        y = by,
        w = bw,
        h = bh,
        bg = xml_escape(&pal.bg)
    );
    // `context-stroke` is a canvas-only convenience: a standalone SVG needs
    // one marker per (arrow kind, edge colour).
    let mut marker_ids: HashMap<(String, String), String> = HashMap::new();
    let mut link_markers: HashMap<String, String> = HashMap::new();
    let mut defs = String::from("<defs>\n");
    for edge in &layout.edges {
        if edge.arrow.is_empty() || edge.arrow == "none" || edge.tapered { continue; }
        let key = (edge.arrow.clone(), edge.color.clone());
        if marker_ids.contains_key(&key) { continue; }
        let color = xml_escape(&edge.color);
        let Some(body) = arrow_body(&edge.arrow, &color) else { continue };
        let id = format!("arrow-{}", marker_ids.len());
        defs.push_str(&format!(
            "<marker id=\"{id}\" viewBox=\"-1 -5 9 10\" refX=\"6\" refY=\"0\" \
             markerWidth=\"9\" markerHeight=\"10\" markerUnits=\"userSpaceOnUse\" \
             orient=\"auto\">{body}</marker>\n"
        ));
        marker_ids.insert(key, id);
    }
    for link in &layout.links {
        if !link.arrow || link.color.is_empty() || link_markers.contains_key(&link.color) { continue; }
        let id = format!("link-arrow-{}", link_markers.len());
        defs.push_str(&format!(
            "<marker id=\"{id}\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" \
             markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\
             <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"{}\"/></marker>\n",
            xml_escape(&link.color)
        ));
        link_markers.insert(link.color.clone(), id);
    }
    defs.push_str("</defs>\n");
    out.push_str(&defs);
    for edge in &layout.edges {
        if edge.tapered {
            // A tapered connector is a *filled wedge*, not a stroked spine.
            out.push_str(&format!(
                "<path d=\"{}\" fill=\"{}\" stroke=\"none\"/>\n",
                xml_escape(&edge.path),
                xml_escape(&edge.color),
            ));
            continue;
        }
        let dash = dash_attr(edge.dash.as_deref());
        let marker = marker_ids
            .get(&(edge.arrow.clone(), edge.color.clone()))
            .map(|id| format!(" marker-end=\"url(#{id})\""))
            .unwrap_or_default();
        out.push_str(&format!(
            "<path d=\"{}\" stroke=\"{}\" stroke-width=\"{:.1}\"{dash}{marker}/>\n",
            xml_escape(&edge.path),
            xml_escape(&edge.color),
            edge.width
        ));
    }
    out.push_str("</g>\n");
    // 外框 / 概要 and 联系 live beneath the topics but above the connectors,
    // exactly like MapCanvas's decor layer.
    for frame in &layout.frames {
        let dash = if frame.kind == "boundary" { " stroke-dasharray=\"6 4\"" } else { "" };
        out.push_str(&format!(
            "<path d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{:.1}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"{dash}/>\n",
            xml_escape(&frame.path), xml_escape(&frame.color), frame.width.max(1.0),
        ));
        if !frame.title.is_empty() {
            out.push_str(&format!(
                "<text x=\"{:.1}\" y=\"{:.1}\" fill=\"{}\" font-size=\"12\" font-weight=\"500\" \
                 paint-order=\"stroke\" stroke=\"#fff\" stroke-width=\"3\" stroke-linejoin=\"round\">{}\
                 </text>\n",
                frame.label_x, frame.label_y, xml_escape(&frame.color), xml_escape(&frame.title),
            ));
        }
    }
    for link in &layout.links {
        let marker = link_markers.get(&link.color)
            .map(|id| format!(" marker-end=\"url(#{id})\""))
            .unwrap_or_default();
        // Layout already translates `line-pattern` into the literal SVG array
        // (`"9 3"`); dash_attr() is for branch edges, not for 联系 lines.
        let dash = link.dash.as_deref().filter(|d| !d.is_empty())
            .map(|d| format!(" stroke-dasharray=\"{}\"", xml_escape(d)))
            .unwrap_or_default();
        out.push_str(&format!(
            "<path d=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{:.1}\" stroke-linecap=\"round\"{}{}/>\n",
            xml_escape(&link.path), xml_escape(&link.color), link.width.max(1.0), dash, marker,
        ));
        if !link.title.is_empty() {
            out.push_str(&format!(
                "<text x=\"{:.1}\" y=\"{:.1}\" text-anchor=\"middle\" fill=\"{}\" font-size=\"12\" \
                 font-weight=\"500\" paint-order=\"stroke\" stroke=\"#fff\" stroke-width=\"3\" \
                 stroke-linejoin=\"round\">{}</text>\n",
                link.label_x, link.label_y - 6.0, xml_escape(&link.color), xml_escape(&link.title),
            ));
        }
    }
    out.push_str(&format!("<g font-family=\"{}\">\n", xml_escape(FONT_STACK)));
    for node in &layout.nodes {
        let style = &node.style;
        if style.underline || style.fill == "transparent" {
            // Underline shapes have no plate: the rule is the topic itself.
            let rule_y = node.y + node.height - if style.underline { 0.0 } else { 2.0 };
            out.push_str(&format!(
                "<line x1=\"{x:.1}\" y1=\"{y:.1}\" x2=\"{x2:.1}\" y2=\"{y:.1}\" stroke=\"{c}\" stroke-width=\"{w:.1}\"/>\n",
                x = node.x,
                y = rule_y,
                x2 = node.x + node.width,
                c = xml_escape(&style.underline_color),
                w = style.underline_width,
            ));
        } else {
            out.push_str(&format!(
                "<rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{w:.1}\" height=\"{h:.1}\" rx=\"{r:.1}\" fill=\"{fill}\" stroke=\"{stroke}\"/>\n",
                x = node.x,
                y = node.y,
                w = node.width,
                h = node.height,
                r = style.radius,
                fill = xml_escape(&style.fill),
                stroke = if style.stroke == "transparent" { "none".into() } else { xml_escape(&style.stroke) }
            ));
        }
        svg_image(node, images, &mut out);
        svg_marker_row(node, &mut out);
        out.push_str(&svg_label(node, pal));
        svg_labels(node, &mut out);
        if node.folded && node.hidden_count > 0 {
            // Same anchor as the connectors and the on-canvas fold disc:
            // underlines are met on their bottom rule, filled shapes at the
            // box centre (layout.rs::branch_anchor_y).
            let anchor_y = if style.underline {
                node.y + node.height
            } else {
                node.y + node.height / 2.0
            };
            out.push_str(&format!(
                "<text x=\"{x:.1}\" y=\"{y:.1}\" fill=\"{}\" font-size=\"11\">+{}</text>\n",
                xml_escape(&pal.muted),
                node.hidden_count,
                x = node.x + node.width + 8.0,
                y = anchor_y + f64::from(style.font_size) * 0.35,
            ));
        }
    }
    out.push_str("</g>\n</svg>\n");
    out
}
