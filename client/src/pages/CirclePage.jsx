import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormError, Photo, Spinner, useLoad, useSubmit } from '../components/ui.jsx';
import { plural, when } from '../format.js';

const EVENT_TEXT = {
  CircleCreated: () => 'started the circle',
  MemberInvited: (e, name) => <>invited {name(e.subject)}</>,
  InvitationAccepted: () => 'joined',
  InvitationDeclined: () => 'declined the invitation',
  MemberLeft: () => 'left the circle',
  MemberRemoved: (e, name) => <>removed {name(e.subject)} from the circle</>,
  ItemAudienceChanged: (e) => (e.data.change === 'unshared'
    ? <>stopped sharing <Link to={`/items/${e.item.id}`}>{e.item.title}</Link> here</>
    : <>shared <Link to={`/items/${e.item.id}`}>{e.item.title}</Link>{e.data.audience === 'circles' ? ' (circles only)' : ''}</>),
};

/** A destructive action asks once, inline, so it works the same with a keyboard or a finger. */
function ConfirmAction({ label, question, confirmLabel, busyLabel, onConfirm, className = 'btn btn-ghost btn-sm' }) {
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useSubmit();
  if (!asking) return <button className={className} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="confirm" role="group" aria-label={question}>
      <span className="small">{question}</span>
      <Button className="btn btn-danger btn-sm" busy={busy} busyLabel={busyLabel} onClick={() => run(onConfirm)} autoFocus>{confirmLabel}</Button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
      <FormError error={error} />
    </div>
  );
}

function InviteForm({ circle, onDone }) {
  const { toast } = useApp();
  const [personId, setPersonId] = useState('');
  const { busy, error, setError, run } = useSubmit();
  if (circle.invitable.length === 0) return <p className="muted small">Everyone on BorrowBox is already here or invited.</p>;
  const submit = async (e) => {
    e.preventDefault();
    if (!personId) return setError({ message: 'Choose who to invite.' });
    const res = await run((key) => api.invite(circle.id, personId, key));
    if (res) {
      const p = circle.invitable.find((x) => x.id === personId);
      toast(`Invitation sent to ${p.firstName}.`);
      setPersonId('');
      onDone(res.circle);
    }
  };
  return (
    <form className="invite-form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Invite someone</span>
        <select value={personId} onChange={(e) => { setPersonId(e.target.value); setError(null); }}>
          <option value="">Choose a person…</option>
          {circle.invitable.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.neighborhood}</option>)}
        </select>
      </label>
      <Button busy={busy} busyLabel="Inviting…" className="btn">Send invitation</Button>
      <FormError error={error} />
    </form>
  );
}

function InvitedView({ circle, reload }) {
  const { toast, refreshAttention } = useApp();
  const navigate = useNavigate();
  const { busy, error, run } = useSubmit();
  const answer = async (act) => {
    const res = await run((key) => api.circleAct(circle.id, act, key));
    if (!res) return;
    refreshAttention();
    if (act === 'accept') { toast(`Welcome to ${circle.name}!`); reload(); } else { toast('Invitation declined.'); navigate('/circles'); }
  };
  return (
    <section className="panel action-panel" aria-labelledby="inv-h">
      <h2 id="inv-h" className="h3">{circle.invitedBy ? `${circle.invitedBy.firstName} invited you` : "You're invited"}</h2>
      <p>Join to see what {circle.name} shares, and to lend things just to this group. You can leave whenever you like.</p>
      <FormError error={error} />
      <div className="row-gap">
        <Button busy={busy} busyLabel="Joining…" onClick={() => answer('accept')}>Join circle</Button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => answer('decline')}>No thanks</button>
      </div>
    </section>
  );
}

