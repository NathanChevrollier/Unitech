//! Score d'usage d'une planète : sa taille et son éclat à l'écran, l'ordre des favoris.
//!
//! Même formule que `src/model/usage.ts` : fréquence (logarithmique) pondérée par la fraîcheur
//! (demi-vie de 14 jours).

use crate::model::{Galaxy, Planet, Usage};

pub const HALF_LIFE_DAYS: f64 = 14.0;
const DAY_MS: f64 = 86_400_000.0;

/// Score entre 0 (jamais utilisée) et 1 (utilisée très souvent et récemment).
pub fn score(usage: &Usage, now_ms: i64) -> f64 {
    let Some(last) = usage.last_launched else {
        return 0.0;
    };
    let frequency = (1.0 + usage.launch_count as f64).ln() / (1.0 + 200f64).ln();
    let age_days = ((now_ms - last).max(0) as f64) / DAY_MS;
    let freshness = 0.5f64.powf(age_days / HALF_LIFE_DAYS);
    (frequency.min(1.0) * (0.35 + 0.65 * freshness)).clamp(0.0, 1.0)
}

/// Les planètes les plus utilisées d'une galaxie, pour le menu de l'icône de notification.
pub fn favorites(galaxy: &Galaxy, now_ms: i64, limit: usize) -> Vec<&Planet> {
    let mut all: Vec<(&Planet, f64)> =
        galaxy.systems.iter().flat_map(|s| s.planets.iter()).map(|p| (p, score(&p.usage, now_ms))).filter(|(_, s)| *s > 0.0).collect();
    all.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.name.cmp(&b.0.name)));
    all.into_iter().take(limit).map(|(p, _)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    #[test]
    fn never_used_scores_zero() {
        assert_eq!(score(&Usage::default(), NOW), 0.0);
    }

    #[test]
    fn frequent_and_recent_beats_old() {
        let recent = Usage { launch_count: 50, last_launched: Some(NOW) };
        let old = Usage { launch_count: 50, last_launched: Some(NOW - 60 * DAY_MS as i64) };
        assert!(score(&recent, NOW) > score(&old, NOW));
        assert!(score(&recent, NOW) <= 1.0);
    }

    #[test]
    fn matches_the_typescript_reference_values() {
        // Mêmes valeurs que `src/model/usage.test.ts`.
        let a = score(&Usage { launch_count: 10, last_launched: Some(NOW) }, NOW);
        let b = score(&Usage { launch_count: 3, last_launched: Some(NOW - 14 * DAY_MS as i64) }, NOW);
        assert!((a - 0.452_151).abs() < 1e-5, "{a}");
        assert!((b - 0.176_446).abs() < 1e-5, "{b}");
    }
}
