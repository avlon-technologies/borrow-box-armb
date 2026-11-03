import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Calendar from '../components/Calendar.jsx';
import { availability, CircleChip } from '../components/ItemCard.jsx';
import AudiencePicker from '../components/AudiencePicker.jsx';
import { Avatar, Button, Chip, ErrorState, FormError, Photo, Spinner, useLoad, useSubmit } from '../components/ui.jsx';
import { daysInclusive, range, plural, addDays } from '../format.js';
import { chip } from '../loanText.js';

function Rules({ item }) {
  const lines = item.lendingRules.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <section className="rules" aria-labelledby="rules-h">
      <h2 id="rules-h">{item.isMine ? 'Your lending rules' : `${item.owner.firstName}'s lending rules`}</h2>
      {lines.length ? <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="muted">No special rules — just be kind to it.</p>}
      <dl className="facts">
        <div><dt>Longest loan</dt><dd>{plural(item.maxLoanDays, 'day')}</dd></div>
        {item.pickupArea && <div><dt>Pickup</dt><dd>{item.pickupArea}</dd></div>}
      </dl>
    </section>
  );
}

function RequestForm({ item, today, onDone }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const days = start && end && end >= start ? daysInclusive(start, end) : 0;
  const clash = start && item.busy.find((b) => b.start <= (end || start) && start <= b.end);
  const tooLong = days > item.maxLoanDays;

  const submit = async (e) => {
    e.preventDefault();
    if (!start || !end) return setError({ message: 'Choose a start date and a return date.' });
    if (end < start) return setError({ message: 'The return date needs to be on or after the start date.' });
    const res = await run((key) => api.request(item.id, { startDate: start, endDate: end, note }, key));
    if (res) {
      toast(`Request sent to ${item.owner.firstName}.`);
      onDone?.();
      navigate(`/loans/${res.reservation.id}`);
    }
  };

  return (
    <form className="panel request-form" onSubmit={submit} noValidate aria-labelledby="req-h">
      <h2 id="req-h">Ask to borrow</h2>
      <p className="muted small">Pick dates below or on the calendar. Both days count, and you can have it for up to {plural(item.maxLoanDays, 'day')}.</p>
      <div className="date-pair">
        <label>
          <span>Pick up</span>
          <input type="date" required value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end && end < e.target.value) setEnd(''); }} />
        </label>
        <label>
          <span>Bring back</span>
          <input type="date" required value={end} min={start || today} max={start ? addDays(start, item.maxLoanDays - 1) : undefined} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <Calendar today={today} busy={item.busy} start={start} end={end} maxDays={item.maxLoanDays} onPick={(s, e2) => { setStart(s); setEnd(e2); setError(null); }} />
      <div aria-live="polite" className="hint-line">
        {clash ? <p className="warn-text">Those dates overlap a booking — try others.</p>
          : tooLong ? <p className="warn-text">That's {plural(days, 'day')}; {item.owner.firstName} lends this for up to {plural(item.maxLoanDays, 'day')}.</p>
          : days ? <p className="ok-text">{range(start, end)} · {plural(days, 'day')}</p> : null}
      </div>
      <label className="field">
        <span>A note for {item.owner.firstName} <em className="muted">(optional)</em></span>
        <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for? When could you pick it up?" />
      </label>
      <FormError error={error} />
      <Button busy={busy} busyLabel="Sending…" disabled={!!clash || tooLong}>Send request</Button>
    </form>
  );
}

function AudiencePanel({ item, reload }) {
  const { toast } = useApp();
  const initial = { audience: item.audience, circleIds: item.circles.map((c) => c.id) };
  const [value, setValue] = useState(initial);
  const { busy, error, setError, run } = useSubmit();
  const changed = value.audience !== initial.audience || value.circleIds.slice().sort().join() !== initial.circleIds.slice().sort().join();
  const save = async () => {
    if (value.audience === 'circles' && value.circleIds.length === 0) return setError({ message: 'Pick at least one circle to share it with.' });
    const res = await run((key) => api.setAudience(item.id, value, key));
    if (res) {
      toast(res.item.audience === 'circles' ? 'Now just for your circles. Anything already agreed carries on.' : 'Open to everyone again.');
      reload({ quiet: true });
    }
  };
  // Circles the item is shared with but the owner has since left still show, so they can be removed.
  const circles = [...item.myCircles, ...item.circles.filter((c) => !item.myCircles.some((m) => m.id === c.id))];
  return (
    <section className="panel" aria-labelledby="aud-h">
      <h2 id="aud-h" className="h3">Who can borrow it</h2>
      <AudiencePicker value={value} onChange={(v) => { setValue(v); setError(null); }} circles={circles} idPrefix="edit" quietLegend />
      <p className="muted small">Changing this only affects new requests. Requests and loans you already have stay exactly as they are.</p>
      <FormError error={error} />
      <Button busy={busy} disabled={!changed} className="btn" busyLabel="Saving…" onClick={save}>Save who can borrow it</Button>
    </section>
  );
}

