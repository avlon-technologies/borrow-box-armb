// CatalogService (model: ::BorrowBox.Lending.Library.CatalogService).
// Handles ListItem, EditItem, SetItemVisibility; answers SearchCatalog with availability.
// Every function that changes state runs inside the caller's transaction.
import { randomUUID } from 'node:crypto';
import { COMMITTED } from './db.js';
import { isIsoDate } from './dates.js';
import { forbidden, invalid, notFound } from './errors.js';
import { personView } from './people.js';
import { photoUrl, savePhoto } from './photos.js';

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
        `SELECT r.id, r.start_date, r.end_date, r.status, r.note, p.name AS borrower_name, p.color AS borrower_color
         FROM reservations r JOIN people p ON p.id = r.borrower_id
         WHERE r.item_id = ? AND r.status IN ('pending', ${committedSql}) ORDER BY r.start_date`,
      ).all(row.id).map((r) => ({ id: r.id, start: r.start_date, end: r.end_date, status: r.status, note: r.note, borrowerName: r.borrower_name, borrowerColor: r.borrower_color }));
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
    // Hidden items no longer appear to others; owners still see their own.
    where.push('(i.hidden = 0 OR i.owner_id = ?)');
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
  if (row.hidden && row.owner_id !== viewer.id) {
    // A hidden item stays visible to people who already have a reservation for it.
    const involved = db.prepare('SELECT 1 FROM reservations WHERE item_id = ? AND borrower_id = ? LIMIT 1').get(row.id, viewer.id);
    if (!involved) throw notFound('That item');
  }
  return itemView(db, row, viewer, ctx.today(), { detail: true });
}

// ListItem — admits Owner (any member listing their own possession).
export function listItem(ctx, viewer, input) {
  const { db } = ctx;
  const fields = validateItem(input || {});
  if (!input.photo) throw invalid('A photo helps friends recognise it. Please add one.', { field: 'photo' });
  const photo = savePhoto(ctx.uploadsDir, input.photo);
  const id = randomUUID();
  const now = ctx.now().toISOString();
  db.prepare(
    `INSERT INTO items (id, owner_id, title, category, description, lending_rules, max_loan_days, pickup_area, photo, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, viewer.id, fields.title, fields.category, fields.description, fields.lending_rules, fields.max_loan_days ?? 7, fields.pickup_area, photo, now, now);
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
