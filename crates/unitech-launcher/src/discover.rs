//! Applications installées, proposées à l'import au premier lancement.
//!
//! - Linux : fichiers `.desktop` des dossiers XDG et des exports Flatpak, avec icône et catégories.
//! - Windows : raccourcis `.lnk` du menu Démarrer (utilisateur et commun).
//! - macOS : paquets `.app` de `/Applications`, `/System/Applications` et `~/Applications`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use unitech_core::{Target, TargetKind};

use crate::desktop_entry;
use crate::icons;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApp {
    pub name: String,
    pub target: Target,
    /// URL `data:` de l'icône, quand elle a été trouvée.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Catégories freedesktop (Linux uniquement), utilisées pour choisir le bras.
    pub categories: Vec<String>,
}

pub fn discover() -> Vec<DiscoveredApp> {
    let mut apps = if cfg!(target_os = "linux") {
        linux(&linux_dirs(), std::env::var("LANG").ok().as_deref())
    } else if cfg!(windows) {
        windows()
    } else if cfg!(target_os = "macos") {
        macos()
    } else {
        Vec::new()
    };
    let mut seen = HashSet::new();
    apps.retain(|a| seen.insert(a.name.to_lowercase()));
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

fn app(name: String, value: &Path) -> DiscoveredApp {
    DiscoveredApp {
        name,
        target: Target { kind: TargetKind::App, value: value.to_string_lossy().into_owned(), args: vec![], cwd: None },
        icon: None,
        categories: vec![],
    }
}

fn linux_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".local/share")));
    if let Some(h) = &data_home {
        dirs.push(h.join("applications"));
        dirs.push(h.join("flatpak/exports/share/applications"));
    }
    let data_dirs = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    for d in data_dirs.split(':').filter(|d| !d.is_empty()) {
        dirs.push(Path::new(d).join("applications"));
    }
    dirs.push("/var/lib/flatpak/exports/share/applications".into());
    dirs.push("/var/lib/snapd/desktop/applications".into());
    let mut seen = HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// Parcourt les dossiers dans l'ordre : le premier fichier d'un identifiant donné masque les
/// suivants (règle XDG), ce qui laisse l'utilisateur surcharger une entrée système.
pub(crate) fn linux(dirs: &[PathBuf], lang: Option<&str>) -> Vec<DiscoveredApp> {
    let mut ids = HashSet::new();
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        let mut files: Vec<PathBuf> =
            entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "desktop")).collect();
        files.sort();
        for path in files {
            let id = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            if !ids.insert(id) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let Some(entry) = desktop_entry::parse(&text, lang) else { continue };
            // Les outils en ligne de commande n'ont pas leur place comme planète par défaut.
            if entry.terminal {
                continue;
            }
            let mut a = app(entry.name, &path);
            a.icon = entry.icon.as_deref().and_then(icons::linux_icon);
            a.categories = entry.categories;
            out.push(a);
        }
    }
    out
}

fn windows() -> Vec<DiscoveredApp> {
    let mut roots = Vec::new();
    if let Some(p) = std::env::var_os("ProgramData") {
        roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(p) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    let mut out = Vec::new();
    for root in roots {
        walk(&root, 3, &mut |p| {
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                return;
            }
            let name = p.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            // Désinstalleurs, documentations et pages web n'ont rien à faire sur le bureau.
            if ["uninstall", "désinstaller", "readme", "help", "aide", "documentation", "website"].iter().any(|w| lower.contains(w)) {
                return;
            }
            out.push(app(name, p));
        });
    }
    out
}

fn macos() -> Vec<DiscoveredApp> {
    let mut roots = vec![PathBuf::from("/Applications"), PathBuf::from("/Applications/Utilities"), PathBuf::from("/System/Applications")];
    if let Some(h) = dirs::home_dir() {
        roots.push(h.join("Applications"));
    }
    let mut out = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "app") {
                out.push(app(p.file_stem().unwrap_or_default().to_string_lossy().into_owned(), &p));
            }
        }
    }
    out
}

fn walk(dir: &Path, depth: usize, f: &mut dyn FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, f);
            }
        } else {
            f(&p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_scan_honours_precedence_and_filters() {
        let user = tempfile::tempdir().unwrap();
        let system = tempfile::tempdir().unwrap();
        let write = |dir: &Path, file: &str, body: &str| {
            std::fs::write(dir.join(file), format!("[Desktop Entry]\nType=Application\n{body}")).unwrap()
        };
        write(user.path(), "editor.desktop", "Name=Mon Éditeur\nExec=editor\nCategories=Development;");
        write(system.path(), "editor.desktop", "Name=Éditeur système\nExec=editor");
        write(system.path(), "top.desktop", "Name=Top\nExec=top\nTerminal=true");
        write(system.path(), "hidden.desktop", "Name=Caché\nExec=x\nNoDisplay=true");
        write(system.path(), "game.desktop", "Name=Jeu\nName[fr]=Le Jeu\nExec=game %U\nCategories=Game;");

        let apps = linux(&[user.path().to_path_buf(), system.path().to_path_buf()], Some("fr_FR.UTF-8"));
        let names: Vec<_> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["Mon Éditeur", "Le Jeu"]);
        assert_eq!(apps[0].categories, ["Development"]);
        assert!(apps[1].target.value.ends_with("game.desktop"));
    }
}
