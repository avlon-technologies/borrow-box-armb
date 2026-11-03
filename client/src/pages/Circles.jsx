import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Avatar, Button, EmptyState, ErrorState, FormError, useLoad, useSubmit } from '../components/ui.jsx';
import { plural } from '../format.js';

function Faces({ people }) {
  return (
    <span className="faces" aria-hidden="true">
      {people.map((p) => <Avatar key={p.id} person={p} size={28} />)}
    </span>
  );
}

function Invitation({ circle, onAnswered }) {
  const { toast, refreshAttention } = useApp();
  const navigate = useNavigate();
  const { busy, error, run } = useSubmit();
  const answer = async (act) => {
    const res = await run((key) => api.circleAct(circle.id, act, key));
    if (!res) return;
    refreshAttention();
    if (act === 'accept') {
      toast(`Welcome to ${circle.name}!`);
      navigate(`/circles/${circle.id}`);
    } else {
      toast('Invitation declined. Nobody is told why.');
      onAnswered();
    }
  };
  return (
    <li className="card invite-card">
      <div className="invite-top">
        <Faces people={circle.faces} />
        <div>
          <h3><Link to={`/circles/${circle.id}`}>{circle.name}</Link></h3>
          <p className="muted small">{circle.invitedBy ? `${circle.invitedBy.firstName} invited you` : 'You are invited'} · {plural(circle.memberCount, 'member')}</p>
        </div>
      </div>
      {circle.description && <p className="small">{circle.description}</p>}
      <FormError error={error} />
      <div className="row-gap">
        <Button busy={busy} busyLabel="Joining…" onClick={() => answer('accept')}>Join circle</Button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => answer('decline')}>No thanks</button>
      </div>
    </li>
  );
}

function NewCircle({ onCancel }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError({ message: 'Give your circle a name.' });
    const res = await run((key) => api.createCircle({ name, description }, key));
    if (res) {
      toast(`${res.circle.name} is ready. Invite a few friends!`);
      navigate(`/circles/${res.circle.id}`);
    }
  };
  return (
    <form className="panel form" onSubmit={submit} noValidate aria-labelledby="new-circle-h">
      <h2 id="new-circle-h" className="h3">Start a circle</h2>
      <label className="field">
        <span>Name <em className="req">required</em></span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Climbing crew, Elm Street neighbours" autoFocus />
      </label>
      <label className="field">
        <span>What's it about? <em className="muted">(optional)</em></span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} placeholder="Who's in it, and what you tend to lend each other." />
      </label>
      <FormError error={error} />
      <div className="row-gap">
        <Button busy={busy} busyLabel="Creating…">Create circle</Button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Circles() {
  const { me } = useApp();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useLoad(() => api.circles(), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <div className="section-head">
        <div>
          <h1 className="display">Circles</h1>
          <p className="lead">Small groups of friends who lend to each other, {me.firstName}. Share things with everyone, or just with your circles.</p>
        </div>
        {!creating && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Start a circle</button>}
      </div>
      {creating && <NewCircle onCancel={() => setCreating(false)} />}

      {loading && !data ? <ul className="grid" aria-hidden="true">{[1, 2].map((i) => <li key={i} className="card skeleton" />)}</ul> : (
        <>
          {data.invitations.length > 0 && (
            <section className="section" aria-labelledby="inv-h">
              <h2 id="inv-h">Invitations</h2>
              <ul className="grid invite-grid">{data.invitations.map((c) => <Invitation key={c.id} circle={c} onAnswered={reload} />)}</ul>
            </section>
          )}
          <section className="section" aria-labelledby="mine-h">
            <h2 id="mine-h">Your circles</h2>
            {data.circles.length === 0 ? (
              <EmptyState icon="🫶" title="No circles yet" action={!creating && <button className="btn btn-primary" onClick={() => setCreating(true)}>Start your first circle</button>}>
                Start one for your street, your climbing crew or your supper club, then invite the people you trust.
              </EmptyState>
            ) : (
              <ul className="grid circle-grid">
                {data.circles.map((c) => (
                  <li key={c.id} className="card circle-card">
                    <Link to={`/circles/${c.id}`} className="circle-link">
                      <Faces people={c.faces} />
                      <h3>{c.name}</h3>
                      {c.description && <p className="small muted clamp">{c.description}</p>}
                      <p className="small">
                        {plural(c.memberCount, 'member')} · {plural(c.itemCount, 'thing')} shared
                        {c.isOrganiser && <> · <strong>you organise it</strong></>}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
