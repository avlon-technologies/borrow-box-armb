// Test harness: a real HTTP server over a real SQLite file in a temp directory, seeded with
// the demo library at a fixed clock, and one cookie-carrying client per person.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { seed } from '../src/seed.js';
import { addDays } from '../src/dates.js';

export const NOW = new Date('2026-06-15T16:00:00Z'); // 12:00 in Toronto
export const TODAY = '2026-06-15';
export const day = (n) => addDays(TODAY, n);

export async function startLibrary({ dataDir, fresh = true, clock } = {}) {
  dataDir = dataDir ?? mkdtempSync(join(tmpdir(), 'borrowbox-test-'));
  const dbFile = join(dataDir, 'borrowbox.sqlite');
  const uploadsDir = join(dataDir, 'uploads');
  let items = {};
  if (fresh) {
    const db = openDatabase(dbFile);
    items = seed(db, { uploadsDir, timeZone: 'America/Toronto', realNow: NOW }).items;
    db.close();
  }
  const time = clock ?? { now: NOW };
  const lib = createApp({ dataDir, timeZone: 'America/Toronto', now: () => time.now, secret: 'test-secret' });
  const server = await new Promise((resolve) => { const s = lib.app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (!fresh) items = Object.fromEntries(lib.db.prepare('SELECT slug, id FROM items').all().map((r) => [r.slug, r.id]));

  const clients = {};
  const as = async (handle) => {
    if (clients[handle]) return clients[handle];
    const res = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: `p-${handle}` }) });
    if (!res.ok) throw new Error(`cannot sign in as ${handle}`);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    clients[handle] = client(base, cookie);
    return clients[handle];
  };

  return {
    base, dataDir, items, db: lib.db, time, as, anonymous: client(base, null),
    async stop({ keep = false } = {}) {
      await new Promise((resolve) => server.close(resolve));
      lib.close();
      if (!keep) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function client(base, cookie) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    patch: (p, b = {}, h) => call('PATCH', p, b, h),
    // Convenience wrappers
    request: (itemId, startDate, endDate, note) => call('POST', `/items/${itemId}/requests`, { startDate, endDate, note }),
    act: (id, act, body = {}) => call('POST', `/reservations/${id}/${act}`, body),
  };
}

/** Drive a fresh request to the given state through the real API. */
export async function loanTo(lib, { owner, borrower, item, from, to, state }) {
  const b = await lib.as(borrower);
  const o = await lib.as(owner);
  const r = await b.request(lib.items[item], from, to);
  if (r.status !== 201) throw new Error(`request failed: ${JSON.stringify(r.body)}`);
  const id = r.body.reservation.id;
  const steps = [['approve', o], ['ready', o], ['pickup', b, { rating: 'good' }], ['return', b, { rating: 'good' }], ['confirm-return', o, { rating: 'good' }]];
  const order = ['pending', 'approved', 'ready', 'borrowed', 'returning', 'returned'];
  for (let i = 0; i < order.indexOf(state); i++) {
    const [act, who, body] = steps[i];
    const res = await who.act(id, act, body);
    if (res.status !== 200) throw new Error(`${act} failed: ${JSON.stringify(res.body)}`);
  }
  return id;
}

export const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
