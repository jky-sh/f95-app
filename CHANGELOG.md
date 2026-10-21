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

The app's changelog (Settings → About and the version modal) shows the
release notes published on GitHub Releases. This file ships with the build
and stands in when GitHub can't be reached, so keep it in step with them.

## [Unreleased]

### Fixed
- Installing a game said "No direct download links found in this thread".
  F95Zone now sends every download link through its own download page,
  which no longer names the host. The app tells the host from the thread,
  goes through that page by itself and downloads from the host as before.
  F95 lets those links expire after a few hours, so a download started
  from a game page opened long ago gets its link again from the post.
- The host icons in a game's download section were tiled over the link
  names.
- Profile pictures and profile covers didn't load (a broken image in the
  top bar and on profiles). F95Zone serves them from behind its Cloudflare
  check now, so the app loads them through its own connection to F95,
  which has passed the check.
- Steam achievements of games linked since October 19 showed no icons and
  their internal names: Steam moved its public achievements page. The app
  reads the new one, and fixes those games the next time it starts.
- The Cloudflare check sometimes showed up in the app although it would
  have cleared on its own: the app gave up after 15 s, and Cloudflare can
  take a little longer. It now waits up to 30 s.

### Changed
- Playwright 1.64.1 with Chromium 156 (was 1.60.0 with Chromium 148).

## [1.0.3] - 2026-10-19

### Fixed
- Signing in hung on "Signing you in…" and failed after a minute
  ("page.goto: Timeout 60000ms exceeded") while F95Zone shows
  Cloudflare's "Just a moment…" check. The app now passes the check on
  its own in a few seconds and keeps the clearance for the next starts.

### Added
- When Cloudflare wants a person to confirm, the check shows inside the
  sign-in window (or in a small window of the app once it's open)
  instead of a separate browser.

## [1.0.2] - 2026-10-19

### Fixed
- Installing or updating could stop with "Error opening file for writing
  … sidecar\node.exe": the app's background helper and its browser kept
  running after the app closed. They now close with the app, and the
  installer stops any left running by older versions.
- Cloudflare checks failed with "Executable doesn't exist …
  chromium_headless_shell" ("Looks like Playwright was just installed or
  updated"). Every browser the app opens now uses the Chromium it ships.
- Updates no longer leave old browser files behind in the install folder.

### Improved
- The built-in browser repairs itself: when it's missing or damaged (an
  antivirus removed it, an install was cut short), the app downloads it
  again in the background, with no `playwright install` needed.

## [1.0.1] - 2026-10-01

### Added
- Big Picture: a full-screen, controller-first mode with Home, Library,
  Store, Downloads, News and Friends, an on-screen keyboard and interface
  sounds. It opens from the title bar, the tray, Ctrl+K or Settings, and
  from a controller with the Xbox button or View + Menu.
- App updates from GitHub Releases: checked at startup and every 6 hours,
  installed only when you choose, with Skip this version.
- Background checks for game updates (F95's latest updates and SAM),
  announced in the bell, as toasts and as system notifications.
- Tray icon with a Steam-like menu: recent games, game updates and the
  app update. Closing the window keeps the app in the tray.
- Steam skin and color theme.
- Library collections, with a page per collection and the Steam sidebar
  grouped by collection.
- Steam achievements for games that ship with a Steam emulator (or,
  experimentally, read from their saves), with in-game unlock toasts, a
  profile section and an Achievements page.
- Installed versions side by side: keep the previous install when
  updating, play any version, roll back to it or delete it.
- Download hosts VikingFile, AkiraBox, BowFile, UploadNow and Terminal,
  and a small in-app window for hosts that ask for a human check
  (MixDrop, VikingFile, AkiraBox).
- The thread's Discussion and Reviews on store game pages.
- Member profiles inside the app (cover, follow, Activity, Postings and
  About), and a Friends page that shows who is online.
- Quick search on Ctrl+K for library games, the store, pages and settings.
- Overlay: a Game panel (session time, playtime, achievements, quit) and
  Guides & thread with the first post's walkthrough, mod and patch links.
- Settings → About lists the release notes published on GitHub.

### Improved
- Library redesign: covers, cards and list views, a game page with tabs
  and one main action, live download progress and play time, and sorting
  by disk size and F95 rating.
- Store: covers and list views, filters by developer, update date and
  excluded tags, screenshots while a card is hovered, and badges for games
  already in the library.
- Store search ranks results better and falls back to fewer words when
  the exact phrase finds nothing; library search matches every word and
  custom tags. Combined tags match any of them by default.
- Going back to the store or the library keeps the filters, the results
  and the scroll position.
- Settings show one section at a time; the version, app updates and the
  changelog moved to a new About section.
- Extraction shows its progress, uses the installed 7-Zip when there is
  one and checks the free disk space first.
- Sharper covers and screenshots, and game details are cached, so pages
  open at once and work offline.
- The download history lists the newest first and can show only the
  completed or only the unfinished downloads.
- Only one copy of the app runs: opening it again brings its window
  forward.

### Fixed
- The sign-in check at startup failed on F95 pages that carry
  Cloudflare's passive detection script.
- Times saved by the app (last played, sessions, notifications) showed in
  UTC instead of the local time zone.
- A store page that failed to load retried forever; it now offers Retry.
- The built-in prefix filters sent the wrong ids (Completed filtered by
  Abandoned, among others).
- F95 thread links with a title opened in the browser instead of the app.
- A download interrupted by closing the app left its game stuck as
  downloading.
- Settings changed while the overlay was open could be undone by it.
- Removing a game left its versions and collection entries behind.
- Tags showed as raw #id placeholders when SAM sent bare tag ids, and the
  tag list flickered while loading.

## [1.0.0] - 2026-06-05

### Added
- Initial public release of the F95 App desktop client.
