import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';

export function createAuthHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    login: async (p) => {
      const client = ctx.requireClient();
      const username = p.username;
      const password = p.password;
      if (typeof username !== 'string' || typeof password !== 'string') {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'username and password required');
      }
      return client.login(username, password);
    },
    getProfile: async () => ctx.requireClient().getProfile(),
    getMemberProfile: async (p) => {
      const userId = p.userId;
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'userId required');
      }
      return ctx.requireClient().getMemberProfile(userId.trim());
    },
    isLoggedIn: async () => ({ loggedIn: await ctx.requireClient().isLoggedIn() }),
    logout: async () => {
      const client = ctx.requireClient();
      await client.logout();
      ctx.resetDerivedClients();
      return { ok: true };
    },
  };
}
