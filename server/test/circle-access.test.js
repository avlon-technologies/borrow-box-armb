// Verifies ::BorrowBox.CircleAccessTests — OwnersChooseAudience, CircleOnlyItemsReachOnlyMembers,
// MembershipChangesKeepCommitments, CatalogService, BorrowingService.
// Rules: CircleOnlyNeedsSharedCircle, MembershipChangesKeepCommitments, ShareOnlyWhereMember.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day, PIXEL } from './helpers.js';

let lib;
beforeEach(async () => { lib = await startLibrary(); });
afterEach(() => lib.stop());

const circleId = (name) => lib.db.prepare('SELECT id FROM circles WHERE name = ?').get(name).id;
const slugs = (items) => items.map((i) => i.slug);

test('a circle-only item is seen and requested only through a shared circle', async () => {
  const jo = await lib.as('jo');
  const priya = await lib.as('priya');
  const bike = lib.items.bike;

  assert.ok(!slugs((await jo.get('/items')).body).includes('bike'), 'Jo is not in Riverside Neighbours yet');
  assert.equal((await jo.get(`/items/${bike}`)).status, 404);
  const refused = await jo.request(bike, day(10), day(11));
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /circles/);

  const seen = (await priya.get(`/items/${bike}`)).body;
  assert.equal(seen.audience, 'circles');
  assert.deepEqual(seen.circles.map((c) => c.name), ['Riverside Neighbours']);
  assert.equal(seen.canRequest, true);

  // Jo accepts her invitation: the bike appears, labelled with the circle, and can be requested.
  assert.equal((await jo.post(`/circles/${circleId('Riverside Neighbours')}/accept`)).status, 200);
  const now = (await jo.get('/items?circles=1')).body;
  assert.ok(slugs(now).includes('bike'));
  assert.equal((await jo.request(bike, day(10), day(11))).status, 201);
});

test('only the owner chooses the audience, and only among circles they belong to', async () => {
  const sam = await lib.as('sam');
  const maya = await lib.as('maya');
  const supper = circleId('Supper Club');
  const riverside = circleId('Riverside Neighbours');

  assert.equal((await maya.put(`/items/${lib.items.bike}/audience`, { audience: 'everyone', circleIds: [] })).status, 403);
  assert.equal((await sam.put(`/items/${lib.items.bike}/audience`, { audience: 'circles', circleIds: [supper] })).status, 403, 'Sam is not in Supper Club');
  assert.equal((await sam.put(`/items/${lib.items.bike}/audience`, { audience: 'circles', circleIds: [] })).status, 422);
  assert.equal((await sam.put(`/items/${lib.items.bike}/audience`, { audience: 'friends', circleIds: [] })).status, 422);

  const open = await sam.put(`/items/${lib.items.camera}/audience`, { audience: 'circles', circleIds: [riverside] });
  assert.equal(open.status, 200);
  assert.equal(open.body.item.audience, 'circles');
  const activity = (await maya.get(`/circles/${riverside}`)).body.activity[0];
  assert.deepEqual([activity.type, activity.actor.handle, activity.item.slug, activity.data.change], ['ItemAudienceChanged', 'sam', 'camera', 'shared']);

  // Listing a new item straight into a circle.
  const listed = await maya.post('/items', { title: 'Pasta machine', category: 'Kitchen', maxLoanDays: 5, photo: PIXEL, audience: 'circles', circleIds: [supper] });
  assert.equal(listed.status, 201);
  assert.equal(listed.body.item.audience, 'circles');
  const jo = await lib.as('jo');
  const priya = await lib.as('priya');
  assert.ok(slugs((await jo.get('/items?q=pasta')).body).length === 1, 'Jo shares Supper Club with Maya');
  assert.equal((await priya.get('/items?q=pasta')).body.length, 0, 'Priya does not');
});

test('removal refuses new circle-only requests, but a committed loan runs to the end', async () => {
  const maya = await lib.as('maya');
  const priya = await lib.as('priya');
  const sam = await lib.as('sam');
  const riverside = circleId('Riverside Neighbours');
  // Seeded: Priya is borrowing Sam's circle-only bike, ready for pickup.
  const loan = (await priya.get('/reservations')).body.find((r) => r.item.id === lib.items.bike);
  assert.equal(loan.status, 'ready');

  assert.equal((await maya.post(`/circles/${riverside}/members/p-priya/remove`)).status, 200);

  // New requests: refused, and the bike leaves her catalog.
  assert.ok(!slugs((await priya.get('/items')).body).includes('bike'));
  assert.equal((await priya.request(lib.items.bike, day(20), day(21))).status, 403);

  // Prior commitment: untouched. She can still open it and every step works.
  const item = await priya.get(`/items/${lib.items.bike}`);
  assert.equal(item.status, 200, 'people with a reservation keep seeing the item');
  assert.equal(item.body.canRequest, false);
  assert.equal((await priya.act(loan.id, 'pickup', { rating: 'good' })).status, 200);
  const ext = await priya.act(loan.id, 'extensions', { proposedEndDate: day(5) });
  assert.equal(ext.status, 201);
  assert.equal((await sam.post(`/extensions/${ext.body.reservation.pendingExtension.id}/accept`)).status, 200);
  assert.equal((await priya.act(loan.id, 'return', { rating: 'good' })).status, 200);
  const done = await sam.act(loan.id, 'confirm-return', { rating: 'good' });
  assert.equal(done.status, 200);
  assert.equal(done.body.reservation.status, 'returned');
  assert.equal(done.body.reservation.endDate, day(5));
});

