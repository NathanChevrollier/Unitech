//! Commandes appelées par l'interface (`src/platform/tauri.ts`).

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use unitech_core::{Store, Target, TargetKind, Workspace};
use unitech_launcher::{desktop_entry, icons, DiscoveredApp};
use unitech_system::{RecentFile, Snapshot};

use crate::state::{lock, AppState};
use crate::{tray, window};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    workspace: Workspace,
    created: bool,
    recovered: bool,
    path: String,
}

#[tauri::command]
pub fn workspace_load(app: AppHandle, state: State<'_, AppState>) -> CmdResult<LoadResult> {
    let loaded = state.store.load().map_err(err)?;
    *lock(&state.workspace) = loaded.workspace.clone();
    tray::refresh(&app);
    Ok(LoadResult {
        workspace: loaded.workspace,
        created: loaded.created,
        recovered: loaded.recovered,
        path: state.store.path().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn workspace_save(app: AppHandle, state: State<'_, AppState>, workspace: Workspace) -> CmdResult<Workspace> {
    let saved = state.store.save(workspace).map_err(err)?;
    let favorites_changed = {
        let mut cached = lock(&state.workspace);
        let changed = cached.active().map(|g| &g.systems) != saved.active().map(|g| &g.systems);
        *cached = saved.clone();
        changed
    };
    if favorites_changed {
        tray::refresh(&app);
    }
    Ok(saved)
}

/// Écrit une copie de l'espace de travail à l'emplacement choisi dans la boîte de dialogue.
#[tauri::command]
pub fn workspace_export(workspace: Workspace, path: String) -> CmdResult<()> {
    let path = Path::new(&path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("json")) {
        return Err("l'export doit être un fichier .json".into());
    }
    let (ws, _) = unitech_core::sanitize(workspace);
    let json = serde_json::to_vec_pretty(&ws).map_err(err)?;
    std::fs::write(path, json).map_err(err)
}

#[tauri::command]
pub fn workspace_import(path: String) -> CmdResult<Workspace> {
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("fichier trop volumineux".into());
    }
    let text = std::fs::read_to_string(&path).map_err(err)?;
    Store::parse(&text).map_err(err)
}

#[tauri::command]
pub async fn launch_target(target: Target) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || unitech_launcher::launch(&target).map(|_| ())).await.map_err(err)?.map_err(err)
}

#[tauri::command]
pub async fn discover_apps() -> CmdResult<Vec<DiscoveredApp>> {
    tauri::async_runtime::spawn_blocking(unitech_launcher::discover).await.map_err(err)
}

/// Ce qu'on sait d'un chemin déposé sur la fenêtre, pour en faire une planète.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    name: String,
    target: Target,
    icon: Option<String>,
}

#[tauri::command]
pub async fn describe_path(path: String) -> CmdResult<PathInfo> {
    tauri::async_runtime::spawn_blocking(move || describe(&path)).await.map_err(err)?
}

fn describe(path: &str) -> CmdResult<PathInfo> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| format!("{path} : {e}"))?;
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    let stem = p.file_stem().or(p.file_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
    let target = |kind| Target { kind, value: path.to_string(), args: vec![], cwd: None };
    if meta.is_dir() {
        return Ok(if ext == "app" {
            PathInfo { name: stem, target: target(TargetKind::App), icon: None }
        } else {
            let name = p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or(stem);
            PathInfo { name, target: target(TargetKind::Folder), icon: None }
        });
    }
    if ext == "desktop" {
        let text = std::fs::read_to_string(p).map_err(err)?;
        let entry = desktop_entry::parse(&text, std::env::var("LANG").ok().as_deref()).ok_or("fichier .desktop non lançable")?;
        let icon = entry.icon.as_deref().and_then(icons::linux_icon);
        return Ok(PathInfo { name: entry.name, target: target(TargetKind::App), icon });
    }
    let executable = matches!(ext.as_str(), "exe" | "lnk" | "appimage" | "url" | "appref-ms") || is_unix_executable(&meta);
    let icon = if matches!(ext.as_str(), "png" | "svg" | "jpg" | "jpeg" | "webp") { icons::data_url(p) } else { None };
    Ok(PathInfo { name: stem, target: target(if executable { TargetKind::App } else { TargetKind::File }), icon })
}

#[cfg(unix)]
fn is_unix_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_unix_executable(_: &std::fs::Metadata) -> bool {
    false
}

#[tauri::command]
pub fn system_snapshot(state: State<'_, AppState>) -> Snapshot {
    lock(&state.monitor).snapshot()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProbe {
    id: String,
    target: Target,
}

/// Identifiants des planètes dont l'application tourne.
#[tauri::command]
pub async fn running_planets(app: AppHandle, planets: Vec<RunningProbe>) -> CmdResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let hints: Vec<(String, String)> = {
            let mut cache = lock(&state.hints);
            planets
                .iter()
                .filter_map(|p| {
                    let hint = cache.entry(p.target.value.clone()).or_insert_with(|| unitech_launcher::process_hint(&p.target)).clone()?;
                    Some((p.id.clone(), hint))
                })
                .collect()
        };
        let running = lock(&state.monitor).running(&hints);
        running
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn recent_downloads() -> CmdResult<Vec<RecentFile>> {
    tauri::async_runtime::spawn_blocking(|| unitech_system::recent_downloads(12)).await.map_err(err)
}

#[tauri::command]
pub fn shortcut_set(app: AppHandle, accel: String) -> CmdResult<()> {
    window::set_shortcut(&app, &accel)
}

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> CmdResult<bool> {
    app.autolaunch().is_enabled().map_err(err)
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> CmdResult<()> {
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(err)
    } else {
        al.disable().map_err(err)
    }
}

#[tauri::command]
pub fn wallpaper_set(app: AppHandle, enabled: bool) -> CmdResult<()> {
    window::set_wallpaper(&app, enabled).map_err(err)
}

/// En mode fond d'écran : passe la fenêtre devant (recherche en cours) ou la renvoie au fond.
#[tauri::command]
pub fn wallpaper_raise(app: AppHandle, raised: bool) {
    if app.state::<AppState>().wallpaper.load(std::sync::atomic::Ordering::Relaxed) {
        window::raise(&app, raised);
    }
}

#[tauri::command]
pub fn app_hide(app: AppHandle) {
    if let Some(w) = window::main_window(&app) {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_recognises_folders_files_and_desktop_entries() {
        let dir = std::env::temp_dir().join(format!("unitech-describe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes.txt");
        std::fs::write(&file, "x").unwrap();
        let desktop = dir.join("demo.desktop");
        std::fs::write(&desktop, "[Desktop Entry]\nType=Application\nName=Démo\nExec=demo\n").unwrap();

        let folder = describe(&dir.to_string_lossy()).unwrap();
        assert_eq!(folder.target.kind, TargetKind::Folder);
        let f = describe(&file.to_string_lossy()).unwrap();
        assert_eq!((f.name.as_str(), f.target.kind), ("notes", TargetKind::File));
        let d = describe(&desktop.to_string_lossy()).unwrap();
        assert_eq!((d.name.as_str(), d.target.kind), ("Démo", TargetKind::App));
        assert!(describe(&dir.join("missing").to_string_lossy()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
