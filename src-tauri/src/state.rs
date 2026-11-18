//! Application state. Startup is intentionally empty: no file is read beyond
//! the tiny settings.json, no HTTP client is built, no document is parsed, and
//! no resource directory is walked. Recovery loading and AI setup happen only
//! after the first paint, triggered by explicit IPC commands.

use crate::paths::{self, DataLayout};
use aicompat::AiHub;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use xmind_core::{compute_layout, ops, Document, Layout, Structure, ThemeId};
use xmind_resources::ResourceStore;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent: Vec<String>,
    pub theme: ThemeId,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsDto {
    pub topics: usize,
    pub depth: usize,
    pub branches: usize,
    pub sheets: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub document: Document,
    pub layout: Layout,
    pub dirty: bool,
    pub path: Option<String>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub stats: StatsDto,
    pub recent: Vec<String>,
    pub structure: Structure,
    pub theme: ThemeId,
}

/// One in-place topic edit. Every keystroke is relayed to the layout engine so
/// the topic box grows as you type, but the whole session is a *single* undo
/// step and Escape can restore the document exactly as it was.
pub struct EditSession {
    pub id: String,
    /// Document before the first keystroke (also restores `titleUnedited` etc.).
    pub original: Document,
    pub original_title: String,
    pub dirty: bool,
    /// Undo stack length before the session's one history entry was pushed.
    pub undo_len: usize,
    pub redo: Vec<Document>,
    pub started: bool,
}

pub struct AppState {
    pub layout: DataLayout,
    /// File handed over by Explorer "Open with", a command-line launch, or
    /// macOS Finder (RunEvent::Opened). Behind a mutex because macOS delivers
    /// the file asynchronously, after the state has been created.
    pub startup_file: Mutex<Option<PathBuf>>,
    pub document: Mutex<Document>,
    pub current_path: Mutex<Option<PathBuf>>,
    pub dirty: AtomicBool,
    pub undo: Mutex<Vec<Document>>,
    pub redo: Mutex<Vec<Document>>,
    /// `Some` while a topic label is being edited in place.
    pub edit: Mutex<Option<EditSession>>,
    pub resources: ResourceStore,
    /// Constructed with a path only; the provider/client is a lazy OnceLock.
    pub ai: Arc<AiHub>,
    pub settings: Mutex<Settings>,
    /// Original Thumbnails/thumbnail.png, kept so re-saving doesn't drop it.
    pub thumbnail: Mutex<Option<Vec<u8>>>,
    /// Unknown entries from the opened .xmind, re-emitted on save.
    pub extra_files: Mutex<Vec<(String, Vec<u8>)>>,
}

const HISTORY_LIMIT: usize = 60;
const RECENT_LIMIT: usize = 12;

