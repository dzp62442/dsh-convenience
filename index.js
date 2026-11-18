import { createMatcher } from './src/ip-rules.js';
import { startProxy } from './src/proxy.js';
export { Config } from './src/config.js';

export const name = 'convenience';
export const inject = ['webServer', 'connection'];

export async function apply(ctx, config) {
  const matches = createMatcher(() => config.access.get());
  await ctx.effect(() => startProxy({
    upstream: ctx.webServer.getOrigin(),
    listeners: config.listeners,
    connection: ctx.connection,
    matches,
    logger: ctx.logger,
  }), 'convenience.access');
}
