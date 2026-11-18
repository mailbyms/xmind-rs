//! Startup command-line handling.
//!
//! Windows Explorer's "Open with" launches the exe with the selected file as
//! an argument. The app used to ignore every argument and always painted a
//! clean document, so the startup file is captured here and surfaced through
//! `app_info` once the WebView is ready to call `doc_open`.

use std::{
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
};

// Keep in sync with the filters in the frontend open dialog.
const OPENABLE_EXTENSIONS: &[&str] = &["xmind", "json", "md", "txt", "opml"];

/// First existing, openable file passed on the command line, if any.
pub fn startup_file() -> Option<PathBuf> {
    first_openable(env::args_os().skip(1))
}

fn first_openable<I, P>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: Into<PathBuf>,
{
    args.into_iter()
        .map(Into::into)
        .find(|candidate| is_openable_file(candidate))
}

fn is_openable_file(path: &Path) -> bool {
    path.is_file() && has_openable_extension(path)
}

fn has_openable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| {
            OPENABLE_EXTENSIONS
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn recognises_openable_extensions_case_insensitively() {
        assert!(has_openable_extension(Path::new(r"C:\My Maps\test.xmind")));
        assert!(has_openable_extension(Path::new("notes.XMIND")));
        assert!(has_openable_extension(Path::new("outline.OpML")));
        assert!(!has_openable_extension(Path::new("app.exe")));
        assert!(!has_openable_extension(Path::new("README")));
    }

    #[test]
    fn skips_flags_and_finds_the_real_file() {
        let path = env::temp_dir().join(format!("xmind-rs-cli-{}.xmind", std::process::id()));
        fs::write(&path, b"not a real map").unwrap();
        let chosen = first_openable(["--some-flag", path.to_str().unwrap()]);
        fs::remove_file(&path).unwrap();
        assert_eq!(chosen, Some(path));
    }

    #[test]
    fn ignores_missing_or_unsupported_files() {
        let missing = env::temp_dir().join(format!("xmind-rs-missing-{}.xmind", std::process::id()));
        assert_eq!(first_openable([missing.to_str().unwrap()]), None);

        let exe = env::current_exe().unwrap();
        assert_eq!(first_openable([exe.to_str().unwrap()]), None);
    }
}
