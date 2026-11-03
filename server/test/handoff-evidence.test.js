// Verifies ::BorrowBox.HandoffAndEvidenceTests — HandoffIsAttributed, LateLoansRemainReturnable,
// EvidenceIsAttributedAndPreserved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day, PIXEL } from './helpers.js';

let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

test('full journey: ready → pickup → return → confirmation, each step attributed', async () => {
  const sam = await lib.as('sam');
  const maya = await lib.as('maya');
  const id = (await sam.request(lib.items.drill, day(0), day(2), 'Hanging shelves')).body.reservation.id;
  await maya.act(id, 'approve');
  const ready = await maya.act(id, 'ready', { note: 'On the porch bench' });
  assert.equal(ready.body.reservation.status, 'ready');
  assert.deepEqual(ready.body.reservation.actions, ['add-note']);

  const pickup = await sam.act(id, 'pickup', { rating: 'like-new', note: 'Looks great', photos: [PIXEL] });
  assert.equal(pickup.status, 200);
  assert.equal(pickup.body.reservation.status, 'borrowed');

  const ret = await sam.act(id, 'return', { rating: 'good', note: 'Works fine, batteries charged' });
  assert.equal(ret.body.reservation.status, 'returning');

  const done = await maya.act(id, 'confirm-return', { rating: 'good', note: 'All good, thanks!' });
  assert.equal(done.status, 200);
  const r = done.body.reservation;
  assert.equal(r.status, 'returned');
  assert.equal(r.disputed, false);

  const trail = r.history.map((h) => [h.type, h.actor.handle]);
  assert.deepEqual(trail, [
    ['RequestSubmitted', 'sam'], ['RequestApproved', 'maya'], ['ItemReadied', 'maya'],
    ['PickupConfirmed', 'sam'], ['ConditionRecorded', 'sam'],
    ['ReturnStarted', 'sam'], ['ConditionRecorded', 'sam'],
    ['ReturnConfirmed', 'maya'], ['ConditionRecorded', 'maya'],
  ]);
  for (const h of r.history) assert.ok(h.at, 'every step has a time');
  assert.equal(r.history[2].data.note, 'On the porch bench');

  const notes = r.conditionNotes.map((n) => [n.phase, n.role, n.author.handle, n.rating]);
  assert.deepEqual(notes, [['handoff', 'borrower', 'sam', 'like-new'], ['return', 'borrower', 'sam', 'good'], ['return', 'owner', 'maya', 'good']]);
  assert.equal(r.conditionNotes[0].photos.length, 1);
  const photo = await fetch(lib.base + r.conditionNotes[0].photos[0]);
  assert.equal(photo.status, 401, 'photos are not served without an identity');
});

test('a condition account is required at pickup, return and confirmation', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'jo', item: 'tent', from: day(1), to: day(2), state: 'ready' });
  const jo = await lib.as('jo');
  const res = await jo.act(id, 'pickup', {});
  assert.equal(res.status, 422);
  assert.equal(res.body.error.details.field, 'rating');
});

test('owner disagreement is recorded beside the borrower account, never over it', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'priya', item: 'guitar', from: day(1), to: day(3), state: 'returning' });
  const maya = await lib.as('maya');
  const missingWhy = await maya.act(id, 'confirm-return', { rating: 'damaged', disagrees: true });
  assert.equal(missingWhy.status, 422, 'a disagreement needs words');
  const res = await maya.act(id, 'confirm-return', { rating: 'damaged', disagrees: true, note: 'Crack near the bridge that was not there before.' });
  assert.equal(res.status, 200);
  const r = res.body.reservation;
  assert.equal(r.disputed, true);
  const [borrowerReturn, ownerReturn] = r.conditionNotes.filter((n) => n.phase === 'return');
  assert.equal(borrowerReturn.author.handle, 'priya');
  assert.equal(borrowerReturn.rating, 'good');
  assert.equal(borrowerReturn.disagrees, false);
  assert.equal(ownerReturn.author.handle, 'maya');
  assert.equal(ownerReturn.rating, 'damaged');
  assert.equal(ownerReturn.disagrees, true);

  // The borrower can answer afterwards; both stay.
  const priya = await lib.as('priya');
  const reply = await priya.act(id, 'notes', { note: 'It was in the case the whole time — happy to look together.', disagrees: true });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.reservation.conditionNotes.length, 4);
  assert.equal(reply.body.reservation.conditionNotes.at(-1).phase, 'followup');
});

test('evidence is append-only at the database level', () => {
  const note = lib.db.prepare('SELECT id FROM condition_notes LIMIT 1').get();
  assert.throws(() => lib.db.prepare("UPDATE condition_notes SET note = 'rewritten' WHERE id = ?").run(note.id), /evidence_append_only/);
  assert.throws(() => lib.db.prepare('DELETE FROM condition_notes WHERE id = ?').run(note.id), /evidence_append_only/);
  assert.throws(() => lib.db.prepare('DELETE FROM events').run(), /journal_append_only/);
});

test('an empty follow-up note is refused', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'projector', from: day(1), to: day(2), state: 'borrowed' });
  const sam = await lib.as('sam');
  assert.equal((await sam.act(id, 'notes', { note: '   ' })).status, 422);
});

test('a late loan shows as overdue to both people and can still be returned', async () => {
  // The seed has Jo holding Sam's camera, due yesterday.
  const jo = await lib.as('jo');
  const sam = await lib.as('sam');
  const loan = (await jo.get('/reservations')).body.find((r) => r.item.title.startsWith('Mirrorless'));
  assert.equal(loan.status, 'borrowed');
  assert.equal(loan.overdue, true);
  assert.equal(loan.daysLate, 1);
  assert.equal(loan.needsMe, true);
  const ownerView = (await sam.get(`/reservations/${loan.id}`)).body;
  assert.equal(ownerView.overdue, true);

  const ret = await jo.act(loan.id, 'return', { rating: 'like-new', note: 'Sorry it is a day late!' });
  assert.equal(ret.status, 200);
  assert.equal(ret.body.reservation.status, 'returning');
  assert.equal(ret.body.reservation.history.find((h) => h.type === 'ReturnStarted').data.daysLate, 1);
  const done = await sam.act(loan.id, 'confirm-return', { rating: 'like-new' });
  assert.equal(done.body.reservation.status, 'returned');
  assert.equal(done.body.reservation.overdue, false);
});

test('the loan becomes overdue when the community calendar passes the due date', async () => {
  const id = await loanTo(lib, { owner: 'jo', borrower: 'priya', item: 'mixer', from: day(20), to: day(21), state: 'pending' });
  const priya = await lib.as('priya');
  assert.equal((await priya.get(`/reservations/${id}`)).body.overdue, false);
  // Not borrowed yet → never overdue, whatever the date.
  const saved = lib.time.now;
  lib.time.now = new Date(saved.getTime() + 30 * 86400000);
  assert.equal((await priya.get(`/reservations/${id}`)).body.overdue, false);
  lib.time.now = saved;
});