function OwnerPanel({ item, reload }) {
  const { toast } = useApp();
  const { busy, error, run } = useSubmit();
  const toggle = async () => {
    const res = await run((key) => api.setHidden(item.id, !item.hidden, key));
    if (res) {
      toast(res.item.hidden ? 'Hidden. Nobody can send new requests; existing loans carry on.' : 'Visible again — friends can ask to borrow it.');
      reload({ quiet: true });
    }
  };
  return (
    <section className="panel" aria-labelledby="owner-h">
      <h2 id="owner-h">This is yours</h2>
      <div className="row-gap wrap">
        <Link className="btn" to={`/items/${item.id}/edit`}>Edit details</Link>
        <Button className="btn btn-ghost" busy={busy} busyLabel="Updating…" onClick={toggle} aria-describedby="hide-help">
          {item.hidden ? 'Show to friends again' : 'Hide from new requests'}
        </Button>
      </div>
      <p id="hide-help" className="muted small">{item.hidden ? 'Hidden: nobody else can find it or ask for it. Reservations you already agreed stay as they are.' : 'Hiding stops new requests without cancelling anything you have already agreed.'}</p>
      <FormError error={error} />
      <h3 className="subhead">Requests and bookings</h3>
      {item.openRequests.length === 0 ? <p className="muted">No open requests right now.</p> : (
        <ul className="mini-list">
          {item.openRequests.map((r) => {
            const c = chip({ ...r, overdue: false, pendingExtension: null, disputed: false });
            return (
              <li key={r.id}>
                <Link to={`/loans/${r.id}`} className="mini-row">
                  <Avatar person={{ name: r.borrowerName, color: r.borrowerColor }} size={28} />
                  <span>
                    <strong>{r.borrowerName.split(' ')[0]}</strong> · {range(r.start, r.end)}
                    {r.outsideCircles && <small className="muted block">Asked while in a shared circle; no longer is</small>}
                  </span>
                  <Chip tone={c.tone}>{c.label}</Chip>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function ItemPage() {
  const { id } = useParams();
  const { config } = useApp();
  const { data: item, loading, error, reload } = useLoad(() => api.item(id), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !item || !config) return <div className="center-pad"><Spinner label="Loading item" /></div>;
  const a = availability(item, config.today);

  return (
    <article className="item-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Explore</Link> <span aria-hidden="true">/</span> <span>{item.category}</span></nav>
      <div className="item-layout">
        <div className="item-main">
          <Photo src={item.photoUrl} alt={item.title} className="hero-photo" />
          <div className="title-row">
            <h1 className="display">{item.title}</h1>
            <Chip tone={a.tone}>{a.label}</Chip>
            <CircleChip item={item} />
          </div>
          <div className="owner-card">
            <Avatar person={item.owner} size={44} />
            <div>
              <strong>{item.isMine ? 'You' : item.owner.name}</strong>
              <div className="muted small">{item.owner.neighborhood}</div>
              {!item.isMine && <p className="small">{item.owner.bio}</p>}
            </div>
          </div>
          {item.description && <p className="description">{item.description}</p>}
          <Rules item={item} />
          <section aria-labelledby="avail-h" className="section">
            <h2 id="avail-h">Availability</h2>
            {item.busy.length === 0 ? <p className="muted">No bookings yet — every day is open.</p> : (
              <ul className="busy-list">
                {item.busy.map((b) => (
                  <li key={`${b.start}-${b.end}`}>
                    <span className="busy-dot" aria-hidden="true" />
                    {range(b.start, b.end)}
                    {b.borrowerName ? <> · {b.mine ? 'you' : b.borrowerName}</> : ''}
                    {b.out ? ' (out now)' : ''}
                    {b.reservationId && <> · <Link to={`/loans/${b.reservationId}`}>details</Link></>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="item-side">
          {item.isMine ? <><OwnerPanel item={item} reload={reload} /><AudiencePanel key={item.updatedAt} item={item} reload={reload} /></> : (
            <>
              {item.myRequests.length > 0 && (
                <div className="panel panel-soft" role="note">
                  <h2 className="h3">You've asked for this</h2>
                  <ul className="mini-list">
                    {item.myRequests.map((r) => {
                      const c = chip({ ...r, overdue: false, pendingExtension: null, disputed: false });
                      return <li key={r.id}><Link to={`/loans/${r.id}`} className="mini-row"><span>{range(r.start, r.end)}</span><Chip tone={c.tone}>{c.label}</Chip></Link></li>;
                    })}
                  </ul>
                </div>
              )}
              {item.hidden ? (
                <div className="panel"><h2 className="h3">Not taking new requests</h2><p className="muted">{item.owner.firstName} has paused lending this for now. Anything already agreed still stands.</p></div>
              ) : !item.canRequest ? (
                <div className="panel"><h2 className="h3">Just for {item.owner.firstName}'s circles</h2><p className="muted">{item.owner.firstName} lends this only within circles you're not in right now. Anything you already arranged still stands.</p></div>
              ) : <RequestForm item={item} today={config.today} onDone={reload} />}
            </>
          )}
        </aside>
      </div>
    </article>
  );
}
