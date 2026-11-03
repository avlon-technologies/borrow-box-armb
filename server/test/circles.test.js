// Verifies ::BorrowBox.CircleMembershipTests — CirclesGrowByInvitation, CircleService.
// Rules: OnlyMembersInvite, OrganiserStaysMember.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startLibrary } from './helpers.js';

let lib;
beforeEach(async () => { lib = await startLibrary(); });
afterEach(() => lib.stop());

const circleNamed = async (who, name) => {
  const { circles, invitations } = (await who.get('/circles')).body;
  return [...circles, ...invitations].find((c) => c.name === name);
};

test('the demo seed has circles, members and an open invitation', async () => {
  const maya = await lib.as('maya');
  const mine = (await maya.get('/circles')).body;
  assert.deepEqual(mine.circles.map((c) => c.name), ['Riverside Neighbours', 'Supper Club']);
  const riverside = mine.circles.find((c) => c.name === 'Riverside Neighbours');
  assert.equal(riverside.isOrganiser, true);
  assert.equal(riverside.memberCount, 3);

  const jo = await lib.as('jo');
  const joCircles = (await jo.get('/circles')).body;
  assert.deepEqual(joCircles.invitations.map((c) => c.name), ['Riverside Neighbours']);
  assert.equal(joCircles.invitations[0].invitedBy.handle, 'sam');
});

test('anyone can start a circle and becomes its organiser and first member', async () => {
  const jo = await lib.as('jo');
  const res = await jo.post('/circles', { name: '  Old Mill Gardeners ', description: 'Seeds, shears and wheelbarrows.' });
  assert.equal(res.status, 201);
  assert.equal(res.body.circle.name, 'Old Mill Gardeners');
  assert.equal(res.body.circle.isOrganiser, true);
  assert.equal(res.body.circle.myStanding, 'active');
  assert.deepEqual(res.body.circle.members.map((m) => [m.person.handle, m.standing, m.isOrganiser]), [['jo', 'active', true]]);
  assert.equal(res.body.circle.activity[0].type, 'CircleCreated');

  assert.equal((await jo.post('/circles', { name: '   ' })).status, 422);
  assert.equal((await lib.anonymous.post('/circles', { name: 'Nobody' })).status, 401);
});

test('only current members invite, and nobody is invited twice', async () => {
  const maya = await lib.as('maya');
  const jo = await lib.as('jo');
  const priya = await lib.as('priya');
  const supper = await circleNamed(jo, 'Supper Club');

  // Priya is not in Supper Club, so she cannot invite anyone into it.
  assert.equal((await priya.post(`/circles/${supper.id}/invitations`, { personId: 'p-sam' })).status, 403);
  // Maya is a member (not the organiser) and may invite.
  const invited = await maya.post(`/circles/${supper.id}/invitations`, { personId: 'p-priya' });
  assert.equal(invited.status, 200);
  assert.ok(invited.body.circle.members.some((m) => m.person.handle === 'priya' && m.standing === 'invited'));
  const again = await jo.post(`/circles/${supper.id}/invitations`, { personId: 'p-priya' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'already_invited');
  const member = await jo.post(`/circles/${supper.id}/invitations`, { personId: 'p-maya' });
  assert.equal(member.status, 409);
  assert.equal(member.body.error.code, 'already_member');
  assert.equal((await jo.post(`/circles/${supper.id}/invitations`, { personId: 'p-nobody' })).status, 404);
});

test('only the invited person accepts or declines, and a declined person can be invited again', async () => {
  const jo = await lib.as('jo');
  const priya = await lib.as('priya');
  const sam = await lib.as('sam');
  const riverside = await circleNamed(jo, 'Riverside Neighbours');

  // Priya is already active there; she has no invitation to accept.
  const notHers = await priya.post(`/circles/${riverside.id}/accept`);
  assert.equal(notHers.status, 409);
  assert.equal(notHers.body.error.code, 'no_invitation');

  // An invitee can see who is inside before deciding, but not what they share.
  const preview = (await jo.get(`/circles/${riverside.id}`)).body;
  assert.equal(preview.myStanding, 'invited');
  assert.equal(preview.items, undefined);

  assert.equal((await jo.post(`/circles/${riverside.id}/decline`)).status, 200);
  assert.equal((await jo.post(`/circles/${riverside.id}/decline`)).status, 409, 'deciding twice is refused');
  assert.equal((await jo.get(`/circles/${riverside.id}`)).status, 404, 'a declined invitation no longer opens the circle');

  assert.equal((await sam.post(`/circles/${riverside.id}/invitations`, { personId: 'p-jo' })).status, 200);
  const joined = await jo.post(`/circles/${riverside.id}/accept`);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.circle.myStanding, 'active');
  assert.ok(Array.isArray(joined.body.circle.items), 'members see what the circle shares');
});

