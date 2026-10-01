pub(crate) fn is_f95_masked(url: &str) -> bool {
    url.starts_with("https://f95zone.to/masked/") || url.starts_with("http://f95zone.to/masked/")
}

/// Pull the `<host>` segment from `/masked/<host>/<thread>/...`.
pub(crate) fn masked_host(url: &str) -> Option<String> {
    let after = url.split_once("/masked/")?.1;
    let host = after.split('/').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

/// Strip hosting-site suffixes like " (520.47 MB)" before saving to disk.
pub(crate) fn clean_download_filename(name: &str) -> String {
    let mut s = name.trim().to_string();
    for _ in 0..3 {
        if let Some(next) = strip_one_trailing_size_label(&s) {
            s = next;
        } else {
            break;
        }
    }
    s
}

fn strip_one_trailing_size_label(name: &str) -> Option<String> {
    let trimmed = name.trim_end();
    if let Some(open) = trimmed.rfind(" (") {
        if open > 0 && trimmed.ends_with(')') {
            let inner = trimmed[open + 2..trimmed.len() - 1].trim();
            if is_human_size_label(inner) {
                return Some(trimmed[..open].trim_end().to_string());
            }
        }
    }
    if let Some(dash) = trimmed.rfind(" - ") {
        if dash > 0 {
            let inner = trimmed[dash + 3..].trim();
            if is_human_size_label(inner) {
                return Some(trimmed[..dash].trim_end().to_string());
            }
        }
    }
    None
}

fn is_human_size_label(text: &str) -> bool {
    let t = text.trim().to_ascii_uppercase().replace(',', "");
    for unit in ["B", "KB", "MB", "GB", "TB", "KIB", "MIB", "GIB"] {
        if let Some(num) = t.strip_suffix(unit) {
            let num = num.trim();
            if !num.is_empty() && num.chars().all(|c| c.is_ascii_digit() || c == '.') {
                return true;
            }
        }
    }
    false
}

/// Strip anything that would break a path segment on Windows or POSIX.
pub(crate) fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn host_of(url: &str) -> String {
    let rest = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = rest.split('/').next().unwrap_or(rest);
    host.split(':').next().unwrap_or(host).to_lowercase()
}

/// `host` is `domain` or a subdomain of it.
fn is_domain(host: &str, domain: &str) -> bool {
    host == domain
        || host
            .strip_suffix(domain)
            .is_some_and(|rest| rest.ends_with('.'))
}

/// Hosts whose download link only comes after a human check (Turnstile or
/// reCAPTCHA), done in the app's own verification window
/// (`commands::captcha`). Keep in sync with `VERIFY_HOSTS` in
/// `src/lib/downloadHosts.ts`.
pub(crate) const VERIFY_WINDOW_HOSTS: &[&str] = &["mixdrop", "vikingfile", "akirabox"];

pub(crate) fn needs_verify_window(label: &str) -> bool {
    let label = label.trim().to_ascii_lowercase();
    VERIFY_WINDOW_HOSTS.contains(&label.as_str())
}

/// Same ids as `PATTERNS` in the sidecar's `domain/game/hosts.ts`, so a row
/// keeps one host id from the thread page to the end of the download.
pub(crate) fn host_label(host: &str) -> String {
    if host.contains("pixeldrain") {
        return "pixeldrain".into();
    }
    if host.contains("mediafire") {
        return "mediafire".into();
    }
    if host.contains("gofile") {
        return "gofile".into();
    }
    if host.contains("uploadhaven") {
        return "uploadhaven".into();
    }
    if host.contains("mega.") || host == "mega.nz" {
        return "mega".into();
    }
    if host.contains("mixdrop")
        || host.contains("mixdrp")
        || host.contains("mxdrop")
        || host.contains("m1xdrop")
    {
        return "mixdrop".into();
    }
    if host.contains("vikingfile") || host.contains("vik1ngfile") || host.contains("vikingf1le") {
        return "vikingfile".into();
    }
    if is_domain(host, "terminal.lc") {
        return "terminal".into();
    }
    if host.contains("akirabox") {
        return "akirabox".into();
    }
    if host.contains("bowfile") {
        return "bowfile".into();
    }
    if host.contains("uploadnow") {
        return "uploadnow".into();
    }
    if host.contains("krakenfiles") {
        return "krakenfiles".into();
    }
    if is_domain(host, "wdho.ru") {
        return "wdho".into();
    }
    if is_domain(host, "qu.ax") {
        return "qu.ax".into();
    }
    if is_domain(host, "files.dp.ua") {
        return "files.dp.ua".into();
    }
    if host.contains("workupload") {
        return "workupload".into();
    }
    if host.contains("datanodes") {
        return "datanodes".into();
    }
    if host.contains("buzzheavier") || host.contains("bzzhr") || host.contains("fuckingfast") {
        return "buzzheavier".into();
    }
    if host.contains("drive.google.com") || host.contains("docs.google.com") {
        return "gdrive".into();
    }
    if host.contains("rapidgator") {
        return "rapidgator".into();
    }
    host.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_download_filename_strips_trailing_size() {
        assert_eq!(
            clean_download_filename("SkarpWorld_Collection.7z (520.47 MB)"),
            "SkarpWorld_Collection.7z"
        );
        assert_eq!(clean_download_filename("game.zip (1.2 GB)"), "game.zip");
        assert_eq!(clean_download_filename("plain.7z"), "plain.7z");
    }

    #[test]
    fn host_label_matches_sidecar_ids() {
        let cases = [
            ("pixeldrain.com", "pixeldrain"),
            ("mega.nz", "mega"),
            ("mixdrop.ag", "mixdrop"),
            ("mixdrop.is", "mixdrop"),
            ("mxdrop.top", "mixdrop"),
            ("m1xdrop.net", "mixdrop"),
            ("mixdrp.co", "mixdrop"),
            ("buzzheavier.com", "buzzheavier"),
            ("bzzhr.to", "buzzheavier"),
            ("bzzhr.co", "buzzheavier"),
            ("vikingfile.com", "vikingfile"),
            ("vik1ngfile.site", "vikingfile"),
            ("vikingf1le.us.to", "vikingfile"),
            ("terminal.lc", "terminal"),
            ("www.terminal.lc", "terminal"),
            ("akirabox.com", "akirabox"),
            ("akirabox.to", "akirabox"),
            ("bowfile.com", "bowfile"),
            ("www.bowfile.com", "bowfile"),
            ("uploadnow.io", "uploadnow"),
            ("uploadnow.co", "uploadnow"),
            ("krakenfiles.com", "krakenfiles"),
            ("wdho.ru", "wdho"),
            ("qu.ax", "qu.ax"),
            ("files.dp.ua", "files.dp.ua"),
            ("drive.google.com", "gdrive"),
        ];
        for (domain, label) in cases {
            assert_eq!(host_label(domain), label, "{domain}");
        }
        // Not a lookalike of a known host.
        assert_eq!(host_label("notterminal.lc"), "notterminal.lc");
        assert_eq!(host_label("miixdrop.net"), "miixdrop.net");
    }

    #[test]
    fn masked_host_goes_through_the_same_labels() {
        let url = "https://f95zone.to/masked/vikingfile.com/161330/5617588/aB1/cD2/eF3";
        assert!(is_f95_masked(url));
        assert_eq!(
            masked_host(url).map(|h| host_label(&h)).as_deref(),
            Some("vikingfile")
        );
    }

    #[test]
    fn verify_window_hosts() {
        assert!(needs_verify_window("mixdrop"));
        assert!(needs_verify_window("vikingfile"));
        assert!(needs_verify_window("AkiraBox"));
        assert!(!needs_verify_window("bowfile"));
        assert!(!needs_verify_window("gdrive"));
    }
}