export default function CirclePage() {
  const { id } = useParams();
  const { me, toast } = useApp();
  const navigate = useNavigate();
  const { data: circle, loading, error, reload, setData } = useLoad(() => api.circle(id), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !circle) return <div className="center-pad"><Spinner label="Loading circle" /></div>;
  const member = circle.myStanding === 'active';
  const name = (p) => (p?.id === me.id ? 'you' : p?.firstName);

  const leave = async (key) => {
    const res = await api.circleAct(circle.id, 'leave', key);
    toast(`You've left ${circle.name}. Anything you already arranged carries on.`);
    navigate('/circles');
    return res;
  };
  const remove = (person) => async (key) => {
    const res = await api.removeMember(circle.id, person.id, key);
    toast(`${person.firstName} is no longer in ${circle.name}. Their existing requests and loans carry on.`);
    setData(res.circle);
    return res;
  };

  return (
    <article className="circle-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/circles">Circles</Link> <span aria-hidden="true">/</span> <span>{circle.name}</span></nav>
      <header className="circle-header">
        <div>
          <h1 className="display">{circle.name}</h1>
          {circle.description && <p className="lead">{circle.description}</p>}
          <p className="muted">
            {plural(circle.memberCount, 'member')} · organised by {circle.isOrganiser ? 'you' : circle.organiser.name}
          </p>
        </div>
        {member && (
          <div className="row-gap wrap">
            <Link className="btn btn-primary" to="/items/new">+ Share something</Link>
            <Link className="btn" to="/?circles=1">Browse circle items</Link>
          </div>
        )}
      </header>

      <div className="item-layout">
        <div className="item-main">
          {member ? (
            <section className="section" aria-labelledby="shared-h">
              <h2 id="shared-h">Shared in this circle</h2>
              {circle.items.length === 0 ? (
                <EmptyState icon="🧺" title="Nothing shared yet" action={<Link className="btn btn-primary" to="/shelf">Share from your shelf</Link>}>
                  Open one of your items and choose this circle under “Who can borrow it”.
                </EmptyState>
              ) : (
                <ul className="grid grid-small">
                  {circle.items.map((i) => (
                    <li key={i.id} className={`card item-card ${i.hidden ? 'is-hidden' : ''}`}>
                      <Link to={`/items/${i.id}`} className="item-link">
                        <div className="item-photo-wrap"><Photo src={i.photoUrl} alt="" className="item-photo" /><span className="item-category">{i.category}</span></div>
                        <div className="item-body">
                          <h3 className="item-title">{i.title}</h3>
                          <span className="owner-line"><Avatar person={i.owner} size={22} />{i.owner.id === me.id ? 'Yours' : i.owner.firstName}</span>
                          <div className="chip-row">
                            {i.audience === 'circles' ? <Chip tone="circle">Circles only</Chip> : <Chip>Open to everyone</Chip>}
                            {i.hidden && <Chip>Hidden</Chip>}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : <InvitedView circle={circle} reload={reload} />}

          {member && (
            <section className="section" aria-labelledby="act-h">
              <h2 id="act-h">What's been happening</h2>
              <ol className="timeline">
                {circle.activity.map((e) => (
                  <li key={e.seq}>
                    <Avatar person={e.actor} size={26} />
                    <div>
                      <p><strong>{e.actor.id === me.id ? 'You' : e.actor.firstName}</strong> {EVENT_TEXT[e.type]?.(e, name) ?? e.type}</p>
                      <time className="muted small" dateTime={e.at}>{when(e.at)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="item-side">
          <section className="panel" aria-labelledby="members-h">
            <h2 id="members-h" className="h3">People</h2>
            <ul className="member-list">
              {circle.members.map((m) => (
                <li key={m.person.id}>
                  <Avatar person={m.person} size={32} />
                  <span className="member-name">
                    <strong>{m.person.id === me.id ? 'You' : m.person.name}</strong>
                    <small className="muted">{m.isOrganiser ? 'Organiser' : m.standing === 'invited' ? 'Invited' : m.person.neighborhood}</small>
                  </span>
                  {circle.isOrganiser && m.standing === 'active' && !m.isOrganiser && (
                    <ConfirmAction
                      label={<>Remove<span className="sr-only"> {m.person.firstName}</span></>}
                      question={`Remove ${m.person.firstName}? Loans already agreed carry on.`}
                      confirmLabel="Remove"
                      busyLabel="Removing…"
                      onConfirm={remove(m.person)}
                    />
                  )}
                </li>
              ))}
            </ul>
            {member && <InviteForm circle={circle} onDone={setData} />}
          </section>
          {member && !circle.isOrganiser && (
            <section className="panel panel-soft" aria-labelledby="leave-h">
              <h2 id="leave-h" className="h3">Leaving</h2>
              <p className="muted small">You'll stop seeing things shared only here. Requests and loans you already have carry on as agreed.</p>
              <ConfirmAction label="Leave circle" question={`Leave ${circle.name}?`} confirmLabel="Leave" busyLabel="Leaving…" onConfirm={leave} className="btn btn-ghost" />
            </section>
          )}
          {circle.isOrganiser && <p className="muted small">As the organiser you look after who's in this circle.</p>}
        </aside>
      </div>
    </article>
  );
}
