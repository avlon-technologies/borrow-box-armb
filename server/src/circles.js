// CircleService (model: ::BorrowBox.Lending.Library.CircleService).
// Forms circles and carries invitations and memberships through their lifecycle. It never
// touches a reservation: leaving or removal only changes who can make NEW circle-only requests
// (MembershipChangesKeepCommitments). Every command runs inside the caller's transaction.
import { randomUUID } from 'node:crypto';
import { isConstraint } from './db.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import { personView } from './people.js';
import { photoUrl } from './photos.js';

const NAME_MAX = 60;
const ABOUT_MAX = 400;

function text(value, field, { required = false, max }) {
  if (value == null || value === '') {
    if (required) throw invalid(`Please give the circle a ${field}.`, { field });
    return '';
  }
  if (typeof value !== 'string') throw invalid(`The ${field} should be text.`, { field });
  const t = value.trim();
  if (required && !t) throw invalid(`Please give the circle a ${field}.`, { field });
  if (t.length > max) throw invalid(`The ${field} is a little long (${max} characters at most).`, { field });
  return t;
}

function loadCircle(db, id) {
  const c = db.prepare('SELECT * FROM circles WHERE id = ?').get(id);
  if (!c) throw notFound('That circle');
  return c;
}

export function standingOf(db, circleId, personId) {
  return db.prepare('SELECT standing FROM memberships WHERE circle_id = ? AND person_id = ?').get(circleId, personId)?.standing ?? null;
}

/** Ids of the circles the person is an active member of. */
export function activeCircleIds(db, personId) {
  return db.prepare("SELECT circle_id FROM memberships WHERE person_id = ? AND standing = 'active'").all(personId).map((r) => r.circle_id);
}

