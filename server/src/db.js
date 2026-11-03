// Durable store (model resources ItemStore, ReservationStore, EvidenceStore, ActivityJournal,
// bound to one SQLite file in LocalDevelopment). The database itself refuses the two things
// the model says must never happen, so no code path can bypass them:
//   - two committed reservations of one item overlapping (CommittedReservationsNeverOverlap)
//   - condition evidence or journal entries being changed or removed (EvidenceIsAppendOnly)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const COMMITTED = ['approved', 'ready', 'borrowed', 'returning'];
export const STATUSES = ['pending', 'approved', 'declined', 'cancelled', 'ready', 'borrowed', 'returning', 'returned'];
const committedSql = COMMITTED.map((s) => `'${s}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#C8553D'
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  owner_id TEXT NOT NULL REFERENCES people(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  lending_rules TEXT NOT NULL DEFAULT '',
  max_loan_days INTEGER NOT NULL DEFAULT 7 CHECK (max_loan_days BETWEEN 1 AND 90),
  pickup_area TEXT NOT NULL DEFAULT '',
  photo TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  audience TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'circles')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  borrower_id TEXT NOT NULL REFERENCES people(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  original_end_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(', ')})),
  response_note TEXT NOT NULL DEFAULT '',
  disputed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS reservations_item ON reservations(item_id, status);
CREATE INDEX IF NOT EXISTS reservations_borrower ON reservations(borrower_id);

CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  proposed_end_date TEXT NOT NULL,
  previous_end_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'declined', 'withdrawn')),
  response_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS condition_notes (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  author_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'borrower')),
  phase TEXT NOT NULL CHECK (phase IN ('handoff', 'return', 'followup')),
  rating TEXT CHECK (rating IN ('like-new', 'good', 'worn', 'damaged')),
  note TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  disagrees INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  reservation_id TEXT,
  item_id TEXT,
  actor_id TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_reservation ON events(reservation_id, seq);

CREATE TABLE IF NOT EXISTS idempotency (
  person_id TEXT NOT NULL,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, key)
);

-- No two committed reservations of one item may share a calendar day.
CREATE TRIGGER IF NOT EXISTS reservations_no_overlap_insert
BEFORE INSERT ON reservations
WHEN NEW.status IN (${committedSql})
BEGIN
  SELECT RAISE(ABORT, 'reservation_overlap')
  WHERE EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.item_id = NEW.item_id AND r.id <> NEW.id AND r.status IN (${committedSql})
      AND r.start_date <= NEW.end_date AND NEW.start_date <= r.end_date);
END;

CREATE TRIGGER IF NOT EXISTS reservations_no_overlap_update
BEFORE UPDATE OF status, start_date, end_date ON reservations
WHEN NEW.status IN (${committedSql})
BEGIN
  SELECT RAISE(ABORT, 'reservation_overlap')
  WHERE EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.item_id = NEW.item_id AND r.id <> NEW.id AND r.status IN (${committedSql})
      AND r.start_date <= NEW.end_date AND NEW.start_date <= r.end_date);
END;

-- Nobody borrows their own item.
CREATE TRIGGER IF NOT EXISTS reservations_no_self_borrow
BEFORE INSERT ON reservations
BEGIN
  SELECT RAISE(ABORT, 'self_borrow')
  WHERE (SELECT owner_id FROM items WHERE id = NEW.item_id) = NEW.borrower_id;
END;

-- Lending circles (model resource CircleStore). A membership's standing changes; it is never deleted.
CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  organiser_id TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  circle_id TEXT NOT NULL REFERENCES circles(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  standing TEXT NOT NULL CHECK (standing IN ('invited', 'active', 'declined', 'left', 'removed')),
  invited_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (circle_id, person_id)
);
CREATE INDEX IF NOT EXISTS memberships_person ON memberships(person_id, standing);

-- Which circles an item is shared with (part of the item's audience, model resource ItemStore).
CREATE TABLE IF NOT EXISTS item_circles (
  item_id TEXT NOT NULL REFERENCES items(id),
  circle_id TEXT NOT NULL REFERENCES circles(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, circle_id)
);
CREATE INDEX IF NOT EXISTS item_circles_circle ON item_circles(circle_id);

-- Each circle's own append-only activity (read-model CircleActivity is projected from it).
CREATE TABLE IF NOT EXISTS circle_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  subject_id TEXT,
  item_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS circle_events_circle ON circle_events(circle_id, seq);

-- The organiser always stays an active member (OrganiserStaysMember).
CREATE TRIGGER IF NOT EXISTS memberships_organiser_stays
BEFORE UPDATE OF standing ON memberships
WHEN NEW.standing <> 'active' AND NEW.person_id = (SELECT organiser_id FROM circles WHERE id = NEW.circle_id)
BEGIN
  SELECT RAISE(ABORT, 'organiser_stays');
END;

CREATE TRIGGER IF NOT EXISTS memberships_no_delete BEFORE DELETE ON memberships
BEGIN SELECT RAISE(ABORT, 'membership_history_kept'); END;
CREATE TRIGGER IF NOT EXISTS circle_events_no_update BEFORE UPDATE ON circle_events
BEGIN SELECT RAISE(ABORT, 'journal_append_only'); END;
CREATE TRIGGER IF NOT EXISTS circle_events_no_delete BEFORE DELETE ON circle_events
BEGIN SELECT RAISE(ABORT, 'journal_append_only'); END;

-- Condition evidence and the activity journal are append-only.
CREATE TRIGGER IF NOT EXISTS condition_notes_no_update BEFORE UPDATE ON condition_notes
BEGIN SELECT RAISE(ABORT, 'evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS condition_notes_no_delete BEFORE DELETE ON condition_notes
BEGIN SELECT RAISE(ABORT, 'evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'journal_append_only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'journal_append_only'); END;
`;

/**
 * SQL that is true when `requester` can reach `item` through a circle: the requester and the
 * item's owner are both active members of a circle the item is shared with. The arguments are
 * SQL expressions, so one rule serves the queries and the trigger below.
 */
export function circleReachSql(item, requester, owner) {
  return `EXISTS (SELECT 1 FROM item_circles ic
    JOIN memberships mr ON mr.circle_id = ic.circle_id AND mr.person_id = ${requester} AND mr.standing = 'active'
    JOIN memberships mo ON mo.circle_id = ic.circle_id AND mo.person_id = ${owner} AND mo.standing = 'active'
    WHERE ic.item_id = ${item})`;
}

// A new request for a circle-only item needs a circle shared with the owner at that instant
// (CircleOnlyNeedsSharedCircle). Requests already made are never re-checked
// (MembershipChangesKeepCommitments), so this guards INSERT only.
const REACH_TRIGGER = `
CREATE TRIGGER IF NOT EXISTS reservations_circle_reach
BEFORE INSERT ON reservations
WHEN (SELECT audience FROM items WHERE id = NEW.item_id) = 'circles'
BEGIN
  SELECT RAISE(ABORT, 'circle_only')
  WHERE NOT ${circleReachSql('NEW.item_id', 'NEW.borrower_id', '(SELECT owner_id FROM items WHERE id = NEW.item_id)')};
END;`;

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  // Databases made before lending circles get the audience column, defaulting to everyone.
  const hasAudience = db.prepare("SELECT 1 FROM pragma_table_info('items') WHERE name = 'audience'").get();
  if (!hasAudience) {
    db.exec("ALTER TABLE items ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'circles'))");
  }
  db.exec(REACH_TRIGGER);
  return db;
}

/**
 * Run fn inside one IMMEDIATE transaction: the write lock is taken before any read, so a
 * check-then-commit (e.g. the overlap check before approval) cannot interleave with another
 * writer, in this process or another one sharing the file.
 */
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

export function isConstraint(err, code) {
  return err && typeof err.message === 'string' && err.message.includes(code);
}
