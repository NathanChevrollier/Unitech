//! Remise en ordre d'un espace de travail lu sur disque ou reçu de l'interface.
//!
//! Tout ce qui est écrit passe par ici : identifiants uniques, bornes numériques, longueurs de
//! chaîne, couleurs valides, un seul système d'accueil par galaxie, bras complets. Rien n'est
//! refusé : une valeur invalide est corrigée, et chaque correction est comptée pour le journal.

use std::collections::HashSet;

use crate::model::*;

pub const MAX_NAME: usize = 80;
pub const MAX_NOTES: usize = 4_000;
pub const MAX_TARGET: usize = 4_096;
pub const MAX_ARGS: usize = 64;
pub const MAX_ICON: usize = 512 * 1024;
pub const MAX_ARCHIVE: usize = 500;
pub const MAX_GALAXIES: usize = 16;
pub const MAX_SYSTEMS: usize = 400;
pub const MAX_PLANETS: usize = 64;
pub const MAX_MOONS: usize = 8;

/// Nombre de corrections appliquées.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    pub fixes: usize,
}

struct Ctx {
    ids: HashSet<String>,
    counter: u64,
    report: Report,
}

impl Ctx {
    fn fix(&mut self) {
        self.report.fixes += 1;
    }

    /// Garde l'identifiant s'il est valide et libre, sinon en fabrique un nouveau.
    fn id(&mut self, id: &mut String, prefix: &str) {
        let valid = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if valid && self.ids.insert(id.clone()) {
            return;
        }
        loop {
            self.counter += 1;
            let candidate = format!("{prefix}-fix{}", self.counter);
            if self.ids.insert(candidate.clone()) {
                *id = candidate;
                break;
            }
        }
        self.fix();
    }

    fn text(&mut self, s: &mut String, max: usize, fallback: &str) {
        let trimmed: String = s.trim().chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect();
        let fixed = if trimmed.is_empty() { fallback.to_string() } else { trimmed };
        if fixed != *s {
            *s = fixed;
            self.fix();
        }
    }

    fn unit(&mut self, v: &mut f64, lo: f64, hi: f64, fallback: f64) {
        let fixed = if v.is_finite() { v.clamp(lo, hi) } else { fallback };
        if fixed != *v {
            *v = fixed;
            self.fix();
        }
    }
}

pub fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Icône acceptée : image en `data:` raisonnable, ou court texte (émoji).
pub fn is_valid_icon(s: &str) -> bool {
    if s.starts_with("data:image/") {
        s.len() <= MAX_ICON
    } else {
        !s.is_empty() && s.chars().count() <= 8 && !s.contains('<')
    }
}

pub fn sanitize(mut ws: Workspace) -> (Workspace, Report) {
    let mut cx = Ctx { ids: HashSet::new(), counter: 0, report: Report::default() };

    if ws.version != SCHEMA_VERSION {
        // Pas encore de migration : la version 1 est la première publiée.
        ws.version = SCHEMA_VERSION;
        cx.fix();
    }
    if ws.galaxies.len() > MAX_GALAXIES {
        ws.galaxies.truncate(MAX_GALAXIES);
        cx.fix();
    }
    if ws.galaxies.is_empty() {
        ws.galaxies.push(new_galaxy("perso", "Perso", DEFAULT_SEED, 0));
        cx.fix();
    }
    for g in &mut ws.galaxies {
        galaxy(&mut cx, g);
    }
    if !ws.galaxies.iter().any(|g| g.id == ws.active_galaxy) {
        ws.active_galaxy = ws.galaxies[0].id.clone();
        cx.fix();
    }
    settings(&mut cx, &mut ws.settings);
    (ws, cx.report)
}

