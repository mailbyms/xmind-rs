//! Minimal reader for XMind 8 `content.xml` (namespace:
//! `urn:xmind:xmap:xmlns:content:2.0`). We only need the topic tree, titles,
//! notes and sheet titles; labels/markers/styles from legacy files are ignored.
//!
//! A stack of open `<topic>` elements is enough: `<children>` / `<topics>`
//! wrappers do not need explicit handling.

use crate::FileError;
use quick_xml::{events::Event, Reader};
use xmind_core::{new_id, Document, Sheet, Structure, Topic};

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn new_sheet(title: String, mut root: Topic) -> Sheet {
    let structure = root
        .structure_class
        .as_deref()
        .map(Structure::from_class)
        .unwrap_or(Structure::Clockwise);
    if root.structure_class.is_none() {
        root.structure_class = Some(structure.class().into());
    }
    Sheet {
        id: new_id(),
        title,
        root,
        structure,
        extra: Default::default(),
    }
}

pub fn from_content_xml(text: &str) -> Result<Document, FileError> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut buf: Vec<u8> = Vec::new();

    let mut stack: Vec<Topic> = Vec::new();
    let mut sheets: Vec<Sheet> = Vec::new();
    let mut sheet_title: Option<String> = None;
    let mut sheet_root: Option<Topic> = None;
    let mut in_sheet_title = false;
    let mut in_topic_title = false;
    let mut in_notes = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => match local(event.name().as_ref()) {
                "sheet" => {
                    sheet_title = None;
                    sheet_root = None;
                }
                "topic" => {
                let mut topic = Topic::new("未命名主题");
                topic.title_unedited = true;
                stack.push(topic);
            }
                "title" => {
                    if stack.is_empty() {
                        in_sheet_title = true;
                    } else {
                        in_topic_title = true;
                    }
                }
                "notes" | "plain" => in_notes = true,
                _ => {}
            },
            Ok(Event::Text(event)) => {
                let value = event.xml10_content().trim().to_string();
                if value.is_empty() {
                    // skip
                } else if in_sheet_title {
                    sheet_title = Some(value);
                } else if in_topic_title {
                    if let Some(topic) = stack.last_mut() {
                        topic.title = value;
                    }
                } else if in_notes {
                    if let Some(topic) = stack.last_mut() {
                        if !topic.note.is_empty() {
                            topic.note.push('\n');
                        }
                        topic.note.push_str(&value);
                    }
                }
            }
            Ok(Event::End(event)) => match local(event.name().as_ref()) {
                "title" => {
                    in_sheet_title = false;
                    in_topic_title = false;
                }
                "notes" | "plain" => in_notes = false,
                "topic" => {
                    if let Some(topic) = stack.pop() {
                        if let Some(parent) = stack.last_mut() {
                            parent.children.push(topic);
                        } else {
                            sheet_root = Some(topic);
                        }
                    }
                }
                "sheet" => {
                    if let Some(root) = sheet_root.take() {
                        sheets.push(new_sheet(
                            sheet_title.take().unwrap_or_else(|| format!("画布 {}", sheets.len() + 1)),
                            root,
                        ));
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => {
                if local(event.name().as_ref()) == "topic" {
                    let topic = Topic::new("未命名主题");
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(topic);
                    } else {
                        sheet_root = Some(topic);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(FileError::Xml(error.to_string())),
            _ => {}
        }
        buf.clear();
    }

    if sheets.is_empty() {
        if let Some(root) = sheet_root {
            sheets.push(new_sheet(sheet_title.unwrap_or_else(|| "画布 1".into()), root));
        }
    }

    let mut document = Document {
        title: "导入的思维导图".into(),
        theme: Default::default(),
        active_sheet: 0,
        sheets,
        background: None,
        font_family: None,
        line_width: None,
        rainbow: true,
        compact: false,
        sibling_align: false,
        branch_colors: None,
        palette: None,
        center_color: None,
        palette_dirty: false,
        extra: Default::default(),
    };
    document.ensure_sheet();
    Ok(document)
}
