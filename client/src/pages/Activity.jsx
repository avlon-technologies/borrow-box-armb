import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, Chip, EmptyState, ErrorState, Photo, useLoad } from '../components/ui.jsx';
import { range } from '../format.js';
import { chip, headline, nextStep } from '../loanText.js';

const DONE = ['returned', 'declined', 'cancelled'];

export function LoanRow({ r }) {
  const c = chip(r);
  const other = r.role === 'owner' ? r.borrower : r.owner;
  const step = r.needsMe ? nextStep(r) : null;
  return (
    <li>
      <Link to={`/loans/${r.id}`} className={`loan-row ${r.needsMe ? 'needs' : ''} ${r.overdue ? 'late' : ''}`}>
        <Photo src={r.item.photoUrl} alt="" className="loan-thumb" />
        <div className="loan-text">
          <div className="loan-top">
            <strong>{r.item.title}</strong>
            <Chip tone={c.tone}>{c.label}</Chip>
          </div>
          <div className="muted small loan-people">
            <Avatar person={other} size={18} />
            {r.role === 'owner' ? `Lending to ${other.firstName}` : `Borrowing from ${other.firstName}`} · {range(r.startDate, r.endDate)}
          </div>
          <div className="loan-headline">{headline(r)}</div>
          {step && <div className="loan-next">→ {step}</div>}
        </div>
      </Link>
    </li>
  );
}

function Group({ title, list, empty }) {
  return (
    <section className="section" aria-label={title}>
      <h2>{title} {list.length > 0 && <span className="count">{list.length}</span>}</h2>
      {list.length === 0 ? <p className="muted">{empty}</p> : <ul className="loan-list">{list.map((r) => <LoanRow key={r.id} r={r} />)}</ul>}
    </section>
  );
}

export default function Activity() {
  const { data, loading, error, reload } = useLoad(() => api.reservations(), []);
  const [showDone, setShowDone] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const list = data ?? [];
  const needs = list.filter((r) => r.needsMe);
  const open = list.filter((r) => !r.needsMe && !DONE.includes(r.status));
  const borrowing = open.filter((r) => r.role === 'borrower').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lending = open.filter((r) => r.role === 'owner').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const done = list.filter((r) => !r.needsMe && DONE.includes(r.status));

  return (
    <>
      <h1 className="display">Loans</h1>
      <p className="lead">Everything you're borrowing and lending, with what needs you first.</p>
      {loading && !data ? <ul className="loan-list" aria-hidden="true">{[1, 2, 3].map((i) => <li key={i} className="loan-row skeleton" />)}</ul> : list.length === 0 ? (
        <EmptyState icon="🤝" title="No loans yet" action={<Link className="btn btn-primary" to="/">Find something to borrow</Link>}>
          When you ask to borrow something, or someone asks for yours, it shows up here.
        </EmptyState>
      ) : (
        <>
          <section className="section needs-you" aria-label="Needs you">
            <h2>Needs you {needs.length > 0 && <span className="count count-accent">{needs.length}</span>}</h2>
            {needs.length === 0 ? <p className="muted">You're all caught up. 🌿</p> : <ul className="loan-list">{needs.map((r) => <LoanRow key={r.id} r={r} />)}</ul>}
          </section>
          <Group title="Borrowing" list={borrowing} empty="Nothing borrowed right now." />
          <Group title="Lending" list={lending} empty="Nothing lent out right now." />
          {done.length > 0 && (
            <section className="section">
              <button className="link-button" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
                {showDone ? 'Hide' : 'Show'} past loans and requests ({done.length})
              </button>
              {showDone && <ul className="loan-list past">{done.map((r) => <LoanRow key={r.id} r={r} />)}</ul>}
            </section>
          )}
        </>
      )}
    </>
  );
}
