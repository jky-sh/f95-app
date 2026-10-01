# App updates (GitHub Releases)

The desktop client uses [Tauri's updater plugin](https://v2.tauri.app/plugin/updater/) with a static `latest.json` hosted on GitHub Releases:

```
https://github.com/jky-sh/f95-app/releases/latest/download/latest.json
```

## Signing keys

Updates are signed. The **public** key is embedded in `src-tauri/tauri.conf.json`. The **private** key must never be committed.

Generate (once):

```bash
npm run tauri signer generate -- -w ~/.tauri/f95-app.key
```

Store these GitHub Actions secrets before cutting a release:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password (empty string if none) |

If you rotate keys, ship a transitional release that embeds both verification strategies, or ask users to reinstall once.

## Cutting a release

1. Bump versions together (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, sidecar package files) and update `CHANGELOG.md`.
2. Merge to the release branch / tag `vX.Y.Z`.
3. The [Release workflow](../.github/workflows/release.yml) builds Windows artifacts, uploads them, and publishes `latest.json` for the updater (`includeUpdaterJson`).
4. Publish the draft GitHub release when ready. Its notes become the app's changelog (see below), so write them for users.

## The changelog in the app

- Settings → About and the version modal list the notes of every published release (drafts are skipped), newest first, as GitHub renders them (`body_html`), with the running version marked.
- `src/lib/appReleases.ts` asks the GitHub API (`/repos/jky-sh/f95-app/releases`) when one of them opens and the saved copy is more than 30 minutes old, or more than 2 minutes old and missing the running version. That stays well below GitHub's 60 requests an hour without a token. The last answer is kept in `localStorage`, so the list shows at once and offline.
- With no saved copy and GitHub out of reach, the `CHANGELOG.md` bundled with the build stands in.

## How the app finds and installs its own updates

- **Checks.** About 5 seconds after the main window opens, then every 6 hours while the app runs (in the tray too). The background scheduler (`src/lib/backgroundScheduler.ts`) keeps the time of the last check in `app_settings` (`app_update_checked_at`), so a check missed during sleep or while the app was closed runs at the next opportunity.
- **Background checks never open a dialog.** A new version shows up as:
  - an accent pill on the status bar version (`v1.0.1 → v1.1.0`) and an app update pill in Big Picture's top bar;
  - one bell entry per version (id `app:<version>`);
  - one toast per version: in the app while its window is in front, a system notification otherwise (`tauri-plugin-notification`);
  - the tray tooltip and an "Update to vX" item in the tray menu.
- **Installing** always starts from the user: the version modal, Settings → About, the tray menu, or Big Picture. The app first says it will close and reopen. While downloads or extractions are running, or a game is open, it asks again. Then it downloads the update, stops the sidecar (`prepare_app_update`, so the installer can replace `node.exe` and the bundled browser), and runs the installer. From that point no new sidecar can start and the background checks pause; if the install fails, `abort_app_update` lifts both. On Windows the installer closes the app and starts the new version. A background check that ends during an install never closes the update the install is using.
- **Skip this version** (Settings → About) silences the toast, the bell, the tray and the pills for that version. A newer version is offered again.
- Only one instance runs at a time (`tauri-plugin-single-instance`): a second launch, for example from clicking a notification, brings the open window forward.

## Game updates

The app also checks the games in the library while it is open:

- **RSS feed**, every 15 minutes: F95's latest updates (about a day of entries). An entry counts as new per thread and version. The guid is the thread URL, the same for every version.
- **SAM's "latest updates" list**, every 3 hours by default: everything updated since the last check, a few requests for the whole library. On a first run, or after more than 30 days, it reads the last 30 days. An update older than that is not in the list, so the next manual **Check for updates** reads every game's thread (`library_updates_full_pending`).
- An update that no earlier check had flagged, for an installed game, gets a bell entry (id `upd:<threadId>:<version>`) and a toast. Several games found at once share one toast. Installing the update marks its bell entry read.

## User settings

- **Settings → About → App updates**
  - **Check for app updates automatically (at startup and every 6 hours)**: on by default.
  - **Check for updates**: always available manually, even when the automatic check is off.
  - The time of the last check, the version on offer, **Install** and **Skip this version**.
- **Settings → System → Game updates**
  - Background checks on or off, and how often (1, 3, 6, 12 or 24 hours).
  - Notifications for new game updates in the bell, and system notifications while the app is in the background.
  - Background checks only run while the app is open. With the tray icon off, closing the window quits the app.
- **Big Picture → Settings → Updates**: update notifications, the automatic app check, and Check / Install.
