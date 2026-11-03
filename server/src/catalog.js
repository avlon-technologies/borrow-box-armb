// CatalogService (model: ::BorrowBox.Lending.Library.CatalogService).
// Handles ListItem, EditItem, SetItemVisibility; answers SearchCatalog with availability.
// Every function that changes state runs inside the caller's transaction.
import { randomUUID } from 'node:crypto';
import { COMMITTED, circleReachSql } from './db.js';
import { isIsoDate } from './dates.js';
import { forbidden, invalid, notFound } from './errors.js';
import { personView } from './people.js';
import { photoUrl, savePhoto } from './photos.js';
import { activeCircleIds, recordCircleEvent } from './circles.js';

export const AUDIENCES = ['everyone', 'circles'];

/** Circles an item is shared with that the viewer may know about: all of them for its owner,
 * otherwise only circles where the viewer and the owner are both active members. */
function sharedCircles(db, itemId, ownerId, viewerId) {
  const rows = db.prepare(
    `SELECT c.id, c.name FROM item_circles ic JOIN circles c ON c.id = ic.circle_id
     WHERE ic.item_id = ? ORDER BY c.name`,
  ).all(itemId);
  if (viewerId === ownerId) return rows;
  const mine = new Set(activeCircleIds(db, viewerId));
  const owners = new Set(activeCircleIds(db, ownerId));
  return rows.filter((c) => mine.has(c.id) && owners.has(c.id));
}

/** Can the viewer make a new request for this item, audience-wise? (CircleOnlyNeedsSharedCircle) */
export function canReach(db, item, viewerId) {
  if (item.owner_id === viewerId) return false;
  if (item.audience !== 'circles') return true;
  return !!db.prepare(`SELECT ${circleReachSql(':item', ':requester', ':owner')} AS ok`)
    .get({ item: item.id, requester: viewerId, owner: item.owner_id }).ok;
}

export const CATEGORIES = ['Outdoors', 'Tools', 'Kitchen', 'Music', 'Tech & Photo', 'Games', 'Books', 'Bikes & Sport', 'Home & Garden', 'Other'];
const committedSql = COMMITTED.map((s) => `'${s}'`).join(', ');

function text(value, field, { required = false, max = 2000 } = {}) {
  if (value == null || value === '') {
    if (required) throw invalid(`Please add a ${field}.`, { field });
    return '';
  }
  if (typeof value !== 'string') throw invalid(`The ${field} should be text.`, { field });
  const trimmed = value.trim();
  if (required && !trimmed) throw invalid(`Please add a ${field}.`, { field });
  if (trimmed.length > max) throw invalid(`The ${field} is a little long (${max} characters at most).`, { field });
  return trimmed;
}

function validateItem(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);
  if (has('title')) out.title = text(input.title, 'title', { required: true, max: 80 });
  if (has('category')) {
    if (!CATEGORIES.includes(input.category)) throw invalid('Please choose a category.', { field: 'category' });
    out.category = input.category;
  }
  if (has('description')) out.description = text(input.description, 'description', { max: 2000 });
  if (has('lendingRules')) out.lending_rules = text(input.lendingRules, 'lending rules', { max: 1000 });
  if (has('pickupArea')) out.pickup_area = text(input.pickupArea, 'pickup area', { max: 120 });
  if (has('maxLoanDays')) {
    const n = Number(input.maxLoanDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw invalid('Loan length should be between 1 and 90 days.', { field: 'maxLoanDays' });
    out.max_loan_days = n;
  }
  return out;
}

function ownerOf(db, itemId) {
  const row = db.prepare('SELECT owner_id FROM items WHERE id = ?').get(itemId);
  if (!row) throw notFound('That item');
  return row.owner_id;
}

