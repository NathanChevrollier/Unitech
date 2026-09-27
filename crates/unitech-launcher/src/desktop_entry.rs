//! Fichiers `.desktop` (spécification freedesktop « Desktop Entry ») : lecture et ligne `Exec`.

use std::collections::HashMap;

/// Section `[Desktop Entry]` d'un fichier `.desktop`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEntry {
    pub name: String,
    pub exec: String,
    pub icon: Option<String>,
    pub categories: Vec<String>,
    pub terminal: bool,
    pub path: Option<String>,
}

/// Lit une entrée lançable ; `None` si elle est cachée, n'est pas une application ou n'a pas de
/// commande. Le nom localisé (`Name[fr]`) est préféré quand `lang` est fourni.
pub fn parse(text: &str, lang: Option<&str>) -> Option<DesktopEntry> {
    let mut in_entry = false;
    let mut kv: HashMap<&str, &str> = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            kv.entry(k.trim()).or_insert(v.trim());
        }
    }
    if kv.get("Type").copied().unwrap_or("Application") != "Application" {
        return None;
    }
    let truthy = |k: &str| kv.get(k).is_some_and(|v| v.eq_ignore_ascii_case("true"));
    if truthy("NoDisplay") || truthy("Hidden") {
        return None;
    }
    let exec = unescape(kv.get("Exec")?);
    if exec.is_empty() {
        return None;
    }
    let localized = lang.and_then(|l| {
        let short = l.split(['_', '.', '@']).next().unwrap_or(l);
        kv.get(format!("Name[{l}]").as_str()).or_else(|| kv.get(format!("Name[{short}]").as_str()))
    });
    let name = unescape(localized.or_else(|| kv.get("Name"))?);
    if name.is_empty() {
        return None;
    }
    Some(DesktopEntry {
        name,
        exec,
        icon: kv.get("Icon").map(|s| unescape(s)).filter(|s| !s.is_empty()),
        categories: kv.get("Categories").map(|c| c.split(';').filter(|s| !s.is_empty()).map(String::from).collect()).unwrap_or_default(),
        terminal: truthy("Terminal"),
        path: kv.get("Path").map(|s| unescape(s)).filter(|s| !s.is_empty()),
    })
}

/// Échappements des valeurs de type chaîne (`\s`, `\n`, `\t`, `\r`, `\\`).
fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Découpe une ligne `Exec` en arguments et retire les codes de champ (`%f`, `%U`…), puisque
/// Unitech lance l'application sans fichier.
pub fn exec_argv(exec: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut has_token = false;
    let mut quoted = false;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                has_token = true;
            }
            '\\' if quoted => {
                if let Some(&next) = chars.peek() {
                    if matches!(next, '"' | '`' | '$' | '\\') {
                        cur.push(next);
                        chars.next();
                        continue;
                    }
                }
                cur.push('\\');
            }
            c if c.is_whitespace() && !quoted => {
                if has_token {
                    args.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            _ => {
                cur.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        args.push(cur);
    }
    args.into_iter()
        .filter_map(|a| {
            // Un argument réduit à un code de champ disparaît ; ailleurs, `%%` devient `%`.
            if a.len() == 2 && a.starts_with('%') && a != "%%" {
                return None;
            }
            let mut out = String::with_capacity(a.len());
            let mut it = a.chars().peekable();
            while let Some(c) = it.next() {
                if c == '%' {
                    if let Some('%') = it.next() {
                        out.push('%');
                    }
                } else {
                    out.push(c);
                }
            }
            // Un argument vidé par le retrait de ses codes (`%i%c`) disparaît aussi ; `""` reste.
            if out.is_empty() && a.contains('%') {
                None
            } else {
                Some(out)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIREFOX: &str = r#"
[Desktop Entry]
Version=1.0
Name=Firefox Web Browser
Name[fr]=Navigateur Web Firefox
Exec=firefox %u
Icon=firefox
Type=Application
Categories=GNOME;GTK;Network;WebBrowser;

[Desktop Action new-window]
Name=Open a New Window
Exec=firefox --new-window
"#;

    #[test]
    fn parses_localized_entry_and_ignores_actions() {
        let e = parse(FIREFOX, Some("fr_FR.UTF-8")).unwrap();
        assert_eq!(e.name, "Navigateur Web Firefox");
        assert_eq!(e.exec, "firefox %u");
        assert_eq!(e.icon.as_deref(), Some("firefox"));
        assert_eq!(e.categories, ["GNOME", "GTK", "Network", "WebBrowser"]);
        assert!(!e.terminal);
        assert_eq!(parse(FIREFOX, None).unwrap().name, "Firefox Web Browser");
    }

    #[test]
    fn hidden_and_non_application_entries_are_skipped() {
        assert!(parse("[Desktop Entry]\nName=X\nExec=x\nNoDisplay=true\n", None).is_none());
        assert!(parse("[Desktop Entry]\nName=X\nType=Link\nURL=http://a\n", None).is_none());
        assert!(parse("[Desktop Entry]\nName=X\n", None).is_none());
    }

    #[test]
    fn exec_line_is_split_with_quotes_and_field_codes_removed() {
        assert_eq!(exec_argv("firefox %u"), ["firefox"]);
        assert_eq!(exec_argv(r#""/opt/My App/run" --flag %F"#), ["/opt/My App/run", "--flag"]);
        assert_eq!(exec_argv(r#"sh -c "echo \"hi\" \$HOME""#), ["sh", "-c", r#"echo "hi" $HOME"#]);
        assert_eq!(exec_argv("app --rate=100%%"), ["app", "--rate=100%"]);
        assert_eq!(exec_argv("  spaced   out  "), ["spaced", "out"]);
        assert_eq!(exec_argv(r#"app """#), ["app", ""]);
    }
}
