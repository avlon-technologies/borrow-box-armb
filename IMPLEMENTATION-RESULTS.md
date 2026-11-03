# Implementation results: BorrowBox (Arm B, Continuum)

**Status: definition of done met for V1, with the gaps listed below.** BorrowBox is a locally runnable
product (Node 24 + SQLite + React). It has a real backend, a persistent database, seeded demo data, a
polished responsive interface, and three automated suites that were run with the results recorded here.

Run date 2026-11-02 (America/Toronto). Setup and use: [README.md](README.md).

## Verification evidence (run, not assumed)

| Suite | Command | Result |
|---|---|---|
| API, rules, authorization, concurrency, persistence | `npm test` | **48 / 48 passed** (7 files, `node --test`) |
| Browser journeys (Chromium desktop + Pixel 7 mobile) | `npm run test:e2e` | **9 / 9 passed** (about 10 s) |
| Continuum acceptance scenarios against the real app | `npm run test:acceptance` (`continuum package run continuum`) | **6 passed, 0 failed, 6 executed**, in `continuum/evidence/acceptance-run.txt` |
| Development package integrity | `continuum package check continuum` | intact, in `continuum/evidence/package-check.txt` |
| ADL compile | Continuum compiler | **0 errors, 0 warnings** |
| BDL compile | Continuum BDL compiler | **valid, 0 errors**, 2 deliberate warnings, in `continuum/evidence/bdl-compile.txt` |
| Fresh clone | `git clone` → `npm run setup` → `node server/src/index.js` | setup exit 0, seeded 4 people and 10 items; `/api/config` 200, `/` 200, and `/api/items` refuses with `not_signed_in` when there is no identity |

All three suites were last run after the final code change (the seed-clock fix). The documentation
commits that followed changed no code.

## Acceptance criteria

| | How it is met | Evidence |
|---|---|---|
| A01 | Explore page: search, category filters, availability badges ("Free now", "Back on …"), real photos, and an item page with rules, max loan length, booked dates calendar and owner | `catalog.test.js`; e2e *lists a new item*, *keyboard only* |
| A02 | Identity switcher (4 seeded people); request dates on the calendar; the pending request survives a reload and a restart | `lifecycle.test.js`, `persistence.test.js`; e2e *whole loan*; scenario `state-survives-restart` |
| A03 | Approve/decline (optional note) by the owner, cancel by the borrower; every out-of-order step returns 409 | `lifecycle.test.js` (*steps cannot be skipped*) |
| A04 | Overlapping pending requests coexist; approval checks under `BEGIN IMMEDIATE` plus SQLite triggers. Parallel HTTP approvals and 4 OS processes racing on one file each commit exactly one | `concurrency.test.js`; scenario `overlapping-approval-refused`; e2e *conflicting requests* |
| A05 | Server-side checks per command, plus a self-borrow trigger. Every command is refused for the wrong person and for no identity | `authorization.test.js` (10 tests); scenario `self-borrow-refused` |
| A06 | ready → pickup → return → confirm, each attributed in an append-only journal shown as the loan history | `handoff-evidence.test.js`; scenario `full-loan-journey`; e2e *whole loan* |
| A07 | Separate borrower/owner condition notes (rating, text, photos) at each handoff; disagreement is a new note, and the loan is marked disputed; triggers forbid edits and deletes | `handoff-evidence.test.js`; scenario `full-loan-journey` |
| A08 | Borrower proposes and owner accepts/declines; conflicts checked at proposal (suggesting the last free day) and rechecked at acceptance | `extensions.test.js`; scenario `extension-recheck`; e2e *extension* |
| A09 | Overdue banner and badges computed in the community time zone; return works the same | `handoff-evidence.test.js`; e2e *overdue* |
| A10 | Hide/show on My shelf: new requests refused and the item is hidden from others, while existing reservations continue | `catalog.test.js`; scenario `hidden-item-keeps-reservations`; e2e *hiding* |
| A11 | SQLite file in `data/` (WAL); `npm run seed` is repeatable and relative to today; the server auto-seeds on first run; idempotency keys and duplicate refusal | `persistence.test.js`; fresh clone above |
| A12 | Keyboard: skip link, visible focus, labelled controls, calendar days are labelled buttons (Tab and Enter; no arrow-key grid navigation). Mobile: bottom tab bar and fluid layouts. Feedback: `aria-live` toasts and inline errors that explain why | e2e *keyboard only* and *@mobile*; visually checked at desktop and phone widths during development |
| A13 | 48 + 9 + 6 automated tests, all executed above | this file |
| A14 | README with setup, a 5-minute demo and rules; every button is wired to a real API call, with no placeholders | README; e2e journeys |

