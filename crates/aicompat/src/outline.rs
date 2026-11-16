//! Tolerant parser for model output: JSON array, wrapped object, fenced code
//! block, or a plain bullet/numbered list. Models rarely follow instructions
//! perfectly, so accept all of them.

use serde_json::Value;
use std::collections::HashSet;

pub fn parse_outline(raw: &str, max: usize) -> Vec<String> {
    let text = strip_fence(raw.trim());
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        let items = from_json(&value);
        if !items.is_empty() {
            return finalize(items, max);
        }
    }
    // Sometimes a JSON array is embedded in a sentence.
    if let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) {
        if end > start {
            if let Ok(value) = serde_json::from_str::<Value>(&text[start..=end]) {
                let items = from_json(&value);
                if !items.is_empty() {
                    return finalize(items, max);
                }
            }
        }
    }
    let lines: Vec<String> = text.lines().map(clean_line).filter(|s| !s.is_empty()).collect();
    finalize(lines, max)
}

fn strip_fence(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        let rest = rest.trim_start_matches(|c: char| c.is_ascii_alphabetic()).trim_start();
        return rest.strip_suffix("```").unwrap_or(rest).trim();
    }
    trimmed
}

fn from_json(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().filter_map(item_text).collect(),
        Value::Object(map) => {
            for key in ["children", "topics", "items", "outline", "subtopics", "data"] {
                if let Some(items) = map.get(key) {
                    let found = from_json(items);
                    if !found.is_empty() {
                        return found;
                    }
                }
            }
            Vec::new()
        }
        Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn item_text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map
            .get("title")
            .or_else(|| map.get("text"))
            .or_else(|| map.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
}

fn clean_line(line: &str) -> String {
    let mut text = line.trim();
    text = text
        .strip_prefix("- ")
        .or_else(|| text.strip_prefix("* "))
        .or_else(|| text.strip_prefix("• "))
        .unwrap_or(text)
        .trim();
    let digits = text.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits < 4 {
        let tail = &text[digits..];
        if let Some(rest) = tail
            .strip_prefix(". ")
            .or_else(|| tail.strip_prefix(") "))
            .or_else(|| tail.strip_prefix("、"))
        {
            text = rest.trim();
        }
    }
    text.trim_matches(|c| c == '"' || c == '\'' || c == '*' || c == '`')
        .trim()
        .to_string()
}

fn finalize(items: Vec<String>, max: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let clean = clean_line(&item);
        if clean.is_empty() || clean.chars().count() > 60 || clean.starts_with("```") {
            continue;
        }
        if matches!(clean.as_str(), "[" | "]" | "{" | "}") {
            continue;
        }
        if !seen.insert(clean.clone()) {
            continue;
        }
        out.push(clean);
        if out.len() >= max.max(1) {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse_outline;

    #[test]
    fn parses_json_array() {
        assert_eq!(
            parse_outline(r#"["市场调研", "产品定位", "渠道策略"]"#, 10),
            vec!["市场调研", "产品定位", "渠道策略"]
        );
    }

    #[test]
    fn parses_wrapped_object_and_fenced_block() {
        let raw = "```json\n{\"topics\": [{\"title\": \"目标用户\"}, {\"title\": \"竞品分析\"}]}\n```";
        assert_eq!(parse_outline(raw, 10), vec!["目标用户", "竞品分析"]);
    }

    #[test]
    fn parses_bullets_numbers_and_prose_wrapped_json() {
        let raw = "- 需求收集\n* 方案设计\n1. 开发实现\n2) 上线复盘\n需求收集";
        assert_eq!(
            parse_outline(raw, 10),
            vec!["需求收集", "方案设计", "开发实现", "上线复盘"]
        );
        assert_eq!(
            parse_outline("建议如下：[\"A\", \"B\"] 供参考。", 10),
            vec!["A", "B"]
        );
    }

    #[test]
    fn respects_limit_and_drops_noise() {
        let raw = "[\"\", \"[\", \"第一条\", \"第二条\", \"第三条\"]";
        assert_eq!(parse_outline(raw, 2), vec!["第一条", "第二条"]);
    }
}
