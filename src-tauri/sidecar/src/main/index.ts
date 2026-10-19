import * as readline from 'node:readline';
import { AppContext } from '../domain/context';
import { closePlaywrightBrowser } from '../infra/playwright/browser';
import { installPlaywrightGuard, prefetchChromium } from '../infra/playwright/runtime';
import { log } from '../logger';
import {
  RPC_ERROR,
  RpcError,
  parseRequest,
  type RpcRequest,
  type RpcResponse,
} from '../rpc';
import { createHandlerRegistry, dispatchMethod } from '../rpc/registry';

installPlaywrightGuard();

/**
 * Once the host is gone, a request stuck on a slow host must not keep
 * node.exe and Chromium running: they lock the files an app update replaces.
 */
const EXIT_DRAIN_MS = 3_000;

const ctx = new AppContext();
const handlers = createHandlerRegistry(ctx);
let queue: Promise<void> = Promise.resolve();

function writeResponse(res: RpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function dispatch(req: RpcRequest): void {
  queue = queue
    .then(async () => {
      try {
        const result = await dispatchMethod(handlers, req.method, req.params ?? {});
        writeResponse({ jsonrpc: '2.0', id: req.id, result });
      } catch (err) {
        const e = err as Error;
        if (err instanceof RpcError) {
          writeResponse({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: err.code, message: err.message, data: err.data },
          });
        } else {
          log('handler error:', e.stack ?? e.message);
          writeResponse({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: RPC_ERROR.INTERNAL, message: e.message ?? 'internal error' },
          });
        }
      }
    })
    .catch((err) => {
      log('queue error (unreachable):', err);
    });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: RpcRequest;
  try {
    req = parseRequest(trimmed);
  } catch (err) {
    const e = err as RpcError;
    writeResponse({
      jsonrpc: '2.0',
      id: 0,
      error: { code: e.code ?? RPC_ERROR.PARSE, message: e.message },
    });
    return;
  }
  dispatch(req);
});

rl.on('close', () => {
  log('stdin closed, draining queue and exiting');
  setTimeout(() => process.exit(0), EXIT_DRAIN_MS).unref();
  queue
    .then(async () => {
      if (ctx.client) {
        await ctx.client.close();
        ctx.client = null;
      }
      await closePlaywrightBrowser();
    })
    .catch(() => {})
    .finally(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  log('uncaughtException:', err.stack ?? err.message);
});
process.on('unhandledRejection', (reason) => {
  log('unhandledRejection:', reason);
});

log('ready');

// Off the startup path: a missing Chromium starts downloading now instead
// of when a download host or a Cloudflare check first needs it.
setTimeout(prefetchChromium, 3_000).unref();
