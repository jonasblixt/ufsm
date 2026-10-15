// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tauri_plugin_updater::UpdaterExt;

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

/// Write the editor settings (atomically).
#[tauri::command]
fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    write_atomically(&settings_path(&app)?, &contents)
}

/// Write a file in the config folder: into a temporary file next to it, then renamed over it, so a crash never leaves
/// half a file. Creates the folder when missing.
fn write_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let fail = |p: &Path, e: std::io::Error| format!("{}: {e}", p.display());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| fail(dir, e))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| fail(&tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| fail(path, e))
}

/// How many machines File › Open Recent lists.
const RECENT_MAX: usize = 10;

/// `recent.json` in the app's config folder: the paths of the machines opened or saved last, most recent first. Kept
/// by the shell, not in settings.json, so the frontend can only add a path it was given in a dialog.
fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("recent.json"))
        .map_err(|e| format!("no config folder: {e}"))
}

/// The recent list; empty when there is none or it cannot be read.
fn read_recent(app: &tauri::AppHandle) -> Vec<String> {
    recent_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn write_recent(app: &tauri::AppHandle, list: &[String]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    write_atomically(&recent_path(app)?, &format!("{text}\n"))
}

/// The machines opened or saved last, most recent first.
#[tauri::command]
fn recent_files(app: tauri::AppHandle) -> Vec<String> {
    read_recent(&app)
}

/// Put a machine first in the recent list. Only a path the user picked in a dialog this run (or reopened from the
/// list) is taken. Returns the new list.
#[tauri::command]
fn add_recent(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    if !app.fs_scope().is_allowed(Path::new(&path)) {
        return Err(format!("{path} was not opened in this run"));
    }
    let mut list = read_recent(&app);
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(RECENT_MAX);
    write_recent(&app, &list)?;
    Ok(list)
}

/// Take a machine off the recent list, or clear the list (no path). Returns the new list.
#[tauri::command]
fn forget_recent(app: tauri::AppHandle, path: Option<String>) -> Result<Vec<String>, String> {
    let mut list = read_recent(&app);
    match path {
        Some(path) => list.retain(|p| p != &path),
        None => list.clear(),
    }
    write_recent(&app, &list)?;
    Ok(list)
}

/// Read a machine from the recent list and let the fs plugin reach it for the rest of this run (as if it had been
/// picked in a dialog), so Save and Generate work on it. Paths that are not on the list are refused.
#[tauri::command]
fn open_recent(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if !read_recent(&app).contains(&path) {
        return Err(format!("{path} is not a recently opened machine"));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    app.fs_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(text)
}

/// One generated file (a bare file name and its text).
#[derive(serde::Deserialize)]
struct GeneratedFile {
    name: String,
    text: String,
}

/// What `write_generated` did.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Generated {
    /// The files were written into `dir`.
    Written { dir: String },
    /// Nothing was written: `dir` lies outside the model's folder and `allow_outside` was false.
    Outside { dir: String },
}

/// The first line of every file uFSM generates contains this, in any case ("Generated by uFSM", Go's "Code generated by
/// uFSM"); only such files are overwritten.
const GENERATED_MARK: &str = "generated by ufsm";

/// The extensions of the files the code generators write.
const GENERATED_EXTENSIONS: [&str; 8] = ["h", "c", "py", "ts", "rs", "go", "hpp", "cs"];

/// `path` with `.` and `..` resolved lexically (the folder need not exist yet).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(c);
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// Did uFSM write the file at `path`? (Its first line carries the generated-code mark.)
fn is_generated(path: &Path) -> bool {
    std::fs::read(path)
        .map(|bytes| {
            let first = bytes.split(|&b| b == b'\n').next().unwrap_or(&[]);
            String::from_utf8_lossy(first).to_lowercase().contains(GENERATED_MARK)
        })
        .unwrap_or(false)
}

/// Write generated code into a model's output folder: `out` relative to the folder of `model` (or absolute), created
/// when missing. `model` must be a file the user opened or saved in a dialog this run. A folder outside the model's
/// folder is only written with `allow_outside` (the editor asks first). An existing file is only overwritten when
/// uFSM generated it; otherwise nothing is written.
#[tauri::command]
fn write_generated(
    app: tauri::AppHandle,
    model: String,
    out: String,
    files: Vec<GeneratedFile>,
    allow_outside: bool,
) -> Result<Generated, String> {
    let model = PathBuf::from(model);
    if !app.fs_scope().is_allowed(&model) {
        return Err(format!("{} was not opened in this run", model.display()));
    }
    let base = normalize(model.parent().ok_or("the model has no folder")?);
    let dir = normalize(&base.join(&out));
    let shown = dir.display().to_string();
    if !allow_outside && !dir.starts_with(&base) {
        return Ok(Generated::Outside { dir: shown });
    }
    let mut targets = Vec::with_capacity(files.len());
    for f in &files {
        let mut parts = Path::new(&f.name).components();
        let plain = matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None))
            && !f.name.contains(['/', '\\', ':']);
        let ext = Path::new(&f.name).extension().and_then(|e| e.to_str()).unwrap_or("");
        if !plain || !GENERATED_EXTENSIONS.contains(&ext) {
            return Err(format!("not a generated file name: {}", f.name));
        }
        let path = dir.join(&f.name);
        if path.exists() && !is_generated(&path) {
            return Err(format!("{} exists and was not generated by uFSM; nothing was written", path.display()));
        }
        targets.push(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("{shown}: {e}"))?;
    for (f, path) in files.iter().zip(&targets) {
        std::fs::write(path, &f.text).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(Generated::Written { dir: shown })
}

// ---------------------------------------------------------------- updates
//
// The editor checks the `latest.json` of the newest GitHub release (`plugins.updater` in tauri.conf.json), downloads
// the package for the installer it was installed with in the background and installs it when the user restarts.
// Packages are signed in CI with the key whose public half is `plugins.updater.pubkey`; a build without that key
// (empty pubkey) does not update itself. The flow is driven from the frontend (update-controller.ts) through these
// commands rather than the plugin's own JavaScript API, so the webview cannot point the updater elsewhere.

/// What the editor needs to know before it offers updates.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSupport {
    /// The build has the public key update packages are signed with (release builds from CI do).
    configured: bool,
    /// A debug build (`npm run dev`): the editor does not check by itself, only when asked.
    development: bool,
    /// The version running.
    version: String,
}

