//! `aicompat` — provider-agnostic AI layer.
//!
//! Design goal for a memory-light shell: **no HTTP client, no TLS context and
//! no config file read happen at startup**. The provider is instantiated on the
//! first AI command and cached by config fingerprint. With no API key the hub
//! uses a deterministic offline provider, so the app is fully usable without
//! any network access.

pub mod config;
pub mod outline;
pub mod provider;

pub use config::{AiConfig, AiConfigStore, AiStatus};
pub use outline::parse_outline;
pub use provider::{MockProvider, OpenAiCompatProvider};

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("网络请求失败: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("配置读写失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("接口返回 HTTP {0}: {1}")]
    Status(u16, String),
    #[error("{0}")]
    Message(String),
}

struct Cached {
    fingerprint: String,
    provider: Arc<dyn provider::AiProvider>,
}

pub struct AiHub {
    store: AiConfigStore,
    config_cache: Mutex<Option<AiConfig>>,
    provider_cache: Mutex<Option<Cached>>,
}

impl AiHub {
    pub fn new(config_path: impl Into<PathBuf>) -> Self {
        Self {
            store: AiConfigStore::new(config_path),
            config_cache: Mutex::new(None),
            provider_cache: Mutex::new(None),
        }
    }

    /// First call reads the tiny JSON config; later calls are pure memory.
    pub fn config(&self) -> AiConfig {
        let mut guard = self.config_cache.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = Some(self.store.load());
        }
        guard.clone().expect("just populated")
    }

    pub fn set_config(&self, config: AiConfig) -> Result<(), AiError> {
        let mut normalized = config;
        normalized.base_url = normalized.base_url.trim().trim_end_matches('/').to_string();
        normalized.api_key = normalized.api_key.trim().to_string();
        normalized.model = normalized.model.trim().to_string();
        if normalized.model.is_empty() {
            normalized.model = AiConfig::default().model;
        }
        self.store.save(&normalized)?;
        *self.config_cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(normalized);
        // Force a rebuild on the next AI call; never keep a stale TLS client.
        *self.provider_cache.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }

    pub fn status(&self) -> AiStatus {
        let config = self.config();
        let configured = config.enabled && !config.api_key.is_empty();
        let key_hint = if config.api_key.chars().count() > 8 {
            let chars: Vec<char> = config.api_key.chars().collect();
            let head: String = chars.iter().take(4).collect();
            let tail: String = chars.iter().rev().take(4).rev().collect();
            format!("{head}…{tail}")
        } else if config.api_key.is_empty() {
            "未设置".into()
        } else {
            "****".into()
        };
        AiStatus {
            provider: if configured { "openai-compatible" } else { "offline-mock" }.into(),
            model: config.model.clone(),
            ready: true,
            configured,
            base_url: config.base_url.clone(),
            key_hint,
            offline_demo: !configured,
        }
    }

    fn provider(&self) -> Arc<dyn provider::AiProvider> {
        let config = self.config();
        let configured = config.enabled && !config.api_key.is_empty();
        let fingerprint = format!(
            "{}|{}|{}|{}",
            configured, config.base_url, config.api_key, config.model
        );
        let mut guard = self.provider_cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = guard.as_ref() {
            if cached.fingerprint == fingerprint {
                return cached.provider.clone();
            }
        }
        let provider: Arc<dyn provider::AiProvider> = if configured {
            Arc::new(OpenAiCompatProvider::new(&config))
        } else {
            Arc::new(MockProvider)
        };
        *guard = Some(Cached {
            fingerprint,
            provider: provider.clone(),
        });
        provider
    }

    /// Generate `count` sibling child topics for a selected topic.
    pub fn expand(
        &self,
        title: &str,
        context: &str,
        instruction: &str,
        count: usize,
    ) -> Result<Vec<String>, AiError> {
        let system = "你是思维导图助手。只输出一个 JSON 字符串数组，数组里是并列的子主题，不要解释，不要 Markdown 代码块。";
        let prompt = format!(
            "主题：{title}\n当前导图大纲：\n{context}\n补充要求：{instruction}\n请给出 {count} 个互不重复、有信息量的子主题，每条不超过 18 个汉字，输出 JSON 数组。"
        );
        let raw = self.provider().complete(system, &prompt)?;
        let items = parse_outline(&raw, count);
        if items.is_empty() {
            return Err(AiError::Message("模型没有返回可用的子主题，请重试或换一个说法".into()));
        }
        Ok(items)
    }

    /// Free-form chat used by the AI side panel.
    pub fn chat(&self, message: &str, map_context: &str) -> Result<String, AiError> {
        let system = "你是简洁、务实的思维导图助手。回答用中文，控制在 200 字以内，可用短列表。";
        let prompt = format!("当前导图：\n{map_context}\n\n用户：{message}");
        let raw = self.provider().complete(system, &prompt)?;
        Ok(raw.trim().to_string())
    }
}
