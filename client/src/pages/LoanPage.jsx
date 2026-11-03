import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ConditionForm from '../components/ConditionForm.jsx';
import { Avatar, Button, Chip, ErrorState, FormError, Photo, Spinner, useLoad, useSubmit } from '../components/ui.jsx';
import { addDays, dayMonth, longDate, plural, range, ratingLabel, when } from '../format.js';
import { chip, EVENT_TEXT, headline } from '../loanText.js';

const STEPS = [
  { key: 'pending', label: 'Asked' },
  { key: 'approved', label: 'Approved' },
  { key: 'ready', label: 'Ready' },
  { key: 'borrowed', label: 'Borrowed' },
  { key: 'returning', label: 'Coming back' },
  { key: 'returned', label: 'Returned' },
];

function Stepper({ status }) {
  if (status === 'declined' || status === 'cancelled') return null;
  const at = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="step-dot" aria-hidden="true">{i < at ? '✓' : i + 1}</span>
          <span className="step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Wraps one action: a single submission at a time, idempotent, with toast + refresh on success. */
function useAction(r, onChange) {
  const { toast, refreshAttention } = useApp();
  const submit = useSubmit();
  const go = async (call, message) => {
    const res = await submit.run(call);
    if (res) {
      toast(message);
      onChange(res.reservation);
      refreshAttention();
    }
    return res;
  };
  return { ...submit, go };
}

function DecidePanel({ r, onChange }) {
  const [note, setNote] = useState('');
  const a = useAction(r, onChange);
  const [which, setWhich] = useState(null);
  const blocked = !!r.blockedBy;
  return (
    <section className="panel action-panel" aria-labelledby="decide-h">
      <h2 id="decide-h">{r.borrower.firstName} would like to borrow it {range(r.startDate, r.endDate)}</h2>
      {r.note && <blockquote className="quote"><Avatar person={r.borrower} size={24} /> “{r.note}”</blockquote>}
      {blocked && (
        <p className="notice notice-warn" role="note">
          These dates overlap {r.blockedBy.borrowerName ? `${r.blockedBy.borrowerName}'s` : 'a'} booking ({range(r.blockedBy.start, r.blockedBy.end)}), so it can't be approved. You can decline with a kind note.
        </p>
      )}
      {!blocked && r.overlapping?.some((o) => o.status === 'pending') && (
        <p className="notice" role="note">
          Heads up: {r.overlapping.filter((o) => o.status === 'pending').map((o) => `${o.borrowerName} (${range(o.start, o.end)})`).join(', ')} also asked for some of these days. Once you approve one, the others can't be approved for the same days.
        </p>
      )}
      <label className="field">
        <span>Message to {r.borrower.firstName} <em className="muted">(optional)</em></span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={blocked ? 'Sorry, it is already lent out then…' : 'Enjoy! It is on my porch after 5.'} />
      </label>
      <FormError error={a.error} />
      <div className="row-gap wrap">
        <Button busy={a.busy && which === 'approve'} busyLabel="Approving…" disabled={blocked || a.busy} onClick={() => { setWhich('approve'); a.go((k) => api.act(r.id, 'approve', { note }, k), `Approved — ${r.borrower.firstName} will be glad.`); }}>Approve</Button>
        <Button className="btn btn-ghost" busy={a.busy && which === 'decline'} busyLabel="Declining…" disabled={a.busy} onClick={() => { setWhich('decline'); a.go((k) => api.act(r.id, 'decline', { note }, k), 'Declined. We let them know.'); }}>Decline</Button>
      </div>
    </section>
  );
}

function ReadyPanel({ r, onChange }) {
  const [note, setNote] = useState('');
  const a = useAction(r, onChange);
  return (
    <section className="panel action-panel" aria-labelledby="ready-h">
      <h2 id="ready-h">Get it ready for {r.borrower.firstName}</h2>
      <p className="muted">Pickup starts {longDate(r.startDate)}. Let them know when and where to collect it.</p>
      <label className="field">
        <span>Pickup note <em className="muted">(optional)</em></span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="It's in a bag by my front door. Text me when you're here!" />
      </label>
      <FormError error={a.error} />
      <Button busy={a.busy} busyLabel="Saving…" onClick={() => a.go((k) => api.act(r.id, 'ready', { note }, k), `Marked ready. ${r.borrower.firstName} can pick it up.`)}>It's ready for pickup</Button>
    </section>
  );
}

function ConditionActionPanel({ r, onChange, act, title, intro, button, success, allowDisagree }) {
  const [value, setValue] = useState({ rating: '', note: '', photos: [], disagrees: false });
  const a = useAction(r, onChange);
  const submit = (e) => {
    e.preventDefault();
    if (!value.rating) return a.setError({ message: 'Pick how it looks — it helps you both later.' });
    if (value.disagrees && !value.note.trim()) return a.setError({ message: "Say what's different, so you both remember." });
    return a.go((k) => api.act(r.id, act, value, k), success);
  };
  return (
    <form className="panel action-panel" onSubmit={submit} aria-labelledby={`${act}-h`} noValidate>
      <h2 id={`${act}-h`}>{title}</h2>
      {intro}
      <ConditionForm value={value} onChange={setValue} allowDisagree={allowDisagree} disagreeLabel={`I see its condition differently from ${r.borrower.firstName}`} />
      <FormError error={a.error} />
      <Button busy={a.busy}>{button}</Button>
    </form>
  );
}

function CancelButton({ r, onChange }) {
  const [confirming, setConfirming] = useState(false);
  const a = useAction(r, onChange);
  if (!confirming) return <button className="btn btn-ghost btn-danger-text" onClick={() => setConfirming(true)}>Cancel this request</button>;
  return (
    <div className="panel panel-soft" role="group" aria-label="Confirm cancellation">
      <p><strong>Cancel your request?</strong> {r.status !== 'pending' && `${r.owner.firstName} has already said yes — maybe send them a message too.`}</p>
      <FormError error={a.error} />
      <div className="row-gap">
        <Button className="btn btn-danger" busy={a.busy} busyLabel="Cancelling…" onClick={() => a.go((k) => api.act(r.id, 'cancel', {}, k), 'Request cancelled.')}>Yes, cancel it</Button>
        <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={a.busy}>Keep it</button>
      </div>
    </div>
  );
}

function ExtensionAnswer({ r, onChange }) {
  const e = r.pendingExtension;
  const [note, setNote] = useState('');
  const a = useAction(r, onChange);
  const [which, setWhich] = useState(null);
  const conflict = a.error?.code === 'dates_taken';
  return (
    <section className="panel action-panel" aria-labelledby="ext-h">
      <h2 id="ext-h">{r.borrower.firstName} asked for more time</h2>
      <p>Keep it until <strong>{longDate(e.proposedEndDate)}</strong> instead of {longDate(r.endDate)} ({plural(Math.round((Date.parse(e.proposedEndDate) - Date.parse(r.endDate)) / 86400000), 'extra day')}).</p>
      {e.note && <blockquote className="quote"><Avatar person={r.borrower} size={24} /> “{e.note}”</blockquote>}
      <label className="field">
        <span>Reply <em className="muted">(optional)</em></span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </label>
      <FormError error={a.error} />
      {conflict && <p className="muted small">Someone else is booked for some of those days. Decline this one; {r.borrower.firstName} can ask for fewer days.</p>}
      <div className="row-gap wrap">
        <Button busy={a.busy && which === 'accept'} busyLabel="Checking dates…" disabled={a.busy || conflict} onClick={() => { setWhich('accept'); a.go((k) => api.answerExtension(e.id, 'accept', { note }, k), `Extended to ${dayMonth(e.proposedEndDate)}.`); }}>Say yes</Button>
        <Button className="btn btn-ghost" busy={a.busy && which === 'decline'} busyLabel="Declining…" disabled={a.busy} onClick={() => { setWhich('decline'); a.go((k) => api.answerExtension(e.id, 'decline', { note }, k), 'Extension declined.'); }}>Decline</Button>
      </div>
    </section>
  );
}

function ExtensionAsk({ r, onChange }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const a = useAction(r, onChange);
  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)} aria-expanded="false">Need more time?</button>;
  const lastFree = a.error?.details?.lastFreeDate;
  return (
    <form className="panel" aria-labelledby="ask-h" onSubmit={async (e) => {
      e.preventDefault();
      if (!date) return a.setError({ message: 'Choose the new return date.' });
      const ok = await a.go((k) => api.proposeExtension(r.id, { proposedEndDate: date, note }, k), `Asked ${r.owner.firstName} for more time.`);
      if (ok) setOpen(false);
      return ok;
    }} noValidate>
      <h2 id="ask-h" className="h3">Ask {r.owner.firstName} for more time</h2>
      <label className="field">
        <span>New return date</span>
        <input type="date" value={date} min={addDays(r.endDate, 1)} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span>Why? <em className="muted">(optional)</em></span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormError error={a.error} />
      {lastFree && <button type="button" className="link-button" onClick={() => { setDate(lastFree); a.setError(null); }}>Ask for {longDate(lastFree)} instead</button>}
      <div className="row-gap">
        <Button busy={a.busy} busyLabel="Sending…">Send</Button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Never mind</button>
      </div>
    </form>
  );
}

