//! Types persistés d'un espace de travail Unitech.
//!
//! Le JSON produit est lu tel quel par l'interface (`src/model/types.ts`) : les deux définitions
//! doivent rester alignées. Le fichier `fixtures/default-workspace.json` sert de témoin commun aux
//! tests Rust et TypeScript.

use serde::{Deserialize, Serialize};

/// Version du schéma écrite dans chaque fichier. À incrémenter avec une migration dans `sanitize`.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub version: u32,
    pub active_galaxy: String,
    pub galaxies: Vec<Galaxy>,
    #[serde(default)]
    pub settings: Settings,
}

/// Une galaxie = un profil (Perso, Travail, Études…).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Galaxy {
    pub id: String,
    pub name: String,
    /// Graine de la génération procédurale : la même galaxie à chaque lancement.
    pub seed: u32,
    pub arms: Vec<Arm>,
    pub systems: Vec<StarSystem>,
    #[serde(default)]
    pub archive: Vec<ArchivedItem>,
    #[serde(default)]
    pub created_at: i64,
}

/// Les cinq bras de la Voie lactée modélisés. Chacun porte une catégorie de l'utilisateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArmSlot {
    Perseus,
    ScutumCentaurus,
    Sagittarius,
    Norma,
    Orion,
}

impl ArmSlot {
    pub const ALL: [ArmSlot; 5] = [ArmSlot::Perseus, ArmSlot::ScutumCentaurus, ArmSlot::Sagittarius, ArmSlot::Norma, ArmSlot::Orion];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arm {
    pub slot: ArmSlot,
    pub label: String,
    /// Couleur `#rrggbb` de la catégorie.
    pub color: String,
}

/// Un système stellaire = un projet ou un domaine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarSystem {
    pub id: String,
    pub name: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub status: SystemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub planets: Vec<Planet>,
    #[serde(default)]
    pub created_at: i64,
}

/// Position d'un système dans la galaxie.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Anchor {
    /// Le Soleil : système d'accueil, unique par galaxie.
    Home,
    /// Le long d'un bras spiral : `t` de 0 (cœur) à 1 (bord), `offset` de -1 à 1 à travers le bras.
    #[serde(rename_all = "camelCase")]
    Arm { arm: ArmSlot, t: f64, offset: f64 },
    /// Une vraie étoile du catalogue HYG, « adoptée » par l'utilisateur.
    #[serde(rename_all = "camelCase")]
    Real { hyg_id: u32, name: String },
}

/// État d'un projet, rendu par la couleur de son étoile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemStatus {
    /// Étoile bleue, brillante.
    #[default]
    Active,
    /// Naine rouge.
    Paused,
    /// Naine blanche, discrète.
    Dormant,
}

/// Une planète = une application, un fichier, un dossier, une URL ou une commande.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Planet {
    pub id: String,
    pub name: String,
    pub target: Target,
    /// URL `data:` d'une image ou émoji.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub kind: PlanetKind,
    #[serde(default)]
    pub ring: bool,
    /// Actions secondaires, dessinées en lunes.
    #[serde(default)]
    pub moons: Vec<Moon>,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Moon {
    pub id: String,
    pub name: String,
    pub target: Target,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub kind: TargetKind,
    pub value: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    /// Exécutable, `.app`, `.desktop`, `.lnk`…
    App,
    File,
    Folder,
    Url,
    /// Ligne de commande passée au shell.
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanetKind {
    /// Choisi à partir de l'identifiant (stable).
    #[default]
    Auto,
    Rocky,
    Desert,
    Ocean,
    Ice,
    Lava,
    Gas,
    Toxic,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub launch_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_launched: Option<i64>,
}

/// Élément jeté dans le trou noir, restaurable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedItem {
    pub id: String,
    pub archived_at: i64,
    pub payload: Archived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Archived {
    System {
        system: StarSystem,
    },
    #[serde(rename_all = "camelCase")]
    Planet {
        system_id: String,
        planet: Planet,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Low,
    #[default]
    Medium,
    High,
    Ultra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub quality: Quality,
    pub bloom: bool,
    pub galaxy_rotation: bool,
    pub orbit_motion: bool,
    pub show_labels: bool,
    pub show_constellations: bool,
    pub reduced_motion: bool,
    /// Raccourci global (syntaxe Tauri) qui fait apparaître le lanceur.
    pub global_shortcut: String,
    pub close_to_tray: bool,
    pub onboarded: bool,
}

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";

impl Default for Settings {
    fn default() -> Self {
        Settings {
            quality: Quality::Medium,
            bloom: true,
            galaxy_rotation: true,
            orbit_motion: true,
            show_labels: true,
            show_constellations: false,
            reduced_motion: false,
            global_shortcut: DEFAULT_SHORTCUT.into(),
            close_to_tray: true,
            onboarded: false,
        }
    }
}

/// Libellé et couleur par défaut de chaque bras.
pub fn default_arm(slot: ArmSlot) -> Arm {
    let (label, color) = match slot {
        ArmSlot::Perseus => ("Développement", "#6ea8ff"),
        ArmSlot::ScutumCentaurus => ("Jeux", "#ff7a59"),
        ArmSlot::Sagittarius => ("Création", "#c77dff"),
        ArmSlot::Norma => ("Web", "#4dd4ac"),
        ArmSlot::Orion => ("Système", "#ffd166"),
    };
    Arm { slot, label: label.into(), color: color.into() }
}

pub fn home_system(id: &str, created_at: i64) -> StarSystem {
    StarSystem {
        id: id.into(),
        name: "Soleil".into(),
        anchor: Anchor::Home,
        status: SystemStatus::Active,
        color: None,
        notes: String::new(),
        planets: Vec::new(),
        created_at,
    }
}

pub fn new_galaxy(id: &str, name: &str, seed: u32, created_at: i64) -> Galaxy {
    Galaxy {
        id: id.into(),
        name: name.into(),
        seed,
        arms: ArmSlot::ALL.iter().map(|s| default_arm(*s)).collect(),
        systems: vec![home_system(&format!("{id}-sol"), created_at)],
        archive: Vec::new(),
        created_at,
    }
}

pub const DEFAULT_SEED: u32 = 20_260_927;

impl Default for Workspace {
    /// Espace de travail d'un premier lancement. Identifiants et dates fixes : il est comparé au
    /// témoin `fixtures/default-workspace.json`.
    fn default() -> Self {
        Workspace {
            version: SCHEMA_VERSION,
            active_galaxy: "perso".into(),
            galaxies: vec![new_galaxy("perso", "Perso", DEFAULT_SEED, 0)],
            settings: Settings::default(),
        }
    }
}

impl Workspace {
    pub fn active(&self) -> Option<&Galaxy> {
        self.galaxies.iter().find(|g| g.id == self.active_galaxy)
    }
}
