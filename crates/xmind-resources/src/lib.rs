//! `xmind-resources` — content-addressed image store.
//!
//! Images are written once under the app's own data directory and referenced
//! by id in the document. When saving an `.xmind`, only the referenced files
//! are copied into the archive's `resources/` folder.

use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io,
    path::{Path, PathBuf},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ResourceError {
    #[error("资源读写失败: {0}")]
    Io(#[from] io::Error),
    #[error("非法的资源名: {0}")]
    InvalidName(String),
    #[error("base64 数据无效: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("不支持的图片格式")]
    Unsupported,
}

#[derive(Debug, Clone)]
pub struct ResourceMeta {
    pub id: String,
    pub mime: String,
    pub size: usize,
    pub data_url: String,
}

#[derive(Debug, Clone)]
pub struct ResourceStore {
    root: PathBuf,
}

impl ResourceStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure(&self) -> Result<(), ResourceError> {
        fs::create_dir_all(&self.root)?;
        Ok(())
    }

    pub fn path_of(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    fn detect(bytes: &[u8], hint: &str) -> (&'static str, &'static str) {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            ("png", "image/png")
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            ("jpg", "image/jpeg")
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            ("gif", "image/gif")
        } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            ("webp", "image/webp")
        } else if bytes.starts_with(b"BM") {
            ("bmp", "image/bmp")
        } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") || bytes.starts_with(b"<SVG") {
            ("svg", "image/svg+xml")
        } else {
            let ext = Path::new(hint)
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            match ext.as_str() {
                "jpg" | "jpeg" => ("jpg", "image/jpeg"),
                "gif" => ("gif", "image/gif"),
                "webp" => ("webp", "image/webp"),
                "svg" => ("svg", "image/svg+xml"),
                "bmp" => ("bmp", "image/bmp"),
                _ => return ("png", "image/png"),
            }
        }
    }

    /// Store bytes, de-duplicating by SHA-256. Returns metadata including a
    /// `data:` URL, so no asset protocol or extra WebView permission is needed.
    pub fn put(&self, bytes: &[u8], hint: &str) -> Result<ResourceMeta, ResourceError> {
        if bytes.is_empty() {
            return Err(ResourceError::Unsupported);
        }
        self.ensure()?;
        let (ext, mime) = Self::detect(bytes, hint);
        // XMind names resources `resources/<full SHA-256 hex>.<ext>` and
        // references them as `xap:resources/<id>`. Match that exactly.
        let digest = Sha256::digest(bytes);
        let mut id = String::with_capacity(69);
        for byte in digest.iter() {
            id.push_str(&format!("{byte:02x}"));
        }
        id.push('.');
        id.push_str(ext);
        let path = self.path_of(&id);
        if !path.exists() {
            fs::write(&path, bytes)?;
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(ResourceMeta {
            id,
            mime: mime.to_string(),
            size: bytes.len(),
            data_url: format!("data:{mime};base64,{encoded}"),
        })
    }

    pub fn import(&self, name: &str, bytes: &[u8]) -> Result<String, ResourceError> {
        let safe = name
            .rsplit(|c| c == '/' || c == '\\')
            .next()
            .unwrap_or(name)
            .to_string();
        if safe.is_empty() || safe.contains("..") {
            return Err(ResourceError::InvalidName(name.to_string()));
        }
        Ok(self.put(bytes, &safe)?.id)
    }

    pub fn data_url(&self, id: &str) -> Result<Option<String>, ResourceError> {
        let path = self.path_of(id);
        if !path.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(&path)?;
        let (_, mime) = Self::detect(&bytes, id);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(format!("data:{mime};base64,{encoded}")))
    }

    /// Only the ids actually referenced by the current document are embedded.
    pub fn export_ids(&self, ids: &[String]) -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();
        for id in ids {
            if id.contains('/') || id.contains('\\') || id.contains("..") {
                continue;
            }
            let path = self.path_of(id);
            if let Ok(bytes) = fs::read(&path) {
                out.push((id.clone(), bytes));
            }
        }
        out
    }
}

pub fn decode_base64(data: &str) -> Result<Vec<u8>, ResourceError> {
    let payload = data
        .split_once(',')
        .map(|(_, rest)| rest)
        .unwrap_or(data)
        .trim();
    Ok(base64::engine::general_purpose::STANDARD.decode(payload)?)
}
