//! Icône de la zone de notification : ouvrir, lanceur, favoris, mode fond d'écran, quitter.

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use unitech_core::usage;

use crate::state::{lock, AppState};
use crate::window;

const TRAY_ID: &str = "main";
const FAVORITES: usize = 8;

/// Planète lancée depuis le menu : l'interface met ses statistiques à jour.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    pub planet_id: String,
    pub ok: bool,
    pub error: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let state = app.state::<AppState>();
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", "Ouvrir Unitech", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "launcher", "Lanceur…", true, None::<&str>)?)?;

    let favorites: Vec<(String, String)> = {
        let ws = lock(&state.workspace);
        ws.active()
            .map(|g| usage::favorites(g, now_ms(), FAVORITES).into_iter().map(|p| (p.id.clone(), p.name.clone())).collect())
            .unwrap_or_default()
    };
    if !favorites.is_empty() {
        let sub = Submenu::new(app, "Favoris", true)?;
        for (id, name) in favorites {
            sub.append(&MenuItem::with_id(app, format!("planet:{id}"), name, true, None::<&str>)?)?;
        }
        menu.append(&sub)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let wallpaper = state.wallpaper.load(Ordering::Relaxed);
    menu.append(&CheckMenuItem::with_id(app, "wallpaper", "Mode fond d'écran", true, wallpaper, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quitter Unitech", true, None::<&str>)?)?;
    Ok(menu)
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Unitech")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => window::show(app),
            "launcher" => window::summon_launcher(app),
            "wallpaper" => {
                let enabled = !app.state::<AppState>().wallpaper.load(Ordering::Relaxed);
                if let Err(e) = window::set_wallpaper(app, enabled) {
                    log::warn!("mode fond d'écran : {e}");
                }
            }
            "quit" => app.exit(0),
            id => {
                if let Some(planet_id) = id.strip_prefix("planet:") {
                    launch_favorite(app, planet_id);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                window::toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Reconstruit le menu (favoris, case du mode fond d'écran).
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    match build_menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::warn!("menu de notification : {e}"),
    }
}

fn launch_favorite<R: Runtime>(app: &AppHandle<R>, planet_id: &str) {
    let target = {
        let state = app.state::<AppState>();
        let ws = lock(&state.workspace);
        ws.active().and_then(|g| g.systems.iter().flat_map(|s| s.planets.iter()).find(|p| p.id == planet_id)).map(|p| p.target.clone())
    };
    let Some(target) = target else { return };
    let result = unitech_launcher::launch(&target);
    if let Err(e) = &result {
        log::warn!("lancement depuis le menu : {e}");
    }
    let _ = app.emit(
        "unitech://launched",
        Launched { planet_id: planet_id.to_string(), ok: result.is_ok(), error: result.err().map(|e| e.to_string()) },
    );
}
