import { execute, query } from './db';
import * as ipc from './ipc';
import * as libraries from './libraries';
import * as library from './library';
import { isPathInside, pathsOverlap, samePath } from './paths';
import type { LibraryGame } from '../types/library';

/**
 * Versões instaladas lado a lado de um jogo (estilo GOG Galaxy).
 *
 * Cada extração bem-sucedida registra uma linha em `install_versions`; a
 * versão ATIVA é a que `library_games.install_path` aponta — uma fonte de
 * verdade só. Trocar de versão (rollback de um update quebrado, por exemplo)
 * é repontar a linha do jogo para o install_path/exe_path da versão desejada.
 */
export interface InstallVersion {
  id: number;
  threadId: string;
  /** Rótulo F95 quando conhecido (ex.: "v0.3.2"); null em seeds retroativos. */
  version: string | null;
  installPath: string;
  exePath: string | null;
  /** Slug da engine detectada (renpy, rpgm_mv, unity…); null = desconhecida. */
  engine: string | null;
  sizeBytes: number | null;
  installedAt: string;
  /** True quando esta é a versão que o botão Jogar usa. */
  active: boolean;
}

/** Nome de exibição das engines (slugs de `engine_detect.rs`). */
const ENGINE_LABELS: Record<string, string> = {
  renpy: "Ren'Py",
  rpgm_mv: 'RPG Maker MV',
  rpgm_mz: 'RPG Maker MZ',
  rpgm_vx: 'RPG Maker VX/Ace',
  rpgm_2k: 'RPG Maker 2000/2003',
  unity: 'Unity',
  unreal: 'Unreal',
  godot: 'Godot',
  wolf: 'Wolf RPG',
  kirikiri: 'KiriKiri',
  html: 'HTML',
  flash: 'Flash',
};

/** Rótulo amigável da engine; slug desconhecido/null vira '?' ou o próprio slug. */
export function engineLabel(slug: string | null | undefined): string {
  if (!slug) return '?';
  return ENGINE_LABELS[slug] ?? slug;
}

interface DbRow {
  id: number;
  thread_id: string;
  version: string | null;
  install_path: string;
  exe_path: string | null;
  engine: string | null;
  size_bytes: number | null;
  installed_at: string;
}

/** Thrown instead of deleting a folder that holds the install in use. */
export class ActiveInstallError extends Error {
  constructor(path: string) {
    super(`refusing to delete ${path}: it contains the active install`);
    this.name = 'ActiveInstallError';
  }
}

function rowToVersion(r: DbRow, activePath: string | null): InstallVersion {
  return {
    id: r.id,
    threadId: r.thread_id,
    version: r.version,
    installPath: r.install_path,
    exePath: r.exe_path,
    engine: r.engine,
    sizeBytes: r.size_bytes,
    installedAt: r.installed_at,
    // The game row may point at the exe's subfolder of this install root.
    active: isPathInside(activePath, r.install_path),
  };
}

async function versionRows(threadId: string): Promise<DbRow[]> {
  return query<DbRow>(
    `SELECT * FROM install_versions WHERE thread_id = ? ORDER BY installed_at DESC, id DESC`,
    [threadId],
  );
}

/**
 * Registered install root that holds `path` (the path itself when it is a
 * root, or the root of the extraction it sits in), or `path` when none does.
 */
export async function installRootFor(threadId: string, path: string): Promise<string> {
  const rows = await versionRows(threadId);
  const root = rows.find((r) => isPathInside(path, r.install_path));
  return root?.install_path ?? path;
}

export interface RegisterInput {
  threadId: string;
  version: string | null;
  installPath: string;
  exePath: string | null;
  engine: string | null;
  sizeBytes: number | null;
}

/**
 * Registra (ou atualiza, se o mesmo caminho for re-extraído) uma versão
 * instalada. Upsert por install_path: re-baixar a mesma versão sobrescreve a
 * linha em vez de duplicar.
 */
export async function register(input: RegisterInput): Promise<void> {
  // A registered extraction root already covers this path (older installs
  // pointed the game at the exe's subfolder): don't list it twice.
  const rows = await versionRows(input.threadId);
  if (rows.some((r) => !samePath(r.install_path, input.installPath) && isPathInside(input.installPath, r.install_path))) {
    return;
  }
  await execute(
    `INSERT INTO install_versions (
       thread_id, version, install_path, exe_path, engine, size_bytes, installed_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(install_path) DO UPDATE SET
       thread_id = excluded.thread_id,
       version = COALESCE(excluded.version, install_versions.version),
       exe_path = COALESCE(excluded.exe_path, install_versions.exe_path),
       engine = COALESCE(excluded.engine, install_versions.engine),
       size_bytes = COALESCE(excluded.size_bytes, install_versions.size_bytes),
       installed_at = datetime('now')`,
    [
      input.threadId,
      input.version,
      input.installPath,
      input.exePath,
      input.engine,
      input.sizeBytes,
    ],
  );
}

/**
 * Versões instaladas do jogo, mais novas primeiro. Garante que a instalação
 * ATUAL do jogo (feita antes do versionamento existir) apareça: se o
 * `install_path` da linha do jogo não tem registro, semeia um na hora com
 * tamanho/engine sondados do disco.
 */
