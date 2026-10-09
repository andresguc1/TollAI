// Generates client/client-source.js — the tollai-client.js script embedded as
// a string so servers can serve it over HTTP without reading from disk.
//
//   node scripts/build-client.mjs
//
// The output is deterministic (byte-identical for identical input) and is
// checked into the package, so a consumer never has to run this at install
// time. Regenerate after editing client/tollai-client.js: `npm run build:client`.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sourcePath = path.join(root, 'client', 'tollai-client.js');
const source = readFileSync(sourcePath, 'utf8');

// The client script must embed byte-for-byte (CLIENT_SOURCE === file content),
// so template-escape hazards are forbidden and fail the build loudly instead
// of silently altering the shipped script.
for (const forbidden of ['\\', '`', '${']) {
  if (source.includes(forbidden)) {
    throw new Error(`build:client — client/tollai-client.js must not contain "${forbidden}"`);
  }
}

const banner =
  '// GENERATED FILE — do not edit. Regenerate with `node scripts/build-client.mjs`.\n'
  + '// Source: client/tollai-client.js (browser client served by /tollai/client.js).\n';

const output =
  banner
  + 'const CLIENT_SOURCE = String(`'
  + source
  + '`);\n\n'
  + 'export { CLIENT_SOURCE };\n'
  + 'export default CLIENT_SOURCE;\n';

writeFileSync(path.join(root, 'client', 'client-source.js'), output, 'utf8');
console.log(`build:client — wrote client/client-source.js (${output.length} bytes)`);