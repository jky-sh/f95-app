pub(crate) fn find_mediafire_button_href(html: &str) -> Option<String> {
    let needle = "id=\"downloadButton\"";
    let idx = html.find(needle)?;
    let window_start = idx.saturating_sub(800);
    let window_end = (idx + needle.len() + 800).min(html.len());
    let window = &html[window_start..window_end];
    let href_idx = window.find("href=\"")?;
    let after = &window[href_idx + 6..];
    let end = after.find('"')?;
    let val = &after[..end];
    if val.starts_with("http") {
        Some(val.to_string())
    } else {
        None
    }
}

pub(crate) fn base64_decode(s: &str) -> Result<Vec<u8>, &'static str> {
    const TABLE: [i8; 256] = build_b64_table();
    let cleaned: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0;
    for &b in &cleaned {
        if b == b'=' {
            break;
        }
        let v = TABLE[b as usize];
        if v < 0 {
            return Err("invalid base64");
        }
        buf = (buf << 6) | (v as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

const fn build_b64_table() -> [i8; 256] {
    let mut t = [-1i8; 256];
    let alpha = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut i = 0;
    while i < alpha.len() {
        t[alpha[i] as usize] = i as i8;
        i += 1;
    }
    t
}

pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub(crate) use crate::uploadhaven::html::{
    find_attr_value, find_text_in_class, percent_decode_lossy,
};

/// Decode `%XX` in one URL path segment (`+` stays a plus, unlike a query).
pub(crate) fn decode_path_segment(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// File name from the last path segment of a link, if it looks like one.
pub(crate) fn file_name_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let last = path.rsplit('/').next()?;
    let name = decode_path_segment(last);
    let name = name.trim();
    (!name.is_empty() && name.contains('.')).then(|| name.to_string())
}

/// Human size like "1.22 GB" or "339.17 MB" → bytes (1024-based, approximate).
pub(crate) fn parse_human_size(text: &str) -> Option<u64> {
    let t = text.trim().replace(',', ".");
    let split = t.find(|c: char| !(c.is_ascii_digit() || c == '.'))?;
    let (num, unit) = t.split_at(split);
    let n: f64 = num.trim().parse().ok()?;
    let mult = match unit.trim().to_ascii_uppercase().as_str() {
        "B" | "BYTES" => 1f64,
        "KB" | "KIB" => 1024f64,
        "MB" | "MIB" => 1024f64 * 1024.0,
        "GB" | "GIB" => 1024f64 * 1024.0 * 1024.0,
        "TB" | "TIB" => 1024f64 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mult) as u64)
}

/// Minimal HTML entity decoding for names scraped from `<title>`.
pub(crate) fn html_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// A Cloudflare challenge or block page instead of the host's own answer.
/// Only a real browser gets past those, so callers hand the link to one.
pub(crate) fn is_cloudflare_block(status: u16, cf_mitigated: bool, body: &str) -> bool {
    if cf_mitigated {
        return true;
    }
    if !matches!(status, 403 | 429 | 503) {
        return false;
    }
    let head = str_head(body, 8000);
    head.contains("<title>Just a moment")
        || head.contains("Attention Required! | Cloudflare")
        || head.contains("/cdn-cgi/challenge-platform/h/")
        || head.contains("cf-chl-")
}

/// At most `max` bytes of `s`, cut on a character boundary.
pub(crate) fn str_head(s: &str, max: usize) -> &str {
    let mut n = max.min(s.len());
    while !s.is_char_boundary(n) {
        n -= 1;
    }
    &s[..n]
}

/// Text between `start` and the next `end` after it.
pub(crate) fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = s.find(start)? + start.len();
    let j = s[i..].find(end)?;
    Some(&s[i..i + j])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_path_segments() {
        assert_eq!(decode_path_segment("a%20b+c.zip"), "a b+c.zip");
        assert_eq!(decode_path_segment("end%41"), "endA");
        assert_eq!(decode_path_segment("bad%zz"), "bad%zz");
        assert_eq!(
            file_name_from_url("https://x.com/d/abc/My%20Game.7z?x=1").as_deref(),
            Some("My Game.7z")
        );
        assert_eq!(file_name_from_url("https://x.com/d/abc"), None);
    }

    #[test]
    fn parses_human_sizes() {
        assert_eq!(parse_human_size("1 KB"), Some(1024));
        assert_eq!(parse_human_size("1.5 MB"), Some(1572864));
        assert_eq!(parse_human_size("2,0 GB"), Some(2147483648));
        assert_eq!(parse_human_size("12 parsecs"), None);
    }
}
