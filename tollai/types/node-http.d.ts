import type { Toll } from './index.js';

export function runNode(req: any, res: any, next: () => void, toll: Toll): Promise<void>;
export function createTollaiMiddleware(toll: Toll): (req: any, res: any, next: () => void) => void;
export default createTollaiMiddleware;
