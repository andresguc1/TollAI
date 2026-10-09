// Cloudflare Workers adapter: handle(request, env, ctx) => Promise<Response>.
// The tollai core runs first; if it produces a response (challenge, 433,
// shell, 401, ...) that is returned. Otherwise the request is forwarded to the
// origin fetch handler and any sliding-session refresh cookies / decision
// headers are applied to its response.
export function createCloudflareTollHandler(toll, origin) {
  if (!toll || typeof toll.handle !== 'function') {
    throw new Error('tollai: createCloudflareTollHandler requires a toll from createToll()');
  }
  if (typeof origin !== 'function') {
    throw new Error('tollai: createCloudflareTollHandler origin must be a fetch handler');
  }
  return async function tollaiCloudflareHandler(request, env, ctx) {
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-real-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      '';
    const modeHeader = request.headers.get('x-tollai-mode');
    const coreCtx = { ip, ...(modeHeader === 'off' ? { mode: 'off' } : {}) };

    const response = await toll.handle(request, coreCtx);
    if (response) return response;

    let result = await origin(request, env, ctx);
    if (result == null) result = new Response('', { status: 204 });

    const out = coreCtx.out;
    if (out) {
      for (const [name, value] of Object.entries(out.headers || {})) {
        result.headers.set(name, String(value));
      }
      for (const cookie of out.setCookie || []) {
        result.headers.append('set-cookie', cookie);
      }
    }
    return result;
  };
}

export const tollaiCloudflareHandler = createCloudflareTollHandler;

export default createCloudflareTollHandler;