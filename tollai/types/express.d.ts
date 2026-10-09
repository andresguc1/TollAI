import type { Toll } from './index.js';

export type ExpressTollaiMiddleware = (
  req: any,
  res: any,
  next: (err?: unknown) => void,
) => unknown;

export function tollaiMiddleware(toll: Toll): ExpressTollaiMiddleware;
export function createTollaiMiddleware(toll: Toll): ExpressTollaiMiddleware;
export default tollaiMiddleware;
