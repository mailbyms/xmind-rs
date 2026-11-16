use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    /// OpenAI-compatible base, e.g. https://api.openai.com/v1 or a local
    /// Ollama / LM Studio endpoint. No vendor SDK is required.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    /// When false (or with an empty key) the offline demo provider is used.
    pub enabled: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model: "gpt-4o-mini".into(),
            temperature: 0.6,
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub provider: String,
    pub model: String,
    pub ready: bool,
    pub configured: bool,
    pub base_url: String,
    /// Never echo the full key back to the WebView.
    pub key_hint: String,
    pub offline_demo: bool,
}

/// Owns `ai.json` inside the app data dir. The file may contain a plaintext
/// credential, so writes are atomic and an unparsable file is *never* replaced
/// automatically (we keep a .bak copy instead of silently dropping the key).
pub struct AiConfigStore {
    path: PathBuf,
}

impl AiConfigStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> AiConfig {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return AiConfig::default();
        };
        match serde_json::from_str::<AiConfig>(&text) {
            Ok(config) => config,
            Err(_) => {
                // Preserve the original; the user can recover the key by hand.
                let backup = self.path.with_extension("json.bak");
                let _ = fs::copy(&self.path, backup);
                AiConfig::default()
            }
        }
    }

    pub fn save(&self, config: &AiConfig) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(config)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text)?;
        match fs::rename(&tmp, &self.path) {
            Ok(()) => Ok(()),
            Err(_) => {
                let _ = fs::remove_file(&self.path);
                fs::rename(&tmp, &self.path)
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
