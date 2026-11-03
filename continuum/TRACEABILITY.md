# Traceability: acceptance → model → tests

Model: `continuum/model/borrowbox.adl` (package `avlon.borrowbox` cycle-1, core `adl/1.7`,
attestation `sha256:f81cd224fe95bf70327e0e4540de10aade4d9428a4ff5f40ad37a549619dc4df`,
changeState `sha256:2a970ccbcbf7166fcfbbd5a243cad584c7b1a07b646beba57defa39643be61a7`, which includes lending circles).
Business model: `continuum/business.bdl` (definition `2026-11-03.1`).

| Acceptance | ADL requirement / rule (DECLARED) | BDL element | Tests that exercise it |
|---|---|---|---|
| A01 catalog | `Lending.CatalogDiscovery.CatalogShowsAvailability` | capability `OfferItems`, entity `Item` | `catalog.test.js` · e2e *lists a new item*, *keyboard only* |
| A02 identity + pending | `ReservationCoordination.RequestsPersistAsPending` | action `RequestToBorrow`, outcome `Pending` | `lifecycle.test.js` · scenario `state-survives-restart` · e2e *whole loan* (reload) |
| A03 approve/decline/cancel, invalid transitions | `ReservationCoordination.DecisionsFollowLifecycle`, rules `OnlyPendingIsDecided`, `LoanStepsInOrder` | `ReservationLifecycle` transitions | `lifecycle.test.js` (*steps cannot be skipped*) |
| A04 conflicting approval, concurrency | `ReservationCoordination.ApprovalsNeverOverlap`, rule `CommittedReservationsNeverOverlap` | invariant `NoOverlappingCommitments` | `concurrency.test.js` (HTTP race + 4-process race + trigger bypass) · scenario `overlapping-approval-refused` · e2e *conflicting requests* |
| A05 self-borrow, unauthorized actions | `NoSelfBorrowing`, `EveryActionAuthorizedOnServer`, `OnlyOwnersShapeListings`; command `admits … requires ItemOwnership/Borrowership/NonOwnership` | invariant `OwnerNeverBorrowsOwnItem`, forbidden `BorrowOwnItem`, `mayPerform` | `authorization.test.js` · scenario `self-borrow-refused` |
| A06 ready → pickup → return → completion, audit | `LoanCustody.HandoffIsAttributed`; events journaled into `ActivityJournal`; read-model `LoanHistory` | transitions `MakeReady`…`CompleteReturn`, obligation `ReturnBorrowedItem` | `handoff-evidence.test.js` (*full journey*) · scenario `full-loan-journey` · e2e *whole loan* |
| A07 separate evidence, dispute preserved | `ConditionEvidence.EvidenceIsAttributedAndPreserved`, rule `EvidenceIsAppendOnly` | entity `ConditionNote`, forbidden `OverwriteConditionNote`, unspecified `DamageResolution` | `handoff-evidence.test.js` (disagreement, append-only triggers) · scenario `full-loan-journey` |
| A08 extension approval + collision recheck | `ReservationCoordination.ExtensionsRecheckConflicts`, rule `ExtensionRecheck` | `ExtensionLifecycle`, rule `ExtensionMustFit` | `extensions.test.js` · scenario `extension-recheck` · e2e *extension* |
| A09 overdue + return | `LoanCustody.LateLoansRemainReturnable`, rule `OverdueIsInformational` | rule `OverdueStillReturns` | `handoff-evidence.test.js` (*late loan*) · e2e *overdue* |
| A10 hidden listing keeps reservations | `ItemListing.HiddenItemsKeepCommitments`, rule `HiddenItemsTakeNoNewRequests` | `ListingLifecycle`, rule `HiddenItemsTakeNoRequests` | `catalog.test.js` (*hiding…*) · scenario `hidden-item-keeps-reservations` · e2e *hiding* |
| A11 persistence, repeatable seed | `StateSurvivesRestart` (resources bound to `sqlite-file`) | | `persistence.test.js` · scenario `state-survives-restart` |
| A11/A05 duplicates | `RepeatedSubmissionIsHarmless` | | `persistence.test.js` (idempotency, duplicate) · e2e *double-clicked request* |
| Date policy | policy `CalendarDatePolicy`, rule `RequestsFitTheCalendar` | invariant `RangeIsOrdered` | `lifecycle.test.js` (validation) · `persistence.test.js` (time-zone "today") |
| A12 keyboard + mobile | (not architecture) | | e2e *keyboard only*, *@mobile* |
| Circles: create, invite, join, leave, remove | `LendingCircles.CirclesGrowByInvitation`, rules `OnlyMembersInvite`, `OrganiserStaysMember`; commands admitted by `CircleMembership` / `OpenInvitation` / `CircleOrganisership` | entities `Circle`, `Membership` (`MembershipLifecycle`), invariant `OrganiserStaysActive`, unspecified `OrganiserSuccession` | `circles.test.js` · scenario `circle-only-request-needs-membership` · e2e *start a circle* |
| Circles: everybody or circles only | `LendingCircles.OwnersChooseAudience`, rule `ShareOnlyWhereMember`; command `SetItemAudience` | enum `Audience`, entity `CircleShare`, action `ChooseAudience`, rule `ShareOnlyWhereMember` | `circle-access.test.js` (*only the owner chooses*) · e2e *lend an item just to that circle* |
| Circles: circle-only requests need a shared circle | `LendingCircles.CircleOnlyItemsReachOnlyMembers`, rule `CircleOnlyNeedsSharedCircle`; `RequestToBorrow` now `requires NonOwnership, ItemReach` | rule `CircleOnlyNeedsSharedCircle` | `circle-access.test.js` (catalog, request, DB trigger) · scenario `circle-only-request-needs-membership` · e2e *joining a circle* |
| Circles: membership changes keep commitments | `LendingCircles.MembershipChangesKeepCommitments`, rule `MembershipChangesKeepCommitments` | rules `MembershipChangesKeepCommitments`, `LeavingKeepsCommitments`; forbidden `CancelOnMembershipChange` | `circle-access.test.js` (removal, leaving, narrowing, pending kept, removal racing a request) · scenario `removal-keeps-commitments` · e2e *removal* |

