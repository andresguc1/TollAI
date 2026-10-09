import type { Toll } from './index.js';

export function createCloudflareTollHandler(
  toll: Toll,
  origin?: unknown,
): (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>;
export const tollaiCloudflareHandler: typeof createCloudflareTollHandler;
export default createCloudflareTollHandler;
