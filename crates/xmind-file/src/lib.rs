//! `xmind-file` — all file-format work lives here, in Rust.
//!
//! Reads/writes the real XMind container described in `research/FINDINGS.md`:
//! `content.json` (sheets array), `content.xml` (fixed warning placeholder),
//! `metadata.json`, `manifest.json`, `resources/<sha256>.<ext>`.
//! Unknown JSON is preserved verbatim so a round-trip never strips themes,
//! extensions, boundaries, relationships or summaries.

mod export;
mod legacy;
mod markdown;
mod theme;
mod xmind;

pub use export::{export_document, to_markdown, to_opml, to_svg, to_text, ExportFormat};
pub use theme::theme_for;
pub use xmind::{
    read_any, read_xmind, remap_image_ids, write_xmind, write_xmind_with_extras,
    sanitize_resource_name,
    EmbeddedResource, LoadedDocument, CONTENT_XML_PLACEHOLDER,
};

use std::{io, path::Path};
use thiserror::Error;
use xmind_core::Document;

#[derive(Debug, Error)]
pub enum FileError {
    #[error("文件读写失败: {0}")]
    Io(#[from] io::Error),
    #[error("压缩包损坏: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("XML 解析失败: {0}")]
    Xml(String),
    #[error("{0}")]
    Message(String),
}

pub fn document_extension(path: &Path) -> String {
    path.extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn read_text_document(path: &Path) -> Result<Document, FileError> {
    let text = std::fs::read_to_string(path)?;
    let mut doc: Document = serde_json::from_str(&text)?;
    doc.ensure_sheet();
    Ok(doc)
}

/// Crash-safe write: temp file + rename, so a failed save cannot truncate a
/// user's map (or a config file containing a credential).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("bin");
    let tmp = path.with_extension(format!("{ext}.tmp"));
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::remove_file(path).ok();
            std::fs::rename(&tmp, path)?;
            Ok(())
        }
    }
}

pub fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
