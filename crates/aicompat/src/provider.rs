use crate::{AiConfig, AiError};
use serde_json::{json, Value};
use std::time::Duration;

pub trait AiProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn complete(&self, system: &str, prompt: &str) -> Result<String, AiError>;
}

/// Offline, deterministic provider. It produces a reasonable outline without
/// allocating an HTTP client, a TLS config or even a socket. This is the
/// default so a freshly installed app never phones home and never stalls.
pub struct MockProvider;

impl AiProvider for MockProvider {
    fn id(&self) -> &'static str {
        "offline-mock"
    }

    fn complete(&self, _system: &str, prompt: &str) -> Result<String, AiError> {
        let topic = prompt
            .lines()
            .find_map(|line| line.strip_prefix("主题："))
            .unwrap_or("这个主题")
            .trim();
        let suffix = if topic.chars().count() > 14 {
            let short: String = topic.chars().take(14).collect();
            short
        } else {
            topic.to_string()
        };
        let titles = vec![
            format!("{suffix} · 现状与背景"),
            format!("{suffix} · 关键要素"),
            "目标与衡量指标".to_string(),
            "实施步骤与分工".to_string(),
            "风险点与应对".to_string(),
            "可复用经验".to_string(),
            "下一步行动".to_string(),
        ];
        if prompt.contains("用户：") {
            let question = prompt.rsplit("用户：").next().unwrap_or("").trim();
            return Ok(format!(
                "（离线演示模式）关于「{question}」：\n\
                 1. 先明确目标与边界，把问题拆成 3–5 个并列分支；\n\
                 2. 每个分支补充可验证的事实或数据；\n\
                 3. 配置一个 OpenAI 兼容接口后，这里会返回模型的真实回答。"
            ));
        }
        Ok(json!(titles).to_string())
    }
}

/// Any OpenAI-compatible `/chat/completions` endpoint: OpenAI, DeepSeek,
/// Moonshot, Qwen, Ollama, LM Studio, vLLM, etc. Only the JSON shape matters.
pub struct OpenAiCompatProvider {
    base_url: String,
    api_key: String,
    model: String,
    temperature: f32,
}

impl OpenAiCompatProvider {
    pub fn new(config: &AiConfig) -> Self {
        Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
            temperature: config.temperature,
        }
    }
}

impl AiProvider for OpenAiCompatProvider {
    fn id(&self) -> &'static str {
        "openai-compatible"
    }

    fn complete(&self, system: &str, prompt: &str) -> Result<String, AiError> {
        // Built per request, never at app startup. `Client` holds a connection
        // pool + TLS roots; creating it lazily keeps the idle footprint tiny.
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()?;
        let url = format!("{}/chat/completions", self.base_url);
        let body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": prompt }
            ],
            "temperature": self.temperature,
            "stream": false
        });
        let response = client
            .post(&url)
            .bearer_auth(&self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()?;
        let status = response.status();
        let text = response.text()?;
        if !status.is_success() {
            let short: String = text.chars().take(400).collect();
            return Err(AiError::Status(status.as_u16(), short));
        }
        let value: Value = serde_json::from_str(&text)?;
        let content = value["choices"][0]["message"]["content"]
            .as_str()
            .or_else(|| value["choices"][0]["text"].as_str())
            .or_else(|| value["content"].as_str())
            .ok_or_else(|| AiError::Message("接口响应里没有 choices[0].message.content".into()))?;
        Ok(content.to_string())
    }
}
