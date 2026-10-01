import type { SamFilters } from '../../domain/sam/client';
import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';

export function createSamHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    samList: async (p) => {
      const filters = (p?.filters ?? p ?? {}) as SamFilters;
      return ctx.getSam().list(filters);
    },
    samTagSearch: async (p) => {
      const category = (p?.category ?? 'games') as SamFilters['category'];
      const search = typeof p?.search === 'string' ? p.search : '';
      return ctx.getSam().searchTags(category ?? 'games', search);
    },
    samOptions: async (p) => {
      const category = (p?.category ?? 'games') as SamFilters['category'];
      return ctx.getSam().options(category ?? 'games');
    },
  };
}

function threadIdParam(p: Record<string, unknown> | undefined): string {
  const id = p?.threadId;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'numeric threadId required');
  }
  return id;
}

function pageParam(value: unknown): number {
  const n = Number(value ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function createGameHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    gameDetail: async (p) => {
      const id = (p?.threadId ?? p?.thread_id ?? p?.url) as string | undefined;
      if (typeof id !== 'string' || id.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      }
      return ctx.getGame().getDetail(id);
    },
    gamePosts: async (p) => {
      const page = p?.page === 'last' ? 'last' : pageParam(p?.page);
      return ctx.getGame().getPosts(threadIdParam(p), page);
    },
    gameReviews: async (p) => ctx.getGame().getReviews(threadIdParam(p), pageParam(p?.page)),
    getFollowing: async () => ctx.getSocial().getFollowing(),
  };
}
