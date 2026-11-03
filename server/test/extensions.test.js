// Verifies ::BorrowBox.ExtensionTests — ExtensionsRecheckConflicts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day } from './helpers.js';

let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

test('borrower proposes, owner accepts, the due date moves and history records it', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'tent', from: day(0), to: day(3), state: 'borrowed' });
  const sam = await lib.as('sam');
  const res = await sam.act(id, 'extensions', { proposedEndDate: day(5), note: 'Weather turned great' });
  assert.equal(res.status, 201);
  const ext = res.body.reservation.pendingExtension;
  assert.equal(ext.proposedEndDate, day(5));
  assert.ok(!res.body.reservation.actions.includes('propose-extension'), 'one at a time');
  assert.equal((await sam.act(id, 'extensions', { proposedEndDate: day(6) })).body.error.code, 'extension_pending');

  const maya = await lib.as('maya');
  const accepted = await maya.post(`/extensions/${ext.id}/accept`);
  assert.equal(accepted.status, 200);
  const r = accepted.body.reservation;
  assert.equal(r.endDate, day(5));
  assert.equal(r.originalEndDate, day(3));
  assert.equal(r.pendingExtension, null);
  assert.equal(r.extensions[0].status, 'accepted');
  assert.deepEqual(r.history.slice(-2).map((h) => [h.type, h.actor.handle]), [['ExtensionProposed', 'sam'], ['ExtensionAccepted', 'maya']]);
  assert.equal((await maya.post(`/extensions/${ext.id}/accept`)).status, 409, 'cannot answer twice');
});

test('acceptance re-checks: days promised to someone else after the proposal block it', async () => {
  const x = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'projector', from: day(0), to: day(3), state: 'borrowed' });
  const sam = await lib.as('sam');
  const jo = await lib.as('jo');
  const maya = await lib.as('maya');
  const joRequest = (await jo.request(lib.items.projector, day(6), day(8))).body.reservation.id;
  const ext = (await sam.act(x, 'extensions', { proposedEndDate: day(7) })).body.reservation.pendingExtension;

  // Maya approves Jo first; the pending extension now collides.
  assert.equal((await maya.act(joRequest, 'approve')).status, 200);
  const refused = await maya.post(`/extensions/${ext.id}/accept`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'dates_taken');
  const still = (await sam.get(`/reservations/${x}`)).body;
  assert.equal(still.endDate, day(3), 'due date unchanged');
  assert.equal(still.pendingExtension.id, ext.id, 'the proposal waits for an answer');

  assert.equal((await maya.post(`/extensions/${ext.id}/decline`, { note: 'Jo has it from the 6th' })).status, 200);
  const fits = (await sam.act(x, 'extensions', { proposedEndDate: day(5) })).body.reservation.pendingExtension;
  assert.equal((await maya.post(`/extensions/${fits.id}/accept`)).status, 200);
  assert.equal((await sam.get(`/reservations/${x}`)).body.endDate, day(5));
});

test('a proposal that already collides is refused with the last free day', async () => {
  const x = await loanTo(lib, { owner: 'priya', borrower: 'jo', item: 'boardgame', from: day(1), to: day(2), state: 'approved' });
  await loanTo(lib, { owner: 'priya', borrower: 'sam', item: 'boardgame', from: day(6), to: day(7), state: 'approved' });
  const jo = await lib.as('jo');
  const res = await jo.act(x, 'extensions', { proposedEndDate: day(8) });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.details.lastFreeDate, day(5));
});

test('the database refuses an extension that would overlap, even bypassing the service', async () => {
  const a = lib.db.prepare("SELECT r.id, r.item_id FROM reservations r JOIN items i ON i.id = r.item_id WHERE i.slug = 'boardgame' AND r.status = 'approved' ORDER BY r.start_date LIMIT 1").get();
  assert.throws(() => lib.db.prepare('UPDATE reservations SET end_date = ? WHERE id = ?').run(day(9), a.id), /reservation_overlap/);
});

test('proposals must move the date later and only while the loan is open', async () => {
  const x = await loanTo(lib, { owner: 'jo', borrower: 'maya', item: 'mixer', from: day(30), to: day(31), state: 'approved' });
  const maya = await lib.as('maya');
  assert.equal((await maya.act(x, 'extensions', { proposedEndDate: day(31) })).status, 422);
  assert.equal((await maya.act(x, 'extensions', { proposedEndDate: 'soon' })).status, 422);
  const done = await loanTo(lib, { owner: 'jo', borrower: 'sam', item: 'mixer', from: day(40), to: day(41), state: 'returned' });
  const sam = await lib.as('sam');
  assert.equal((await sam.act(done, 'extensions', { proposedEndDate: day(45) })).status, 409);
});

test('cancelling a reservation withdraws its pending extension', async () => {
  const x = await loanTo(lib, { owner: 'sam', borrower: 'priya', item: 'camera', from: day(50), to: day(51), state: 'approved' });
  const priya = await lib.as('priya');
  const ext = (await priya.act(x, 'extensions', { proposedEndDate: day(52) })).body.reservation.pendingExtension;
  await priya.act(x, 'cancel');
  const sam = await lib.as('sam');
  assert.equal((await sam.post(`/extensions/${ext.id}/accept`)).status, 409);
});
