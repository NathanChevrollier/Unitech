//! Fenêtre principale : affichage, raccourci global, mode fond d'écran.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::state::{lock, AppState};

pub const MAIN: &str = "main";
/// Argument du lancement automatique : l'app démarre réduite dans la zone de notification.
pub const HIDDEN_ARG: &str = "--hidden";

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    match main_window(app) {
        Some(w) if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false) => {
            let _ = w.hide();
        }
        _ => show(app),
    }
}

/// Fait apparaître la fenêtre et ouvre le lanceur. En mode fond d'écran, la fenêtre passe devant
/// les autres le temps de la recherche (l'interface la renvoie derrière ensuite).
pub fn summon_launcher<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<AppState>().wallpaper.load(Ordering::Relaxed) {
        raise(app, true);
    }
    show(app);
    let _ = app.emit("unitech://launcher", ());
}

pub fn raise<R: Runtime>(app: &AppHandle<R>, raised: bool) {
    if let Some(w) = main_window(app) {
        if raised {
            let _ = w.set_always_on_bottom(false);
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
        } else {
            let _ = w.set_always_on_top(false);
            let _ = w.set_always_on_bottom(true);
        }
    }
}

/// Mode fond d'écran : plein écran, sans décoration, derrière toutes les fenêtres et absent de la
/// barre des tâches. Ce n'est pas un vrai papier peint (les icônes du bureau restent masquées) :
/// c'est une fenêtre vivante placée tout au fond, rappelée par le raccourci global.
pub fn set_wallpaper<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> tauri::Result<()> {
    let Some(w) = main_window(app) else { return Ok(()) };
    app.state::<AppState>().wallpaper.store(enabled, Ordering::Relaxed);
    if enabled {
        w.set_decorations(false)?;
        w.set_skip_taskbar(true)?;
        w.set_fullscreen(true)?;
        w.set_always_on_top(false)?;
        w.set_always_on_bottom(true)?;
        w.show()?;
    } else {
        w.set_always_on_bottom(false)?;
        w.set_fullscreen(false)?;
        w.set_skip_taskbar(false)?;
        w.set_decorations(true)?;
        w.show()?;
        w.set_focus()?;
    }
    let _ = app.emit("unitech://wallpaper", enabled);
    crate::tray::refresh(app);
    Ok(())
}

/// Remplace le raccourci global. En cas d'échec (syntaxe, raccourci déjà pris par une autre
/// application), l'ancien reste actif et l'erreur est renvoyée.
pub fn set_shortcut<R: Runtime>(app: &AppHandle<R>, accel: &str) -> Result<(), String> {
    let accel = accel.trim();
    let shortcut: Shortcut = accel.parse().map_err(|e| format!("raccourci invalide « {accel} » : {e}"))?;
    let state = app.state::<AppState>();
    let mut current = lock(&state.shortcut);
    let gs = app.global_shortcut();
    if let Some(old) = current.as_deref() {
        if old == accel {
            return Ok(());
        }
        let _ = gs.unregister(old);
    }
    match gs.register(shortcut) {
        Ok(()) => {
            *current = Some(accel.to_string());
            Ok(())
        }
        Err(e) => {
            if let Some(old) = current.as_deref() {
                let _ = gs.register(old);
            }
            Err(format!("impossible d'enregistrer « {accel} » : {e}"))
        }
    }
}
