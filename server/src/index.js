import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { resetAndSeed } from './seed.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = process.env.BORROWBOX_DATA ?? join(ROOT, 'data');
const port = Number(process.env.PORT ?? 4321);

// First run on a fresh machine: seed the demo library automatically. Afterwards data persists.
if (!existsSync(join(dataDir, 'borrowbox.sqlite'))) {
  const { today } = resetAndSeed({ dataDir });
  console.log(`No database yet — seeded the demo library (today is ${today}).`);
}
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.warn('The interface has not been built yet. Run `npm run build` (or `npm run setup`).');
}

const { app, ctx } = createApp({ dataDir });
const server = app.listen(port, () => {
  console.log(`BorrowBox is running at http://localhost:${port}  (community time zone ${ctx.timeZone}, today ${ctx.today()})`);
});
const stop = () => server.close(() => { ctx.db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
