//! Icônes d'applications, renvoyées à l'interface en URL `data:`.

use std::path::{Path, PathBuf};

use base64::Engine;

/// Taille maximale d'une icône embarquée dans l'espace de travail.
pub const MAX_ICON_BYTES: u64 = 256 * 1024;

/// Lit une image PNG, SVG, JPEG ou WebP et la convertit en URL `data:`.
pub fn data_url(path: &Path) -> Option<String> {
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return None,
    };
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_ICON_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if mime == "image/svg+xml" && !looks_like_safe_svg(&bytes) {
        return None;
    }
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Une icône SVG est affichée dans une balise `<img>` (scripts inactifs), mais on écarte quand même
/// celles qui embarquent du script ou des ressources externes.
fn looks_like_safe_svg(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    text.contains("<svg") && !text.contains("<script") && !text.contains("javascript:") && !text.contains("<foreignobject")
}

/// Résout un nom d'icône freedesktop (`firefox`) ou un chemin absolu.
pub fn linux_icon(name: &str) -> Option<String> {
    let direct = Path::new(name);
    if direct.is_absolute() {
        return data_url(direct);
    }
    candidates(name, &icon_roots()).into_iter().find_map(|p| data_url(&p))
}

fn icon_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(h) = dirs::home_dir() {
        roots.push(h.join(".local/share/icons"));
        roots.push(h.join(".icons"));
        roots.push(h.join(".local/share/flatpak/exports/share/icons"));
    }
    let data_dirs = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    for d in data_dirs.split(':').filter(|d| !d.is_empty()) {
        roots.push(Path::new(d).join("icons"));
    }
    roots.push("/var/lib/flatpak/exports/share/icons".into());
    roots
}

/// Chemins à essayer, du plus net au plus générique.
pub(crate) fn candidates(name: &str, roots: &[PathBuf]) -> Vec<PathBuf> {
    const THEMES: [&str; 4] = ["hicolor", "Adwaita", "breeze", "Papirus"];
    const SIZES: [&str; 7] = ["256x256", "128x128", "scalable", "96x96", "64x64", "48x48", "32x32"];
    let mut out = Vec::new();
    for root in roots {
        for theme in THEMES {
            for size in SIZES {
                for ext in ["png", "svg"] {
                    out.push(root.join(theme).join(size).join("apps").join(format!("{name}.{ext}")));
                }
            }
        }
    }
    for ext in ["png", "svg"] {
        out.push(PathBuf::from("/usr/share/pixmaps").join(format!("{name}.{ext}")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_becomes_a_data_url_and_large_files_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("a.png");
        std::fs::write(&small, [0x89, b'P', b'N', b'G']).unwrap();
        assert_eq!(data_url(&small).unwrap(), "data:image/png;base64,iVBORw==");
        let big = dir.path().join("b.png");
        std::fs::write(&big, vec![0u8; (MAX_ICON_BYTES + 1) as usize]).unwrap();
        assert!(data_url(&big).is_none());
        assert!(data_url(&dir.path().join("c.xpm")).is_none());
    }

    #[test]
    fn scripted_svg_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let ok = dir.path().join("ok.svg");
        std::fs::write(&ok, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        assert!(data_url(&ok).is_some());
        let bad = dir.path().join("bad.svg");
        std::fs::write(&bad, "<svg><script>alert(1)</script></svg>").unwrap();
        assert!(data_url(&bad).is_none());
    }

    #[test]
    fn theme_lookup_prefers_large_icons() {
        let root = tempfile::tempdir().unwrap();
        let big = root.path().join("hicolor/256x256/apps");
        let small = root.path().join("hicolor/48x48/apps");
        std::fs::create_dir_all(&big).unwrap();
        std::fs::create_dir_all(&small).unwrap();
        std::fs::write(big.join("demo.png"), b"big").unwrap();
        std::fs::write(small.join("demo.png"), b"small").unwrap();
        let first = candidates("demo", &[root.path().to_path_buf()]).into_iter().find(|p| p.exists()).unwrap();
        assert!(first.starts_with(&big));
    }
}
