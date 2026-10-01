//! Per-host rules for the in-app verification window (`commands::captcha`).
//!
//! MixDrop: the user passes reCAPTCHA, presses "Continue download", and the
//! window's cookies go to the sidecar. VikingFile and AkiraBox: the user (or
//! Turnstile by itself) passes the check, the page produces its download
//! link, and the window hands that link straight to the downloader. The
//! window never touches the check itself.

use super::resolvers::{akirabox, vikingfile};
use reqwest::Url;

/// Navigations to this host carry a link the init script found (`?u=`).
const MARKER_HOST: &str = "f95app-verify.invalid";

/// Hosts whose window captures the download link by itself.
pub(crate) fn captures_link(host: &str) -> bool {
    matches!(host, "vikingfile" | "akirabox")
}

/// The page to open for `raw` (a thread link or a stored page URL).
pub(crate) fn page_url(host: &str, raw: &str) -> Option<String> {
    match host {
        "vikingfile" => vikingfile::verify_page_url(raw),
        "akirabox" => akirabox::verify_page_url(raw),
        _ => None,
    }
}

pub(crate) fn is_download_link(host: &str, url: &Url) -> bool {
    match host {
        "vikingfile" => vikingfile::is_download_link(url),
        "akirabox" => akirabox::is_download_link(url),
        _ => false,
    }
}

/// The download link a navigation carries, either directly or through the
/// marker URL the init script uses.
pub(crate) fn captured_link(host: &str, url: &Url) -> Option<String> {
    if url.host_str() == Some(MARKER_HOST) {
        let link = url
            .query_pairs()
            .find(|(k, _)| k == "u")
            .map(|(_, v)| v.into_owned())?;
        let parsed = Url::parse(&link).ok()?;
        return is_download_link(host, &parsed).then_some(link);
    }
    is_download_link(host, url).then(|| url.to_string())
}

/// Top-level pages the window may show. Anything else (ad redirects,
/// pop-under landings) is blocked.
pub(crate) fn allowed_page(host: &str, url: &Url) -> bool {
    match host {
        "vikingfile" => vikingfile::is_allowed_page(url),
        "akirabox" => akirabox::is_allowed_page(url),
        _ => true,
    }
}

/// Injected into capture-host pages. It disarms the ad library and pop-ups
/// and reports the download link once the page has it: from the JSON the
/// page receives (AkiraBox fetch, VikingFile XHR) or from the filled-in
/// anchor. It does not touch the Turnstile widget.
pub(crate) const CAPTURE_INIT_SCRIPT: &str = r#"
(() => {
  const MARK = 'https://f95app-verify.invalid/capture?u=';
  const LINK = /^https:\/\/([^\/]*\.)?(vikingfile\.com|vik1ngfile\.site|vikingf1le\.us\.to)\/d\/|^https:\/\/(www\.)?akirabox\.(to|com)\/download\//i;
  let sent = false;
  function send(u) {
    if (sent || typeof u !== 'string') return;
    try { u = new URL(u, location.href).href; } catch (e) { return; }
    if (!LINK.test(u)) return;
    sent = true;
    location.href = MARK + encodeURIComponent(u);
  }
  // Adcash (VikingFile) pop-unders and any other new window.
  try {
    const stub = { runPop() {}, runAutoTag() {}, runBanner() {}, runInPagePush() {} };
    Object.defineProperty(window, 'aclib', { configurable: false, get: () => stub, set: () => {} });
  } catch (e) {}
  window.open = () => null;
  function pick(text) {
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') send(j.link || j.url);
    } catch (e) {}
  }
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const type = res.headers.get('content-type') || '';
          if (type.includes('json')) res.clone().text().then(pick, () => {});
        } catch (e) {}
        return res;
      });
    };
  }
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try { pick(this.responseText); } catch (e) {}
    });
    return origSend.apply(this, args);
  };
  function scan() {
    const main = document.querySelector('#download-link[href]');
    if (main) send(main.href);
    for (const a of document.querySelectorAll('a[href]')) {
      if (LINK.test(a.href)) { send(a.href); return; }
    }
  }
  setInterval(scan, 500);
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn captures_marker_and_direct_links() {
        let link = "https://vikingfile.com/d/30zNxeO6vB/Game%20v1.zip";
        let marker = format!(
            "https://f95app-verify.invalid/capture?u={}",
            super::super::util::urlencode(link)
        );
        assert_eq!(
            captured_link("vikingfile", &url(&marker)).as_deref(),
            Some(link)
        );
        assert_eq!(
            captured_link("vikingfile", &url(link)).as_deref(),
            Some(link)
        );
        // A marker can't smuggle in an unrelated URL.
        let evil = "https://f95app-verify.invalid/capture?u=https%3A%2F%2Fevil.example%2Fx";
        assert_eq!(captured_link("vikingfile", &url(evil)), None);
        assert_eq!(captured_link("akirabox", &url(link)), None);
        assert_eq!(
            captured_link("vikingfile", &url("https://vik1ngfile.site/f/TPRSfLvcIu")),
            None
        );
    }

    #[test]
    fn page_rules() {
        assert!(captures_link("akirabox") && captures_link("vikingfile"));
        assert!(!captures_link("mixdrop"));
        assert_eq!(
            page_url("akirabox", "https://akirabox.com/LJlGnVb8AG15/file").as_deref(),
            Some("https://akirabox.to/LJlGnVb8AG15/file")
        );
        assert_eq!(page_url("mixdrop", "https://mixdrop.ag/f/abc"), None);
        assert!(allowed_page("akirabox", &url("https://akirabox.to/LJlGnVb8AG15/file")));
        assert!(!allowed_page("akirabox", &url("https://ads.example/landing")));
        assert!(allowed_page("mixdrop", &url("https://anything.example/")));
    }
}
