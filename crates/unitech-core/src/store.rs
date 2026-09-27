//! Lecture et écriture de l'espace de travail sur disque.
//!
//! Écriture atomique (fichier temporaire, `fsync`, renommage) et copie de sécurité du fichier
//! précédent. Un fichier illisible est mis de côté (jamais écrasé) et la copie de sécurité prend
//! le relais.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::model::{Workspace, SCHEMA_VERSION};
use crate::sanitize::sanitize;

const FILE: &str = "workspace.json";
const BACKUP: &str = "workspace.json.bak";
const TMP: &str = "workspace.json.tmp";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("accès au fichier {path} : {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("contenu JSON invalide : {0}")]
    Json(#[from] serde_json::Error),
    #[error("ce fichier a été écrit par une version plus récente d'Unitech (schéma {0}) : mets l'application à jour")]
    Newer(u32),
}

fn io(path: &Path) -> impl FnOnce(std::io::Error) -> StoreError + '_ {
    move |source| StoreError::Io { path: path.to_path_buf(), source }
}

/// Résultat d'un chargement.
#[derive(Debug)]
pub struct Loaded {
    pub workspace: Workspace,
    /// Aucun fichier : premier lancement.
    pub created: bool,
    /// Le fichier principal était illisible : la copie de sécurité a été utilisée.
    pub recovered: bool,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Store { dir: dir.into() }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    pub fn load(&self) -> Result<Loaded, StoreError> {
        let main = self.dir.join(FILE);
        let backup = self.dir.join(BACKUP);
        match read(&main) {
            Ok(Some(ws)) => return Ok(Loaded { workspace: ws, created: false, recovered: false }),
            Ok(None) => {}
            Err(StoreError::Newer(v)) => return Err(StoreError::Newer(v)),
            Err(e) => {
                log::warn!("espace de travail illisible, recours à la copie de sécurité : {e}");
                let aside = self.dir.join(format!("workspace.corrupt-{}.json", now_ms()));
                fs::rename(&main, &aside).map_err(io(&main))?;
                if let Some(ws) = read(&backup)? {
                    return Ok(Loaded { workspace: ws, created: false, recovered: true });
                }
                return Ok(Loaded { workspace: Workspace::default(), created: true, recovered: true });
            }
        }
        // Fichier principal absent (interruption entre deux renommages) : la copie peut exister.
        if let Some(ws) = read(&backup)? {
            return Ok(Loaded { workspace: ws, created: false, recovered: true });
        }
        Ok(Loaded { workspace: Workspace::default(), created: true, recovered: false })
    }

    /// Nettoie puis écrit l'espace de travail. Renvoie la version réellement écrite.
    pub fn save(&self, ws: Workspace) -> Result<Workspace, StoreError> {
        if ws.version > SCHEMA_VERSION {
            return Err(StoreError::Newer(ws.version));
        }
        let (ws, report) = sanitize(ws);
        if report.fixes > 0 {
            log::info!("espace de travail corrigé avant écriture ({} corrections)", report.fixes);
        }
        let json = serde_json::to_vec_pretty(&ws)?;
        write_atomic(&self.dir, &json)?;
        Ok(ws)
    }

    /// Lit un fichier exporté (ou n'importe quel JSON d'espace de travail) sans rien écrire.
    pub fn parse(json: &str) -> Result<Workspace, StoreError> {
        let ws: Workspace = serde_json::from_str(json)?;
        if ws.version > SCHEMA_VERSION {
            return Err(StoreError::Newer(ws.version));
        }
        Ok(sanitize(ws).0)
    }
}

fn read(path: &Path) -> Result<Option<Workspace>, StoreError> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(path)(e)),
    };
    Store::parse(&text).map(Some)
}

fn write_atomic(dir: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    fs::create_dir_all(dir).map_err(io(dir))?;
    let tmp = dir.join(TMP);
    let main = dir.join(FILE);
    let backup = dir.join(BACKUP);
    {
        let mut f = File::create(&tmp).map_err(io(&tmp))?;
        f.write_all(bytes).map_err(io(&tmp))?;
        f.sync_all().map_err(io(&tmp))?;
    }
    if main.exists() {
        // Le fichier courant, forcément lisible puisqu'il a été chargé ou écrit par nous, devient la copie.
        fs::copy(&main, &backup).map_err(io(&backup))?;
    }
    fs::rename(&tmp, &main).map_err(io(&main))?;
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_load_creates_the_default_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = Store::new(dir.path()).load().unwrap();
        assert!(loaded.created);
        assert!(!loaded.recovered);
        assert_eq!(loaded.workspace, Workspace::default());
    }

    #[test]
    fn save_then_load_round_trips_and_keeps_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let mut ws = Workspace::default();
        ws.galaxies[0].name = "Travail".into();
        store.save(ws.clone()).unwrap();
        ws.galaxies[0].name = "Travail 2".into();
        store.save(ws.clone()).unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded.workspace.galaxies[0].name, "Travail 2");
        let backup: Workspace = serde_json::from_str(&fs::read_to_string(dir.path().join(BACKUP)).unwrap()).unwrap();
        assert_eq!(backup.galaxies[0].name, "Travail");
        assert!(!dir.path().join(TMP).exists());
    }

    #[test]
    fn corrupt_file_is_set_aside_and_backup_is_used() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let mut ws = Workspace::default();
        ws.galaxies[0].name = "Sauvée".into();
        store.save(ws.clone()).unwrap();
        store.save(ws).unwrap();
        fs::write(dir.path().join(FILE), b"{ pas du json").unwrap();

        let loaded = store.load().unwrap();
        assert!(loaded.recovered);
        assert_eq!(loaded.workspace.galaxies[0].name, "Sauvée");
        let aside = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("workspace.corrupt-"));
        assert!(aside, "le fichier illisible doit être conservé");
    }

    #[test]
    fn newer_schema_is_refused_and_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let mut value = serde_json::to_value(Workspace::default()).unwrap();
        value["version"] = serde_json::json!(SCHEMA_VERSION + 1);
        let text = serde_json::to_string(&value).unwrap();
        fs::write(dir.path().join(FILE), &text).unwrap();

        assert!(matches!(Store::new(dir.path()).load(), Err(StoreError::Newer(_))));
        assert_eq!(fs::read_to_string(dir.path().join(FILE)).unwrap(), text);
    }

    #[test]
    fn default_workspace_matches_the_shared_fixture() {
        let fixture = include_str!("../../../fixtures/default-workspace.json");
        let expected: serde_json::Value = serde_json::from_str(fixture).unwrap();
        assert_eq!(serde_json::to_value(Workspace::default()).unwrap(), expected);
    }

    #[test]
    fn full_fixture_round_trips_without_loss() {
        let fixture = include_str!("../../../fixtures/sample-workspace.json");
        let expected: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let ws = Store::parse(fixture).unwrap();
        assert_eq!(serde_json::to_value(ws).unwrap(), expected);
    }
}
