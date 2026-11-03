// BorrowingService (model: ::BorrowBox.Lending.Library.BorrowingService).
// Decides requests, carries each loan through handoff and return, records condition evidence
// and extensions, and journals every accepted act as the event the model names.
// Every command function runs inside the caller's IMMEDIATE transaction.
import { randomUUID } from 'node:crypto';
import { COMMITTED, isConstraint } from './db.js';
import { addDays, daysInclusive, isIsoDate } from './dates.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import { personView } from './people.js';
import { photoUrl, savePhotos } from './photos.js';

const committedSql = COMMITTED.map((s) => `'${s}'`).join(', ');
const RATINGS = ['like-new', 'good', 'worn', 'damaged'];
const OPEN_FOR_EXTENSION = ['approved', 'ready', 'borrowed'];
const NOTE_MAX = 1000;

// ---------------------------------------------------------------- helpers

function note(value, field = 'note') {
  if (value == null) return '';
  if (typeof value !== 'string') throw invalid(`The ${field} should be text.`);
  const t = value.trim();
  if (t.length > NOTE_MAX) throw invalid(`The ${field} is a little long (${NOTE_MAX} characters at most).`);
  return t;
}

function loadReservation(db, id) {
  const r = db.prepare(
    `SELECT r.*, i.owner_id, i.title AS item_title, i.hidden AS item_hidden, i.max_loan_days
     FROM reservations r JOIN items i ON i.id = r.item_id WHERE r.id = ?`,
  ).get(id);
  if (!r) throw notFound('That request');
  return r;
}

function roleOf(r, viewer) {
  if (r.owner_id === viewer.id) return 'owner';
  if (r.borrower_id === viewer.id) return 'borrower';
  return null;
}

/** ItemOwnership evidence: the acting person owns the reservation's item. */
function requireOwner(r, viewer, what) {
  if (r.owner_id !== viewer.id) throw forbidden(`Only the item's owner can ${what}.`);
}

/** Borrowership evidence: the acting person is the reservation's borrower. */
function requireBorrower(r, viewer, what) {
  if (r.borrower_id !== viewer.id) throw forbidden(`Only the person borrowing can ${what}.`);
}

function requireStatus(r, allowed, message) {
  if (!allowed.includes(r.status)) throw conflict('invalid_transition', message, { status: r.status });
}

