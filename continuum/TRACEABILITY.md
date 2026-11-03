# Traceability: acceptance → model → tests

Model: `continuum/model/borrowbox.adl` (package `avlon.borrowbox` cycle-1, core `adl/1.7`,
attestation `sha256:1631f83eecbc048520644600379ef320132af8ef0806436cb6bff032dd5eed42`).
Business model: `continuum/business.bdl` (definition `2026-11-02.2`).

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

The ADL `test` elements (`CatalogAndListingTests`, `RequestLifecycleTests`, `ApprovalConcurrencyTests`,
`AuthorizationTests`, `HandoffAndEvidenceTests`, `ExtensionTests`, `PersistenceAndIdempotencyTests`)
each name the requirements they verify. Every `server/test/*.test.js` file opens with a comment
naming the model test it realizes, and each acceptance scenario's `test` field points at one of them.

## Recorded evidence (`continuum/evidence/`)

- `bdl-compile.txt`: BDL valid, 0 errors. 2 warnings (`no-declared-performer` on the two *forbidden*
  actions), deliberate: a forbidden act has no permitted performer.
- `package-check.txt`: development package intact; every check evaluated over the attested state.
- `acceptance-run.txt`: `continuum package run`, 6/6 scenarios passed against the real app.
- `assessment.txt`: conformance assessment. **L1 is undetermined** with
  `model/language-version-unsupported`: the assessor does not yet support core `adl/1.7`, which this
  model uses for command admissions (the authorization semantics). It was a deliberate choice to keep
  authorization in the model rather than downgrade to `adl/1.6` to obtain a level. No level is claimed.

## Lifecycle state

The initial state is **not accepted**. `continuum package accept continuum --as <you> --verified-against HEAD`
is a human judgment and is left to the project owner. No ledger checkpoint is recorded.
