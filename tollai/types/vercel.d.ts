import type { Toll } from './index.js';

export function tollaiVercel(toll: Toll, downstream?: ((req: any, res: any) => unknown) | null): (req: any, res: any) => Promise<unknown>;
export default tollaiVercel;
