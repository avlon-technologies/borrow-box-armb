// Verifies ::BorrowBox.CatalogAndListingTests — CatalogShowsAvailability, OnlyOwnersShapeListings,
// HiddenItemsKeepCommitments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary, loanTo, day, PIXEL } from './helpers.js';

let lib;
before(async () => { lib = await startLibrary(); });
after(() => lib.stop());

test('the catalog lists varied items with photo, owner and rules', async () => {
  const sam = await lib.as('sam');
  const items = (await sam.get('/items')).body;
  assert.ok(items.length >= 10);
  assert.ok(new Set(items.map((i) => i.category)).size >= 6);
  for (const i of items) {
    assert.ok(i.photoUrl, `${i.title} has a photo`);
    assert.ok(i.owner.name);
    assert.ok(i.lendingRules);
  }
  const photo = await fetch(lib.base + items[0].photoUrl, { headers: { cookie: (await fetch(`${lib.base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"personId":"p-sam"}' })).headers.get('set-cookie').split(';')[0] } });
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get('content-type'), /image/);
});

test('search by text, category and owner', async () => {
  const sam = await lib.as('sam');
  const tent = (await sam.get('/items?q=tent')).body;
  assert.deepEqual(tent.map((i) => i.slug), ['tent']);
  const byOwnerName = (await sam.get('/items?q=priya')).body;
  assert.deepEqual(byOwnerName.map((i) => i.slug).sort(), ['boardgame', 'books']);
  const kitchen = (await sam.get(`/items?category=${encodeURIComponent('Kitchen')}`)).body;
  assert.deepEqual(kitchen.map((i) => i.slug).sort(), ['dutch-oven', 'mixer']);
  const jo = (await sam.get('/items?owner=jo')).body;
  assert.equal(jo.length, 2);
  assert.equal((await sam.get('/items?q=zzzz-nothing')).body.length, 0);
});

test('availability: busy ranges, out-on-loan state and a free-between filter', async () => {
  const sam = await lib.as('sam');
  const camera = (await sam.get(`/items/${lib.items.camera}`)).body; // Jo has it, overdue
  assert.equal(camera.availableToday, false);
  assert.ok(camera.out);
  assert.equal(camera.out.borrowerName, 'Jo', 'the owner sees who has it');
  const priya = await lib.as('priya');
  const cameraForPriya = (await priya.get(`/items/${lib.items.camera}`)).body;
  assert.equal(cameraForPriya.out.borrowerName, undefined, 'others only see that it is out');

  const ovens = (await priya.get(`/items/${lib.items['dutch-oven']}`)).body; // approved to Maya day 7–9
  assert.deepEqual(ovens.busy.map((b) => [b.start, b.end]), [[day(7), day(9)]]);
  const free = (await priya.get(`/items?from=${day(8)}&to=${day(8)}&category=Kitchen`)).body.map((i) => i.slug);
  assert.deepEqual(free, ['mixer'], 'the ovens are not free on day 8');
});

test('pending requests do not make an item look unavailable', async () => {
  const sam = await lib.as('sam');
  const mixer = (await sam.get(`/items/${lib.items.mixer}`)).body;
  assert.equal(mixer.busy.length, 0);
  assert.equal(mixer.myRequests.length, 1, 'Sam sees his own pending request');
  const jo = await lib.as('jo');
  const mine = (await jo.get(`/items/${lib.items.mixer}`)).body;
  assert.equal(mine.openRequests.length, 2, 'the owner sees both competing requests');
});

test('owners list and edit items; validation is human', async () => {
  const priya = await lib.as('priya');
  const missing = await priya.post('/items', { title: '', category: 'Tools' });
  assert.equal(missing.status, 422);
  assert.match(missing.body.error.message, /title/);
  const noPhoto = await priya.post('/items', { title: 'Ladder', category: 'Tools', maxLoanDays: 3 });
  assert.equal(noPhoto.status, 422);
  assert.equal(noPhoto.body.error.details.field, 'photo');
  const created = await priya.post('/items', { title: 'Step ladder', category: 'Home & Garden', maxLoanDays: 3, description: 'Six steps', lendingRules: 'Fold it before carrying.', photo: PIXEL });
  assert.equal(created.status, 201);
  const edited = await priya.patch(`/items/${created.body.item.id}`, { maxLoanDays: 5, pickupArea: 'Riverside garage' });
  assert.equal(edited.body.item.maxLoanDays, 5);
  assert.equal(edited.body.item.pickupArea, 'Riverside garage');
  assert.equal(edited.body.item.title, 'Step ladder', 'unchanged fields stay');
  assert.equal((await priya.patch(`/items/${created.body.item.id}`, { maxLoanDays: 0 })).status, 422);
});

test('hiding an item refuses new requests but keeps existing reservations', async () => {
  const k = await loanTo(lib, { owner: 'maya', borrower: 'sam', item: 'guitar', from: day(4), to: day(5), state: 'approved' });
  const pendingId = await loanTo(lib, { owner: 'maya', borrower: 'priya', item: 'guitar', from: day(20), to: day(21), state: 'pending' });
  const maya = await lib.as('maya');
  const hidden = await maya.post(`/items/${lib.items.guitar}/visibility`, { hidden: true });
  assert.equal(hidden.body.item.hidden, true);

  const jo = await lib.as('jo');
  const refused = await jo.request(lib.items.guitar, day(9), day(10));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'item_hidden');
  assert.ok(!(await jo.get('/items')).body.some((i) => i.slug === 'guitar'), 'others no longer see it');
  assert.equal((await jo.get(`/items/${lib.items.guitar}`)).status, 404);

  const sam = await lib.as('sam');
  const kept = (await sam.get(`/reservations/${k}`)).body;
  assert.equal(kept.status, 'approved', 'existing reservation untouched');
  assert.equal((await sam.get(`/items/${lib.items.guitar}`)).status, 200, 'its borrower can still open the item');
  assert.ok((await maya.get('/items?mine=1')).body.some((i) => i.slug === 'guitar' && i.hidden), 'owner still sees it on their shelf');

  // The loan can carry on, and the existing pending request can still be decided.
  assert.equal((await maya.act(k, 'ready')).status, 200);
  assert.equal((await maya.act(pendingId, 'approve')).status, 200);

  await maya.post(`/items/${lib.items.guitar}/visibility`, { hidden: false });
  assert.equal((await jo.request(lib.items.guitar, day(9), day(10))).status, 201, 'shown again, requests welcome');
});
