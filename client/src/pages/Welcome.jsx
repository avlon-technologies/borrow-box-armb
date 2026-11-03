import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Logo } from '../components/Header.jsx';
import { Avatar, Spinner, ErrorState } from '../components/ui.jsx';

export default function Welcome() {
  const { switchTo } = useApp();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const [choosing, setChoosing] = useState(null);

  const load = () => api.people().then(setPeople).catch(setError);
  useEffect(() => { load(); }, []);

  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo />
        <h1 className="display">Lend a little. Borrow a lot.</h1>
        <p className="lead">BorrowBox is your circle's shared shelf — tents, drills, stand mixers and more, lent between friends who trust each other to bring things back.</p>
        <h2 className="welcome-q" id="who">Who's borrowing today?</h2>
        <p className="muted small">This is a demo with four neighbours. Pick anyone — you can switch at any time from the top-right menu.</p>
        {error ? <ErrorState error={error} onRetry={load} /> : !people ? <Spinner label="Loading people" /> : (
          <ul className="people-grid" aria-labelledby="who">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  className="person-card"
                  disabled={!!choosing}
                  aria-busy={choosing === p.id || undefined}
                  onClick={async () => { setChoosing(p.id); try { await switchTo(p.id); } catch (e) { setError(e); setChoosing(null); } }}
                >
                  <Avatar person={p} size={52} />
                  <span className="person-text">
                    <strong>{p.name}</strong>
                    <small>{p.neighborhood}</small>
                    <span className="person-bio">{p.bio}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