test('a pending request survives removal and stays the owner’s decision', async () => {
  const maya = await lib.as('maya');
  const jo = await lib.as('jo');
  const sam = await lib.as('sam');
  const riverside = circleId('Riverside Neighbours');
  await jo.post(`/circles/${riverside}/accept`);
  const pending = await jo.request(lib.items.bike, day(10), day(12), 'For the lake loop');
  assert.equal(pending.status, 201);
  const id = pending.body.reservation.id;

  assert.equal((await maya.post(`/circles/${riverside}/members/p-jo/remove`)).status, 200);

  const asOwner = (await sam.get(`/reservations/${id}`)).body;
  assert.equal(asOwner.status, 'pending', 'removal never cancels or declines');
  assert.equal(asOwner.borrowerOutsideCircles, true, 'the owner is told, gently');
  const open = (await sam.get(`/items/${lib.items.bike}`)).body.openRequests.find((r) => r.id === id);
  assert.equal(open.outsideCircles, true);
  assert.equal((await jo.get(`/reservations/${id}`)).status, 200);
  assert.equal((await sam.act(id, 'approve')).status, 200);
});

test('when the owner leaves, their circle-only item stops taking new requests there; loans continue', async () => {
  const sam = await lib.as('sam');
  const priya = await lib.as('priya');
  const loan = (await priya.get('/reservations')).body.find((r) => r.item.id === lib.items.bike);

  assert.equal((await sam.post(`/circles/${circleId('Riverside Neighbours')}/leave`)).status, 200);
  assert.ok(!slugs((await priya.get('/items')).body).includes('bike'));
  assert.equal((await priya.request(lib.items.bike, day(20), day(21))).status, 403);
  assert.equal((await priya.act(loan.id, 'pickup', { rating: 'like-new' })).status, 200);
  assert.equal((await sam.get(`/items/${lib.items.bike}`)).body.circles.length, 1, 'the owner still sees where it was shared');
});

test('narrowing the audience keeps existing reservations for people outside the circles', async () => {
  const maya = await lib.as('maya');
  const jo = await lib.as('jo');
  const id = await loanTo(lib, { owner: 'maya', borrower: 'jo', item: 'guitar', from: day(2), to: day(4), state: 'approved' });
  const pending = await jo.request(lib.items.guitar, day(8), day(9));
  assert.equal(pending.status, 201);

  const narrowed = await maya.put(`/items/${lib.items.guitar}/audience`, { audience: 'circles', circleIds: [circleId('Riverside Neighbours')] });
  assert.equal(narrowed.status, 200);

  assert.equal((await jo.request(lib.items.guitar, day(15), day(16))).status, 403);
  const r = (await jo.get(`/reservations/${id}`)).body;
  assert.equal(r.status, 'approved');
  assert.equal((await maya.act(id, 'ready')).status, 200);
  assert.equal((await jo.act(id, 'pickup', { rating: 'good' })).status, 200);
  assert.equal((await maya.act(pending.body.reservation.id, 'approve')).status, 200, 'the earlier pending request can still be approved');
  // Busy dates from those reservations still block the calendar for circle members.
  const forPriya = (await (await lib.as('priya')).get(`/items/${lib.items.guitar}`)).body;
  assert.ok(forPriya.busy.some((b) => b.start === day(2)));
});

test('the database refuses a circle-only request without a shared circle, whatever the code path', async () => {
  const now = new Date().toISOString();
  assert.throws(
    () => lib.db.prepare(
      `INSERT INTO reservations (id, item_id, borrower_id, start_date, end_date, original_end_date, status, created_at, updated_at)
       VALUES ('x-1', ?, 'p-jo', ?, ?, ?, 'pending', ?, ?)`,
    ).run(lib.items.bike, day(30), day(31), day(31), now, now),
    /circle_only/,
  );
  // The same insert for a circle member is accepted.
  lib.db.prepare(
    `INSERT INTO reservations (id, item_id, borrower_id, start_date, end_date, original_end_date, status, created_at, updated_at)
     VALUES ('x-2', ?, 'p-maya', ?, ?, ?, 'pending', ?, ?)`,
  ).run(lib.items.bike, day(30), day(31), day(31), now, now);
});

test('removal racing a request: the request either lands before the removal and stands, or is refused', async () => {
  const maya = await lib.as('maya');
  const jo = await lib.as('jo');
  const riverside = circleId('Riverside Neighbours');
  for (let round = 0; round < 6; round++) {
    await maya.post(`/circles/${riverside}/invitations`, { personId: 'p-jo' });
    await jo.post(`/circles/${riverside}/accept`);
    const from = day(30 + round * 3);
    const [req, rem] = await Promise.all([
      jo.request(lib.items.bike, from, from),
      maya.post(`/circles/${riverside}/members/p-jo/remove`),
    ]);
    assert.equal(rem.status, 200);
    assert.ok([201, 403].includes(req.status), `round ${round}: ${req.status}`);
    const stored = lib.db.prepare("SELECT status FROM reservations WHERE item_id = ? AND borrower_id = 'p-jo' AND start_date = ?").get(lib.items.bike, from);
    if (req.status === 201) assert.equal(stored.status, 'pending', 'a request made while a member stands');
    else assert.equal(stored, undefined, 'a refused request leaves nothing behind');
  }
});