The ADL `test` elements (`CatalogAndListingTests`, `RequestLifecycleTests`, `ApprovalConcurrencyTests`,
`AuthorizationTests`, `HandoffAndEvidenceTests`, `ExtensionTests`, `PersistenceAndIdempotencyTests`,
`CircleMembershipTests`, `CircleAccessTests`)
each name the requirements they verify. Every `server/test/*.test.js` file opens with a comment
naming the model test it realizes, and each acceptance scenario's `test` field points at one of them.

## Recorded evidence (`continuum/evidence/`)

- `bdl-compile.txt`: BDL valid, 0 errors. 8 warnings: `no-declared-performer` on the three *forbidden*
  actions (deliberate: a forbidden act has no permitted performer), and `effective-performer-set` on
  the five circle actions granted to `Member` (informational: Owner, Borrower and Organiser specialize
  Member, so they may perform them too, which is intended).
- `package-check.txt`: development package intact; every check evaluated over the attested state.
- `acceptance-run.txt`: `continuum package run`, 8/8 scenarios passed against the real app.
- `transition-0002-check.txt`: the lending-circles transition checked against checkpoint 0001
  (`base true`, `identity true`, refused at apply), and a one-operation probe proving that every
  apply to this model is refused by a Host defect (see below).
- `assessment.txt`: conformance assessment. **L1 is undetermined** with
  `model/language-version-unsupported`: the assessor does not yet support core `adl/1.7`, which this
  model uses for command admissions (the authorization semantics). It was a deliberate choice to keep
  authorization in the model rather than downgrade to `adl/1.6` to obtain a level. No level is claimed.

## Lifecycle state

The initial state (changeState sha256:8ae3819b…) was **accepted** by the project owner (mike@avlon.ca) on 2026-11-03T02:44:50Z, verified against commit 0992b49 with the suite re-run (6/6). Acceptance fact sha256:38f7355e9703a0b900599bc6390cf86db232be51083abd2804a1725a9328a07c, appended to continuum/workflow.jsonl. Ledger checkpoint 0001 (initial) recorded in continuum/ledger.json and continuum/history/0001-initial.

### Lending circles (transition 0002, not yet a checkpoint)

The lending-circles change is `transitions/0002-lending-circles/`: the `.adl-change`, the BDL
candidate and its canonical diff, the bindings, the two added scenarios and the adapter. The project
owner approved it before implementation (`APPROVAL.md`). The Continuum Host refuses **every** apply to
this model (it adds an `attributes` member to both `Policy` elements and then rejects its own
result as `adl/structural/unknown-member`). So `apply(A, Δ) = B` is **not proved**, the transition
cannot get an id, and it cannot be approved, materialized or adopted through `continuum icp`. On the
owner's instruction, state B was written into `continuum/model/` directly and the package was rebuilt.
Both A and B compile with 0 errors and 0 warnings. Until the Host is fixed and the transition is
adopted (or reconciled), `continuum guard ci` reports `lifecycle/guard/state-unrecorded`:
the live package is not checkpoint 0001.
