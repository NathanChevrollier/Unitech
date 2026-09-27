//! Lancement d'une cible (application, fichier, dossier, URL, commande) sans bloquer l'interface.

use std::path::Path;
use std::process::{Command, Stdio};

use unitech_core::{Target, TargetKind};

use crate::desktop_entry;

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("la cible est vide")]
    Empty,
    #[error("introuvable : {0}")]
    NotFound(String),
    #[error("adresse refusée : {0}")]
    BadUrl(String),
    #[error("fichier .desktop illisible : {0}")]
    BadDesktopEntry(String),
    #[error("échec du lancement : {0}")]
    Spawn(#[from] std::io::Error),
}

/// Schémas d'URL jamais ouverts : ils exécuteraient du contenu au lieu de désigner une ressource.
const BLOCKED_SCHEMES: [&str; 4] = ["javascript", "data", "vbscript", "file"];

/// Vérifie qu'une URL a un schéma et qu'il est autorisé. Renvoie le schéma en minuscules.
pub fn check_url(url: &str) -> Result<String, LaunchError> {
    let bad = || LaunchError::BadUrl(url.to_string());
    let (scheme, rest) = url.split_once(':').ok_or_else(bad)?;
    let valid = !scheme.is_empty()
        && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid || rest.is_empty() || url.chars().any(char::is_whitespace) {
        return Err(bad());
    }
    let scheme = scheme.to_ascii_lowercase();
    if BLOCKED_SCHEMES.contains(&scheme.as_str()) {
        return Err(bad());
    }
    Ok(scheme)
}

/// Lance la cible. Renvoie le PID du processus créé quand il y en a un.
pub fn launch(target: &Target) -> Result<Option<u32>, LaunchError> {
    let value = target.value.trim();
    if value.is_empty() {
        return Err(LaunchError::Empty);
    }
    let cwd = target.cwd.as_deref().filter(|c| Path::new(c).is_dir());
    match target.kind {
        TargetKind::Url => {
            check_url(value)?;
            open::that_detached(value)?;
            Ok(None)
        }
        TargetKind::File | TargetKind::Folder => {
            let path = expand_home(value);
            if !Path::new(&path).exists() {
                return Err(LaunchError::NotFound(path));
            }
            open::that_detached(&path)?;
            Ok(None)
        }
        TargetKind::Command => {
            let mut cmd = shell(value);
            if let Some(cwd) = cwd {
                cmd.current_dir(cwd);
            }
            spawn(cmd, true)
        }
        TargetKind::App => launch_app(&expand_home(value), &target.args, cwd),
    }
}

fn launch_app(value: &str, args: &[String], cwd: Option<&str>) -> Result<Option<u32>, LaunchError> {
    let path = Path::new(value);
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("desktop") => {
            let text = std::fs::read_to_string(path).map_err(|_| LaunchError::NotFound(value.into()))?;
            let entry = desktop_entry::parse(&text, None).ok_or_else(|| LaunchError::BadDesktopEntry(value.into()))?;
            let mut argv = desktop_entry::exec_argv(&entry.exec);
            if argv.is_empty() {
                return Err(LaunchError::BadDesktopEntry(value.into()));
            }
            argv.extend(args.iter().cloned());
            let mut cmd = Command::new(argv.remove(0));
            cmd.args(argv);
            if let Some(dir) = cwd.or(entry.path.as_deref()) {
                cmd.current_dir(dir);
            }
            spawn(cmd, false)
        }
        Some("app") if cfg!(target_os = "macos") => {
            let mut cmd = Command::new("open");
            cmd.arg("-a").arg(value);
            if !args.is_empty() {
                cmd.arg("--args").args(args);
            }
            spawn(cmd, false)
        }
        // Raccourcis Windows et fichiers ouverts par leur application associée : pas d'arguments possibles.
        Some("lnk" | "url" | "appref-ms") => {
            if !path.exists() {
                return Err(LaunchError::NotFound(value.into()));
            }
            open::that_detached(value)?;
            Ok(None)
        }
        _ => {
            // Un nom nu (`code`, `firefox`) est cherché dans le PATH par le système.
            let bare = !value.contains(['/', '\\']);
            if !bare && !path.exists() {
                return Err(LaunchError::NotFound(value.into()));
            }
            let mut cmd = Command::new(value);
            cmd.args(args);
            if let Some(cwd) = cwd {
                cmd.current_dir(cwd);
            }
            spawn(cmd, false)
        }
    }
}

fn shell(line: &str) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(line);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(line);
        c
    }
}

