//! Application de bureau Unitech : fenêtre, commandes, icône de notification, raccourci global.

mod commands;
mod state;
mod tray;
mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use unitech_core::{Store, DEFAULT_SHORTCUT};

use crate::state::{lock, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Un second lancement ramène la fenêtre existante au lieu d'ouvrir une autre galaxie.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![window::HIDDEN_ARG])))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: Some("unitech".into()) })])
                .rotation_strategy(RotationStrategy::KeepOne)
                .max_file_size(2_000_000)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        window::summon_launcher(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let state = AppState::new(Store::new(dir));
            // Réglages du fichier pour le raccourci et la fermeture, avant même que l'interface démarre.
            if let Ok(loaded) = state.store.load() {
                *lock(&state.workspace) = loaded.workspace;
            }
            let accel = lock(&state.workspace).settings.global_shortcut.clone();
            app.manage(state);

            let handle = app.handle();
            if let Err(e) = window::set_shortcut(handle, &accel) {
                log::warn!("{e} ; retour au raccourci par défaut");
                if let Err(e) = window::set_shortcut(handle, DEFAULT_SHORTCUT) {
                    log::warn!("{e}");
                }
            }
            tray::setup(handle)?;
            if !std::env::args().any(|a| a == window::HIDDEN_ARG) {
                window::show(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if window.label() == window::MAIN && lock(&state.workspace).settings.close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace_load,
            commands::workspace_save,
            commands::workspace_export,
            commands::workspace_import,
            commands::launch_target,
            commands::discover_apps,
            commands::describe_path,
            commands::system_snapshot,
            commands::running_planets,
            commands::recent_downloads,
            commands::shortcut_set,
            commands::autostart_get,
            commands::autostart_set,
            commands::wallpaper_set,
            commands::wallpaper_raise,
            commands::app_hide,
            commands::app_quit,
        ])
        .run(tauri::generate_context!())
        .expect("démarrage d'Unitech");
}