test('members may leave; the organiser stays', async () => {
  const maya = await lib.as('maya');
  const priya = await lib.as('priya');
  const riverside = await circleNamed(maya, 'Riverside Neighbours');

  const organiserLeaves = await maya.post(`/circles/${riverside.id}/leave`);
  assert.equal(organiserLeaves.status, 409);
  assert.equal(organiserLeaves.body.error.code, 'organiser_stays');

  assert.equal((await priya.post(`/circles/${riverside.id}/leave`)).status, 200);
  assert.equal((await priya.post(`/circles/${riverside.id}/leave`)).status, 409);
  assert.equal((await priya.get(`/circles/${riverside.id}`)).status, 404);
  const after = (await maya.get(`/circles/${riverside.id}`)).body;
  assert.ok(!after.members.some((m) => m.person.handle === 'priya'));
  assert.equal(after.activity[0].type, 'MemberLeft');
  assert.equal(after.activity[0].actor.handle, 'priya');
});

test('only the organiser removes, never themselves, and only current members', async () => {
  const maya = await lib.as('maya');
  const sam = await lib.as('sam');
  const riverside = await circleNamed(maya, 'Riverside Neighbours');

  assert.equal((await sam.post(`/circles/${riverside.id}/members/p-priya/remove`)).status, 403);
  const self = await maya.post(`/circles/${riverside.id}/members/p-maya/remove`);
  assert.equal(self.status, 409);
  assert.equal(self.body.error.code, 'organiser_stays');
  // Jo is only invited, not a member.
  assert.equal((await maya.post(`/circles/${riverside.id}/members/p-jo/remove`)).status, 409);

  const removed = await maya.post(`/circles/${riverside.id}/members/p-priya/remove`);
  assert.equal(removed.status, 200);
  assert.ok(!removed.body.circle.members.some((m) => m.person.handle === 'priya'));
  const event = removed.body.circle.activity[0];
  assert.deepEqual([event.type, event.actor.handle, event.subject.handle], ['MemberRemoved', 'maya', 'priya']);
});

test('the database keeps the organiser and every membership record', async () => {
  const circle = lib.db.prepare("SELECT * FROM circles WHERE name = 'Riverside Neighbours'").get();
  assert.throws(
    () => lib.db.prepare("UPDATE memberships SET standing = 'left' WHERE circle_id = ? AND person_id = ?").run(circle.id, circle.organiser_id),
    /organiser_stays/,
  );
  assert.throws(() => lib.db.prepare('DELETE FROM memberships WHERE circle_id = ?').run(circle.id), /membership_history_kept/);
  assert.throws(() => lib.db.prepare('DELETE FROM circle_events WHERE circle_id = ?').run(circle.id), /journal_append_only/);
});

test('a repeated circle creation with the same Idempotency-Key has one effect', async () => {
  const sam = await lib.as('sam');
  const headers = { 'Idempotency-Key': 'circle-once-1' };
  const a = await sam.post('/circles', { name: 'Photo walkers' }, headers);
  const b = await sam.post('/circles', { name: 'Photo walkers' }, headers);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(a.body.circle.id, b.body.circle.id);
  assert.equal(lib.db.prepare("SELECT count(*) AS n FROM circles WHERE name = 'Photo walkers'").get().n, 1);
});
