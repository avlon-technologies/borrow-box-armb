# Experiment closeout: BorrowBox, Arm B

**Final disposition: experiment complete, implementation preserved.** Nothing in the application, its Continuum package or its transition records was changed at closeout. Known defects are recorded below and deliberately left unfixed.

Central report: **[BorrowBox: Vision Fidelity and Architectural Evolution — Final Experiment Report](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/RESULTS.md)** (`continuum-architecture/experiments/2026-11-02-borrowbox-vision-fidelity/`).

## 1. Experiment identity and arm assignment

| | |
|---|---|
| Experiment | EXP-BORROWBOX-001: does a formal architecture practice (Continuum) help an AI agent realize a product vision and evolve it? |
| This repository | **Arm B: with Continuum.** [`CLAUDE.md`](../CLAUDE.md): use the Continuum tools to author and check ADL and BDL, model obligations, and connect tests to intent, but don't let the models "dictate UI layouts, frameworks or implementation algorithms". Also bootstrapped with [`continuum/README.md`](https://github.com/avlon-technologies/borrow-box-armb/blob/13498c7dd137effdd1bbe901685dabec9cd1016c/continuum/README.md) and a 23-line candidate [`business.bdl`](https://github.com/avlon-technologies/borrow-box-armb/blob/3b6442fd0e11459db37689f59e3aec8929a8266e/continuum/business.bdl) |
| Other arm | [borrow-box-arma](https://github.com/avlon-technologies/borrow-box-arma), Arm A, without Continuum |
| Agent | Claude Code, Opus 5.5, auto mode, Windows 11; Continuum CLI 0.20.0 and the hosted Continuum MCP |
| Dates | V1 on 2026-11-02 from 19:28 EST; lending circles from 22:07 EST on 2026-11-02 to 04:52 EST on 2026-11-03; closed 2026-11-03 |

## 2. Frozen product vision and acceptance criteria

[`VISION.md`](../VISION.md), [`ACCEPTANCE.md`](../ACCEPTANCE.md) and [`AGENT-RUN.md`](../AGENT-RUN.md) were committed at bootstrap (`57d5586`, `00d50ca`, `025a5d3`) and never modified. Their git blobs are byte-identical to Arm A's (`4ec217d0…`, `f222573e…`, `778e8540…`). `CLAUDE.md` and the two bootstrap Continuum files differ between the arms, by design.

## 3. Initial implementation (V1)

- **Completion commit:** `0992b49`, 2026-11-02 21:43 EST. The initial package state was accepted, and ledger checkpoint 0001 recorded, at `8f5d780` (21:45 EST).
- **Model first:** ADL `adl/1.7` with 3 actors, the Lending domain (5 capabilities, 11 requirements), commands with authorization admissions, events, resources, 9 business rules, 2 services and 7 tests. BDL with lifecycles, invariants, forbidden actions and obligations. Bindings and 6 acceptance scenarios.
- **Stack:** Node 24, Express 5, built-in `node:sqlite` (WAL), React 19, Vite, `node --test`, Playwright.
- **Built:** all five vision journeys and acceptance criteria A01–A14, with rules in domain code inside `BEGIN IMMEDIATE` plus SQLite triggers.
- **Details:** [`IMPLEMENTATION-RESULTS.md`](../IMPLEMENTATION-RESULTS.md) (V1 record) and [`continuum/TRACEABILITY.md`](../continuum/TRACEABILITY.md).

## 4. Lending-circles evolution

- **Completion commits:** feature `16346d8` and documentation `cfbdcd6`, 2026-11-03 04:52 EST.
- **Process:** classified as both a BDL and an ADL change. The proposal was written before any code and approved by the experimenter ("Approve, write B directly"), recorded in [`transitions/0002-lending-circles/APPROVAL.md`](../transitions/0002-lending-circles/APPROVAL.md).
- **Built:** circles, invitations (accept, decline), per-item audience, leaving, organiser removal, an activity history, and a note to owners on pending requests from removed members.
- **Central rule:** reach is checked only when a request is created. The ADL admission `requires ItemReach` sits on `RequestToBorrow` alone, backed by an INSERT-only trigger. Removal stops new circle-only requests and keeps every commitment.
- **Model state B:** changeState `sha256:2a970ccb…`, attestation `sha256:f81cd224…`, 0 errors and 0 warnings. BDL `2026-11-03.1`.
- **Transition incomplete:** Continuum's `apply` refused every change to this model (see §8, C1). So `apply(A, Δ) = B` is not proven, and checkpoint 0002 is not recorded.

## 5. Final commit and how to reproduce

- **Evaluated commit:** `cfbdcd69750eccd6609a831076369a61dedfa907`. This closeout document was added afterwards and changes no code or Continuum artifact.
- **Run:**

  ```bash
  git checkout cfbdcd69750eccd6609a831076369a61dedfa907
  npm run setup && npm start        # http://localhost:4321, Node 24+
  npm test && npm run test:e2e && npm run test:acceptance
  ```

## 6. Test and verification results

| Check | Result | Status |
|---|---|---|
| Backend tests (`node --test`) | **64 / 64** | re-run at closeout, 2026-11-03 |
| Browser journeys (Chromium desktop + Pixel 7) | **12 / 12** | re-run at closeout |
| Continuum acceptance scenarios | **8 / 8** | re-run at closeout |
| ADL state A recompiles to attestation `sha256:1631f83e…` | yes | re-derived at closeout |
| `apply` of the circles change to state A | **refused** (C1) | reproduced at closeout |
| V1 at completion | 48 backend + 9 browser + 6 scenarios | self-report |
| Package check, BDL compile, guard after circles | intact; valid (0 errors, 8 warnings); PASS with `state-unrecorded` | self-report ([`continuum/evidence/`](../continuum/evidence/)) |
| Conformance | no level attained (`model/language-version-unsupported` for `adl/1.7`) | [`continuum/evidence/assessment.txt`](../continuum/evidence/assessment.txt) |
| Independent review | rubric 8.675 / 10; blind experimenter rating 7/10 after V1, 7/10 after circles | see central report §4 |

The closeout test output is in the central repository: [`evidence/test-runs/`](https://github.com/avlon-technologies/continuum-architecture/tree/main/experiments/2026-11-02-borrowbox-vision-fidelity/evidence/test-runs).

## 7. Significant decisions

- Approval atomicity uses a write lock plus overlap triggers (ADL `CommittedReservationsNeverOverlap`, BDL `NoOverlappingCommitments`). Overlapping pending requests coexist and are never auto-declined.
- Evidence is append-only, enforced by triggers (BDL `forbidden OverwriteConditionNote`). Disagreement is a new note plus a `disputed` flag. `unspecified DamageResolution` records that settlement is out of scope.
- Authorization is expressed as ADL command *admissions* (ItemOwnership, Borrowership, NonOwnership, and for circles ItemReach), each mirrored by a server check.
- Circles:
  - Placed in the Library context, so reach is checked atomically with the request.
  - Pending requests survive removal (a BDL rule, approved).
  - `unspecified OrganiserSuccession`.
  - Circle history has a single writer, after the compiler's `multi-writer-store` warning (below).

**The compiler finding.** While drafting state B, the ADL compiler warned `adl/architectural/multi-writer-store` on `ActivityJournal`: 3 writing services (`CatalogService`, `BorrowingService`, `CircleService`), where the rule allows 1. Circle history was moved into its own store (`CircleStore`, table `circle_events`), written only by `CircleService` / `server/src/circles.js`. The same rule had flagged 2 writers during V1 modelling. The diagnostic is preserved verbatim in the central repository: [`evidence/multi-writer-store-diagnostic.md`](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/evidence/multi-writer-store-diagnostic.md).

The central report (§5.4) compares these decisions with Arm A's. Arm A reached almost all of them without Continuum, including a single-writer circle history.

## 8. Known defects and limitations

Verified at closeout against this commit on throwaway servers. Full reproductions are in [DEFECTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/DEFECTS.md). **Not fixed.**

| ID | Defect | Root cause |
|---|---|---|
| D1 | **An overdue loan does not block a new booking.** A loan still `borrowed` past its due date stops counting for later dates. The owner can approve and mark ready another person's booking for today. | `committedOverlaps` compares scheduled dates only (`server/src/borrowing.js:80-87`), and the triggers do the same (`server/src/db.js:106-126`). `markReady` has no possession check (`borrowing.js:194-202`). The BDL and ADL overlap rules are stated over scheduled dates, and no rule ties `LoanCustody` to availability, so no model check or scenario could catch it. Also present in Arm A. |
| D2 | **A past declined or cancelled request keeps an item visible** after it is hidden or limited to circles. | The "involved" query has no status filter (`server/src/catalog.js:205`). Also present in Arm A. |
| D3 | **Bodyless requests cause HTTP 500.** `PATCH /api/items/:id` (`catalog.js:283`), `POST /api/circles/:id/invitations` (`circles.js:76`) and `POST /api/session` (`people.js:7`, reachable without signing in). Not reachable from the UI. | Express 5 leaves `req.body` undefined, and these handlers read or bind it unchecked. Arm A returns 415. |
| D4 | **An extension can be proposed, and accepted, to a date already in the past** on a loan more than one day late. | `borrowing.js:256` only requires a date after the current due date, and `acceptExtension` (`:282-295`) doesn't compare with today. Arm A refuses past dates. |
| C1 | **Continuum `apply` refuses every change to this model.** The applied result gives both `Policy` elements an `attributes` member (`adl/structural/unknown-member` → `change/result/invalid-state`). | A Continuum tooling defect, reproduced at closeout with the pinned compiler and filed as [continuum#11](https://github.com/avlon-technologies/continuum/issues/11). Consequences: no `apply(A, Δ) = B` proof, `icp check` refuses, `icp ready` stays at `identify`, approval is recorded only as a markdown note, no checkpoint 0002, and `guard ci` warns `lifecycle/guard/state-unrecorded`. |

Limitations stated by the agent: no real authentication (demo identity switcher); no out-of-app notifications; listing, edit and hide events are not in the loan journal; organiser succession is unspecified; an invitation can't be withdrawn; circles can't be renamed or deleted.

## 9. Agent time, interventions and cost

From the session transcripts (central report [EVIDENCE §6](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/EVIDENCE.md#6-time-interventions-and-cost)):

| | V1 | Lending circles |
|---|---|---|
| First prompt → completion commit | 2 h 15 min | 6 h 45 min |
| Self-reported | "about 2 h 10 min" | "about 7 h … about 1 h 50 min active, about 4 h 45 min stalled" |
| Human messages | 2 × "continue", each after an API error | 1 × "continue" (after an API error); 1 approval answer |
| Main-session output tokens | 216,007 | 145,995 |

- **Dollar cost:** not available.
- **Correction to the self-report:** the circles experience report attributes the long stall to a broken shell heredoc. The transcript shows it began with `API Error: Connection lost mid-response` at 03:38Z, the same moment Arm A's session hit the same outage.
- **Timing caution:** wall-clock times are dominated by shared outages and are not evidence of efficiency.
- The approval answer is the only decision-bearing human intervention in the whole experiment. It exists because the Continuum workflow asks for approval of a model change, and because the apply defect forced a choice about how to proceed.

## 10. Links

| | |
|---|---|
| Final report | [RESULTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/RESULTS.md) |
| Evidence baseline | [EVIDENCE.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/EVIDENCE.md) |
| Defects | [DEFECTS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/DEFECTS.md) |
| Continuum improvements | [FINDINGS.md](https://github.com/avlon-technologies/continuum-architecture/blob/main/experiments/2026-11-02-borrowbox-vision-fidelity/FINDINGS.md) |
| Experience reports | [V1](https://github.com/avlon-technologies/continuum-architecture/blob/main/experience/2026-11-02-borrow-box-armb-greenfield-build.md) · [lending circles](https://github.com/avlon-technologies/continuum-architecture/blob/main/experience/2026-11-03-borrow-box-armb-lending-circles.md) |
| Arm A closeout | [borrow-box-arma/docs/EXPERIMENT-CLOSEOUT.md](https://github.com/avlon-technologies/borrow-box-arma/blob/main/docs/EXPERIMENT-CLOSEOUT.md) |
| Screenshots | none committed by the agent · [reviewer set](https://github.com/avlon-technologies/continuum-architecture/tree/main/experiments/2026-11-02-borrowbox-vision-fidelity/evidence/screenshots/arm-b) |

## 11. Final disposition

**Experiment complete; implementation preserved.**

The application, its tests, its data, its Continuum package, ledger, workflow record and the incomplete transition `0002-lending-circles` are exactly as evaluated at `cfbdcd6`. Defects D1–D4 remain on purpose. The transition is left unadopted: once continuum#11 is fixed, it can be checked and adopted as a separate, dated act that references this closeout, not by rewriting history.