/** Busy (committed) ranges from `today` on. Names are only shown to the item's owner and the borrower. */
function busyRanges(db, itemId, viewerId, ownerId, today) {
  const rows = db.prepare(
    `SELECT r.id, r.start_date, r.end_date, r.status, r.borrower_id, p.name AS borrower_name
     FROM reservations r JOIN people p ON p.id = r.borrower_id
     WHERE r.item_id = ? AND r.status IN (${committedSql}) AND (r.end_date >= ? OR r.status IN ('borrowed', 'returning'))
     ORDER BY r.start_date`,
  ).all(itemId, today);
  return rows.map((r) => {
    const visible = viewerId === ownerId || viewerId === r.borrower_id;
    return {
      start: r.start_date,
      end: r.end_date,
      out: r.status === 'borrowed' || r.status === 'returning',
      reservationId: visible ? r.id : undefined,
      borrowerName: visible ? r.borrower_name.split(' ')[0] : undefined,
      mine: r.borrower_id === viewerId,
    };
  });
}

export function itemView(db, row, viewer, today, { detail = false } = {}) {
  const owner = personView(db.prepare('SELECT * FROM people WHERE id = ?').get(row.owner_id));
  const busy = busyRanges(db, row.id, viewer.id, row.owner_id, today);
  const out = busy.find((b) => b.out) || null;
  const bookedToday = busy.some((b) => b.start <= today && today <= b.end);
  const view = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    description: row.description,
    lendingRules: row.lending_rules,
    maxLoanDays: row.max_loan_days,
    pickupArea: row.pickup_area,
    photoUrl: photoUrl(row.photo),
    hidden: !!row.hidden,
    audience: row.audience,
    circles: sharedCircles(db, row.id, row.owner_id, viewer.id),
    canRequest: !row.hidden && canReach(db, row, viewer.id),
    owner,
    isMine: row.owner_id === viewer.id,
    availableToday: !bookedToday && !out,
    out: out ? { until: out.end, borrowerName: out.borrowerName } : null,
    nextBooking: busy.find((b) => b.start > today) ? { start: busy.find((b) => b.start > today).start } : null,
    busy,
    updatedAt: row.updated_at,
  };
  if (detail) {
    // The viewer's own open requests for this item, so the page can say "you've asked for…".
    view.myRequests = db.prepare(
      `SELECT id, start_date, end_date, status FROM reservations
       WHERE item_id = ? AND borrower_id = ? AND status IN ('pending', ${committedSql}) ORDER BY start_date`,
    ).all(row.id, viewer.id).map((r) => ({ id: r.id, start: r.start_date, end: r.end_date, status: r.status }));
    if (view.isMine) {
      view.openRequests = db.prepare(
        `SELECT r.id, r.borrower_id, r.start_date, r.end_date, r.status, r.note, p.name AS borrower_name, p.color AS borrower_color
         FROM reservations r JOIN people p ON p.id = r.borrower_id
         WHERE r.item_id = ? AND r.status IN ('pending', ${committedSql}) ORDER BY r.start_date`,
      ).all(row.id).map((r) => ({ id: r.id, start: r.start_date, end: r.end_date, status: r.status, note: r.note, borrowerName: r.borrower_name, borrowerColor: r.borrower_color,
        outsideCircles: row.audience === 'circles' && !canReach(db, row, r.borrower_id) }));
    }
  }
  return view;
}

