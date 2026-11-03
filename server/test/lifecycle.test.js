// Verifies ::BorrowBox.RequestLifecycleTests — RequestsPersistAsPending, DecisionsFollowLifecycle,
// RequestsFitTheCalendar: request, approve, decline, cancel, and every refused transition.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day } from './helpers.js';

let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

test('a borrower requests inclusive dates with a note and sees it pending', async () => {
  const sam = await lib.as('sam');
  const res = await sam.request(lib.items.tent, day(3), day(5), 'Lake weekend with my brother');
  assert.equal(res.status, 201);
  const r = res.body.reservation;
  assert.equal(r.status, 'pending');
  assert.equal(r.startDate, day(3));
  assert.equal(r.endDate, day(5));
  assert.equal(r.days, 3, 'both ends count');
  assert.equal(r.note, 'Lake weekend with my brother');
  assert.equal(r.role, 'borrower');
  assert.deepEqual(r.actions, ['cancel']);
  const mine = (await sam.get('/reservations')).body.find((x) => x.id === r.id);
  assert.equal(mine.status, 'pending');
  const maya = await lib.as('maya');
  const theirs = (await maya.get(`/reservations/${r.id}`)).body;
  assert.equal(theirs.role, 'owner');
  assert.deepEqual(theirs.actions, ['approve', 'decline']);
  assert.equal(theirs.history[0].type, 'RequestSubmitted');
  assert.equal(theirs.history[0].actor.id, 'p-sam');
});

test('dates are validated against the calendar policy and the item rules', async () => {
  const sam = await lib.as('sam');
  const cases = [
    [day(-1), day(1), /past/],
    [day(4), day(2), /on or after/],
    [day(1), day(9), /up to 3 days/], // the drill allows 3 days
    ['2026-02-30', day(2), /choose a start/],
    [undefined, undefined, /choose a start/],
  ];
  for (const [from, to, message] of cases) {
    const res = await sam.request(lib.items.drill, from, to);
    assert.equal(res.status, 422, `${from}..${to}`);
    assert.match(res.body.error.message, message);
  }
  const sameDay = await sam.request(lib.items.drill, day(0), day(0));
  assert.equal(sameDay.status, 201, 'a one-day loan starting today is fine');
});

test('owner approves; approving again or declining afterwards is refused', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'jo', item: 'guitar', from: day(2), to: day(4), state: 'pending' });
  const maya = await lib.as('maya');
  const ok = await maya.act(id, 'approve', { note: 'Enjoy!' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reservation.status, 'approved');
  assert.equal(ok.body.reservation.responseNote, 'Enjoy!');
  for (const act of ['approve', 'decline']) {
    const again = await maya.act(id, act);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'invalid_transition');
  }
});

test('owner declines a pending request; it cannot then be approved or cancelled', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'priya', item: 'projector', from: day(10), to: day(11), state: 'pending' });
  const maya = await lib.as('maya');
  const res = await maya.act(id, 'decline', { note: 'Sorry, family visiting that week.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.reservation.status, 'declined');
  assert.equal((await maya.act(id, 'approve')).status, 409);
  const priya = await lib.as('priya');
  assert.equal((await priya.act(id, 'cancel')).status, 409);
});

test('borrower cancels a pending request, and cancelling again is refused', async () => {
  const id = await loanTo(lib, { owner: 'jo', borrower: 'sam', item: 'dutch-oven', from: day(20), to: day(21), state: 'pending' });
  const sam = await lib.as('sam');
  const res = await sam.act(id, 'cancel');
  assert.equal(res.status, 200);
  assert.equal(res.body.reservation.status, 'cancelled');
  assert.equal((await sam.act(id, 'cancel')).status, 409);
  const jo = await lib.as('jo');
  assert.equal((await jo.act(id, 'approve')).status, 409, 'a cancelled request cannot be approved');
});

test('cancelling an approved reservation frees its dates for others', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'tent', from: day(40), to: day(42), state: 'approved' });
  const jo = await lib.as('jo');
  assert.equal((await jo.request(lib.items.tent, day(41), day(41))).status, 409);
  const sam = await lib.as('sam');
  assert.equal((await sam.act(id, 'cancel')).status, 200);
  assert.equal((await jo.request(lib.items.tent, day(41), day(41))).status, 201);
});

test('steps cannot be skipped or taken out of order', async () => {
  const id = await loanTo(lib, { owner: 'priya', borrower: 'sam', item: 'boardgame', from: day(1), to: day(2), state: 'pending' });
  const sam = await lib.as('sam');
  const priya = await lib.as('priya');
  assert.equal((await priya.act(id, 'ready')).status, 409, 'ready before approval');
  assert.equal((await sam.act(id, 'pickup', { rating: 'good' })).status, 409, 'pickup before approval');
  await priya.act(id, 'approve');
  assert.equal((await sam.act(id, 'pickup', { rating: 'good' })).status, 409, 'pickup before ready');
  assert.equal((await sam.act(id, 'return', { rating: 'good' })).status, 409, 'return before pickup');
  await priya.act(id, 'ready');
  assert.equal((await priya.act(id, 'confirm-return', { rating: 'good' })).status, 409, 'confirm before return');
  await sam.act(id, 'pickup', { rating: 'good' });
  assert.equal((await sam.act(id, 'cancel')).status, 409, 'no cancelling after pickup');
});

test('unknown items, requests and actions are reported plainly', async () => {
  const sam = await lib.as('sam');
  assert.equal((await sam.request('no-such-item', day(1), day(2))).status, 404);
  assert.equal((await sam.get('/reservations/nope')).status, 404);
  assert.equal((await sam.act('nope', 'approve')).status, 404);
  assert.equal((await sam.act('nope', 'fly')).status, 404);
});
