import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ItemCard from '../components/ItemCard.jsx';
import { EmptyState, ErrorState, useLoad } from '../components/ui.jsx';
import { range } from '../format.js';

export default function Explore() {
  const { me, config } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [text, setText] = useState(q);

  // Debounce typing into the URL (so filters survive refresh and back/forward).
  useEffect(() => {
    const t = setTimeout(() => update({ q: text.trim() }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function update(next) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    setParams(p, { replace: true });
  }

  const validRange = from && (!to || to >= from);
  const { data: items, loading, error, reload } = useLoad(
    () => api.items({ q, category, from: validRange ? from : '', to: validRange ? (to || from) : '' }),
    [q, category, from, to],
  );
  const filtered = q || category || from;
  const visible = items?.filter((i) => !i.isMine) ?? [];
  const mine = items?.filter((i) => i.isMine && !i.hidden) ?? [];

  return (
    <>
      <section className="hero">
        <h1 className="display">Hi {me.firstName} — what do you need?</h1>
        <p className="lead">Everything here belongs to someone in your circle. Ask nicely, bring it back better.</p>
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="search" className="sr-only">Search items, categories or people</label>
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input id="search" type="search" placeholder="Try “tent”, “kitchen” or “Priya”" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </form>
      </section>

      <div className="filters">
        <div className="chips-scroll" role="group" aria-label="Category">
          <button className={`filter-chip ${!category ? 'on' : ''}`} aria-pressed={!category} onClick={() => update({ category: '' })}>Everything</button>
          {(config?.categories ?? []).map((c) => (
            <button key={c} className={`filter-chip ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => update({ category: category === c ? '' : c })}>{c}</button>
          ))}
        </div>
        <fieldset className="date-filter">
          <legend>Free between</legend>
          <label className="sr-only" htmlFor="from">From</label>
          <input id="from" type="date" value={from} min={config?.today} onChange={(e) => update({ from: e.target.value, to: to && to < e.target.value ? e.target.value : to })} />
          <span aria-hidden="true">–</span>
          <label className="sr-only" htmlFor="to">To</label>
          <input id="to" type="date" value={to} min={from || config?.today} onChange={(e) => update({ to: e.target.value })} />
          {(from || to) && <button className="link-button" onClick={() => update({ from: '', to: '' })}>Any time</button>}
        </fieldset>
      </div>

      <div aria-live="polite" className="results-line">
        {!loading && items && (
          <p className="muted">
            {visible.length === 0 ? '' : `${visible.length} thing${visible.length === 1 ? '' : 's'} to borrow`}
            {validRange ? ` · free ${range(from, to || from)}` : ''}
          </p>
        )}
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !items ? (
        <ul className="grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="card skeleton" />)}</ul>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={filtered ? '🧭' : '🌱'}
          title={filtered ? 'Nothing matches just yet' : 'The shelf is empty for now'}
          action={filtered ? <button className="btn" onClick={() => { setText(''); setParams({}, { replace: true }); }}>Clear filters</button> : <Link className="btn btn-primary" to="/items/new">List something to lend</Link>}
        >
          {filtered ? 'Try a different word, another category or other dates.' : 'Be the first to share something.'}
        </EmptyState>
      ) : (
        <ul className={`grid ${loading ? 'is-loading' : ''}`}>
          {visible.map((item) => <ItemCard key={item.id} item={item} />)}
        </ul>
      )}

      {!filtered && mine.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your things others can borrow</h2>
            <Link to="/shelf" className="link">Manage your shelf →</Link>
          </div>
          <ul className="grid grid-small">{mine.map((item) => <ItemCard key={item.id} item={item} />)}</ul>
        </section>
      )}
    </>
  );
}
