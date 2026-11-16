//! The single source of truth for every path this application owns.
//!
//! All runtime data (settings, recovery document, resources, AI config, log)
//! lives under one application-specific data directory. Business code must
//! never hard-code `%APPDATA%` or another app's profile path.
//! `XMIND_RS_DATA_DIR` overrides the root for portable installs / isolation.

use std::{
    env,
    path::{Path, PathBuf},
};

pub const DATA_DIR_ENV: &str = "XMIND_RS_DATA_DIR";

fn platform_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("xmind-rs")
    }
    #[cfg(target_os = "macos")]
    {
        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("xmind-rs")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".local")
                    .join("share")
            });
        base.join("xmind-rs")
    }
}

pub fn data_dir() -> PathBuf {
    env::var_os(DATA_DIR_ENV)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(platform_data_dir)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataLayout {
    pub root: PathBuf,
    pub settings: PathBuf,
    pub recovery: PathBuf,
    pub resources: PathBuf,
    /// May contain a plaintext API key — never delete or rewrite blindly.
    pub ai_config: PathBuf,
    pub log: PathBuf,
}

pub fn layout(root: &Path) -> DataLayout {
    DataLayout {
        root: root.to_path_buf(),
        settings: root.join("settings.json"),
        recovery: root.join("recovery/document.json"),
        resources: root.join("resources"),
        ai_config: root.join("ai.json"),
        log: root.join("startup.log"),
    }
}
