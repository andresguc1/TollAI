import type { Toll } from './index.js';

export function tollaiOnRequest(
  toll: Toll,
  downstream: (request: any) => unknown | Promise<unknown>,
): (request: any) => Promise<unknown>;
export const tollaiFirebase: typeof tollaiOnRequest;
export default tollaiOnRequest;
