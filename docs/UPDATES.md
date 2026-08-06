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
4. Publish the draft GitHub release when ready.

## User settings

- **Check for updates automatically on startup** — default on; can be disabled in Settings → System.
- **Check for updates** — always available manually, even when auto-check is off.
