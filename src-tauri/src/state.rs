//! État partagé entre les commandes, l'icône de notification et le raccourci global.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use unitech_core::{Store, Workspace};
use unitech_system::Monitor;

pub struct AppState {
    pub store: Store,
    /// Dernier espace de travail écrit : favoris du menu et réglage de fermeture.
    pub workspace: Mutex<Workspace>,
    pub monitor: Mutex<Monitor>,
    /// Nom de processus attendu pour chaque cible d'application (lecture des `.desktop` évitée).
    pub hints: Mutex<HashMap<String, Option<String>>>,
    /// Raccourci global actuellement enregistré.
    pub shortcut: Mutex<Option<String>>,
    pub wallpaper: AtomicBool,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        AppState {
            store,
            workspace: Mutex::new(Workspace::default()),
            monitor: Mutex::new(Monitor::new()),
            hints: Mutex::new(HashMap::new()),
            shortcut: Mutex::new(None),
            wallpaper: AtomicBool::new(false),
        }
    }
}

/// Verrou qui survit à un fil paniqué : l'état reste utilisable.
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
