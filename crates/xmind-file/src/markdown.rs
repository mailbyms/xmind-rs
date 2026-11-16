//! Import a Markdown outline into a mind map (headings + nested bullets).

use xmind_core::{Document, Topic};

pub fn from_markdown(text: &str) -> Document {
    let mut root_title = String::new();
    let mut root_children: Vec<Topic> = Vec::new();
    // (indent, topic) for the currently open chain.
    let mut stack: Vec<(usize, Topic)> = Vec::new();

    fn close_above(stack: &mut Vec<(usize, Topic)>, indent: usize, root_children: &mut Vec<Topic>) {
        while stack.last().map(|(level, _)| *level >= indent).unwrap_or(false) {
            let (_, finished) = stack.pop().expect("checked above");
            if let Some((_, parent)) = stack.last_mut() {
                parent.children.push(finished);
            } else {
                root_children.push(finished);
            }
        }
    }

    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        let leading = line.len() - line.trim_start().len();
        let trimmed = line.trim_start();

        let item = if trimmed.starts_with('#') {
            let level = trimmed.chars().take_while(|c| *c == '#').count();
            let title = trimmed.trim_start_matches('#').trim();
            if level == 1 && root_title.is_empty() {
                root_title = title.to_string();
                continue;
            }
            Some(((level.saturating_sub(1)) * 2, title.to_string()))
        } else {
            let bullet = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")).or_else(|| trimmed.strip_prefix("+ "));
            let title = match bullet {
                Some(rest) => Some(rest.trim().to_string()),
                None => {
                    // "1. item" style lists
                    let mut chars = trimmed.chars();
                    let digits: String = chars.by_ref().take_while(|c| c.is_ascii_digit()).collect();
                    if !digits.is_empty() && trimmed[digits.len()..].starts_with(". ") {
                        Some(trimmed[digits.len() + 2..].trim().to_string())
                    } else {
                        None
                    }
                }
            };
            title.map(|t| (2 + leading / 2, t))
        };

        if let Some((indent, title)) = item {
            if title.is_empty() {
                continue;
            }
            close_above(&mut stack, indent, &mut root_children);
            stack.push((indent, Topic::new(title)));
        }
    }
    close_above(&mut stack, 0, &mut root_children);

    let mut root = Topic::new(if root_title.is_empty() { "中心主题".into() } else { root_title });
    root.children = root_children;
    let mut doc = Document::new(if root.title.is_empty() { "导入的思维导图".into() } else { root.title.clone() });
    doc.sheets[0].root = root;
    doc
}

