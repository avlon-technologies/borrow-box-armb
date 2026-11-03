// Source of the acceptance scenarios. Run `node continuum/acceptance/scenarios.source.mjs`
// to (re)write continuum/acceptance/scenarios/*.scenario.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'scenarios');
mkdirSync(dir, { recursive: true });
const S = '::BorrowBox.Lending';
const start = { step: 'system.start', text: 'the library is running with the demo seed' };

const scenarios = [
  {
    name: 'overlapping-approval-refused',
    purpose: 'Two overlapping pending requests may coexist, but approving both is refused; concurrent approvals commit exactly one.',
    verifies: [`${S}.ReservationCoordination.ApprovalsNeverOverlap`, `${S}.Library.BorrowingService`],
    test: '::BorrowBox.ApprovalConcurrencyTests',
    given: [
      start,
      { step: 'request.submit', args: { as: 'sam', item: 'tent', from: '+10', to: '+13', ref: 'a' }, text: "Sam requests Maya's tent for days 10-13" },
      { step: 'request.submit', args: { as: 'jo', item: 'tent', from: '+12', to: '+15', ref: 'b' }, text: "Jo requests Maya's tent for days 12-15" },
    ],
    when: [{ step: 'request.approveConcurrently', args: { as: 'maya', refs: ['a', 'b'] }, text: 'Maya approves both at the same moment' }],
    then: [{ step: 'request.exactlyOneApproved', args: { refs: ['a', 'b'] }, text: 'exactly one is approved and the other is still pending' }],
    trace: { from: `${S}.Library.ApproveRequest` },
  },
  {
    name: 'self-borrow-refused',
    purpose: 'An owner cannot request their own item, and a non-owner cannot decide or cancel a request.',
    verifies: [`${S}.ReservationCoordination.NoSelfBorrowing`, '::BorrowBox.EveryActionAuthorizedOnServer', `${S}.Library.BorrowingService`],
    test: '::BorrowBox.AuthorizationTests',
    given: [start],
    when: [
      { step: 'request.submitExpectRefusal', args: { as: 'maya', item: 'tent', from: '+20', to: '+21', status: 403 }, text: 'Maya asks to borrow her own tent' },
      { step: 'request.submit', args: { as: 'sam', item: 'tent', from: '+20', to: '+21', ref: 's' }, text: "Sam requests Maya's tent" },
    ],
    then: [
      { step: 'request.actExpectRefusal', args: { as: 'jo', ref: 's', action: 'approve', status: 403 }, text: 'Jo, who does not own it, cannot approve' },
      { step: 'request.actExpectRefusal', args: { as: 'maya', ref: 's', action: 'cancel', status: 403 }, text: "Maya cannot cancel Sam's request" },
    ],
    trace: { from: `${S}.Library.RequestToBorrow` },
  },
  {
    name: 'full-loan-journey',
    purpose: 'Request, approve, ready, pickup, return with borrower evidence, owner confirms with a disagreement; history keeps both.',
    verifies: [`${S}.LoanCustody.HandoffIsAttributed`, `${S}.ConditionEvidence.EvidenceIsAttributedAndPreserved`, `${S}.Library.BorrowingService`],
    test: '::BorrowBox.HandoffAndEvidenceTests',
    given: [start, { step: 'request.submit', args: { as: 'sam', item: 'drill', from: '+0', to: '+2', ref: 'l' }, text: "Sam requests Maya's drill from today" }],
    when: [
      { step: 'request.act', args: { as: 'maya', ref: 'l', action: 'approve' }, text: 'Maya approves' },
      { step: 'request.act', args: { as: 'maya', ref: 'l', action: 'ready' }, text: 'Maya marks it ready' },
      { step: 'request.act', args: { as: 'sam', ref: 'l', action: 'pickup', note: 'Looks great' }, text: 'Sam confirms pickup' },
      { step: 'request.act', args: { as: 'sam', ref: 'l', action: 'return', note: 'Works fine' }, text: 'Sam starts the return' },
      { step: 'request.act', args: { as: 'maya', ref: 'l', action: 'confirm-return', note: 'Chuck is loose', disagrees: true }, text: 'Maya confirms and disagrees' },
    ],
    then: [
      { step: 'loan.status', args: { ref: 'l', status: 'returned' }, text: 'the loan is complete' },
      { step: 'loan.evidenceFrom', args: { ref: 'l', authors: ['sam', 'maya'], disputed: true }, text: 'both accounts remain and the disagreement is recorded' },
    ],
    trace: { from: `${S}.Library.ConfirmReturn` },
  },
  {
    name: 'extension-recheck',
    purpose: 'An extension proposed while the days were free is refused on acceptance once those days are committed to someone else; a shorter one that fits is accepted.',
    verifies: [`${S}.ReservationCoordination.ExtensionsRecheckConflicts`, `${S}.Library.BorrowingService`],
    test: '::BorrowBox.ExtensionTests',
    given: [
      start,
      { step: 'loan.borrowed', args: { owner: 'maya', as: 'sam', item: 'projector', from: '+0', to: '+3', ref: 'x' }, text: "Sam holds Maya's projector until day 3" },
      { step: 'request.submit', args: { as: 'jo', item: 'projector', from: '+6', to: '+8', ref: 'y' }, text: 'Jo has asked for it from day 6' },
    ],
    when: [
      { step: 'extension.propose', args: { as: 'sam', ref: 'x', to: '+7', ext: 'e1' }, text: 'Sam asks to keep it until day 7' },
      { step: 'request.act', args: { as: 'maya', ref: 'y', action: 'approve' }, text: "Maya approves Jo's request before answering Sam" },
    ],
    then: [
      { step: 'extension.acceptExpectRefusal', args: { as: 'maya', ext: 'e1', status: 409 }, text: "Maya's acceptance is refused because of Jo" },
      { step: 'extension.propose', args: { as: 'sam', ref: 'x', to: '+5', ext: 'e2' }, text: 'Sam asks for day 5 instead' },
      { step: 'extension.accept', args: { as: 'maya', ext: 'e2' }, text: 'Maya accepts' },
      { step: 'loan.dueDate', args: { ref: 'x', date: '+5' }, text: 'the loan is now due on day 5' },
    ],
    trace: { from: `${S}.Library.AcceptExtension` },
  },
  {
    name: 'hidden-item-keeps-reservations',
    purpose: 'Hiding an item refuses new requests while an existing approved reservation stays approved.',
    verifies: [`${S}.ItemListing.HiddenItemsKeepCommitments`, `${S}.Library.CatalogService`],
    test: '::BorrowBox.CatalogAndListingTests',
    given: [start, { step: 'loan.approved', args: { owner: 'maya', as: 'sam', item: 'guitar', from: '+4', to: '+5', ref: 'k' }, text: "Sam has Maya's guitar approved" }],
    when: [{ step: 'item.hide', args: { as: 'maya', item: 'guitar' }, text: 'Maya hides the guitar' }],
    then: [
      { step: 'request.submitExpectRefusal', args: { as: 'jo', item: 'guitar', from: '+9', to: '+10', status: 409 }, text: 'Jo cannot request it' },
      { step: 'loan.status', args: { ref: 'k', status: 'approved' }, text: "Sam's reservation is untouched" },
    ],
    trace: { from: `${S}.Library.SetItemVisibility` },
  },
  {
    name: 'state-survives-restart',
    purpose: 'A pending request survives a restart, and a repeated submission with one key creates one request.',
    verifies: ['::BorrowBox.StateSurvivesRestart', '::BorrowBox.RepeatedSubmissionIsHarmless', `${S}.ReservationCoordination.RequestsPersistAsPending`, `${S}.Library.BorrowingService`],
    test: '::BorrowBox.PersistenceAndIdempotencyTests',
    given: [start],
    when: [
      { step: 'request.submitTwiceSameKey', args: { as: 'sam', item: 'tent', from: '+30', to: '+31', ref: 'p' }, text: "Sam's request is sent twice with the same key" },
      { step: 'system.restart', text: 'the library restarts' },
    ],
    then: [
      { step: 'request.countFor', args: { as: 'sam', item: 'tent', from: '+30', count: 1 }, text: 'there is exactly one such request' },
      { step: 'loan.status', args: { ref: 'p', status: 'pending' }, text: 'it is still pending' },
    ],
    trace: { from: `${S}.Library.RequestToBorrow` },
  },
  {
    name: 'circle-only-request-needs-membership',
    purpose: "A circle-only item can be requested only by someone who shares one of its circles with the owner; joining the circle opens it.",
    verifies: [`${S}.LendingCircles.CircleOnlyItemsReachOnlyMembers`, `${S}.LendingCircles.CirclesGrowByInvitation`, `${S}.Library.BorrowingService`, `${S}.Library.CircleService`],
    test: '::BorrowBox.CircleAccessTests',
    given: [start],
    when: [
      { step: 'request.submitExpectRefusal', args: { as: 'jo', item: 'bike', from: '+10', to: '+11', status: 403 }, text: "Jo, not yet in Riverside Neighbours, asks for Sam's circle-only bike" },
      { step: 'circle.accept', args: { as: 'jo', circle: 'Riverside Neighbours' }, text: "Jo accepts Sam's invitation to Riverside Neighbours" },
    ],
    then: [{ step: 'request.submit', args: { as: 'jo', item: 'bike', from: '+10', to: '+11', ref: 'j' }, text: 'Jo can now ask for the bike' }],
    trace: { from: `${S}.Library.RequestToBorrow` },
  },
  {
    name: 'removal-keeps-commitments',
    purpose: 'Removing a member refuses their new circle-only requests while their approved reservation and their pending request both carry on.',
    verifies: [`${S}.LendingCircles.MembershipChangesKeepCommitments`, `${S}.Library.CircleService`, `${S}.Library.BorrowingService`],
    test: '::BorrowBox.CircleAccessTests',
    given: [
      start,
      { step: 'circle.accept', args: { as: 'jo', circle: 'Riverside Neighbours' }, text: 'Jo joins Riverside Neighbours' },
      { step: 'loan.approved', args: { owner: 'sam', as: 'jo', item: 'bike', from: '+20', to: '+21', ref: 'c' }, text: "Sam approves Jo's request for days 20-21" },
      { step: 'request.submit', args: { as: 'jo', item: 'bike', from: '+10', to: '+11', ref: 'r' }, text: 'Jo also asks for days 10-11' },
    ],
    when: [{ step: 'circle.remove', args: { as: 'maya', circle: 'Riverside Neighbours', member: 'jo' }, text: 'Maya, the organiser, removes Jo' }],
    then: [
      { step: 'request.submitExpectRefusal', args: { as: 'jo', item: 'bike', from: '+30', to: '+31', status: 403 }, text: 'Jo cannot make a new request' },
      { step: 'loan.status', args: { ref: 'c', status: 'approved' }, text: 'her approved reservation is untouched' },
      { step: 'request.act', args: { as: 'sam', ref: 'c', action: 'ready' }, text: 'and moves on: Sam marks it ready' },
      { step: 'request.act', args: { as: 'sam', ref: 'r', action: 'approve' }, text: 'her pending request is still Sam’s to approve' },
    ],
    trace: { from: `${S}.Library.RemoveMember` },
  },
];

for (const s of scenarios) {
  const doc = { 'acceptance-scenario': '1', name: s.name, purpose: s.purpose, verifies: s.verifies, test: s.test, environment: 'LocalDevelopment', given: s.given, when: s.when, then: s.then, trace: s.trace };
  writeFileSync(join(dir, `${s.name}.scenario.json`), JSON.stringify(doc, null, 2) + '\n');
}
console.log(`wrote ${scenarios.length} scenarios`);
