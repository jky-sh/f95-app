import type { AppContext } from '../../domain/context';
import { fetchF95Image } from '../../domain/f95/image';
import { unmaskUrl } from '../../domain/f95/unmask';
import { resolveBuzzheavier } from '../../domain/resolvers/buzzheavier';
import { resolveDatanodes } from '../../domain/resolvers/datanodes';
import { resolveGdrive } from '../../domain/resolvers/gdrive';
import { resolveMixdrop, resolveMixdropInteractive, resolveMixdropWithCookies } from '../../domain/resolvers/mixdrop';
import { resolveGofile } from '../../domain/resolvers/gofile';
import { resolveWorkupload } from '../../domain/resolvers/workupload';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';

export function createResolverHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    resolveBuzzheavier: async (p) => {
      const client = ctx.requireClient();
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      const accountId =
        typeof p?.accountId === 'string' && p.accountId.trim() ? p.accountId.trim() : null;
      return resolveBuzzheavier(client.http, url, accountId);
    },
    resolveDatanodes: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      return resolveDatanodes(url);
    },
    resolveGdrive: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      return resolveGdrive(url);
    },
    resolveWorkupload: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      return resolveWorkupload(url);
    },
    resolveGofile: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      const accountToken =
        typeof p?.accountToken === 'string' && p.accountToken.trim()
          ? p.accountToken.trim()
          : null;
      return resolveGofile(url, accountToken);
    },
    resolveMixdrop: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      const apiEmail =
        typeof p?.apiEmail === 'string' && p.apiEmail.trim() ? p.apiEmail.trim() : null;
      const apiKey = typeof p?.apiKey === 'string' && p.apiKey.trim() ? p.apiKey.trim() : null;
      return resolveMixdrop(url, apiEmail, apiKey);
    },
    resolveMixdropWithCookies: async (p) => {
      const url = p?.url as string | undefined;
      const cookieHeader = p?.cookieHeader as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'cookieHeader required');
      }
      const apiEmail =
        typeof p?.apiEmail === 'string' && p.apiEmail.trim() ? p.apiEmail.trim() : null;
      const apiKey = typeof p?.apiKey === 'string' && p.apiKey.trim() ? p.apiKey.trim() : null;
      return resolveMixdropWithCookies(url, cookieHeader, apiEmail, apiKey);
    },
    resolveMixdropInteractive: async (p) => {
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      const apiEmail =
        typeof p?.apiEmail === 'string' && p.apiEmail.trim() ? p.apiEmail.trim() : null;
      const apiKey = typeof p?.apiKey === 'string' && p.apiKey.trim() ? p.apiKey.trim() : null;
      return resolveMixdropInteractive(url, apiEmail, apiKey);
    },
    unmaskUrl: async (p) => {
      const client = ctx.requireClient();
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      return unmaskUrl(client.http, url);
    },
    fetchF95Image: async (p) => {
      const client = ctx.requireClient();
      const url = p?.url as string | undefined;
      if (typeof url !== 'string' || url.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
      }
      return fetchF95Image(client.http, url);
    },
  };
}