function AddNote({ r, onChange }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState({ rating: '', note: '', photos: [], disagrees: false });
  const a = useAction(r, onChange);
  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Add a condition note</button>;
  return (
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault();
      const body = { ...value, rating: value.rating || undefined };
      const ok = await a.go((k) => api.act(r.id, 'notes', body, k), 'Note added to the history.');
      if (ok) { setOpen(false); setValue({ rating: '', note: '', photos: [], disagrees: false }); }
    }} noValidate aria-label="Add a condition note">
      <h2 className="h3">Add a condition note</h2>
      <p className="muted small">Notes are added to the history and never replace anyone's earlier account.</p>
      <ConditionForm value={value} onChange={setValue} legend="Condition (optional)" ratingRequired={false} allowDisagree disagreeLabel="I disagree with the other account" notePlaceholder="What would you like to add?" />
      <FormError error={a.error} />
      <div className="row-gap">
        <Button busy={a.busy}>Add note</Button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

const PHASE = { handoff: 'At pickup', return: 'At return', followup: 'Later note' };

function Evidence({ r }) {
  if (!r.conditionNotes.length) return null;
  const column = (role, person) => {
    const notes = r.conditionNotes.filter((n) => n.role === role);
    return (
      <div className="evidence-col">
        <h3><Avatar person={person} size={24} /> {person.id === r[r.role]?.id ? 'Your view' : `${person.firstName}'s view`} <span className="muted small">({role})</span></h3>
        {notes.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : (
          <ul className="evidence-list">
            {notes.map((n) => (
              <li key={n.id} className={`evidence ${n.disagrees ? 'disagrees' : ''}`}>
                <div className="evidence-head">
                  <span>{PHASE[n.phase]}</span>
                  {n.rating && <Chip tone={n.rating === 'damaged' ? 'danger' : n.rating === 'worn' ? 'warn' : 'ok'}>{ratingLabel(n.rating)}</Chip>}
                  {n.disagrees && <Chip tone="warn">Sees it differently</Chip>}
                </div>
                {n.note && <p>{n.note}</p>}
                {n.photos.length > 0 && (
                  <ul className="evidence-photos">{n.photos.map((p, i) => <li key={p}><a href={p} target="_blank" rel="noreferrer"><img src={p} alt={`${n.author.firstName}'s photo ${i + 1}, ${PHASE[n.phase].toLowerCase()}`} /></a></li>)}</ul>
                )}
                <time className="muted small" dateTime={n.createdAt}>{when(n.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <section className="section" aria-labelledby="ev-h">
      <h2 id="ev-h">Condition — both sides</h2>
      {r.disputed && <p className="notice notice-warn">You two see the condition differently. Both accounts are kept exactly as written; nothing here can be edited away.</p>}
      <div className="evidence-grid">
        {column('owner', r.owner)}
        {column('borrower', r.borrower)}
      </div>
    </section>
  );
}

function History({ r }) {
  return (
    <section className="section" aria-labelledby="hist-h">
      <h2 id="hist-h">History</h2>
      <ol className="timeline">
        {r.history.map((h) => (
          <li key={h.seq}>
            <Avatar person={h.actor} size={26} />
            <div>
              <p><strong>{h.actor.id === r[r.role]?.id ? 'You' : h.actor.firstName}</strong> {EVENT_TEXT[h.type]?.(h) ?? h.type}</p>
              {h.data?.note && <p className="quote-sm">“{h.data.note}”</p>}
              <time className="muted small" dateTime={h.at}>{when(h.at)}</time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function LoanPage() {
  const { id } = useParams();
  const { data: r, loading, error, reload, setData } = useLoad(() => api.reservation(id), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !r) return <div className="center-pad"><Spinner label="Loading loan" /></div>;

  const onChange = (next) => setData(next);
  const c = chip(r);
  const other = r.role === 'owner' ? r.borrower : r.owner;
  const readyNote = r.history.filter((h) => h.type === 'ItemReadied').at(-1)?.data?.note;
  const borrowerReturn = r.conditionNotes.filter((n) => n.role === 'borrower' && n.phase === 'return').at(-1);
  const has = (x) => r.actions.includes(x);

  return (
    <article className="loan-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/activity">Loans</Link> <span aria-hidden="true">/</span> <span>{r.item.title}</span></nav>
      <header className="loan-header">
        <Link to={`/items/${r.item.id}`} className="loan-header-photo"><Photo src={r.item.photoUrl} alt={r.item.title} /></Link>
        <div>
          <div className="row-gap wrap"><Chip tone={c.tone}>{c.label}</Chip>{r.item.hidden && <Chip>Item hidden from new requests</Chip>}</div>
          {r.borrowerOutsideCircles && <p className="notice">{r.borrower.firstName} asked while you shared a circle. They're no longer in one with you{r.status === 'pending' ? ", but this request still stands — it's yours to decide." : ', and that changes nothing here: this loan carries on as agreed.'}</p>}
          <h1 className="display">{headline(r)}</h1>
          <p className="loan-sub">
            <Link to={`/items/${r.item.id}`}>{r.item.title}</Link> · {r.role === 'owner' ? 'lending to' : 'borrowing from'} <Avatar person={other} size={20} /> <strong>{other.name}</strong>
          </p>
          <p className="dates"><span aria-hidden="true">📅</span> {range(r.startDate, r.endDate)} · {plural(r.days, 'day')}{r.endDate !== r.originalEndDate && <span className="muted"> (extended from {dayMonth(r.originalEndDate)})</span>}</p>
        </div>
      </header>

      <Stepper status={r.status} />

      {r.overdue && (
        <p className="notice notice-danger" role="alert">
          {r.role === 'borrower'
            ? `This was due ${longDate(r.endDate)} — ${plural(r.daysLate, 'day')} ago. No stress: bring it back when you can and start the return below.`
            : `${r.borrower.firstName} was due to return it ${longDate(r.endDate)} (${plural(r.daysLate, 'day')} ago). They can still return it as normal.`}
        </p>
      )}
      {r.responseNote && ['approved', 'declined', 'ready'].includes(r.status) && (
        <blockquote className="quote"><Avatar person={r.owner} size={24} /> “{r.responseNote}”</blockquote>
      )}

      <div className="loan-actions">
        {has('approve') && <DecidePanel r={r} onChange={onChange} />}
        {has('accept-extension') && <ExtensionAnswer r={r} onChange={onChange} />}
        {has('ready') && <ReadyPanel r={r} onChange={onChange} />}
        {has('pickup') && (
          <ConditionActionPanel r={r} onChange={onChange} act="pickup" title="Picked it up?" button="Confirm pickup" success="Enjoy! The loan has started."
            intro={<>{readyNote && <blockquote className="quote"><Avatar person={r.owner} size={24} /> “{readyNote}”</blockquote>}<p className="muted">Take a quick look before you go — your note is kept as your side of the story.</p></>} />
        )}
        {has('return') && (
          <ConditionActionPanel r={r} onChange={onChange} act="return" title={`Bringing it back to ${r.owner.firstName}?`} button="Start the return" success={`Thanks! ${r.owner.firstName} will confirm it's back.`}
            intro={<p className="muted">Describe how it is now. {r.owner.firstName} adds their own view when they confirm — neither replaces the other.</p>} />
        )}
        {has('confirm-return') && (
          <ConditionActionPanel r={r} onChange={onChange} act="confirm-return" title="Is it back with you?" button="Confirm it's back" success="Return confirmed. Loan complete." allowDisagree
            intro={borrowerReturn && (
              <div className="panel-soft inset">
                <p className="small"><strong>{r.borrower.firstName} says:</strong> {ratingLabel(borrowerReturn.rating)}{borrowerReturn.note && ` — “${borrowerReturn.note}”`}</p>
              </div>
            )} />
        )}
        {r.status === 'pending' && r.role === 'borrower' && (
          <div className="panel panel-soft"><p>{r.owner.firstName} has your request. You'll see their answer here — nothing else to do for now.</p>{r.note && <p className="muted small">Your note: “{r.note}”</p>}</div>
        )}
        {r.status === 'approved' && r.role === 'borrower' && <div className="panel panel-soft"><p>{r.owner.firstName} will mark it ready when you can collect it{r.item.pickupArea ? ` (${r.item.pickupArea})` : ''}.</p></div>}
        {r.status === 'ready' && r.role === 'owner' && <div className="panel panel-soft"><p>Waiting for {r.borrower.firstName} to confirm pickup.</p></div>}
        {r.status === 'returning' && r.role === 'borrower' && <div className="panel panel-soft"><p>{r.owner.firstName} will check it over and confirm it's back.</p></div>}
        {r.pendingExtension && r.role === 'borrower' && (
          <div className="panel panel-soft"><p>You asked to keep it until <strong>{longDate(r.pendingExtension.proposedEndDate)}</strong>. Waiting for {r.owner.firstName}.</p></div>
        )}
        <div className="row-gap wrap secondary-actions">
          {has('propose-extension') && <ExtensionAsk r={r} onChange={onChange} />}
          {has('add-note') && <AddNote r={r} onChange={onChange} />}
          {has('cancel') && <CancelButton r={r} onChange={onChange} />}
        </div>
      </div>

      <Evidence r={r} />
      {r.extensions.length > 0 && (
        <section className="section" aria-labelledby="ext-list-h">
          <h2 id="ext-list-h">Requests for more time</h2>
          <ul className="mini-list">
            {r.extensions.map((e) => (
              <li key={e.id} className="mini-row">
                <span>Until {longDate(e.proposedEndDate)}</span>
                <Chip tone={e.status === 'accepted' ? 'ok' : e.status === 'proposed' ? 'warn' : 'muted'}>{{ proposed: 'Waiting', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' }[e.status]}</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}
      <History r={r} />
    </article>
  );
}
