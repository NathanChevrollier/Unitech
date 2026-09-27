//! Données vivantes de la galaxie : mesures des widgets (stations), téléchargements récents
//! (comètes) et applications en cours d'exécution (planètes qui pulsent).

use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{MemoryRefreshKind, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Charge processeur globale, en pourcentage.
    pub cpu: f32,
    pub cores: usize,
    pub memory_used: u64,
    pub memory_total: u64,
    pub uptime: u64,
    pub host: String,
    pub os: String,
}

pub struct Monitor {
    sys: System,
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Monitor {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()));
        sys.refresh_cpu_usage();
        Monitor { sys }
    }

    /// Mesure courante. La charge processeur est calculée depuis l'appel précédent : le premier
    /// relevé est donc approximatif, les suivants (toutes les deux secondes) sont exacts.
    pub fn snapshot(&mut self) -> Snapshot {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        Snapshot {
            cpu: self.sys.global_cpu_usage(),
            cores: self.sys.cpus().len(),
            memory_used: self.sys.used_memory(),
            memory_total: self.sys.total_memory(),
            uptime: System::uptime(),
            host: System::host_name().unwrap_or_default(),
            os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
        }
    }

    /// Parmi les couples (identifiant, nom de processus attendu), ceux dont un processus tourne.
    pub fn running(&mut self, hints: &[(String, String)]) -> Vec<String> {
        if hints.is_empty() {
            return Vec::new();
        }
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
        );
        let mut names: HashSet<String> = HashSet::new();
        for p in self.sys.processes().values() {
            names.insert(normalize(&p.name().to_string_lossy()));
            if let Some(stem) = p.exe().and_then(|e| e.file_stem()) {
                names.insert(normalize(&stem.to_string_lossy()));
            }
        }
        hints.iter().filter(|(_, hint)| names.contains(&normalize(hint))).map(|(id, _)| id.clone()).collect()
    }
}

fn normalize(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Date de modification, en millisecondes depuis l'époque Unix.
    pub modified: i64,
    pub is_dir: bool,
}

/// Extensions des téléchargements inachevés.
const PARTIAL: [&str; 6] = ["part", "crdownload", "download", "tmp", "partial", "opdownload"];

/// Fichiers du dossier modifiés depuis moins de `max_age`, du plus récent au plus ancien.
pub fn recent_files(dir: &Path, max_age: Duration, limit: usize) -> Vec<RecentFile> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let now = SystemTime::now();
    let mut out: Vec<RecentFile> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let ext = Path::new(&name).extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase());
            if ext.as_deref().is_some_and(|x| PARTIAL.contains(&x)) {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?;
            if now.duration_since(modified).unwrap_or_default() > max_age {
                return None;
            }
            Some(RecentFile {
                name,
                path: e.path().to_string_lossy().into_owned(),
                size: if meta.is_file() { meta.len() } else { 0 },
                modified: modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0),
                is_dir: meta.is_dir(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    out.truncate(limit);
    out
}

/// Dossier des téléchargements : celui déclaré par le système (XDG, Windows, macOS), sinon
/// `~/Downloads` ou `~/Téléchargements` s'ils existent.
pub fn download_dir() -> Option<std::path::PathBuf> {
    if let Some(d) = dirs::download_dir().filter(|d| d.is_dir()) {
        return Some(d);
    }
    if let Some(d) = std::env::var_os("XDG_DOWNLOAD_DIR").map(std::path::PathBuf::from).filter(|d| d.is_dir()) {
        return Some(d);
    }
    let home = dirs::home_dir()?;
    ["Downloads", "Téléchargements"].iter().map(|n| home.join(n)).find(|d| d.is_dir())
}

/// Téléchargements des trois derniers jours.
pub fn recent_downloads(limit: usize) -> Vec<RecentFile> {
    download_dir().map(|d| recent_files(&d, Duration::from_secs(3 * 86_400), limit)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_reports_memory_and_cores() {
        let mut m = Monitor::new();
        let s = m.snapshot();
        assert!(s.memory_total > 0);
        assert!(s.memory_used <= s.memory_total);
        assert!(s.cores > 0);
        assert!((0.0..=100.0 * s.cores as f32).contains(&s.cpu));
    }

    #[test]
    fn running_finds_the_current_test_process() {
        let mut m = Monitor::new();
        let me = std::env::current_exe().unwrap();
        let stem = me.file_stem().unwrap().to_string_lossy().into_owned();
        let hints = vec![("me".to_string(), stem), ("ghost".to_string(), "unitech-no-such-process".to_string())];
        assert_eq!(m.running(&hints), ["me"]);
    }

    #[test]
    fn recent_files_skip_partial_and_hidden_downloads() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("photo.png"), b"1234").unwrap();
        std::fs::write(dir.path().join("film.mkv.part"), b"x").unwrap();
        std::fs::write(dir.path().join(".hidden"), b"x").unwrap();
        std::fs::create_dir(dir.path().join("archive")).unwrap();
        let files = recent_files(dir.path(), Duration::from_secs(60), 10);
        let mut names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["archive", "photo.png"]);
        let photo = files.iter().find(|f| f.name == "photo.png").unwrap();
        assert_eq!(photo.size, 4);
        assert!(!photo.is_dir);
        assert!(recent_files(dir.path(), Duration::from_secs(60), 1).len() == 1);
        assert!(recent_files(&dir.path().join("missing"), Duration::from_secs(60), 10).is_empty());
    }
}