/// Démarre le processus détaché de l'application : sans entrée/sortie héritée, dans son propre
/// groupe, et récupéré par un fil dédié pour ne pas laisser de zombie.
fn spawn(mut cmd: Command, hide_console: bool) -> Result<Option<u32>, LaunchError> {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        let _ = hide_console;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | if hide_console { CREATE_NO_WINDOW } else { DETACHED_PROCESS });
    }
    let mut child = cmd.spawn()?;
    let pid = child.id();
    std::thread::Builder::new().name("unitech-reap".into()).spawn(move || {
        let _ = child.wait();
    })?;
    Ok(Some(pid))
}

/// `~/x` → dossier personnel.
pub fn expand_home(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/").or_else(|| value.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    value.to_string()
}

/// Nom de processus probable d'une application, pour savoir si elle tourne déjà.
pub fn process_hint(target: &Target) -> Option<String> {
    if target.kind != TargetKind::App {
        return None;
    }
    let value = expand_home(target.value.trim());
    let path = Path::new(&value);
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    let program = if ext.as_deref() == Some("desktop") {
        let text = std::fs::read_to_string(path).ok()?;
        let entry = desktop_entry::parse(&text, None)?;
        let argv = desktop_entry::exec_argv(&entry.exec);
        // `env VAR=x prog` : le programme est le premier élément qui n'est pas une affectation.
        let first = argv.iter().find(|a| !a.contains('=') && a.as_str() != "env")?.clone();
        // Les applications Flatpak et Snap tournent sous un autre nom : pas de détection fiable.
        if first.ends_with("flatpak") || first.ends_with("snap") {
            return None;
        }
        first
    } else {
        value
    };
    let stem = Path::new(&program).file_stem()?.to_str()?.to_ascii_lowercase();
    (!stem.is_empty()).then_some(stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(kind: TargetKind, value: &str) -> Target {
        Target { kind, value: value.into(), args: vec![], cwd: None }
    }

    #[test]
    fn urls_need_a_safe_scheme() {
        assert_eq!(check_url("https://example.com").unwrap(), "https");
        assert_eq!(check_url("mailto:a@b.c").unwrap(), "mailto");
        assert_eq!(check_url("steam://run/570").unwrap(), "steam");
        for bad in [
            "javascript:alert(1)",
            "JavaScript:x",
            "data:text/html,x",
            "file:///etc/passwd",
            "example.com",
            "http://a b",
            "1http://x",
            ":x",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn empty_and_missing_targets_fail_cleanly() {
        assert!(matches!(launch(&target(TargetKind::App, "  ")), Err(LaunchError::Empty)));
        assert!(matches!(launch(&target(TargetKind::File, "/nope/unitech-missing.txt")), Err(LaunchError::NotFound(_))));
        assert!(matches!(launch(&target(TargetKind::App, "/nope/unitech-missing-bin")), Err(LaunchError::NotFound(_))));
    }

    #[cfg(unix)]
    #[test]
    fn command_runs_detached_in_its_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let mut t = target(TargetKind::Command, "echo ok > marker.txt");
        t.cwd = Some(dir.path().to_string_lossy().into_owned());
        let pid = launch(&t).unwrap();
        assert!(pid.is_some());
        let marker = dir.path().join("marker.txt");
        for _ in 0..100 {
            if marker.exists() && std::fs::read_to_string(&marker).unwrap().trim() == "ok" {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("la commande n'a pas été exécutée");
    }

    #[cfg(unix)]
    #[test]
    fn desktop_file_is_launched_through_its_exec_line() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("launched");
        let desktop = dir.path().join("demo.desktop");
        std::fs::write(&desktop, format!("[Desktop Entry]\nType=Application\nName=Demo\nExec=touch {} %U\n", marker.display())).unwrap();
        launch(&target(TargetKind::App, &desktop.to_string_lossy())).unwrap();
        for _ in 0..100 {
            if marker.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("le .desktop n'a pas été lancé");
    }

    #[test]
    fn process_hints() {
        assert_eq!(process_hint(&target(TargetKind::App, "/usr/bin/code")).as_deref(), Some("code"));
        assert_eq!(process_hint(&target(TargetKind::App, "firefox")).as_deref(), Some("firefox"));
        assert_eq!(process_hint(&target(TargetKind::Url, "https://x")), None);
    }

    #[cfg(unix)]
    #[test]
    fn process_hint_reads_desktop_files() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.desktop");
        std::fs::write(&a, "[Desktop Entry]\nName=A\nExec=env GDK_BACKEND=x11 /opt/a/bin/alpha %U\n").unwrap();
        assert_eq!(process_hint(&target(TargetKind::App, &a.to_string_lossy())).as_deref(), Some("alpha"));
        let b = dir.path().join("b.desktop");
        std::fs::write(&b, "[Desktop Entry]\nName=B\nExec=/usr/bin/flatpak run --branch=stable com.spotify.Client\n").unwrap();
        assert_eq!(process_hint(&target(TargetKind::App, &b.to_string_lossy())), None);
    }
}
