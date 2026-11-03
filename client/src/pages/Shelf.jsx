import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ItemCard from '../components/ItemCard.jsx';
import { EmptyState, ErrorState, useLoad } from '../components/ui.jsx';

export default function Shelf() {
  const { me } = useApp();
  const { data: items, loading, error, reload } = useLoad(() => api.items({ mine: 1 }), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const hidden = items?.filter((i) => i.hidden) ?? [];
  const shown = items?.filter((i) => !i.hidden) ?? [];
  return (
    <>
      <div className="section-head">
        <div>
          <h1 className="display">My shelf</h1>
          <p className="lead">What you lend to friends, {me.firstName}.</p>
        </div>
        <Link className="btn btn-primary" to="/items/new">+ Lend something</Link>
      </div>
      {loading && !items ? <ul className="grid" aria-hidden="true">{[1, 2, 3].map((i) => <li key={i} className="card skeleton" />)}</ul> : items.length === 0 ? (
        <EmptyState icon="🧺" title="Your shelf is empty" action={<Link className="btn btn-primary" to="/items/new">List your first item</Link>}>
          Got a ladder, a tent or a pasta maker gathering dust? Friends would love to borrow it.
        </EmptyState>
      ) : (
        <>
          <ul className="grid">{shown.map((i) => <ItemCard key={i.id} item={i} />)}</ul>
          {hidden.length > 0 && (
            <section className="section">
              <h2>Hidden from new requests</h2>
              <p className="muted">Only you can see these. Anything already agreed carries on.</p>
              <ul className="grid">{hidden.map((i) => <ItemCard key={i.id} item={i} />)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
