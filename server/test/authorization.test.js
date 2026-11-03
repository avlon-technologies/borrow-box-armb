// Verifies ::BorrowBox.AuthorizationTests — EveryActionAuthorizedOnServer, NoSelfBorrowing,
// OnlyOwnersShapeListings: every command refused for the wrong person, and for no identity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day, PIXEL } from './helpers.js';

let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

test('no identity: reads and writes are refused with 401', async () => {
  for (const [method, path] of [['get', '/items'], ['get', '/reservations'], ['post', `/items/${lib.items.tent}/requests`], ['post', '/items']]) {
    const res = await lib.anonymous[method](path, method === 'post' ? {} : undefined);
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.body.error.code, 'not_signed_in');
  }
});

test('a forged session cookie is not an identity', async () => {
  const res = await fetch(`${lib.base}/api/reservations`, { headers: { cookie: 'bb_session=p-maya.forged' } });
  assert.equal(res.status, 401);
});

test('an owner cannot request to borrow their own item', async () => {
  const maya = await lib.as('maya');
  const res = await maya.request(lib.items.tent, day(20), day(21));
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /your own item/);
  const count = lib.db.prepare("SELECT count(*) n FROM reservations WHERE item_id = ? AND borrower_id = 'p-maya'").get(lib.items.tent).n;
  assert.equal(count, 0);
});

test('the database itself refuses a self-borrow even if code forgot to check', () => {
  assert.throws(() => lib.db.prepare(
    "INSERT INTO reservations (id, item_id, borrower_id, start_date, end_date, original_end_date, status, created_at, updated_at) VALUES ('x', ?, 'p-maya', '2026-07-01', '2026-07-02', '2026-07-02', 'pending', 'now', 'now')",
  ).run(lib.items.tent), /self_borrow/);
});

test('only the owner may approve, decline, mark ready or confirm return', async () => {
  const sam = await lib.as('sam');
  const jo = await lib.as('jo');
  const r = await sam.request(lib.items.tent, day(40), day(41));
  const id = r.body.reservation.id;
  for (const act of ['approve', 'decline', 'ready', 'confirm-return']) {
    for (const who of [sam, jo]) {
      const res = await who.act(id, act, { rating: 'good' });
      assert.equal(res.status, 403, `${act}`);
    }
  }
  const status = lib.db.prepare('SELECT status FROM reservations WHERE id = ?').get(id).status;
  assert.equal(status, 'pending');
});

test('only the borrower may cancel, confirm pickup, start a return or ask for more time', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'guitar', from: day(1), to: day(3), state: 'ready' });
  const maya = await lib.as('maya');
  const jo = await lib.as('jo');
  for (const who of [maya, jo]) {
    assert.equal((await who.act(id, 'cancel')).status, 403);
    assert.equal((await who.act(id, 'pickup', { rating: 'good' })).status, 403);
    assert.equal((await who.act(id, 'extensions', { proposedEndDate: day(5) })).status, 403);
  }
  const sam = await lib.as('sam');
  assert.equal((await sam.act(id, 'pickup', { rating: 'good' })).status, 200);
  for (const who of [maya, jo]) assert.equal((await who.act(id, 'return', { rating: 'good' })).status, 403);
});

test('only the owner may accept or decline more time', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'jo', item: 'drill', from: day(0), to: day(1), state: 'borrowed' });
  const jo = await lib.as('jo');
  const ext = (await jo.act(id, 'extensions', { proposedEndDate: day(2) })).body.reservation.pendingExtension;
  const sam = await lib.as('sam');
  for (const who of [jo, sam]) {
    assert.equal((await who.post(`/extensions/${ext.id}/accept`)).status, 403);
    assert.equal((await who.post(`/extensions/${ext.id}/decline`)).status, 403);
  }
});

test('outsiders can neither see nor annotate a loan', async () => {
  const id = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'projector', from: day(20), to: day(22), state: 'ready' });
  const priya = await lib.as('priya');
  assert.equal((await priya.get(`/reservations/${id}`)).status, 404);
  assert.equal((await priya.act(id, 'notes', { note: 'hi' })).status, 403);
});

test('only the owner may edit or hide an item', async () => {
  const sam = await lib.as('sam');
  assert.equal((await sam.patch(`/items/${lib.items.tent}`, { title: 'Mine now' })).status, 403);
  assert.equal((await sam.post(`/items/${lib.items.tent}/visibility`, { hidden: true })).status, 403);
  const maya = await lib.as('maya');
  const ok = await maya.patch(`/items/${lib.items.tent}`, { title: 'Four-person dome tent (with footprint)' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.item.title, 'Four-person dome tent (with footprint)');
});

test('a new listing always belongs to the person who listed it', async () => {
  const jo = await lib.as('jo');
  const res = await jo.post('/items', { title: 'Picnic blanket', category: 'Outdoors', maxLoanDays: 5, photo: PIXEL, ownerId: 'p-maya' });
  assert.equal(res.status, 201);
  assert.equal(res.body.item.owner.id, 'p-jo');
});