## Continuum work (Arm B)

- **ADL**: `continuum/model/borrowbox.adl` with manifest `avlon.borrowbox` cycle-1, core `adl/1.7`.
  - Attestation `sha256:1631f83eecbc048520644600379ef320132af8ef0806436cb6bff032dd5eed42`.
  - changeState `sha256:8ae3819b488c8639ce39955a41a7303c6f8cd4f360c74f65849a61deb1055a5f`.
  - Content: 3 actors, the Lending domain (5 capabilities, 11 requirements, 2 policies), and the Library context. The context has 15 commands with authorization *admissions* (evidence ItemOwnership, Borrowership, NonOwnership), 12 events, 5 resources, the LoanHistory read-model and 9 business rules. It also has 2 services, a deployable and 7 tests that name the requirements they verify.
- **BDL**: `continuum/business.bdl`, definition `2026-11-02.2`.
  - Lifecycles for Item, Reservation and Extension.
  - Invariants NoOverlappingCommitments and OwnerNeverBorrowsOwnItem; forbidden actions; the obligation ReturnBorrowedItem.
  - `unspecified DamageResolution` records that settlement is deliberately out of scope.
- **Bindings** for LocalDevelopment (node-process, in-process modules, sqlite-file, sqlite-journal, local-directory), plus technology vocabulary claims.
- **Acceptance**: 6 Given/When/Then scenarios with an adapter (`continuum/acceptance/adapter.mjs`) that drives the real HTTP server over a real SQLite file.
- **Traceability**: [`continuum/TRACEABILITY.md`](continuum/TRACEABILITY.md). Each test file names the model test it realizes, and the event journal uses the model's event names.
- How it shaped the product: the model, written before the code, fixed the authorization matrix, the committed-status set that blocks dates, the append-only evidence, and the double extension check. The code mirrors its two services. The models set no UI or algorithms.

## Gaps and limits (stated plainly)

1. **No L1 conformance level.** `continuum conformance assess` returns L1 *Undetermined* with
   `model/language-version-unsupported`, because the assessor does not support `adl/1.7`. I kept `adl/1.7`
   because its command admissions carry the authorization semantics. This is a tool capability limit. No
   level (L1 to L4) is claimed, and the green tests are reported as test results only.
2. **The package is not accepted.** `continuum package accept continuum --as <you> --verified-against HEAD`
   is a human judgment, left to the project owner. No ledger checkpoint exists.
3. **No real authentication.** Sign-in is a demo identity switcher with no passwords, though
   authorization is enforced on the server.
4. **No out-of-app notifications** (email or push). The Loans badge and the *Needs you* list stand in.
5. **Photos are stored on the local disk** (`data/uploads`), at most 4 per upload and 4 MB each, resized
   in the browser. There is no CDN or cloud storage.
6. **The item listing audit is partial.** Listing, edit and hide events are not in the loan journal. The
   model routes them to sinks, so only loan activity has an attributed history.
7. **No dispute resolution** beyond preserving both accounts (BDL `unspecified DamageResolution`).
8. Not verified: screen-reader testing with real assistive technology, or browsers other than Chromium.

## Assumptions

- A borrower can cancel any time before pickup. Cancelling frees the dates.
- When one request is approved, other overlapping pending requests stay pending, and approving them is
  refused with an explanation. They are not auto-declined, so the owner keeps the decision and the
  wording.
- An extension is refused at proposal if it already clashes, and is rechecked at acceptance. It may
  exceed the item's maximum loan length.
- A condition rating is required at pickup, return and return confirmation.
- Dates are inclusive calendar days in one community time zone (`BORROWBOX_TZ`, default
  America/Toronto).
- Lending circles and any later feature were not built (out of V1 scope).

## Cost, time, intervention

- **Wall-clock time**: about 2 h 10 min of agent work (first prompt 19:28 EST to final commit about 21:38 EST,
  2026-11-02), including one context compaction. The Continuum modelling and packaging itself took about 15 min, and the acceptance adapter and run about 10 min.
- **Human intervention**: none beyond the initial assignment and two "continue" prompts. No questions were asked.
- **Cost**: token and dollar usage are not visible to the agent. Read them from the Claude Code session
  usage (`/cost`) for this session.
- **Tools**: Claude Code (Opus 5.5) with the Continuum CLI 0.20.0 and the Continuum MCP knowledge and
  compiler tools. No paid external services are used at runtime.
- The other experimental repository was not inspected.