export function searchCatalog(ctx, viewer, query = {}) {
  const { db } = ctx;
  const today = ctx.today();
  const where = [];
  const params = [];
  if (query.mine === '1' || query.mine === true) {
    where.push('i.owner_id = ?');
    params.push(viewer.id);
  } else {
    // Hidden items no longer appear to others; owners still see their own. Circle-only items
    // appear only to people who share one of the item's circles with its owner.
    where.push(`(i.owner_id = ? OR (i.hidden = 0 AND (i.audience = 'everyone' OR ${circleReachSql('i.id', '?', 'i.owner_id')})))`);
    params.push(viewer.id, viewer.id);
  }
  if (query.circle) {
    // Items shared with one circle the viewer is active in (whose owner is still active there).
    where.push(`EXISTS (SELECT 1 FROM item_circles ic
      JOIN memberships mv ON mv.circle_id = ic.circle_id AND mv.person_id = ? AND mv.standing = 'active'
      JOIN memberships mo ON mo.circle_id = ic.circle_id AND mo.person_id = i.owner_id AND mo.standing = 'active'
      WHERE ic.item_id = i.id AND ic.circle_id = ?)`);
    params.push(viewer.id, query.circle);
  }
  if (query.circles === '1') {
    // Items reachable through any of the viewer's circles, their own shared ones included.
    where.push(`EXISTS (SELECT 1 FROM item_circles ic
      JOIN memberships mv ON mv.circle_id = ic.circle_id AND mv.person_id = ? AND mv.standing = 'active'
      JOIN memberships mo ON mo.circle_id = ic.circle_id AND mo.person_id = i.owner_id AND mo.standing = 'active'
      WHERE ic.item_id = i.id)`);
    params.push(viewer.id);
  }
  if (query.owner) {
    where.push('(p.handle = ? OR p.id = ?)');
    params.push(query.owner, query.owner);
  }
  if (query.category) {
    where.push('i.category = ?');
    params.push(query.category);
  }
  if (query.q && String(query.q).trim()) {
    const term = `%${String(query.q).trim().toLowerCase()}%`;
    where.push('(lower(i.title) LIKE ? OR lower(i.description) LIKE ? OR lower(i.category) LIKE ? OR lower(p.name) LIKE ?)');
    params.push(term, term, term, term);
  }
  const from = isIsoDate(query.from) ? query.from : null;
  const to = isIsoDate(query.to) ? query.to : from;
  if (from && to) {
    where.push(`NOT EXISTS (SELECT 1 FROM reservations r WHERE r.item_id = i.id AND r.status IN (${committedSql}) AND r.start_date <= ? AND ? <= r.end_date)`);
    params.push(to, from);
  }
  const rows = db.prepare(
    `SELECT i.* FROM items i JOIN people p ON p.id = i.owner_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.hidden ASC, i.created_at DESC`,
  ).all(...params);
  return rows.map((row) => itemView(db, row, viewer, today));
}

export function getItem(ctx, viewer, itemId) {
  const { db } = ctx;
  const row = db.prepare('SELECT * FROM items WHERE id = ? OR slug = ?').get(itemId, itemId);
  if (!row) throw notFound('That item');
  if (row.owner_id !== viewer.id && (row.hidden || !canReach(db, row, viewer.id))) {
    // A hidden or circle-only item stays visible to people who already have a reservation for
    // it (HiddenItemsKeepCommitments, MembershipChangesKeepCommitments).
    const involved = db.prepare('SELECT 1 FROM reservations WHERE item_id = ? AND borrower_id = ? LIMIT 1').get(row.id, viewer.id);
    if (!involved) throw notFound('That item');
  }
  const view = itemView(db, row, viewer, ctx.today(), { detail: true });
  if (view.isMine) view.myCircles = db.prepare(
    `SELECT c.id, c.name FROM memberships m JOIN circles c ON c.id = m.circle_id
     WHERE m.person_id = ? AND m.standing = 'active' ORDER BY c.name`,
  ).all(viewer.id);
  return view;
}

