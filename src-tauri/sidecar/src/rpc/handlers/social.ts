import type { AppContext } from '../../domain/context';
import type { MemberActivityKind } from '../../domain/f95/client';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';

function requireUserId(p: Record<string, unknown>): string {
  const userId = p.userId;
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'userId required');
  }
  return userId.trim();
}

/** Member tabs, member cards and follow toggles (friends/profile pages). */
export function createSocialHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    getMemberActivity: async (p) => {
      const kind: MemberActivityKind = p.kind === 'postings' ? 'postings' : 'latest';
      return ctx.requireClient().getMemberActivity(requireUserId(p), kind);
    },
    getMemberAbout: async (p) => ctx.requireClient().getMemberAbout(requireUserId(p)),
    getMemberCards: async (p) => {
      const ids = p.userIds;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'userIds must be a list of ids');
      }
      return ctx.getSocial().getMemberCards(ids.map((id: string) => id.trim()));
    },
    setMemberFollow: async (p) => {
      if (typeof p.follow !== 'boolean') {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'follow must be a boolean');
      }
      return ctx.getSocial().setMemberFollow(requireUserId(p), p.follow);
    },
  };
}
