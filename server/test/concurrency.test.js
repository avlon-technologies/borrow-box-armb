// Verifies ::BorrowBox.ApprovalConcurrencyTests — ApprovalsNeverOverlap: overlapping pending
// requests coexist; concurrent approvals of overlapping requests commit exactly one, whether
// they race inside one server or across separate processes sharing the database file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLibrary, day, NOW } from './helpers.js';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'approve-worker.js');
let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

const committed = (itemId) => lib.db.prepare("SELECT * FROM reservations WHERE item_id = ? AND status IN ('approved','ready','borrowed','returning') ORDER BY start_date").all(itemId);

test('overlapping pending requests may coexist', async () => {
  const sam = await lib.as('sam');
  const jo = await lib.as('jo');
  const a = await sam.request(lib.items.tent, day(10), day(13));
  const b = await jo.request(lib.items.tent, day(12), day(15));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.reservation.status, 'pending');
  assert.equal(b.body.reservation.status, 'pending');
});

test('after one approval, an overlapping approval is refused and the other stays pending', async () => {
  const sam = await lib.as('sam');
  const priya = await lib.as('priya');
  const maya = await lib.as('maya');
  const a = (await sam.request(lib.items.drill, day(5), day(7))).body.reservation.id;
  const b = (await priya.request(lib.items.drill, day(7), day(8))).body.reservation.id; // shares day 7
  assert.equal((await maya.act(a, 'approve')).status, 200);
  const second = await maya.act(b, 'approve');
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'dates_taken');
  const view = (await maya.get(`/reservations/${b}`)).body;
  assert.equal(view.status, 'pending');
  assert.ok(view.blockedBy, 'owner sees what blocks it');
  assert.ok(!view.actions.includes('approve') || view.blockedBy);
});

test('a request for already-committed dates is refused up front', async () => {
  const jo = await lib.as('jo');
  const res = await jo.request(lib.items.drill, day(6), day(6));
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'dates_taken');
});

test('concurrent HTTP approvals of many overlapping requests commit exactly one', async () => {
  const people = ['sam', 'jo', 'priya'];
  const ids = [];
  for (let i = 0; i < 9; i++) {
    const who = await lib.as(people[i % 3]);
    const res = await who.request(lib.items.projector, day(30 + (i % 3)), day(33 + (i % 3)));
    // the same person may not repeat identical dates; vary them
    if (res.status === 201) ids.push(res.body.reservation.id);
  }
  assert.ok(ids.length >= 3);
  const maya = await lib.as('maya');
  const results = await Promise.all(ids.map((id) => maya.act(id, 'approve')));
  const approved = results.filter((r) => r.status === 200);
  const refused = results.filter((r) => r.status === 409);
  assert.equal(approved.length, 1, 'exactly one approval wins');
  assert.equal(refused.length, ids.length - 1);
  assert.equal(committed(lib.items.projector).length, 1);
});

test('the database refuses an overlapping commit even when the service check is bypassed', () => {
  const [a] = committed(lib.items.drill);
  const other = lib.db.prepare("SELECT id FROM reservations WHERE item_id = ? AND status = 'pending'").get(lib.items.drill);
  assert.ok(a && other);
  assert.throws(() => lib.db.prepare("UPDATE reservations SET status = 'approved' WHERE id = ?").run(other.id), /reservation_overlap/);
});

test('separate processes racing to approve overlapping requests commit exactly one', async () => {
  const sam = await lib.as('sam');
  const jo = await lib.as('jo');
  const priya = await lib.as('priya');
  const ids = [
    (await sam.request(lib.items.guitar, day(50), day(55))).body.reservation.id,
    (await jo.request(lib.items.guitar, day(52), day(57))).body.reservation.id,
    (await priya.request(lib.items.guitar, day(54), day(58))).body.reservation.id,
    (await sam.request(lib.items.guitar, day(54), day(54))).body.reservation.id, // every range shares day 54
  ];
  const dbFile = join(lib.dataDir, 'borrowbox.sqlite');
  const workers = ids.map((id) => {
    const child = spawn(process.execPath, [WORKER, dbFile, id, 'p-maya', NOW.toISOString()], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = [];
    let buffer = '';
    const ready = new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          lines.push(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
          if (lines.length === 1) resolve();
        }
      });
    });
    const done = new Promise((resolve) => child.on('exit', () => resolve(lines[1])));
    return { child, ready, done };
  });
  await Promise.all(workers.map((w) => w.ready));
  for (const w of workers) w.child.stdin.write('go\n');
  const outcomes = await Promise.all(workers.map((w) => w.done));
  assert.equal(outcomes.filter((o) => o === 'approved').length, 1, `outcomes: ${outcomes.join(', ')}`);
  assert.equal(outcomes.filter((o) => o === 'dates_taken').length, ids.length - 1, `outcomes: ${outcomes.join(', ')}`);
  assert.equal(committed(lib.items.guitar).length, 1);
});
