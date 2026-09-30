import type { AppContext } from '../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from './types';
import { createAuthHandlers } from './handlers/auth';
import { createGameHandlers, createSamHandlers } from './handlers/game';
import { createLifecycleHandlers } from './handlers/lifecycle';
import { createResolverHandlers } from './handlers/resolvers';
import { createAlertsHandlers } from './handlers/alerts';
import { createSocialHandlers } from './handlers/social';

export function createHandlerRegistry(ctx: AppContext): Record<string, RpcHandler> {
  return {
    ...createLifecycleHandlers(ctx),
    ...createAuthHandlers(ctx),
    ...createSamHandlers(ctx),
    ...createGameHandlers(ctx),
    ...createAlertsHandlers(ctx),
    ...createSocialHandlers(ctx),
    ...createResolverHandlers(ctx),
  };
}

export async function dispatchMethod(
  registry: Record<string, RpcHandler>,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = registry[method];
  if (!handler) {
    throw new RpcError(RPC_ERROR.METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
  return handler(params);
}
