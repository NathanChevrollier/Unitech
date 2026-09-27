//! Lancement des planètes et découverte des applications installées.

pub mod desktop_entry;
pub mod discover;
pub mod icons;
pub mod launch;

pub use discover::{discover, DiscoveredApp};
pub use launch::{check_url, launch, process_hint, LaunchError};
