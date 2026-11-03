# Approval record (outside the lifecycle facts)

**What was approved.** The lending-circles proposal in this folder: the BDL candidate
(`proposed/business.bdl`, canonical diff in `proposed/business.canonical.diff`) and the ADL change
(`changes/lending-circles.adl-change`, resulting state `proposed/model/`).

**Who, when, how.** The project owner (mike@avlon.ca) approved it in the Claude Code session on
2026-11-03, choosing "Approve, write B directly" when asked. Approval came before any implementation
code was written.

**Why this is a note and not a `continuum icp approve` fact.** `icp approve` needs a transitionId,
and `continuum icp ready` keeps it at the first step (`identify`) because `icp check` refuses with
`lifecycle/proposal/apply-refused`. The apply refusal is a Continuum Host defect, not a defect of
this change:

- Every apply to this model fails, including a one-operation probe that only changes a description.
  The applied result gives both `Policy` elements (`ServerSideAuthorization` 72dc4b89…,
  `CalendarDatePolicy` 27002ac9…) an `attributes` member, which is refused as
  `adl/structural/unknown-member` and then `change/result/invalid-state`.
- State A (`changeState sha256:8ae3819b…`) and state B (`changeState sha256:2a970ccb…`,
  attestation `sha256:f81cd224…`) each compile with 0 errors and 0 warnings.
- `continuum icp check` against `continuum/history/0001-initial` reports `base true`,
  `identity true`, and refuses only at apply.

**What was done instead.** As the owner chose, state B was written into `continuum/model/` and the
BDL into `continuum/business.bdl`, the bindings were refreshed, and the package was rebuilt. This
transition stays as the change's explanation. The step **not** established is the mechanical proof
`apply(A, Δ) = B`. Checkpoint 0002 has not been recorded, so `continuum guard ci` reports
`lifecycle/guard/state-unrecorded` until the Host is fixed and the transition is adopted
(or reconciled).