function validateAudience(db, viewer, input) {
  const audience = input.audience ?? 'everyone';
  if (!AUDIENCES.includes(audience)) throw invalid('Choose who can borrow it: everyone, or just your circles.', { field: 'audience' });
  const ids = input.circleIds ?? [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw invalid('Choose circles from your list.', { field: 'circleIds' });
  const unique = [...new Set(ids)];
  const mine = new Set(activeCircleIds(db, viewer.id));
  // ShareOnlyWhereMember: only circles the owner is an active member of.
  if (unique.some((id) => !mine.has(id))) throw forbidden('You can only share with circles you belong to.');
  if (audience === 'circles' && unique.length === 0) throw invalid('Pick at least one circle to share it with.', { field: 'circleIds' });
  return { audience, circleIds: unique };
}

/** Writes the item's audience and circle shares, and tells each affected circle (ItemAudienceChanged). */
function writeAudience(ctx, viewer, itemId, { audience, circleIds }) {
  const { db } = ctx;
  const now = ctx.now().toISOString();
  const before = db.prepare('SELECT circle_id FROM item_circles WHERE item_id = ?').all(itemId).map((r) => r.circle_id);
  db.prepare('UPDATE items SET audience = ?, updated_at = ? WHERE id = ?').run(audience, now, itemId);
  const add = circleIds.filter((id) => !before.includes(id));
  // Shares in circles the owner no longer belongs to are kept unless the owner removes them
  // explicitly here; they grant nothing while the owner is not an active member.
  const keepForeign = before.filter((id) => !activeCircleIds(db, viewer.id).includes(id));
  const drop = before.filter((id) => !circleIds.includes(id) && !keepForeign.includes(id));
  const ins = db.prepare('INSERT INTO item_circles (item_id, circle_id, created_at) VALUES (?, ?, ?)');
  for (const id of add) ins.run(itemId, id, now);
  const del = db.prepare('DELETE FROM item_circles WHERE item_id = ? AND circle_id = ?');
  for (const id of drop) del.run(itemId, id);
  // ItemAudienceChanged is consumed by CircleService, which records it in each circle's activity.
  for (const id of add) recordCircleEvent(ctx, id, 'ItemAudienceChanged', viewer.id, { itemId, data: { audience, change: 'shared' } });
  for (const id of drop) recordCircleEvent(ctx, id, 'ItemAudienceChanged', viewer.id, { itemId, data: { audience, change: 'unshared' } });
}

// SetItemAudience — admits Owner, requires ItemOwnership for itemId. Narrowing the audience
// never touches reservations already made (MembershipChangesKeepCommitments).
export function setItemAudience(ctx, viewer, itemId, input = {}) {
  const { db } = ctx;
  const row = db.prepare('SELECT id, owner_id FROM items WHERE id = ? OR slug = ?').get(itemId, itemId);
  if (!row) throw notFound('That item');
  if (row.owner_id !== viewer.id) throw forbidden('Only the owner can choose who it is shared with.');
  writeAudience(ctx, viewer, row.id, validateAudience(db, viewer, input));
  return getItem(ctx, viewer, row.id);
}

// ListItem — admits Owner (any member listing their own possession).
export function listItem(ctx, viewer, input) {
  const { db } = ctx;
  const fields = validateItem(input || {});
  if (!input.photo) throw invalid('A photo helps friends recognise it. Please add one.', { field: 'photo' });
  const audience = validateAudience(db, viewer, input);
  const photo = savePhoto(ctx.uploadsDir, input.photo);
  const id = randomUUID();
  const now = ctx.now().toISOString();
  db.prepare(
    `INSERT INTO items (id, owner_id, title, category, description, lending_rules, max_loan_days, pickup_area, photo, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, viewer.id, fields.title, fields.category, fields.description, fields.lending_rules, fields.max_loan_days ?? 7, fields.pickup_area, photo, now, now);
  // A new listing is offered to everyone unless the owner chose circles (ListItem, then SetItemAudience).
  if (audience.audience !== 'everyone' || audience.circleIds.length) writeAudience(ctx, viewer, id, audience);
  return getItem(ctx, viewer, id);
}

// EditItem — admits Owner, requires ItemOwnership for itemId.
export function editItem(ctx, viewer, itemId, input) {
  const { db } = ctx;
  if (ownerOf(db, itemId) !== viewer.id) throw forbidden('Only the owner can edit this item.');
  const fields = validateItem(input || {}, { partial: true });
  if (input.photo) fields.photo = savePhoto(ctx.uploadsDir, input.photo);
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), ctx.now().toISOString(), itemId);
  }
  return getItem(ctx, viewer, itemId);
}

// SetItemVisibility — admits Owner, requires ItemOwnership for itemId.
// Hiding never touches reservations (HiddenItemsKeepCommitments).
export function setItemVisibility(ctx, viewer, itemId, hidden) {
  const { db } = ctx;
  if (ownerOf(db, itemId) !== viewer.id) throw forbidden('Only the owner can hide or show this item.');
  if (typeof hidden !== 'boolean') throw invalid('Say whether the item should be hidden.');
  db.prepare('UPDATE items SET hidden = ?, updated_at = ? WHERE id = ?').run(hidden ? 1 : 0, ctx.now().toISOString(), itemId);
  return getItem(ctx, viewer, itemId);
}
