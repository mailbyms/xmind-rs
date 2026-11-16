use crate::xml_escape;
use std::collections::HashMap;
use xmind_core::{compute_layout, Document, Topic};

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
pub fn to_svg(doc: &Document) -> String {
    let layout = compute_layout(doc);
    let pal = &layout.theme;
    // Breathing room around the cropped content, matching XMind's export.
    const MARGIN: f64 = 26.0;
    let (bx, by, bw, bh) = if layout.nodes.is_empty() {
        (0.0, 0.0, layout.width, layout.height)
    } else {
        let min_x = layout.nodes.iter().map(|n| n.x).fold(f64::INFINITY, f64::min);
        let min_y = layout.nodes.iter().map(|n| n.y).fold(f64::INFINITY, f64::min);
        let max_x = layout.nodes
            .iter()
            .map(|n| n.x + n.width)
            .fold(f64::NEG_INFINITY, f64::max);
        let max_y = layout.nodes
            .iter()
            .map(|n| n.y + n.height)
            .fold(f64::NEG_INFINITY, f64::max);
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
    defs.push_str("</defs>\n");
    out.push_str(&defs);
    for edge in &layout.edges {
        if edge.tapered {
            // A tapered connector is a *filled wedge*, not a stroked spine.
            // Drawing it with stroke only would export an empty outline.
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
    out.push_str(&format!("</g>\n<g font-family=\"{}\">\n", xml_escape(FONT_STACK)));
    for node in &layout.nodes {
        let style = &node.style;
        if style.underline || style.fill == "transparent" {
            // Underline shapes have no plate: the rule is the topic itself.
            // Its ink comes from the theme's border-line-color (or the branch
            // hue), not from the neutral canvas edge colour.
            out.push_str(&format!(
                "<line x1=\"{x:.1}\" y1=\"{y:.1}\" x2=\"{x2:.1}\" y2=\"{y:.1}\" stroke=\"{c}\" stroke-width=\"{w:.1}\"/>\n",
                x = node.x,
                y = node.y + node.height - 2.0,
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
        let baseline = node.y + node.height / 2.0 + f64::from(style.font_size) * 0.35;
        // A theme may name its own family (e.g. `Robust` → Montserrat); always
        // keep the desktop's CJK fallbacks behind it.
        let family = style.font_family.as_deref()
            .map(|f| format!(" font-family=\"{}\"", xml_escape(f)))
            .unwrap_or_default();
        out.push_str(&format!(
            "<text x=\"{x:.1}\" y=\"{y:.1}\" fill=\"{color}\" font-size=\"{size}\" font-weight=\"{weight}\"{family}>{}</text>\n",
            xml_escape(&node.title),
            x = node.x + 14.0,
            y = baseline,
            color = xml_escape(&style.color),
            size = style.font_size,
            weight = style.font_weight
        ));
        if node.folded && node.hidden_count > 0 {
            out.push_str(&format!(
                "<text x=\"{x:.1}\" y=\"{y:.1}\" fill=\"{color}\" font-size=\"11\">+{}</text>\n",
                node.hidden_count,
                x = node.x + node.width + 8.0,
                y = baseline,
                color = xml_escape(&pal.muted)
            ));
        }
    }
    out.push_str("</g>\n</svg>\n");
    out
}
