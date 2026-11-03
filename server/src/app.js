// The WebApp deployable: one process serving the API, the built interface and photos.
import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, inTransaction } from './db.js';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayIn } from './dates.js';
import { Refusal, unauthenticated, notFound, invalid } from './errors.js';
import { getPerson, listPeople } from './people.js';
import * as catalog from './catalog.js';
import * as borrowing from './borrowing.js';
import * as circles from './circles.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COOKIE = 'bb_session';

function loadSecret(dataDir) {
  if (process.env.BORROWBOX_SECRET) return process.env.BORROWBOX_SECRET;
  const file = join(dataDir, 'session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret);
  return secret;
}

export function createApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.BORROWBOX_DATA ?? join(ROOT, 'data');
  const timeZone = options.timeZone ?? process.env.BORROWBOX_TZ ?? DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) throw new Error(`Unknown time zone: ${timeZone}`);
  const db = options.db ?? openDatabase(options.dbFile ?? join(dataDir, 'borrowbox.sqlite'));
  const now = options.now ?? (() => new Date());
  const ctx = {
    db,
    timeZone,
    now,
    today: () => todayIn(timeZone, now()),
    uploadsDir: options.uploadsDir ?? join(dataDir, 'uploads'),
  };
  const secret = options.secret ?? loadSecret(dataDir);
  const sign = (id) => `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;
  const verify = (value) => {
    if (!value) return null;
    const i = value.lastIndexOf('.');
    if (i < 1) return null;
    const id = value.slice(0, i);
    const a = Buffer.from(sign(id));
    const b = Buffer.from(value);
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  // Identity is established by the server on every request (ServerSideAuthorization).
  app.use((req, _res, next) => {
    const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
    const id = verify(raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : null);
    req.viewer = id ? getPerson(db, id) : null;
    next();
  });
  const requireViewer = (req) => {
    if (!req.viewer) throw unauthenticated();
    return req.viewer;
  };

  const read = (fn) => (req, res, next) => {
    try {
      res.json(fn(req, requireViewer(req)));
    } catch (err) {
      next(err);
    }
  };

  // Every state change: one IMMEDIATE transaction, replay-safe under an Idempotency-Key.
  const write = (fn) => (req, res, next) => {
    try {
      const viewer = requireViewer(req);
      const key = req.get('Idempotency-Key');
      if (key && (key.length > 100 || !/^[\w-]+$/.test(key))) throw invalid('Malformed Idempotency-Key.');
      const route = `${req.method} ${req.originalUrl}`;
      const result = inTransaction(db, () => {
        if (key) {
          const prior = db.prepare('SELECT * FROM idempotency WHERE person_id = ? AND key = ?').get(viewer.id, key);
          if (prior) return { status: prior.status, body: JSON.parse(prior.body), replayed: true };
        }
        const body = fn(req, viewer);
        const status = req.method === 'POST' && body?.created ? 201 : 200;
        if (key) {
          db.prepare('INSERT INTO idempotency (person_id, key, route, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(viewer.id, key, route, status, JSON.stringify(body), now().toISOString());
        }
        return { status, body };
      });
      if (result.replayed) res.set('Idempotent-Replay', 'true');
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  };

  const api = express.Router();

  api.get('/config', (_req, res) => res.json({ timeZone, today: ctx.today(), categories: catalog.CATEGORIES }));
  api.get('/people', (_req, res) => res.json(listPeople(db)));
  api.get('/session', (req, res) => res.json({ person: req.viewer }));
  api.post('/session', (req, res, next) => {
    try {
      const person = getPerson(db, req.body?.personId);
      if (!person) throw notFound('That person');
      res.set('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(person.id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
      res.json({ person });
    } catch (err) {
      next(err);
    }
  });
  api.delete('/session', (_req, res) => {
    res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ person: null });
  });

  // Catalog
  api.get('/items', read((req, v) => catalog.searchCatalog(ctx, v, req.query)));
  api.get('/items/:id', read((req, v) => catalog.getItem(ctx, v, req.params.id)));
  api.post('/items', write((req, v) => ({ created: true, item: catalog.listItem(ctx, v, req.body) })));
  api.patch('/items/:id', write((req, v) => ({ item: catalog.editItem(ctx, v, req.params.id, req.body) })));
  api.post('/items/:id/visibility', write((req, v) => ({ item: catalog.setItemVisibility(ctx, v, req.params.id, req.body?.hidden) })));

  api.put('/items/:id/audience', write((req, v) => ({ item: catalog.setItemAudience(ctx, v, req.params.id, req.body) })));

  // Lending circles
  const circle = (v, id) => ({ circle: circles.getCircle(ctx, v, id) });
  api.get('/circles', read((_req, v) => circles.listCircles(ctx, v)));
  api.get('/circles/:id', read((req, v) => circles.getCircle(ctx, v, req.params.id)));
  api.post('/circles', write((req, v) => ({ created: true, ...circle(v, circles.createCircle(ctx, v, req.body)) })));
  api.post('/circles/:id/invitations', write((req, v) => circle(v, circles.inviteToCircle(ctx, v, req.params.id, req.body))));
  api.post('/circles/:id/accept', write((req, v) => circle(v, circles.acceptInvitation(ctx, v, req.params.id))));
  api.post('/circles/:id/decline', write((req, v) => {
    circles.declineInvitation(ctx, v, req.params.id);
    return { circle: null };
  }));
  api.post('/circles/:id/leave', write((req, v) => {
    circles.leaveCircle(ctx, v, req.params.id);
    return { circle: null };
  }));
  api.post('/circles/:id/members/:personId/remove', write((req, v) => circle(v, circles.removeMember(ctx, v, req.params.id, req.params.personId))));

  // Borrowing
  const show = (v, id) => ({ reservation: borrowing.getReservation(ctx, v, id) });
  api.get('/reservations', read((_req, v) => borrowing.listReservations(ctx, v)));
  api.get('/reservations/:id', read((req, v) => borrowing.getReservation(ctx, v, req.params.id)));
  api.post('/items/:id/requests', write((req, v) => ({ created: true, ...show(v, borrowing.requestToBorrow(ctx, v, req.params.id, req.body)) })));
  const acts = {
    approve: borrowing.approveRequest,
    decline: borrowing.declineRequest,
    cancel: borrowing.cancelRequest,
    ready: borrowing.markReady,
    pickup: borrowing.confirmPickup,
    return: borrowing.startReturn,
    'confirm-return': borrowing.confirmReturn,
    notes: borrowing.addConditionNote,
  };
  api.post('/reservations/:id/:act', (req, res, next) => {
    const fn = acts[req.params.act];
    if (!fn && req.params.act !== 'extensions') return next(notFound('That action'));
    if (req.params.act === 'extensions') {
      return write((rq, v) => {
        borrowing.proposeExtension(ctx, v, rq.params.id, rq.body);
        return { created: true, ...show(v, rq.params.id) };
      })(req, res, next);
    }
    return write((rq, v) => show(v, fn(ctx, v, rq.params.id, rq.body || {})))(req, res, next);
  });
  api.post('/extensions/:id/:act', (req, res, next) => {
    const fn = { accept: borrowing.acceptExtension, decline: borrowing.declineExtension }[req.params.act];
    if (!fn) return next(notFound('That action'));
    return write((rq, v) => {
      fn(ctx, v, rq.params.id, rq.body || {});
      const ext = db.prepare('SELECT reservation_id FROM extensions WHERE id = ?').get(rq.params.id);
      return show(v, ext.reservation_id);
    })(req, res, next);
  });

  api.use((_req, _res, next) => next(notFound('That page')));
  app.use('/api', api);

  // Photos are only served to signed-in people (PhotoStore: access-controlled).
  app.use('/uploads', (req, res, next) => {
    if (!req.viewer) return res.status(401).end();
    next();
  }, express.static(ctx.uploadsDir, { maxAge: '7d', immutable: true, fallthrough: false }));

  const dist = options.distDir ?? join(ROOT, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  // Refusals become calm JSON; anything unexpected is logged and reported plainly.
  app.use((err, _req, res, _next) => {
    if (err instanceof Refusal) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'That upload is too large.' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: "That request couldn't be read." } });
    if (err?.status === 404 || err?.code === 'ENOENT') return res.status(404).json({ error: { code: 'not_found', message: "That couldn't be found." } });
    console.error(err);
    return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
  });

  return { app, ctx, db, close: () => db.close() };
}
