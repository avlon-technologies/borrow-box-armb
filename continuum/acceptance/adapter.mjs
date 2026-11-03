// Binds the acceptance scenarios' step keys to the real BorrowBox: a real HTTP server over a real
// SQLite file, seeded with the demo library at a fixed clock (the same harness as server/test).
// Dates in scenarios are relative: "+3" means three days after the seed's "today".
import { startLibrary, day } from '../../server/test/helpers.js';

const rel = (v) => (typeof v === 'string' && /^[+-]\d+$/.test(v) ? day(Number(v)) : v);

export function createAdapter() {
  async function lib(ctx) {
    if (!ctx.state.lib) throw new Error('system.start has not run');
    return ctx.state.lib;
  }
  const refs = (ctx) => (ctx.state.refs ??= {});
  const exts = (ctx) => (ctx.state.exts ??= {});

  async function submit(ctx, { as, item, from, to }) {
    const l = await lib(ctx);
    const who = await l.as(as);
    return who.request(l.items[item], rel(from), rel(to));
  }
  async function act(ctx, { as, ref, action, note, disagrees }) {
    const l = await lib(ctx);
    const who = await l.as(as);
    const body = { note, disagrees, rating: ['pickup', 'return', 'confirm-return'].includes(action) ? (disagrees ? 'worn' : 'good') : undefined };
    return who.act(refs(ctx)[ref], action, body);
  }
  async function drive(ctx, args, upTo) {
    const res = await submit(ctx, args);
    ctx.assert.equal(res.status, 201, JSON.stringify(res.body));
    const id = res.body.reservation.id;
    refs(ctx)[args.ref] = id;
    const steps = [['approve', args.owner], ['ready', args.owner], ['pickup', args.as]];
    for (const [action, as] of steps.slice(0, upTo)) {
      const r = await act(ctx, { as, ref: args.ref, action });
      ctx.assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
    }
  }
  async function view(ctx, ref) {
    const l = await lib(ctx);
    const id = refs(ctx)[ref];
    const row = l.db.prepare('SELECT i.owner_id FROM reservations r JOIN items i ON i.id = r.item_id WHERE r.id = ?').get(id);
    const owner = await l.as(row.owner_id.replace('p-', ''));
    const res = await owner.get(`/reservations/${id}`);
    ctx.assert.equal(res.status, 200);
    return res.body;
  }

  return {
    steps: {
      'system.start': async (ctx) => { ctx.state.lib = await startLibrary(); },
      'system.restart': async (ctx) => {
        const old = await lib(ctx);
        await old.stop({ keep: true });
        ctx.state.lib = await startLibrary({ dataDir: old.dataDir, fresh: false });
      },

      'request.submit': async (ctx, args) => {
        const res = await submit(ctx, args);
        ctx.assert.equal(res.status, 201, JSON.stringify(res.body));
        ctx.assert.equal(res.body.reservation.status, 'pending');
        refs(ctx)[args.ref] = res.body.reservation.id;
      },
      'request.submitExpectRefusal': async (ctx, args) => {
        const res = await submit(ctx, args);
        ctx.assert.equal(res.status, args.status, JSON.stringify(res.body));
      },
      'request.submitTwiceSameKey': async (ctx, { as, item, from, to, ref }) => {
        const l = await lib(ctx);
        const who = await l.as(as);
        const body = { startDate: rel(from), endDate: rel(to) };
        const headers = { 'Idempotency-Key': `scenario-${ref}` };
        const [a, b] = await Promise.all([who.post(`/items/${l.items[item]}/requests`, body, headers), who.post(`/items/${l.items[item]}/requests`, body, headers)]);
        ctx.assert.equal(a.status, 201);
        ctx.assert.equal(b.body.reservation.id, a.body.reservation.id);
        refs(ctx)[ref] = a.body.reservation.id;
      },
      'request.countFor': async (ctx, { as, item, from, count }) => {
        const l = await lib(ctx);
        const n = l.db.prepare('SELECT count(*) n FROM reservations WHERE item_id = ? AND borrower_id = ? AND start_date = ?').get(l.items[item], `p-${as}`, rel(from)).n;
        ctx.assert.equal(n, count);
      },
      'request.act': async (ctx, args) => {
        const res = await act(ctx, args);
        ctx.assert.equal(res.status, 200, `${args.action}: ${JSON.stringify(res.body)}`);
      },
      'request.actExpectRefusal': async (ctx, args) => {
        const res = await act(ctx, args);
        ctx.assert.equal(res.status, args.status, JSON.stringify(res.body));
      },
      'request.approveConcurrently': async (ctx, { as, refs: list }) => {
        const results = await Promise.all(list.map((ref) => act(ctx, { as, ref, action: 'approve' })));
        ctx.state.approvals = results.map((r) => r.status);
      },
      'request.exactlyOneApproved': async (ctx, { refs: list }) => {
        const statuses = await Promise.all(list.map(async (ref) => (await view(ctx, ref)).status));
        ctx.assert.equal(statuses.filter((s) => s === 'approved').length, 1, `statuses: ${statuses}`);
        ctx.assert.equal(statuses.filter((s) => s === 'pending').length, list.length - 1, `statuses: ${statuses}`);
        ctx.assert.deepEqual([...ctx.state.approvals].sort(), [200, ...Array(list.length - 1).fill(409)].sort());
      },

      'loan.approved': (ctx, args) => drive(ctx, args, 1),
      'loan.borrowed': (ctx, args) => drive(ctx, args, 3),
      'loan.status': async (ctx, { ref, status }) => ctx.assert.equal((await view(ctx, ref)).status, status),
      'loan.dueDate': async (ctx, { ref, date }) => ctx.assert.equal((await view(ctx, ref)).endDate, rel(date)),
      'loan.evidenceFrom': async (ctx, { ref, authors, disputed }) => {
        const r = await view(ctx, ref);
        const seen = new Set(r.conditionNotes.map((n) => n.author.handle));
        for (const a of authors) ctx.assert.ok(seen.has(a), `no evidence from ${a}`);
        ctx.assert.equal(r.disputed, disputed);
        const owner = r.conditionNotes.find((n) => n.role === 'owner');
        const borrower = r.conditionNotes.filter((n) => n.role === 'borrower' && n.phase === 'return');
        ctx.assert.ok(owner.disagrees && borrower.length === 1 && !borrower[0].disagrees, 'both viewpoints kept separately');
      },

      'item.hide': async (ctx, { as, item }) => {
        const l = await lib(ctx);
        const res = await (await l.as(as)).post(`/items/${l.items[item]}/visibility`, { hidden: true });
        ctx.assert.equal(res.status, 200);
      },

      'extension.propose': async (ctx, { as, ref, to, ext }) => {
        const l = await lib(ctx);
        const res = await (await l.as(as)).act(refs(ctx)[ref], 'extensions', { proposedEndDate: rel(to) });
        ctx.assert.equal(res.status, 201, JSON.stringify(res.body));
        exts(ctx)[ext] = res.body.reservation.pendingExtension.id;
      },
      'extension.accept': async (ctx, { as, ext }) => {
        const l = await lib(ctx);
        const res = await (await l.as(as)).post(`/extensions/${exts(ctx)[ext]}/accept`);
        ctx.assert.equal(res.status, 200, JSON.stringify(res.body));
      },
      'extension.acceptExpectRefusal': async (ctx, { as, ext, status }) => {
        const l = await lib(ctx);
        const who = await l.as(as);
        const res = await who.post(`/extensions/${exts(ctx)[ext]}/accept`);
        ctx.assert.equal(res.status, status, JSON.stringify(res.body));
        // Answer it so the borrower can ask again with fewer days.
        ctx.assert.equal((await who.post(`/extensions/${exts(ctx)[ext]}/decline`)).status, 200);
      },
    },
    async afterScenario(ctx) {
      if (ctx.state.lib) await ctx.state.lib.stop();
    },
  };
}
