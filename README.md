# BorrowBox

A warm, trustworthy lending library for friends and small communities. Someone lists a possession
with a photo and clear borrowing rules; a friend explores the shelf, asks for dates, and the two of
them coordinate handoff, use and return. Each person keeps their own account of the item's condition.
Friends can also form **lending circles**: invite each other, and lend an item to everybody or only to
their circles.

Avlon Technologies project.

> **Experiment closed (2026-11-03).** This repository is Arm B (with Continuum) of the BorrowBox experiment. It is preserved exactly as evaluated, known defects included. See [`docs/EXPERIMENT-CLOSEOUT.md`](docs/EXPERIMENT-CLOSEOUT.md) and the [final experiment report](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/RESULTS.md).

## Quick start

Requires **Node.js 24 or newer** (it uses Node's built-in SQLite). No other services, accounts or keys.

```bash
npm run setup      # install dependencies, build the interface, seed the demo library
npm start          # http://localhost:4321
```

Open <http://localhost:4321>, choose who you are, and start borrowing. To act as two people at once,
open a second browser profile or a private window and choose someone else there. Each window keeps its
own identity.

| Command | What it does |
|---|---|
| `npm run setup` | `npm install`, `npm run build`, `npm run seed` |
| `npm start` | Serves the API, interface and photos on port 4321 (`PORT` changes it). Seeds automatically on first run if there is no database. |
| `npm run seed` | **Wipes** `data/` and re-seeds the demo library. Stop the server first. |
| `npm run dev` | API with auto-restart on :4321 plus Vite hot reload on <http://localhost:5173> |
| `npm test` | API, rules, authorization and concurrency tests (`node --test`, 64 tests) |
| `npm run test:e2e` | Browser journeys with Playwright (12 tests; first run `npx playwright install chromium`) |
| `npm run test:acceptance` | The Continuum acceptance scenarios against the real app (8 scenarios) |

Configuration (environment variables, all optional):

- `PORT` (default `4321`)
- `BORROWBOX_DATA`: data directory (default `./data`, holding `borrowbox.sqlite` and `uploads/`)
- `BORROWBOX_TZ`: the community time zone (default `America/Toronto`)
- `BORROWBOX_SECRET`: cookie-signing secret (default: generated once into `data/session-secret`)

## Demo walkthrough (about 5 minutes)

The seed is relative to today, so the demo always has something happening:

| Person | Lends | Situation in the seed |
|---|---|---|
| **Maya Chen** | tent, drill, slide projector, guitar | Borrowing Priya's books and has asked for more time; Jo's Dutch ovens are approved for next week |
| **Sam Okafor** | city bike (**circle-only**: Riverside Neighbours), camera | Jo has his camera and is **one day overdue**; Priya picks the bike up tomorrow (ready); Sam has asked for Jo's mixer |
| **Jo Rivera** | stand mixer, Dutch ovens | **Two overlapping requests** for the mixer (Sam and Priya) are waiting for her |
| **Priya Natarajan** | books, board game | Maya's past board-game loan ended in a **condition disagreement**, kept in full |

Circles in the seed: **Riverside Neighbours** (organised by Maya; Priya and Sam are members; Jo has an
open invitation from Sam) and **Supper Club** (organised by Jo, with Maya).

1. **Conflicting requests.** Choose *Jo*, then **Loans → Needs you**. Open Sam's mixer request: a note
   says Priya asked for overlapping days. Approve it. Open Priya's request: *Approve* is now disabled
   and explains why. Decline it with a kind note.
2. **A whole loan with two accounts.** In one window choose *Sam*, search "tent", pick dates and send
   a request. In another window choose *Maya*: **Loans** shows it under *Needs you*. Approve it, then
   mark it ready with a pickup note. As Sam, confirm pickup with a condition rating, then start the
   return. As Maya, confirm it's back, tick *I see its condition differently*, and say why. Both views
   now sit side by side and the history names who did what and when.
3. **Extension and re-check.** As *Priya*, accept Maya's request for more time on the books, and the
   due date moves. To see the re-check, have a borrower ask for more time, then (as the owner) approve
   someone else's request for those later days: accepting the extension is then refused.
4. **Overdue.** As *Jo*, open the camera loan: it's clearly overdue, and returning still works as normal.
5. **Hide.** As *Jo*, open the Dutch ovens on **My shelf** and choose *Hide from new requests*.
   Others can no longer find or request it; Maya's approved booking is untouched.
6. **List something.** **My shelf → Lend something**: add a photo, title, rules and maximum loan length.
   Under *Who can borrow it?* choose *Everyone* or *Just my circles*.
7. **Lending circles.** As *Jo*, search "bike": nothing, because Sam lends it only to Riverside
   Neighbours. Open **Circles** (the badge shows one invitation) and join. The bike now appears, with a
   circle badge (try the *From my circles* filter), so ask for it. Then as *Maya*, the organiser, open
   Riverside Neighbours and **Remove** Jo. As Jo, the bike no longer takes new requests from her, but
   her request is still there. As *Sam*, open it: a note says Jo has left the circle, and you can still
   approve it. Priya's existing bike loan behaves the same way if she is removed.

## How it works

- **Server**: Node 24 + Express 5, with SQLite via `node:sqlite` (`server/src`). Three services
  mirror the architecture model: `catalog.js` (CatalogService), `borrowing.js` (BorrowingService) and
  `circles.js` (CircleService).
  Every change runs inside one `BEGIN IMMEDIATE` transaction, and the same transaction also writes an
  append-only event journal (the loan history).
- **Interface**: React 19 + Vite (`client/src`), bundled fonts, no external requests at runtime.
- **Identity**: a demo identity switcher. The server signs a cookie naming the chosen person, and
  every request is authorized against that person's relationship to the item or loan, never against
  what the interface shows. No passwords (see *Assumptions*).

### The rules that matter, and where they are enforced

| Rule | Enforcement |
|---|---|
| No two committed loans of one item overlap, even when approvals race | Service check under a write lock, **and** SQLite triggers that refuse any overlapping `approved/ready/borrowed/returning` row. Tested with parallel HTTP approvals and with four separate OS processes racing on one database file. |
| Overlapping *pending* requests are fine | Only committed statuses block dates. |
| Nobody borrows their own item | Service check (403) **and** a database trigger. |
| Only the owner approves, declines, readies, confirms return and answers extensions; only the borrower cancels, picks up, returns and asks for more time | Per-command checks in `borrowing.js` (the model's command *admissions*). |
| Condition evidence is never overwritten | Notes are insert-only; database triggers refuse `UPDATE`/`DELETE` on evidence and on the journal. A disagreement is a new attributed note, and the loan is flagged as disputed. |
| An extension re-checks conflicts | Checked when it's proposed (with the last free day suggested) **and again when it's accepted**. The trigger also guards end-date changes. |
| Overdue loans stay returnable | Overdue is computed for display; it never blocks a step. |
| Hiding keeps commitments | Hidden items refuse new requests and disappear for others; existing requests and loans continue, and their borrowers can still open the item. |
| Circle-only items reach only circle members | An item is offered to *everyone* or *circles only*. A circle-only item is shown to, and can be requested by, only someone who is an active member of one of its circles **together with its owner**, at the moment of the request: service check (403) **and** a database trigger on new reservations. Only the owner chooses the audience, and only among circles they belong to. |
| Membership changes keep commitments | Leaving, being removed, or the owner narrowing the audience only refuses **new** circle-only requests. Pending requests stay with the owner to decide (with a note that the person left), and approved loans carry on through handoff, extension and return. The circle code never touches a reservation, and the check only guards inserts. Tested, including a removal racing a request. |
| Circles grow by invitation | Any active member invites; only the invited person accepts or declines; only the organiser removes members; the organiser can't leave or be removed (also a database trigger). Membership history and circle activity are append-only. |
| No duplicate submissions | Every write carries an `Idempotency-Key` (replayed, not re-applied); buttons lock while submitting; an identical open request is refused as a duplicate. |

### Date and time zone policy

Borrowing periods are whole **calendar days, inclusive of both the pickup and return date**, stored
as `YYYY-MM-DD`. "Today", "overdue" and "can't start in the past" are judged in **one community time
zone** (`BORROWBOX_TZ`, default `America/Toronto`), never the server's or the browser's. Event
timestamps are stored in UTC and shown in the viewer's local time.

## Architecture model (Continuum)

`continuum/` holds the semantic architecture this app is built against: an ADL model
(`continuum/model/borrowbox.adl`, compiled clean), the business model (`continuum/business.bdl`,
valid), bindings to this implementation, eight executable acceptance scenarios with their adapter, and
recorded check evidence. Lending circles were added as an architecture change,
`transitions/0002-lending-circles/`: proposed, approved by the owner, then implemented. A Continuum
Host defect currently refuses every *apply* to this model, so that transition is not yet recorded as
checkpoint 0002 (details in `continuum/TRACEABILITY.md`). See [`continuum/TRACEABILITY.md`](continuum/TRACEABILITY.md) for how each
acceptance criterion maps to model requirements and tests.

## Assumptions

- **Demo identity, not authentication.** Anyone can choose any of the four seeded people. Real sign-in
  is out of scope for V1. Authorization is still fully enforced on the server for whoever is chosen.
- A borrower may cancel before pickup (pending, approved or ready), not only while pending. Plans
  change, and cancelling frees the dates.
- Requests can start today and at most a year ahead, and can't exceed the item's maximum loan length
  (set by the owner, 1 to 90 days). An extension may go beyond that maximum, because the owner decides.
- A condition rating is required at pickup, return and return confirmation, so every handoff has an
  account from the person doing it. Owners can add their own note at any time from *ready* onward.
- Settling a disagreement is left to the people involved (no payments or insurance in V1). Both
  accounts and the disagreement are preserved.
- There are no notifications outside the app: the **Loans** badge and *Needs you* list are the inbox.
- **Circles.** Any member can start a circle and becomes its organiser. Any active member can invite
  anyone not already in it. Only the organiser removes people, and the organiser can't leave (handing
  a circle over, or closing it, is an open question recorded in the business model as
  `OrganiserSuccession`). Removing someone who was only invited is not supported; the invitation
  stays until they answer.
- A circle-only item needs **both** the requester and the owner to be active in one of its circles.
  If the owner leaves a circle, their items stop being offered through it.
- "Must not invalidate existing reservations" covers **pending** requests too: a removed member's
  pending request stays for the owner to decide, with a gentle note. The owner can still decline it.
- An item can be open to everyone **and** shown on circle shelves, so circles can show what their
  members lend.
- Seed photos are from Unsplash (Unsplash License), bundled in `server/seed/photos`.
