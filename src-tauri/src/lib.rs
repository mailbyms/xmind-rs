// A release binary built without `custom-protocol` points the WebView at the
// Vite dev server, which is not running for a double-clicked exe. Fail loudly
// at compile time rather than shipping a blank window.
#[cfg(all(not(debug_assertions), dev))]
compile_error!(
    "release builds must enable the `custom-protocol` feature; run `npm run build:app` \
     (or `cargo build --release --features custom-protocol`)"
);

mod commands;
mod paths;
mod state;

use state::{startup_log, AppState};
use tauri::Manager;

pub fn run() {
    let state = AppState::init().unwrap_or_else(|error| {
        eprintln!("[xmind-rs] 数据目录初始化失败: {error}");
        std::process::exit(1);
    });
    startup_log(&format!(
        "app data dir: {} ({} override={})",
        state.layout.root.display(),
        paths::DATA_DIR_ENV,
        std::env::var_os(paths::DATA_DIR_ENV).is_some()
    ));
    startup_log(&format!(
        "startup mode: {} | webview: OS-provided | eager work: settings.json only",
        if cfg!(dev) { "DEV / external Vite server" } else { "PRODUCTION / embedded frontend" }
    ));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_set_theme,
            commands::app_set_active_sheet,
            commands::app_clear_recent,
            commands::app_log,
            commands::doc_new,
            commands::doc_restore,
            commands::doc_save_recovery,
            commands::doc_open,
            commands::doc_save,
            commands::doc_export,
            commands::doc_branch_svg,
            commands::doc_export_branch,
            commands::doc_write_bytes,
            commands::doc_layout,
            commands::doc_add_child,
            commands::doc_add_sibling,
            commands::doc_add_sibling_before,
            commands::doc_insert_parent,
            commands::doc_add_floating,
            commands::doc_duplicate,
            commands::doc_delete,
            commands::doc_delete_single,
            commands::doc_indent,
            commands::doc_outdent,
            commands::doc_fold_all,
            commands::doc_focus_branch,
            commands::doc_reset_position,
            commands::doc_add_sheet_from_topic,
            commands::doc_rename,
            commands::doc_edit_begin,
            commands::doc_edit_text,
            commands::doc_edit_end,
            commands::doc_set_note,
            commands::doc_set_labels,
            commands::doc_toggle_marker,
            commands::doc_set_markers,
            commands::doc_set_style,
            commands::doc_clear_style,
            commands::doc_set_width,
            commands::doc_set_canvas,
            commands::doc_set_side,
            commands::doc_set_image,
            commands::doc_toggle_fold,
            commands::doc_set_fold,
            commands::doc_move,
            commands::doc_move_free,
            commands::doc_add_decor,
            commands::doc_remove_decor,
            commands::doc_rename_decor,
            commands::doc_set_decor_range,
            commands::doc_set_summary_style,
            commands::doc_set_href,
            commands::doc_set_structure,
            commands::doc_apply_skeleton,
            commands::doc_add_sheet,
            commands::doc_remove_sheet,
            commands::doc_rename_sheet,
            commands::doc_undo,
            commands::doc_redo,
            commands::resource_put,
            commands::resource_data,
            commands::ai_status,
            commands::ai_get_config,
            commands::ai_set_config,
            commands::ai_clear_config,
            commands::ai_expand,
            commands::ai_chat,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                startup_log(&format!("window created: {}", window.label()));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run xmind-rs");
}
