# Contributing to F95 App

**Languages:** English · [Português (BR)](CONTRIBUTING.pt-BR.md) · [Deutsch](CONTRIBUTING.de.md) · [Русский](CONTRIBUTING.ru.md)

Thanks for looking at the codebase. This document covers how to set up a dev environment, name branches, write commits, and open pull requests.

Repository: [github.com/jky-sh/f95-app](https://github.com/jky-sh/f95-app)

---

## Before you start

### Prerequisites

- Node.js 20+
- Rust stable ([rustup](https://rustup.rs/))
- Tauri v2 CLI (included via `npm install`)
- Windows: WebView2, MSVC build tools (required for native crates and overlay)

### Clone and run

```bash
git clone https://github.com/jky-sh/f95-app.git
cd f95-app
npm install
npm --prefix src-tauri/sidecar install
npm run tauri dev
```

### `browser-rest-api`

The sidecar depends on an HTTP client package. Pick the setup that matches your goal:

**Local development** — clone the `browser-api` repo as a sibling of `f95-app`:

```
Projetos/
├── browser-api/
└── f95-app/
```

The sidecar resolves it via `file:../../../browser-api` in `src-tauri/sidecar/package.json`.

**Release / npm** — the root `package.json` uses `browser-rest-api@^1.0.0` from the registry. For release builds, point the sidecar to the same published version.

### After editing sidecar code

```bash
npm --prefix src-tauri/sidecar run build
```

Then restart or let `tauri dev` pick up changes.

### Sidecar tests

```bash
npm --prefix src-tauri/sidecar test
```

---

## Where to edit

| Layer | Path | Language |
|-------|------|----------|
| UI | `src/pages/`, `src/components/` | TypeScript/React |
| Frontend logic | `src/lib/`, `src/contexts/` | TypeScript |
| Tauri commands | `src-tauri/src/commands/` | Rust |
| Downloads | `src-tauri/src/download/` | Rust |
| Overlay | `src-tauri/src/overlay*.rs` | Rust |
| F95/SAM parsing | `src-tauri/sidecar/src/domain/` | TypeScript |
| Host resolvers | `src-tauri/sidecar/src/domain/resolvers/` | TypeScript |
| Translations | `src/locales/*.ts` | TypeScript |
| Database schema | `src-tauri/src/migrations.rs` | SQL + Rust |

Architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

App auto-update / GitHub Releases signing: [docs/UPDATES.md](docs/UPDATES.md)

---

## Branches

Base branch: `main`.

One topic per branch. Sync with `main` before opening a PR (merge or rebase — your choice, but keep history readable).

| Prefix | Use | Example |
|--------|-----|---------|
| `feature/` | New functionality | `feature/library-sort` |
| `fix/` | Bug fix | `fix/mega-download-resume` |
| `docs/` | Documentation only | `docs/readme-de` |
| `refactor/` | Code change, same behavior | `refactor/ipc-types` |
| `chore/` | Build, deps, tooling | `chore/update-playwright` |

```bash
git checkout main
git pull origin main
git checkout -b feature/my-change
```

---

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — explain why, not just what]
```

### Types

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Refactor without behavior change |
| `test` | Tests |
| `chore` | Maintenance, deps, CI |
| `perf` | Performance improvement |

### Scopes

Use a scope when the change is clearly bounded:

`frontend`, `tauri`, `sidecar`, `download`, `overlay`, `i18n`, `db`

Omit the scope for repo-wide or trivial changes.

### Examples

```
feat(download): add pixeldrain resolver
fix(overlay): anchor window on DPI change
docs: add German README
refactor(sidecar): split auth handler from registry
chore: bump playwright to 1.61
```

Rules:

- Imperative mood in the subject line (`add`, not `added`)
- Subject line ≤ 72 characters
- One logical change per commit when possible
- Do not commit credentials, session files, or personal data

---

## Pull requests

### Title

Match the main commit: `feat(download): add pixeldrain resolver`

### Description

Include:

1. **What** changed
2. **Why** it was needed
3. **How to test** — commands run, manual steps

Link related issues with `Fixes #123` or `Refs #123`.

### Size

Keep PRs focused. Split large changes into reviewable chunks (e.g. Rust resolver separate from UI wiring).

### Checklist

The PR template (`.github/pull_request_template.md`) covers:

- [ ] `npm run build` passes
- [ ] `npm --prefix src-tauri/sidecar test` (if sidecar changed)
- [ ] Tested with `npm run tauri dev` (if Rust/IPC/UI integration changed)
- [ ] No secrets or session data committed

### Review process

1. Open PR against `main`
2. Wait for review (this is a small project — be patient)
3. Address feedback with additional commits or amend locally before push
4. Squash-merge or merge commit — maintainer decides

---

## Code style

No strict linter enforced yet. Match the surrounding file:

- **TypeScript/React** — functional components, hooks, existing naming (`camelCase` functions, `PascalCase` components)
- **Rust** — follow `rustfmt` defaults, `thiserror` for error types in new code
- **Sidecar** — handlers in `src/rpc/handlers/`, domain logic in `src/domain/`

Run `npm run build` before pushing frontend changes. `cargo check` in `src-tauri/` for Rust changes.

---

## Reporting bugs

Open a GitHub issue with:

- OS and app version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (strip credentials and session tokens)

---

## License

By contributing, you agree that your contributions will be licensed under the [GNU GPL v3.0 or later](LICENSE), the same license as the project.