/// A newer release found by `update_check`.
#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    /// The release notes from latest.json, if any.
    notes: Option<String>,
}

/// Download progress sent to the editor while `update_download` runs.
#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    downloaded: u64,
    /// The package's size, when the server says it.
    total: Option<u64>,
}

/// A release found by a check, and its package once downloaded (verified against the key).
type Pending = (tauri_plugin_updater::Update, Option<Vec<u8>>);

/// The release found by the last check. Locked only briefly, never by a synchronous command (those run on the main
/// thread, which a macOS install may wait for while it holds the lock).
#[derive(Default)]
struct PendingUpdate(std::sync::Mutex<Option<Pending>>);

fn updater_configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

#[tauri::command]
fn update_support(app: tauri::AppHandle) -> UpdateSupport {
    UpdateSupport {
        configured: updater_configured(&app),
        development: cfg!(debug_assertions),
        version: app.package_info().version.to_string(),
    }
}

/// Ask the release server whether there is a newer version. Forgets what an earlier check found.
#[tauri::command]
async fn update_check(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    if !updater_configured(&app) {
        return Err("this build of uFSM has no update key, so it cannot update itself".into());
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *pending.0.lock().map_err(|e| e.to_string())? = update.map(|u| (u, None));
    Ok(info)
}

/// Download the package of the release the last check found and verify its signature; installing is a separate step.
#[tauri::command]
async fn update_download(
    pending: tauri::State<'_, PendingUpdate>,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    let update = {
        let slot = pending.0.lock().map_err(|e| e.to_string())?;
        match &*slot {
            Some((u, _)) => u.clone(),
            None => return Err("no update to download; check for updates first".into()),
        }
    };
    let mut downloaded: u64 = 0;
    let mut reported: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                // About a hundred messages for the whole download, not one per network chunk.
                let step = total.map_or(256 * 1024, |t| (t / 100).max(1));
                if downloaded - reported >= step || Some(downloaded) == total {
                    reported = downloaded;
                    let _ = on_progress.send(DownloadProgress { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut slot = pending.0.lock().map_err(|e| e.to_string())?;
    match &mut *slot {
        Some((u, package)) if u.version == update.version => *package = Some(bytes),
        _ => return Err("a newer check replaced this update; download again".into()),
    }
    Ok(())
}

/// Install the downloaded package and restart into the new version. On Windows the installer takes over: the app
/// exits here and the installer starts it again. The editor has asked about unsaved changes before calling this.
#[tauri::command]
async fn update_install(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    {
        let slot = pending.0.lock().map_err(|e| e.to_string())?;
        let Some((update, Some(package))) = &*slot else {
            return Err("no downloaded update to install".into());
        };
        update.install(package).map_err(|e| e.to_string())?;
    }
    app.request_restart();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Models, traces and generated code are read and written through the fs plugin. It has no static scope: a
        // path is reachable only after the user picked it in a dialog (the dialog plugin adds files exactly, folders
        // with their direct children), and only until the app exits; open_recent adds a machine from the recent list
        // the same way. Generated code goes through write_generated, next to a model opened that way.
        .plugin(tauri_plugin_fs::init())
        // Updates: only through the update_* commands below (no updater permission is granted to the webview).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            update_support,
            update_check,
            update_download,
            update_install,
            read_settings,
            write_settings,
            write_generated,
            recent_files,
            add_recent,
            forget_recent,
            open_recent
        ])
        .run(tauri::generate_context!())
        .expect("error while running uFSM");
}
