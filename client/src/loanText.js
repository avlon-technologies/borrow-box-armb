// Human language for where a loan stands, always from the viewer's side. No database statuses.
import { dayMonth, relativeDay, plural } from './format.js';

export function headline(r) {
  const owner = r.owner.firstName;
  const borrower = r.borrower.firstName;
  const mine = r.role === 'borrower';
  switch (r.status) {
    case 'pending':
      return mine ? `Waiting for ${owner} to reply` : `${borrower} would like to borrow this`;
    case 'approved':
      return mine ? `${owner} said yes!` : `You said yes to ${borrower}`;
    case 'ready':
      return mine ? 'Ready for you to pick up' : `Waiting for ${borrower} to pick it up`;
    case 'borrowed':
      if (r.overdue) return mine ? `Overdue — was due ${relativeDay(-r.daysLate)}` : `${borrower} has it — ${plural(r.daysLate, 'day')} late`;
      return mine ? `You have it until ${dayMonth(r.endDate)}` : `${borrower} has it until ${dayMonth(r.endDate)}`;
    case 'returning':
      return mine ? `Waiting for ${owner} to confirm it's back` : `${borrower} is bringing it back`;
    case 'returned':
      return r.disputed ? 'Returned — you see its condition differently' : 'Returned. All done!';
    case 'declined':
      return mine ? `${owner} can't lend it this time` : `You declined ${borrower}'s request`;
    case 'cancelled':
      return mine ? 'You cancelled this request' : `${borrower} cancelled`;
    default:
      return '';
  }
}

export function chip(r) {
  if (r.overdue) return { tone: 'danger', label: 'Overdue' };
  if (r.pendingExtension) return { tone: 'warn', label: 'More time asked' };
  return {
    pending: { tone: 'warn', label: 'Asked' },
    approved: { tone: 'ok', label: 'Approved' },
    ready: { tone: 'ok', label: 'Ready for pickup' },
    borrowed: { tone: 'info', label: 'On loan' },
    returning: { tone: 'info', label: 'Coming back' },
    returned: { tone: r.disputed ? 'warn' : 'muted', label: r.disputed ? 'Returned · noted' : 'Returned' },
    declined: { tone: 'muted', label: 'Declined' },
    cancelled: { tone: 'muted', label: 'Cancelled' },
  }[r.status];
}

/** One short sentence on what this person should do next, or null. */
export function nextStep(r) {
  const a = r.actions;
  if (a.includes('approve')) return r.blockedBy ? 'These dates are already promised — you can decline kindly.' : 'Approve or decline the request.';
  if (a.includes('accept-extension')) return `${r.borrower.firstName} asked to keep it until ${dayMonth(r.pendingExtension.proposedEndDate)}.`;
  if (a.includes('ready')) return 'Let them know when it is ready to pick up.';
  if (a.includes('pickup')) return 'Confirm pickup once it is in your hands.';
  if (a.includes('return')) return r.overdue ? 'Bring it back as soon as you can and start the return.' : `Bring it back by ${dayMonth(r.endDate)}.`;
  if (a.includes('confirm-return')) return 'Check it over and confirm it is back.';
  return null;
}

export const EVENT_TEXT = {
  RequestSubmitted: (e) => `asked to borrow it${e.data.note ? '' : ''}`,
  RequestApproved: () => 'approved the request',
  RequestDeclined: () => 'declined the request',
  RequestCancelled: () => 'cancelled the request',
  ItemReadied: () => 'marked it ready for pickup',
  PickupConfirmed: () => 'picked it up',
  ReturnStarted: (e) => (e.data.late ? `started the return (${plural(e.data.daysLate, 'day')} late)` : 'started the return'),
  ReturnConfirmed: () => 'confirmed it is back',
  ExtensionProposed: (e) => `asked to keep it until ${dayMonth(e.data.proposedEndDate)}`,
  ExtensionAccepted: (e) => `agreed to extend until ${dayMonth(e.data.newEndDate)}`,
  ExtensionDeclined: () => 'declined the extra time',
  ConditionRecorded: (e) => (e.data.disagrees ? 'recorded a different view of its condition' : e.data.phase === 'followup' ? 'added a condition note' : 'noted its condition'),
};