function journal(ctx, type, actorId, { reservationId = null, itemId = null, data = {} } = {}) {
  ctx.db.prepare('INSERT INTO events (type, reservation_id, item_id, actor_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, reservationId, itemId, actorId, JSON.stringify(data), ctx.now().toISOString());
}

function setStatus(ctx, r, status, extra = {}) {
  const sets = ['status = ?', 'updated_at = ?'];
  const values = [status, ctx.now().toISOString()];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  try {
    ctx.db.prepare(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`).run(...values, r.id);
  } catch (err) {
    if (isConstraint(err, 'reservation_overlap')) throw datesTaken();
    throw err;
  }
}

const datesTaken = () => conflict('dates_taken', 'Those dates are already promised to someone else.');

/** Committed reservations of the same item overlapping [start, end], other than `exceptId`. */
function committedOverlaps(db, itemId, start, end, exceptId) {
  return db.prepare(
    `SELECT r.id, r.start_date, r.end_date, r.status, p.name AS borrower_name FROM reservations r
     JOIN people p ON p.id = r.borrower_id
     WHERE r.item_id = ? AND r.id <> ? AND r.status IN (${committedSql}) AND r.start_date <= ? AND ? <= r.end_date
     ORDER BY r.start_date`,
  ).all(itemId, exceptId ?? '', end, start);
}

function recordCondition(ctx, r, viewer, phase, input, { requireRating }) {
  const rating = input?.rating ?? null;
  if (requireRating && !RATINGS.includes(rating)) throw invalid('How does it look? Pick one of the condition options.', { field: 'rating' });
  if (rating != null && !RATINGS.includes(rating)) throw invalid('Unknown condition option.', { field: 'rating' });
  const text = note(input?.note);
  const disagrees = input?.disagrees === true;
  const photos = savePhotos(ctx.uploadsDir, input?.photos);
  if (phase === 'followup' && !text && photos.length === 0) throw invalid('Add a few words or a photo.', { field: 'note' });
  const id = randomUUID();
  const role = roleOf(r, viewer);
  ctx.db.prepare(
    `INSERT INTO condition_notes (id, reservation_id, author_id, role, phase, rating, note, photos, disagrees, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.id, viewer.id, role, phase, rating, text, JSON.stringify(photos), disagrees ? 1 : 0, ctx.now().toISOString());
  journal(ctx, 'ConditionRecorded', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { evidenceId: id, phase, role, rating, disagrees } });
  if (disagrees && !r.disputed) ctx.db.prepare('UPDATE reservations SET disputed = 1 WHERE id = ?').run(r.id);
  return id;
}

// ---------------------------------------------------------------- commands

// RequestToBorrow — admits Borrower, requires NonOwnership for itemId.
export function requestToBorrow(ctx, viewer, itemId, input = {}) {
  const { db } = ctx;
  const item = db.prepare('SELECT * FROM items WHERE id = ? OR slug = ?').get(itemId, itemId);
  if (!item) throw notFound('That item');
  if (item.owner_id === viewer.id) throw forbidden("This is your own item — you can't borrow it from yourself.");
  if (item.hidden) throw conflict('item_hidden', "This item isn't taking new requests right now.");

  const { startDate, endDate } = input;
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw invalid('Please choose a start and a return date.', { field: 'dates' });
  if (endDate < startDate) throw invalid('The return date needs to be on or after the start date.', { field: 'dates' });
  const today = ctx.today();
  if (startDate < today) throw invalid("The start date can't be in the past.", { field: 'dates' });
  if (startDate > addDays(today, 365)) throw invalid('Requests can be at most a year ahead.', { field: 'dates' });
  const length = daysInclusive(startDate, endDate);
  if (length > item.max_loan_days) {
    throw invalid(`${item.title} can be borrowed for up to ${item.max_loan_days} day${item.max_loan_days === 1 ? '' : 's'} at a time.`, { field: 'dates' });
  }
  const text = note(input.note);

  // A borrower asking again for exactly the same dates is a repeat, not a second request.
  const duplicate = db.prepare(
    `SELECT id FROM reservations WHERE item_id = ? AND borrower_id = ? AND start_date = ? AND end_date = ? AND status IN ('pending', ${committedSql})`,
  ).get(item.id, viewer.id, startDate, endDate);
  if (duplicate) throw conflict('duplicate_request', "You've already asked for these dates.", { reservationId: duplicate.id });

  // Pending requests may overlap freely; only committed dates are refused up front.
  if (committedOverlaps(db, item.id, startDate, endDate).length) throw datesTaken();

  const id = randomUUID();
  const now = ctx.now().toISOString();
  try {
    db.prepare(
      `INSERT INTO reservations (id, item_id, borrower_id, start_date, end_date, original_end_date, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(id, item.id, viewer.id, startDate, endDate, endDate, text, now, now);
  } catch (err) {
    if (isConstraint(err, 'self_borrow')) throw forbidden("This is your own item — you can't borrow it from yourself.");
    throw err;
  }
  journal(ctx, 'RequestSubmitted', viewer.id, { reservationId: id, itemId: item.id, data: { startDate, endDate, note: text } });
  return id;
}

// ApproveRequest — admits Owner, requires ItemOwnership. The overlap check and the commit are
// one act: we hold the write lock (BEGIN IMMEDIATE) and the database trigger refuses any overlap.
export function approveRequest(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireOwner(r, viewer, 'approve requests');
  requireStatus(r, ['pending'], r.status === 'approved' ? 'This request is already approved.' : 'Only a pending request can be approved.');
  if (r.end_date < ctx.today()) throw conflict('request_expired', 'These dates have already passed — decline it instead.');
  const overlaps = committedOverlaps(ctx.db, r.item_id, r.start_date, r.end_date, r.id);
  if (overlaps.length) throw datesTaken();
  setStatus(ctx, r, 'approved', { response_note: note(input.note, 'message') });
  journal(ctx, 'RequestApproved', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { note: note(input.note) } });
  return r.id;
}

// DeclineRequest — admits Owner, requires ItemOwnership.
export function declineRequest(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireOwner(r, viewer, 'decline requests');
  requireStatus(r, ['pending'], 'Only a pending request can be declined.');
  const text = note(input.note, 'message');
  setStatus(ctx, r, 'declined', { response_note: text });
  journal(ctx, 'RequestDeclined', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { note: text } });
  return r.id;
}

// CancelRequest — admits Borrower, requires Borrowership. Allowed until pickup.
export function cancelRequest(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireBorrower(r, viewer, 'cancel this request');
  requireStatus(r, ['pending', 'approved', 'ready'], r.status === 'cancelled' ? 'This request is already cancelled.' : "Once you've picked it up, start a return instead.");
  setStatus(ctx, r, 'cancelled');
  ctx.db.prepare("UPDATE extensions SET status = 'withdrawn', decided_at = ? WHERE reservation_id = ? AND status = 'proposed'").run(ctx.now().toISOString(), r.id);
  journal(ctx, 'RequestCancelled', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { from: r.status, note: note(input.note) } });
  return r.id;
}

// MarkReady — admits Owner, requires ItemOwnership.
export function markReady(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireOwner(r, viewer, 'mark it ready');
  requireStatus(r, ['approved'], r.status === 'pending' ? 'Approve the request first.' : 'This is already past the ready step.');
  const text = note(input.note, 'pickup note');
  setStatus(ctx, r, 'ready');
  journal(ctx, 'ItemReadied', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { note: text } });
  return r.id;
}

// ConfirmPickup — admits Borrower; always records the borrower's account of condition.
export function confirmPickup(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireBorrower(r, viewer, 'confirm pickup');
  requireStatus(r, ['ready'], r.status === 'approved' ? "Wait until the owner says it's ready." : 'Pickup has already been confirmed.');
  setStatus(ctx, r, 'borrowed');
  journal(ctx, 'PickupConfirmed', viewer.id, { reservationId: r.id, itemId: r.item_id });
  recordCondition(ctx, r, viewer, 'handoff', input, { requireRating: true });
  return r.id;
}

// StartReturn — admits Borrower. Overdue loans return exactly like on-time ones.
export function startReturn(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireBorrower(r, viewer, 'start the return');
  requireStatus(r, ['borrowed'], r.status === 'returning' ? 'The return has already been started.' : "You can start a return once you've picked it up.");
  const late = r.end_date < ctx.today();
  setStatus(ctx, r, 'returning');
  journal(ctx, 'ReturnStarted', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { late, daysLate: late ? daysInclusive(r.end_date, ctx.today()) - 1 : 0 } });
  recordCondition(ctx, r, viewer, 'return', input, { requireRating: true });
  return r.id;
}

// ConfirmReturn — admits Owner. The owner's account is added beside the borrower's, never over it.
export function confirmReturn(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  requireOwner(r, viewer, 'confirm the return');
  requireStatus(r, ['returning'], r.status === 'borrowed' ? 'The borrower needs to start the return first.' : 'This return is already confirmed.');
  if (input.disagrees === true && !note(input.note)) throw invalid("Say what's different, so you both remember.", { field: 'note' });
  setStatus(ctx, r, 'returned');
  journal(ctx, 'ReturnConfirmed', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { disagrees: input.disagrees === true } });
  recordCondition(ctx, r, viewer, 'return', input, { requireRating: true });
  return r.id;
}

// AddConditionNote — admits Owner or Borrower of this reservation.
export function addConditionNote(ctx, viewer, reservationId, input = {}) {
  const r = loadReservation(ctx.db, reservationId);
  if (!roleOf(r, viewer)) throw forbidden('Only the owner and the borrower can add notes to this loan.');
  requireStatus(r, ['ready', 'borrowed', 'returning', 'returned'], 'Condition notes start once the item is ready for pickup.');
  recordCondition(ctx, r, viewer, 'followup', input, { requireRating: false });
  return r.id;
}

// ProposeExtension — admits Borrower.
export function proposeExtension(ctx, viewer, reservationId, input = {}) {
  const { db } = ctx;
  const r = loadReservation(db, reservationId);
  requireBorrower(r, viewer, 'ask for more time');
  requireStatus(r, OPEN_FOR_EXTENSION, 'More time can only be asked for while the loan is open.');
  const proposed = input.proposedEndDate;
  if (!isIsoDate(proposed)) throw invalid('Choose the new return date.', { field: 'proposedEndDate' });
  if (proposed <= r.end_date) throw invalid('The new return date needs to be after the current one.', { field: 'proposedEndDate' });
  if (daysInclusive(r.start_date, proposed) > 90) throw invalid('A loan can last 90 days at most.', { field: 'proposedEndDate' });
  if (db.prepare("SELECT 1 FROM extensions WHERE reservation_id = ? AND status = 'proposed'").get(r.id)) {
    throw conflict('extension_pending', 'You already have a request for more time waiting.');
  }
  const clash = committedOverlaps(db, r.item_id, addDays(r.end_date, 1), proposed, r.id)[0];
  if (clash) {
    const lastFree = addDays(clash.start_date, -1);
    throw conflict('dates_taken', `Someone else has it from ${clash.start_date}.`, { lastFreeDate: lastFree > r.end_date ? lastFree : null });
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO extensions (id, reservation_id, proposed_end_date, previous_end_date, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?)`,
  ).run(id, r.id, proposed, r.end_date, note(input.note), ctx.now().toISOString());
  journal(ctx, 'ExtensionProposed', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { extensionId: id, proposedEndDate: proposed, previousEndDate: r.end_date } });
  return id;
}

function loadExtension(db, id) {
  const e = db.prepare('SELECT * FROM extensions WHERE id = ?').get(id);
  if (!e) throw notFound('That request for more time');
  return e;
}

// AcceptExtension — admits Owner. Re-checks the extended days at acceptance (ExtensionRecheck).
export function acceptExtension(ctx, viewer, extensionId, input = {}) {
  const e = loadExtension(ctx.db, extensionId);
  const r = loadReservation(ctx.db, e.reservation_id);
  requireOwner(r, viewer, 'accept more time');
  if (e.status !== 'proposed') throw conflict('invalid_transition', 'This request for more time has already been answered.');
  requireStatus(r, OPEN_FOR_EXTENSION, 'This loan is no longer open.');
  if (committedOverlaps(ctx.db, r.item_id, addDays(r.end_date, 1), e.proposed_end_date, r.id).length) {
    throw conflict('dates_taken', "Those extra days are now promised to someone else, so this can't be accepted.");
  }
  setStatus(ctx, r, r.status, { end_date: e.proposed_end_date });
  ctx.db.prepare("UPDATE extensions SET status = 'accepted', decided_at = ?, response_note = ? WHERE id = ?").run(ctx.now().toISOString(), note(input.note), e.id);
  journal(ctx, 'ExtensionAccepted', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { extensionId: e.id, newEndDate: e.proposed_end_date, previousEndDate: r.end_date } });
  return e.id;
}

// DeclineExtension — admits Owner.
export function declineExtension(ctx, viewer, extensionId, input = {}) {
  const e = loadExtension(ctx.db, extensionId);
  const r = loadReservation(ctx.db, e.reservation_id);
  requireOwner(r, viewer, 'decline more time');
  if (e.status !== 'proposed') throw conflict('invalid_transition', 'This request for more time has already been answered.');
  ctx.db.prepare("UPDATE extensions SET status = 'declined', decided_at = ?, response_note = ? WHERE id = ?").run(ctx.now().toISOString(), note(input.note, 'message'), e.id);
  journal(ctx, 'ExtensionDeclined', viewer.id, { reservationId: r.id, itemId: r.item_id, data: { extensionId: e.id, note: note(input.note) } });
  return e.id;
}

// ---------------------------------------------------------------- views (LoanHistory read-model)

/** What the viewer may do next. The server enforces the same rules; this only drives the UI. */
function allowedActions(ctx, r, role, pendingExtension) {
  const a = [];
  if (role === 'owner') {
    if (r.status === 'pending') a.push('approve', 'decline');
    if (r.status === 'approved') a.push('ready');
    if (r.status === 'returning') a.push('confirm-return');
    if (pendingExtension) a.push('accept-extension', 'decline-extension');
  }
  if (role === 'borrower') {
    if (['pending', 'approved', 'ready'].includes(r.status)) a.push('cancel');
    if (r.status === 'ready') a.push('pickup');
    if (r.status === 'borrowed') a.push('return');
    if (OPEN_FOR_EXTENSION.includes(r.status) && !pendingExtension) a.push('propose-extension');
  }
  if (role && ['ready', 'borrowed', 'returning', 'returned'].includes(r.status)) a.push('add-note');
  return a;
}

function summarize(ctx, r, viewer, people) {
  const today = ctx.today();
  const role = roleOf(r, viewer);
  const pendingExtension = ctx.db.prepare("SELECT * FROM extensions WHERE reservation_id = ? AND status = 'proposed'").get(r.id);
  const overdue = r.status === 'borrowed' && r.end_date < today;
  const owner = people(r.owner_id);
  const borrower = people(r.borrower_id);
  const item = ctx.db.prepare('SELECT id, title, photo, category, hidden, pickup_area, lending_rules FROM items WHERE id = ?').get(r.item_id);
  // For the owner: does approving this collide with anything already committed?
  let blockedBy = null;
  if (r.status === 'pending') {
    const c = committedOverlaps(ctx.db, r.item_id, r.start_date, r.end_date, r.id)[0];
    if (c) blockedBy = { start: c.start_date, end: c.end_date, borrowerName: role === 'owner' ? c.borrower_name.split(' ')[0] : undefined };
  }
  const actions = allowedActions(ctx, r, role, pendingExtension);
  return {
    id: r.id,
    status: r.status,
    role,
    startDate: r.start_date,
    endDate: r.end_date,
    originalEndDate: r.original_end_date,
    days: daysInclusive(r.start_date, r.end_date),
    note: r.note,
    responseNote: r.response_note,
    disputed: !!r.disputed,
    overdue,
    daysLate: overdue ? daysInclusive(r.end_date, today) - 1 : 0,
    startsInDays: daysInclusive(today, r.start_date) - 1,
    dueInDays: daysInclusive(today, r.end_date) - 1,
    blockedBy,
    item: { id: item.id, title: item.title, photoUrl: photoUrl(item.photo), category: item.category, hidden: !!item.hidden, pickupArea: item.pickup_area, lendingRules: item.lending_rules },
    owner,
    borrower,
    pendingExtension: pendingExtension ? { id: pendingExtension.id, proposedEndDate: pendingExtension.proposed_end_date, note: pendingExtension.note, createdAt: pendingExtension.created_at } : null,
    actions,
    needsMe: actions.some((x) => ['approve', 'ready', 'confirm-return', 'accept-extension', 'pickup'].includes(x)) || (role === 'borrower' && overdue),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function peopleCache(db) {
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) cache.set(id, personView(db.prepare('SELECT * FROM people WHERE id = ?').get(id)));
    return cache.get(id);
  };
}

export function listReservations(ctx, viewer) {
  const rows = ctx.db.prepare(
    `SELECT r.*, i.owner_id FROM reservations r JOIN items i ON i.id = r.item_id
     WHERE r.borrower_id = ? OR i.owner_id = ? ORDER BY r.start_date DESC, r.created_at DESC`,
  ).all(viewer.id, viewer.id);
  const people = peopleCache(ctx.db);
  return rows.map((r) => summarize(ctx, r, viewer, people));
}

export function getReservation(ctx, viewer, reservationId) {
  const { db } = ctx;
  const r = loadReservation(db, reservationId);
  if (!roleOf(r, viewer)) throw notFound('That request');
  const people = peopleCache(db);
  const view = summarize(ctx, r, viewer, people);
  view.extensions = db.prepare('SELECT * FROM extensions WHERE reservation_id = ? ORDER BY created_at').all(r.id).map((e) => ({
    id: e.id, proposedEndDate: e.proposed_end_date, previousEndDate: e.previous_end_date, note: e.note, status: e.status, responseNote: e.response_note, createdAt: e.created_at, decidedAt: e.decided_at,
  }));
  view.conditionNotes = db.prepare('SELECT * FROM condition_notes WHERE reservation_id = ? ORDER BY created_at, rowid').all(r.id).map((n) => ({
    id: n.id, author: people(n.author_id), role: n.role, phase: n.phase, rating: n.rating, note: n.note, photos: JSON.parse(n.photos).map(photoUrl), disagrees: !!n.disagrees, createdAt: n.created_at,
  }));
  view.history = db.prepare('SELECT * FROM events WHERE reservation_id = ? ORDER BY seq').all(r.id).map((e) => ({
    seq: e.seq, type: e.type, actor: people(e.actor_id), data: JSON.parse(e.data), at: e.created_at,
  }));
  // Owner-only: other requests competing for the same days.
  if (view.role === 'owner') {
    view.overlapping = db.prepare(
      `SELECT r.id, r.start_date, r.end_date, r.status, p.name FROM reservations r JOIN people p ON p.id = r.borrower_id
       WHERE r.item_id = ? AND r.id <> ? AND r.status IN ('pending', ${committedSql}) AND r.start_date <= ? AND ? <= r.end_date ORDER BY r.start_date`,
    ).all(r.item_id, r.id, r.end_date, r.start_date).map((o) => ({ id: o.id, start: o.start_date, end: o.end_date, status: o.status, borrowerName: o.name.split(' ')[0] }));
  }
  return view;
}
