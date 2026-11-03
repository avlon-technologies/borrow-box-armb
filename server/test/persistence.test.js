// Verifies ::BorrowBox.PersistenceAndIdempotencyTests — StateSurvivesRestart, RepeatedSubmissionIsHarmless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, day } from './helpers.js';
import { todayIn } from '../src/dates.js';

test('state survives a server restart over the same database file', async () => {
  const first = await startLibrary();
  const sam = await first.as('sam');
  const id = (await sam.request(first.items.tent, day(30), day(31), 'Persist me')).body.reservation.id;
  const maya = await first.as('maya');
  await maya.patch(`/items/${first.items.tent}`, { pickupArea: 'Front porch' });
  await first.stop({ keep: true });

  const second = await startLibrary({ dataDir: first.dataDir, fresh: false });
  try {
    const again = await second.as('sam');
    const r = (await again.get(`/reservations/${id}`)).body;
    assert.equal(r.status, 'pending');
    assert.equal(r.note, 'Persist me');
    assert.equal((await again.get(`/items/${second.items.tent}`)).body.pickupArea, 'Front porch');
    assert.equal(r.history[0].type, 'RequestSubmitted');
  } finally {
    await second.stop();
  }
});

test('a repeated submission with the same Idempotency-Key has one effect', async () => {
  const lib = await startLibrary();
  try {
    const sam = await lib.as('sam');
    const body = { startDate: day(30), endDate: day(31) };
    const headers = { 'Idempotency-Key': 'req-abc-123' };
    const [a, b] = await Promise.all([
      sam.post(`/items/${lib.items.tent}/requests`, body, headers),
      sam.post(`/items/${lib.items.tent}/requests`, body, headers),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.reservation.id, b.body.reservation.id);
    assert.ok([a, b].some((r) => r.headers.get('idempotent-replay') === 'true'));
    const count = lib.db.prepare("SELECT count(*) n FROM reservations WHERE item_id = ? AND borrower_id = 'p-sam' AND start_date = ?").get(lib.items.tent, day(30)).n;
    assert.equal(count, 1);

    // Same for a state change: a double-clicked approval journals once.
    const maya = await lib.as('maya');
    const id = a.body.reservation.id;
    const k = { 'Idempotency-Key': 'approve-1' };
    await Promise.all([maya.post(`/reservations/${id}/approve`, {}, k), maya.post(`/reservations/${id}/approve`, {}, k)]);
    const approvals = lib.db.prepare("SELECT count(*) n FROM events WHERE reservation_id = ? AND type = 'RequestApproved'").get(id).n;
    assert.equal(approvals, 1);
  } finally {
    await lib.stop();
  }
});

test('asking again for exactly the same dates without a key is caught as a duplicate', async () => {
  const lib = await startLibrary();
  try {
    const sam = await lib.as('sam');
    assert.equal((await sam.request(lib.items.tent, day(30), day(31))).status, 201);
    const dup = await sam.request(lib.items.tent, day(30), day(31));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'duplicate_request');
  } finally {
    await lib.stop();
  }
});

test('the calendar policy judges "today" in the community time zone', () => {
  // 02:30 UTC on 16 June is still the evening of 15 June in Toronto.
  const late = new Date('2026-06-16T02:30:00Z');
  assert.equal(todayIn('America/Toronto', late), '2026-06-15');
  assert.equal(todayIn('UTC', late), '2026-06-16');
});

test('a request starting "today" is accepted in the community zone even after UTC midnight', async () => {
  const clock = { now: new Date('2026-06-16T02:30:00Z') }; // Toronto: 15 June, 22:30
  const lib = await startLibrary({ clock });
  try {
    const sam = await lib.as('sam');
    const res = await sam.request(lib.items.tent, '2026-06-15', '2026-06-15');
    assert.equal(res.status, 201);
  } finally {
    await lib.stop();
  }
});