fn galaxy(cx: &mut Ctx, g: &mut Galaxy) {
    cx.id(&mut g.id, "galaxy");
    cx.text(&mut g.name, MAX_NAME, "Galaxie");

    // Un bras par emplacement, dans l'ordre canonique.
    let mut arms = Vec::with_capacity(ArmSlot::ALL.len());
    for slot in ArmSlot::ALL {
        let mut arm = g.arms.iter().find(|a| a.slot == slot).cloned().unwrap_or_else(|| {
            cx.fix();
            default_arm(slot)
        });
        let def = default_arm(slot);
        cx.text(&mut arm.label, 40, &def.label);
        if !is_hex_color(&arm.color) {
            arm.color = def.color;
            cx.fix();
        }
        arms.push(arm);
    }
    g.arms = arms;

    if g.systems.len() > MAX_SYSTEMS {
        g.systems.truncate(MAX_SYSTEMS);
        cx.fix();
    }
    let mut has_home = false;
    for s in &mut g.systems {
        if matches!(s.anchor, Anchor::Home) {
            if has_home {
                s.anchor = Anchor::Arm { arm: ArmSlot::Orion, t: 0.5, offset: 0.0 };
                cx.fix();
            }
            has_home = true;
        }
        system(cx, s);
    }
    if !has_home {
        let mut id = format!("{}-sol", g.id);
        cx.id(&mut id, "system");
        g.systems.insert(0, home_system(&id, g.created_at));
        cx.fix();
    }

    let mut kept = Vec::with_capacity(g.archive.len().min(MAX_ARCHIVE));
    // Les plus récents d'abord : ce sont eux qu'on garde si l'archive déborde.
    g.archive.sort_by(|a, b| b.archived_at.cmp(&a.archived_at));
    for mut item in g.archive.drain(..) {
        if kept.len() >= MAX_ARCHIVE {
            cx.fix();
            continue;
        }
        cx.id(&mut item.id, "archive");
        match &mut item.payload {
            Archived::System { system: s } => {
                if matches!(s.anchor, Anchor::Home) {
                    s.anchor = Anchor::Arm { arm: ArmSlot::Orion, t: 0.5, offset: 0.0 };
                    cx.fix();
                }
                system(cx, s)
            }
            Archived::Planet { planet: p, .. } => planet(cx, p),
        }
        kept.push(item);
    }
    g.archive = kept;
}

fn system(cx: &mut Ctx, s: &mut StarSystem) {
    cx.id(&mut s.id, "system");
    cx.text(&mut s.name, MAX_NAME, "Système");
    if s.notes.chars().count() > MAX_NOTES {
        s.notes = s.notes.chars().take(MAX_NOTES).collect();
        cx.fix();
    }
    if s.color.as_deref().is_some_and(|c| !is_hex_color(c)) {
        s.color = None;
        cx.fix();
    }
    match &mut s.anchor {
        Anchor::Home => {}
        Anchor::Arm { t, offset, .. } => {
            cx.unit(t, 0.0, 1.0, 0.5);
            cx.unit(offset, -1.0, 1.0, 0.0);
        }
        Anchor::Real { name, .. } => cx.text(name, MAX_NAME, "Étoile"),
    }
    if s.planets.len() > MAX_PLANETS {
        s.planets.truncate(MAX_PLANETS);
        cx.fix();
    }
    for p in &mut s.planets {
        planet(cx, p);
    }
}

fn planet(cx: &mut Ctx, p: &mut Planet) {
    cx.id(&mut p.id, "planet");
    cx.text(&mut p.name, MAX_NAME, "Planète");
    target(cx, &mut p.target);
    if p.icon.as_deref().is_some_and(|i| !is_valid_icon(i)) {
        p.icon = None;
        cx.fix();
    }
    if p.moons.len() > MAX_MOONS {
        p.moons.truncate(MAX_MOONS);
        cx.fix();
    }
    for m in &mut p.moons {
        cx.id(&mut m.id, "moon");
        cx.text(&mut m.name, MAX_NAME, "Action");
        target(cx, &mut m.target);
    }
}

fn target(cx: &mut Ctx, t: &mut Target) {
    if t.value.len() > MAX_TARGET || t.value.contains('\0') {
        t.value = t.value.replace('\0', "").chars().take(MAX_TARGET).collect();
        cx.fix();
    }
    if t.args.len() > MAX_ARGS {
        t.args.truncate(MAX_ARGS);
        cx.fix();
    }
    let before = t.args.len();
    t.args.retain(|a| !a.contains('\0') && a.len() <= MAX_TARGET);
    if t.args.len() != before {
        cx.fix();
    }
    if t.cwd.as_deref().is_some_and(|c| c.trim().is_empty() || c.contains('\0')) {
        t.cwd = None;
        cx.fix();
    }
}

