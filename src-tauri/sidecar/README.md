# Sidecar build (dev vs prod)

## Dev (`tauri dev`)

1. `npm --prefix src-tauri/sidecar run build` — compila TypeScript → `dist/index.js`
2. Tauri spawns `node dist/index.js` (ver `sidecar/path.rs`)

Após alterar código do sidecar, rode `npm run build` no diretório `sidecar/` antes de testar no app.

Em `tauri dev`, o Playwright escreve logs em `ms-playwright/` — isso está listado em `src-tauri/.taurignore` para não reiniciar o app a cada download.

## Prod (release bundle)

O `beforeBuildCommand` em `tauri.conf.json` encadeia:

1. `npm run build` (frontend)
2. `npm --prefix src-tauri/sidecar run build` (tsc)
3. `build:bundle` (esbuild → `dist/bundle.cjs`)
4. `build:sea` (copia `node.exe`, Playwright, Chromium)

Tauri empacota `bundle.cjs` + `node.exe` + browsers.

## Chromium do Playwright

Ninguém precisa rodar `playwright install`: `src/infra/playwright/runtime.ts` cuida disso.

- O Rust passa `PLAYWRIGHT_BROWSERS_PATH` = `%LOCALAPPDATA%\com.f95.app\ms-playwright` (cache por usuário, sempre gravável) e, só no release, `F95_BUNDLED_BROWSERS` = `sidecar/ms-playwright` da instalação (pode estar em Program Files, só leitura).
- Todo `chromium.launch` passa por um guard: usa o Chromium completo (o instalado se tiver a revisão que este Playwright espera, senão o do cache), inclusive no `browser-rest-api`, que lança só com `{ headless: true }` e pediria o headless shell que não é empacotado.
- Se nenhum dos dois tiver a revisão (Playwright atualizado, antivírus apagou o `chrome.exe`, instalação interrompida), o sidecar baixa com o instalador do próprio Playwright para o cache. Na inicialização isso já começa em segundo plano.

Em dev o cache é o mesmo do app instalado; `dist/ms-playwright` não é usado.

Atualizar o Playwright é um PR de rotina: o Dependabot (`.github/dependabot.yml`) abre um PR em `develop` quando sai versão nova. Dar merge e fazer um release entrega o Playwright novo junto com o Chromium que ele espera (o `build:sea` baixa esse Chromium). Em dev, e para usuários em que ele faltar, o reparo automático acima baixa a revisão nova.

## Cloudflare

O F95 pode responder às requisições do app com o desafio "Just a moment…" (403, `cf-mitigated: challenge`). O cookie `cf_clearance` que libera só vale para o User-Agent do navegador que passou na verificação, por isso `USER_AGENT` acompanha a versão do Chromium empacotado.

- `src/infra/playwright/cloudflareSolver.ts` substitui o resolvedor do `browser-rest-api` (campo privado `orchestrator.browserEngine`, que a biblioteca não expõe): abre o Chromium completo headless, sem `--enable-automation` e sem `locale` (um idioma diferente do sistema faz o Cloudflare manter o desafio), espera a página real carregar e copia os cookies para o jar.
- Se não passar em 15 s, o erro `-32010` sai com `data.variant = 'interactive'`. O Rust (`src-tauri/src/cloudflare.rs`) mostra a verificação num WebView2 dentro da janela de login (ou numa janela própria, com a principal aberta), manda os cookies `cf_*`/`__cf*` e o User-Agent do WebView2 para o RPC `importClearance` e repete a chamada.
- `F95_CLOUDFLARE_SKIP_HEADLESS=1` pula a tentativa headless, para testar a verificação no app.

## Testes

```bash
npm --prefix src-tauri/sidecar test
```

## Entry point

- **Runtime:** `src/main/index.ts` (via `src/index.ts`)
- **Handlers:** `src/rpc/handlers/*` registrados em `src/rpc/registry.ts`