impl AppState {
    pub fn init() -> Result<Self, String> {
        let root = paths::data_dir();
        let layout = paths::layout(&root);
        fs::create_dir_all(&layout.root).map_err(|e| e.to_string())?;
        if let Some(parent) = layout.recovery.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // `ResourceStore::ensure` is cheap but deferred until the first image.
        let settings: Settings = fs::read_to_string(&layout.settings)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let mut document = Document::default();
        document.theme = settings.theme;
        Ok(Self {
            ai: Arc::new(AiHub::new(layout.ai_config.clone())),
            resources: ResourceStore::new(layout.resources.clone()),
            layout,
            startup_file: Mutex::new(crate::cli::startup_file()),
            document: Mutex::new(document),
            current_path: Mutex::new(None),
            dirty: AtomicBool::new(false),
            undo: Mutex::new(Vec::new()),
            redo: Mutex::new(Vec::new()),
            edit: Mutex::new(None),
            settings: Mutex::new(settings),
            thumbnail: Mutex::new(None),
            extra_files: Mutex::new(Vec::new()),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        let document = self.document.lock().unwrap().clone();
        let computed = compute_layout(&document);
        let stats = ops::stats(&document);
        Snapshot {
            structure: document.sheet().structure,
            theme: document.theme,
            document,
            layout: computed,
            dirty: self.dirty.load(Ordering::Relaxed),
            path: self
                .current_path
                .lock()
                .unwrap()
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            can_undo: !self.undo.lock().unwrap().is_empty(),
            can_redo: !self.redo.lock().unwrap().is_empty(),
            stats: StatsDto {
                topics: stats.topics,
                depth: stats.depth,
                branches: stats.branches,
                sheets: stats.sheets,
            },
            recent: self.settings.lock().unwrap().recent.clone(),
        }
    }

    pub fn begin_mutation(&self) {
        // Any other mutation closes the edit session, keeping its text, so a
        // later Escape can never roll back unrelated work.
        self.edit.lock().unwrap().take();
        let before = self.document.lock().unwrap().clone();
        let mut undo = self.undo.lock().unwrap();
        undo.push(before);
        if undo.len() > HISTORY_LIMIT {
            undo.remove(0);
        }
        self.redo.lock().unwrap().clear();
        self.dirty.store(true, Ordering::Relaxed);
    }

    pub fn replace_document(&self, document: Document, path: Option<PathBuf>, thumbnail: Option<Vec<u8>>) {
        *self.document.lock().unwrap() = document;
        *self.current_path.lock().unwrap() = path;
        *self.thumbnail.lock().unwrap() = thumbnail;
        *self.extra_files.lock().unwrap() = Vec::new();
        self.edit.lock().unwrap().take();
        self.undo.lock().unwrap().clear();
        self.redo.lock().unwrap().clear();
        self.dirty.store(false, Ordering::Relaxed);
    }

    pub fn set_extra_files(&self, files: Vec<(String, Vec<u8>)>) {
        *self.extra_files.lock().unwrap() = files;
    }

    pub fn save_settings(&self) -> Result<(), String> {
        let settings = self.settings.lock().unwrap().clone();
        let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        xmind_file::write_atomic(&self.layout.settings, text.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn push_recent(&self, path: &Path) {
        let value = path.to_string_lossy().to_string();
        let mut settings = self.settings.lock().unwrap();
        settings.recent.retain(|p| p != &value);
        settings.recent.insert(0, value);
        settings.recent.truncate(RECENT_LIMIT);
        drop(settings);
        let _ = self.save_settings();
    }

    pub fn write_recovery(&self) -> Result<(), String> {
        let document = self.document.lock().unwrap().clone();
        let text = serde_json::to_string(&document).map_err(|e| e.to_string())?;
        xmind_file::write_atomic(&self.layout.recovery, text.as_bytes()).map_err(|e| e.to_string())
    }

    // -----------------------------------------------------------------------
    // Live in-place editing
    // -----------------------------------------------------------------------

    /// Open a session without touching the document. The single history entry
    /// is pushed by the *first keystroke*, so opening/closing the editor without
    /// typing leaves the undo stack untouched.
    pub fn live_edit_begin(&self, id: &str) {
        let previous = self.edit.lock().unwrap().as_ref().map(|s| s.id.clone());
        if previous.as_deref() == Some(id) {
            return;
        }
        // Jumping straight to another topic commits the previous edit.
        if previous.is_some() {
            let _ = self.live_edit_end("", None, false);
        }
        let document = self.document.lock().unwrap().clone();
        let original_title = ops::find(document.root(), id)
            .map(|topic| topic.title.clone())
            .unwrap_or_default();
        let undo_len = self.undo.lock().unwrap().len();
        let redo = self.redo.lock().unwrap().clone();
        let dirty = self.dirty.load(Ordering::Relaxed);
        *self.edit.lock().unwrap() = Some(EditSession {
            id: id.to_string(),
            original: document,
            original_title,
            dirty,
            undo_len,
            redo,
            started: false,
        });
    }

    /// Apply one keystroke, then recompute the whole layout so the topic box
    /// (and every branch around it) grows while the user is still typing.
    pub fn live_edit_text(&self, id: &str, title: &str) -> Result<Snapshot, String> {
        self.live_edit_begin(id);
        let before = {
            let mut guard = self.edit.lock().unwrap();
            let session = guard.as_mut().ok_or("编辑会话未开始")?;
            if session.started {
                None
            } else {
                session.started = true;
                Some(session.original.clone())
            }
        };
        if let Some(before) = before {
            // The one and only undo step for the entire edit session.
            self.undo.lock().unwrap().push(before);
            self.redo.lock().unwrap().clear();
            self.dirty.store(true, Ordering::Relaxed);
        }
        {
            let mut document = self.document.lock().unwrap();
            ops::rename(&mut document, id, title);
        }
        Ok(self.snapshot())
    }

    /// `Some(title)` stores the trimmed final text; `cancel` (or a final text
    /// identical to the original) restores the document and removes the session's
    /// history entry. `None` just closes the session, keeping what was typed.
    pub fn live_edit_end(
        &self, id: &str, title: Option<&str>, cancel: bool,
    ) -> Result<Snapshot, String> {
        let session = self.edit.lock().unwrap().take();
        let Some(session) = session else {
            // Defensive fallback if the session was already closed (e.g. an
            // unrelated mutation ran): commit the final text normally.
            if let Some(text) = title {
                self.begin_mutation();
                let mut document = self.document.lock().unwrap();
                ops::rename(&mut document, id, text);
            }
            return Ok(self.snapshot());
        };
        let unchanged = title.map(|t| t == session.original_title).unwrap_or(false);
        if (cancel || unchanged) && session.started {
            *self.document.lock().unwrap() = session.original.clone();
            self.undo.lock().unwrap().truncate(session.undo_len);
            *self.redo.lock().unwrap() = session.redo;
            self.dirty.store(session.dirty, Ordering::Relaxed);
        } else if let Some(text) = title {
            let mut document = self.document.lock().unwrap();
            ops::rename(&mut document, id, text);
        }
        Ok(self.snapshot())
    }

    pub fn read_recovery(&self) -> Option<Document> {
        let text = fs::read_to_string(&self.layout.recovery).ok()?;
        let mut document: Document = serde_json::from_str(&text).ok()?;
        document.ensure_sheet();
        Some(document)
    }
}

pub fn startup_log(message: &str) {
    use std::{fs::OpenOptions, io::Write};
    let line = format!("[{}] {}\n", chrono::Utc::now().to_rfc3339(), message);
    eprint!("{line}");
    let path = paths::layout(&paths::data_dir()).log;
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}
