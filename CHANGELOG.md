# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From **v1.0.1** onward, each release ships as a new version. Bump these files
together when cutting a release:

- `package.json` / `package-lock.json`
- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json` (version shown in the app UI)
- `src-tauri/sidecar/package.json` / `src-tauri/sidecar/package-lock.json`

## [Unreleased]

### Added
- Auto-update from GitHub Releases, with a Settings toggle to disable automatic checks.
- In-app changelog for app versions under Settings → System.
- System tray icon with show/quit actions and a Settings toggle (close hides to tray when enabled).

## [1.0.1] - 2026-08-05

### Improved
- Store search is more Google-like: query normalization, progressive token
  fallbacks when the exact phrase returns nothing, and relevance ranking.
- Library search matches all query tokens and also searches custom tags.

### Fixed
- Tag autocomplete now handles SAM responses that return bare tag IDs.
- Tag suggestions fall back to the local catalog when the remote search fails.
- Tag catalog is persisted locally and refreshed more aggressively so pills
  stop showing raw `#id` placeholders.
- Default tag filter mode is OR (less restrictive when combining tags).

## [1.0.0] - 2026-08-05

### Added
- Initial public release of the F95 App desktop client.