fn settings(cx: &mut Ctx, s: &mut Settings) {
    let shortcut = s.global_shortcut.trim();
    if shortcut.is_empty() || shortcut.len() > 64 {
        s.global_shortcut = DEFAULT_SHORTCUT.into();
        cx.fix();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn planet(id: &str) -> Planet {
        Planet {
            id: id.into(),
            name: "VS Code".into(),
            target: Target { kind: TargetKind::App, value: "/usr/bin/code".into(), args: vec![], cwd: None },
            icon: None,
            kind: PlanetKind::Auto,
            ring: false,
            moons: vec![],
            usage: Usage::default(),
            created_at: 1,
        }
    }

    #[test]
    fn default_workspace_is_already_clean() {
        let (ws, report) = sanitize(Workspace::default());
        assert_eq!(report.fixes, 0);
        assert_eq!(ws, Workspace::default());
    }

    #[test]
    fn empty_workspace_gets_a_galaxy_with_home() {
        let ws = Workspace { version: 1, active_galaxy: "x".into(), galaxies: vec![], settings: Settings::default() };
        let (ws, report) = sanitize(ws);
        assert!(report.fixes > 0);
        assert_eq!(ws.galaxies.len(), 1);
        assert_eq!(ws.active_galaxy, ws.galaxies[0].id);
        assert!(matches!(ws.galaxies[0].systems[0].anchor, Anchor::Home));
    }

    #[test]
    fn duplicate_ids_are_renamed() {
        let mut ws = Workspace::default();
        let sys = &mut ws.galaxies[0].systems[0];
        sys.planets = vec![planet("p1"), planet("p1"), planet("bad id!")];
        let (ws, _) = sanitize(ws);
        let ids: Vec<_> = ws.galaxies[0].systems[0].planets.iter().map(|p| p.id.clone()).collect();
        assert_eq!(ids[0], "p1");
        assert_ne!(ids[1], "p1");
        assert!(ids[2].starts_with("planet-fix"));
        let unique: HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn second_home_is_moved_to_an_arm_and_numbers_are_bounded() {
        let mut ws = Workspace::default();
        let g = &mut ws.galaxies[0];
        g.systems.push(home_system("other", 0));
        g.systems.push(StarSystem { anchor: Anchor::Arm { arm: ArmSlot::Norma, t: f64::NAN, offset: 7.0 }, ..home_system("armed", 0) });
        let (ws, _) = sanitize(ws);
        let g = &ws.galaxies[0];
        assert_eq!(g.systems.iter().filter(|s| matches!(s.anchor, Anchor::Home)).count(), 1);
        assert_eq!(g.systems[2].anchor, Anchor::Arm { arm: ArmSlot::Norma, t: 0.5, offset: 1.0 });
    }

    #[test]
    fn arms_are_completed_and_ordered() {
        let mut ws = Workspace::default();
        let g = &mut ws.galaxies[0];
        g.arms = vec![Arm { slot: ArmSlot::Orion, label: "  Outils  ".into(), color: "red".into() }];
        let (ws, _) = sanitize(ws);
        let arms = &ws.galaxies[0].arms;
        assert_eq!(arms.iter().map(|a| a.slot).collect::<Vec<_>>(), ArmSlot::ALL);
        assert_eq!(arms[4].label, "Outils");
        assert_eq!(arms[4].color, default_arm(ArmSlot::Orion).color);
    }

    #[test]
    fn invalid_icon_color_and_names_are_fixed() {
        let mut ws = Workspace::default();
        let s = &mut ws.galaxies[0].systems[0];
        s.color = Some("#12345".into());
        s.name = "   ".into();
        let mut p = planet("p");
        p.icon = Some("<script>".into());
        p.name = "x".repeat(200);
        s.planets.push(p);
        let (ws, _) = sanitize(ws);
        let s = &ws.galaxies[0].systems[0];
        assert_eq!(s.color, None);
        assert_eq!(s.name, "Système");
        assert_eq!(s.planets[0].icon, None);
        assert_eq!(s.planets[0].name.chars().count(), MAX_NAME);
    }

    #[test]
    fn archive_keeps_the_most_recent_items() {
        let mut ws = Workspace::default();
        let g = &mut ws.galaxies[0];
        for i in 0..(MAX_ARCHIVE + 5) {
            g.archive.push(ArchivedItem {
                id: format!("a{i}"),
                archived_at: i as i64,
                payload: Archived::Planet { system_id: "s".into(), planet: planet(&format!("p{i}")) },
            });
        }
        let (ws, _) = sanitize(ws);
        let archive = &ws.galaxies[0].archive;
        assert_eq!(archive.len(), MAX_ARCHIVE);
        assert_eq!(archive[0].archived_at, (MAX_ARCHIVE + 4) as i64);
    }

    #[test]
    fn icons() {
        assert!(is_valid_icon("🚀"));
        assert!(is_valid_icon("data:image/png;base64,AAAA"));
        assert!(!is_valid_icon(""));
        assert!(!is_valid_icon("javascript:alert(1)"));
    }
}
