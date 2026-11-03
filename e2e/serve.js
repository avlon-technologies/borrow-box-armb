// Fresh seeded data directory for each E2E run, then the real server on port 4400.
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { resetAndSeed } from '../server/src/seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.e2e-data');
rmSync(dataDir, { recursive: true, force: true });
resetAndSeed({ dataDir });
process.env.BORROWBOX_DATA = dataDir;
process.env.PORT = '4400';
await import('../server/src/index.js');
