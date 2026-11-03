// A separate OS process that opens the same database file and tries to approve one request
// the moment it is told to go. Used to prove the no-overlap guarantee across processes.
import { openDatabase, inTransaction } from '../../src/db.js';
import { todayIn } from '../../src/dates.js';
import { approveRequest } from '../../src/borrowing.js';

const [dbFile, reservationId, ownerId, nowIso] = process.argv.slice(2);
const db = openDatabase(dbFile);
const now = new Date(nowIso);
const ctx = { db, timeZone: 'America/Toronto', now: () => now, today: () => todayIn('America/Toronto', now), uploadsDir: '' };

process.stdout.write('ready\n');
process.stdin.once('data', () => {
  let outcome;
  try {
    inTransaction(db, () => approveRequest(ctx, { id: ownerId }, reservationId));
    outcome = 'approved';
  } catch (err) {
    outcome = err.code || err.message;
  }
  db.close();
  process.stdout.write(`${outcome}\n`);
  process.exit(0);
});