/** Appends to the circle's own activity (read-model CircleActivity). */
export function recordCircleEvent(ctx, circleId, type, actorId, { subjectId = null, itemId = null, data = {} } = {}) {
  ctx.db.prepare('INSERT INTO circle_events (circle_id, type, actor_id, subject_id, item_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(circleId, type, actorId, subjectId, itemId, JSON.stringify(data), ctx.now().toISOString());
}

function setStanding(ctx, circleId, personId, standing) {
  try {
    ctx.db.prepare('UPDATE memberships SET standing = ?, updated_at = ? WHERE circle_id = ? AND person_id = ?')
      .run(standing, ctx.now().toISOString(), circleId, personId);
  } catch (err) {
    if (isConstraint(err, 'organiser_stays')) throw conflict('organiser_stays', "The organiser looks after the circle, so they stay in it.");
    throw err;
  }
}

// ---------------------------------------------------------------- commands

// CreateCircle — admits Member. The creator is the organiser and its first active member.
export function createCircle(ctx, viewer, input = {}) {
  const name = text(input.name, 'name', { required: true, max: NAME_MAX });
  const description = text(input.description, 'description', { max: ABOUT_MAX });
  const id = randomUUID();
  const now = ctx.now().toISOString();
  ctx.db.prepare('INSERT INTO circles (id, name, description, organiser_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, description, viewer.id, now);
  ctx.db.prepare("INSERT INTO memberships (circle_id, person_id, standing, invited_by, created_at, updated_at) VALUES (?, ?, 'active', NULL, ?, ?)").run(id, viewer.id, now, now);
  recordCircleEvent(ctx, id, 'CircleCreated', viewer.id, { data: { name } });
  return id;
}

// InviteToCircle — admits Member, requires CircleMembership (OnlyMembersInvite).
export function inviteToCircle(ctx, viewer, circleId, input = {}) {
  const { db } = ctx;
  const circle = loadCircle(db, circleId);
  if (standingOf(db, circle.id, viewer.id) !== 'active') throw forbidden('Only people in this circle can invite others.');
  const invitee = db.prepare('SELECT * FROM people WHERE id = ? OR handle = ?').get(input.personId, input.personId);
  if (!invitee) throw notFound('That person');
  const current = standingOf(db, circle.id, invitee.id);
  if (current === 'active') throw conflict('already_member', `${invitee.name.split(' ')[0]} is already in this circle.`);
  if (current === 'invited') throw conflict('already_invited', `${invitee.name.split(' ')[0]} has already been invited.`);
  const now = ctx.now().toISOString();
  if (current) {
    db.prepare("UPDATE memberships SET standing = 'invited', invited_by = ?, updated_at = ? WHERE circle_id = ? AND person_id = ?").run(viewer.id, now, circle.id, invitee.id);
  } else {
    db.prepare("INSERT INTO memberships (circle_id, person_id, standing, invited_by, created_at, updated_at) VALUES (?, ?, 'invited', ?, ?, ?)").run(circle.id, invitee.id, viewer.id, now, now);
  }
  recordCircleEvent(ctx, circle.id, 'MemberInvited', viewer.id, { subjectId: invitee.id });
  return circle.id;
}

function requireInvitation(db, circle, viewer) {
  if (standingOf(db, circle.id, viewer.id) !== 'invited') throw conflict('no_invitation', "There's no open invitation to this circle for you.");
}

// AcceptInvitation — admits Member, requires OpenInvitation.
export function acceptInvitation(ctx, viewer, circleId) {
  const circle = loadCircle(ctx.db, circleId);
  requireInvitation(ctx.db, circle, viewer);
  setStanding(ctx, circle.id, viewer.id, 'active');
  recordCircleEvent(ctx, circle.id, 'InvitationAccepted', viewer.id, { subjectId: viewer.id });
  return circle.id;
}

// DeclineInvitation — admits Member, requires OpenInvitation.
export function declineInvitation(ctx, viewer, circleId) {
  const circle = loadCircle(ctx.db, circleId);
  requireInvitation(ctx.db, circle, viewer);
  setStanding(ctx, circle.id, viewer.id, 'declined');
  recordCircleEvent(ctx, circle.id, 'InvitationDeclined', viewer.id, { subjectId: viewer.id });
  return circle.id;
}

// LeaveCircle — admits Member, requires CircleMembership. Reservations are untouched.
export function leaveCircle(ctx, viewer, circleId) {
  const circle = loadCircle(ctx.db, circleId);
  if (standingOf(ctx.db, circle.id, viewer.id) !== 'active') throw conflict('not_member', "You're not in this circle.");
  if (circle.organiser_id === viewer.id) throw conflict('organiser_stays', "As the organiser you look after this circle, so you can't leave it.");
  setStanding(ctx, circle.id, viewer.id, 'left');
  recordCircleEvent(ctx, circle.id, 'MemberLeft', viewer.id, { subjectId: viewer.id });
  return circle.id;
}

// RemoveMember — admits Member, requires CircleOrganisership. Reservations are untouched.
export function removeMember(ctx, viewer, circleId, memberId) {
  const { db } = ctx;
  const circle = loadCircle(db, circleId);
  if (circle.organiser_id !== viewer.id) throw forbidden('Only the organiser can remove people from a circle.');
  if (memberId === viewer.id) throw conflict('organiser_stays', "As the organiser you look after this circle, so you can't remove yourself.");
  if (standingOf(db, circle.id, memberId) !== 'active') throw conflict('not_member', "That person isn't in this circle.");
  setStanding(ctx, circle.id, memberId, 'removed');
  recordCircleEvent(ctx, circle.id, 'MemberRemoved', viewer.id, { subjectId: memberId });
  return circle.id;
}

// ---------------------------------------------------------------- views

function circleSummary(db, c, viewer) {
  const counts = db.prepare(
    `SELECT
       (SELECT count(*) FROM memberships WHERE circle_id = ? AND standing = 'active') AS members,
       (SELECT count(*) FROM item_circles ic JOIN items i ON i.id = ic.item_id
          JOIN memberships mo ON mo.circle_id = ic.circle_id AND mo.person_id = i.owner_id AND mo.standing = 'active'
        WHERE ic.circle_id = ? AND i.hidden = 0) AS items`,
  ).get(c.id, c.id);
  const organiser = personView(db.prepare('SELECT * FROM people WHERE id = ?').get(c.organiser_id));
  const faces = db.prepare(
    `SELECT p.* FROM memberships m JOIN people p ON p.id = m.person_id WHERE m.circle_id = ? AND m.standing = 'active' ORDER BY m.created_at LIMIT 5`,
  ).all(c.id).map(personView);
  const myStanding = standingOf(db, c.id, viewer.id);
  const invitedBy = myStanding === 'invited'
    ? personView(db.prepare('SELECT p.* FROM memberships m JOIN people p ON p.id = m.invited_by WHERE m.circle_id = ? AND m.person_id = ?').get(c.id, viewer.id))
    : null;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    organiser,
    isOrganiser: c.organiser_id === viewer.id,
    myStanding,
    invitedBy,
    memberCount: counts.members,
    itemCount: counts.items,
    faces,
    createdAt: c.created_at,
  };
}

/** The viewer's circles and open invitations. */
export function listCircles(ctx, viewer) {
  const rows = ctx.db.prepare(
    `SELECT c.* FROM circles c JOIN memberships m ON m.circle_id = c.id
     WHERE m.person_id = ? AND m.standing IN ('active', 'invited') ORDER BY m.standing = 'invited' DESC, c.name`,
  ).all(viewer.id);
  const all = rows.map((c) => circleSummary(ctx.db, c, viewer));
  return { circles: all.filter((c) => c.myStanding === 'active'), invitations: all.filter((c) => c.myStanding === 'invited') };
}

/** One circle: visible to its active members and to people invited to it. */
export function getCircle(ctx, viewer, circleId) {
  const { db } = ctx;
  const c = db.prepare('SELECT * FROM circles WHERE id = ?').get(circleId);
  const standing = c ? standingOf(db, c.id, viewer.id) : null;
  if (!c || (standing !== 'active' && standing !== 'invited')) throw notFound('That circle');
  const view = circleSummary(db, c, viewer);
  const people = new Map();
  const person = (id) => {
    if (!id) return null;
    if (!people.has(id)) people.set(id, personView(db.prepare('SELECT * FROM people WHERE id = ?').get(id)));
    return people.get(id);
  };
  view.members = db.prepare(
    `SELECT m.person_id, m.standing, m.updated_at FROM memberships m WHERE m.circle_id = ? AND m.standing IN ('active', 'invited')
     ORDER BY m.standing = 'invited', m.created_at`,
  ).all(c.id).map((m) => ({ person: person(m.person_id), standing: m.standing, isOrganiser: m.person_id === c.organiser_id, since: m.updated_at }));
  if (standing !== 'active') return view; // an invitation shows who is inside, not what they share

  view.items = db.prepare(
    `SELECT i.* FROM item_circles ic JOIN items i ON i.id = ic.item_id
     JOIN memberships mo ON mo.circle_id = ic.circle_id AND mo.person_id = i.owner_id AND mo.standing = 'active'
     WHERE ic.circle_id = ? AND (i.hidden = 0 OR i.owner_id = ?) ORDER BY ic.created_at DESC`,
  ).all(c.id, viewer.id).map((i) => ({
    id: i.id, slug: i.slug, title: i.title, category: i.category, photoUrl: photoUrl(i.photo), owner: person(i.owner_id), audience: i.audience, hidden: !!i.hidden,
  }));
  view.activity = db.prepare('SELECT * FROM circle_events WHERE circle_id = ? ORDER BY seq DESC LIMIT 40').all(c.id).map((e) => {
    const item = e.item_id ? db.prepare('SELECT id, slug, title FROM items WHERE id = ?').get(e.item_id) : null;
    return { seq: e.seq, type: e.type, actor: person(e.actor_id), subject: person(e.subject_id), item, data: JSON.parse(e.data), at: e.created_at };
  });
  // People who could be invited: everyone not currently active or invited.
  view.invitable = db.prepare(
    `SELECT p.* FROM people p WHERE NOT EXISTS (
       SELECT 1 FROM memberships m WHERE m.circle_id = ? AND m.person_id = p.id AND m.standing IN ('active', 'invited'))
     ORDER BY p.name`,
  ).all(c.id).map(personView);
  return view;
}
