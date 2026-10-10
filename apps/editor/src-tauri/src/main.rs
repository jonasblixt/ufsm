// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;

/// `settings.json` in the app's config folder (Windows: %APPDATA%\se.blxt.ufsm, macOS: ~/Library/Application
/// Support/se.blxt.ufsm, Linux: ~/.config/se.blxt.ufsm). The only file the settings commands touch.
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("no config folder: {e}"))
}

#[derive(serde::Serialize)]
struct SettingsFile {
    path: String,
    /// None when the file does not exist yet.
    contents: Option<String>,
}

/// Read the editor settings.
#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<SettingsFile, String> {
    let path = settings_path(&app)?;
    let contents = match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    Ok(SettingsFile { path: path.display().to_string(), contents })
}

/// Write the editor settings: into a temporary file next to settings.json, then renamed over it, so a crash never
/// leaves half a file.
#[tauri::command]
fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    let fail = |p: &PathBuf, e: std::io::Error| format!("{}: {e}", p.display());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| fail(&dir.to_path_buf(), e))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| fail(&tmp, e))?;
    std::fs::rename(&tmp, &path).map_err(|e| fail(&path, e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Models, traces and generated code are read and written through the fs plugin. It has no static scope: a
        // path is reachable only after the user picked it in a dialog (the dialog plugin adds files exactly, folders
        // with their direct children), and only until the app exits.
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![read_settings, write_settings])
        .run(tauri::generate_context!())
        .expect("error while running uFSM");
}