export async function listForGame(game: LibraryGame): Promise<InstallVersion[]> {
  let activePath = game.installPath;

  // Repair installs made before the root fix: the game row pointed at the
  // exe's subfolder, so that subfolder got its own "active" row while the
  // extraction root showed up as an old version — deleting it would wipe the
  // playable game. Keep the root, drop the rows nested in it, and point the
  // game at the root so uninstall/move/reveal see the whole install.
  const existingRows = await versionRows(game.threadId);
  const root = activePath
    ? existingRows.find(
        (r) => !samePath(r.install_path, activePath) && isPathInside(activePath, r.install_path),
      )
    : undefined;
  if (root) {
    for (const r of existingRows) {
      if (r.id !== root.id && isPathInside(r.install_path, root.install_path)) {
        await execute(`DELETE FROM install_versions WHERE id = ?`, [r.id]);
      }
    }
    await execute(`UPDATE library_games SET install_path = ? WHERE thread_id = ?`, [
      root.install_path,
      game.threadId,
    ]);
    activePath = root.install_path;
  }

  // Seed só de instalação REAL: antes da extração o install_path aponta para
  // a pasta do thread (onde ficam os arquivos baixados) — registrar essa
  // pasta como "versão" deixaria o botão Excluir apagar os downloads juntos.
  const isRealInstall =
    game.installStatus === 'installed' || game.installStatus === 'update_available';
  if (activePath && isRealInstall) {
    const covered = existingRows.some((r) => isPathInside(activePath, r.install_path));
    if (!covered) {
      let engine: string | null = null;
      let sizeBytes: number | null = null;
      try {
        const probe = await ipc.probeInstallDir(activePath);
        if (probe.exists) {
          engine = probe.engine;
          sizeBytes = probe.sizeBytes;
        }
      } catch {
        /* sem probe, semeia mesmo assim */
      }
      await register({
        threadId: game.threadId,
        version: game.currentVersion,
        installPath: activePath,
        exePath: game.exePath,
        engine,
        sizeBytes,
      });
    }
  }
  const rows = await versionRows(game.threadId);
  // Poda linhas cujo diretório sumiu (usuário apagou no Explorer). A ativa
  // fica — o fluxo normal de uninstall cuida dela. Existência via disk_info,
  // que é um syscall barato (probe_install_dir anda a árvore inteira).
  const out: InstallVersion[] = [];
  for (const r of rows) {
    const v = rowToVersion(r, activePath);
    if (!v.active) {
      try {
        const info = await ipc.diskInfo(r.install_path);
        if (!info.available) {
          await execute(`DELETE FROM install_versions WHERE id = ?`, [r.id]);
          continue;
        }
      } catch {
        /* mantém na dúvida */
      }
    }
    out.push(v);
  }
  return out;
}

/**
 * Torna `version` a versão ativa do jogo: repõe install_path/exe_path e o
 * rótulo de versão na linha da biblioteca. Status vira `installed` quando a
 * versão tem exe (ou o update pendente continua sinalizado se o F95 anuncia
 * algo mais novo que o rótulo desta versão — setAvailableVersion cuida disso
 * no próximo check; aqui só não regredimos para not_installed sem motivo).
 */
export async function setActive(
  game: LibraryGame,
  version: InstallVersion,
): Promise<void> {
  if (version.exePath) {
    await library.setExe(game.threadId, version.exePath, version.installPath);
  } else {
    await execute(
      `UPDATE library_games
          SET install_path = ?, exe_path = NULL,
              install_status = CASE
                WHEN install_status IN ('downloading', 'extracting') THEN install_status
                ELSE 'installed'
              END
        WHERE thread_id = ?`,
      [version.installPath, game.threadId],
    );
  }
  if (version.version) {
    await execute(
      `UPDATE library_games SET current_version = ? WHERE thread_id = ?`,
      [version.version, game.threadId],
    );
  }
}

/** Atualiza o exe registrado de uma versão (usuário escolheu manualmente). */
export async function setVersionExe(id: number, exePath: string): Promise<void> {
  await execute(`UPDATE install_versions SET exe_path = ? WHERE id = ?`, [exePath, id]);
}

/** Remove só o registro (sem tocar no disco). */
export async function forget(id: number): Promise<void> {
  await execute(`DELETE FROM install_versions WHERE id = ?`, [id]);
}

/** Idem, pelo caminho exato — para quem já apagou o diretório do disco. */
export async function forgetByPath(installPath: string): Promise<void> {
  await execute(`DELETE FROM install_versions WHERE install_path = ?`, [installPath]);
}

export interface DeleteVersionResult {
  deleted: boolean;
  /** Caminho recusado pelo backend (fora das bibliotecas registradas). */
  skippedPath: string | null;
}

/**
 * Apaga a pasta da versão do disco e o registro. A versão ATIVA não pode ser
 * excluída por aqui — o chamador deve exigir ativar outra antes (ou usar o
 * fluxo normal de desinstalação), para a linha da biblioteca nunca apontar
 * para um caminho morto.
 */
export async function deleteVersion(
  version: InstallVersion,
): Promise<DeleteVersionResult> {
  if (version.active) {
    throw new ActiveInstallError(version.installPath);
  }
  // Re-check against the live row: a folder that contains the install in use
  // (or sits inside it) must never be deleted as an "old" version.
  const current = await query<{ install_path: string | null }>(
    `SELECT install_path FROM library_games WHERE thread_id = ?`,
    [version.threadId],
  );
  if (pathsOverlap(version.installPath, current[0]?.install_path)) {
    throw new ActiveInstallError(version.installPath);
  }
  const safeRoots = await libraries.allPaths();
  const ok = await ipc.deleteInstallDir({ path: version.installPath, safeRoots });
  if (!ok) {
    return { deleted: false, skippedPath: version.installPath };
  }
  await forget(version.id);
  return { deleted: true, skippedPath: null };
}
