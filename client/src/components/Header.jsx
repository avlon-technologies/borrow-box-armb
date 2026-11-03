import { useEffect, useRef, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Avatar } from './ui.jsx';

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="var(--accent)" />
        <path d="M16 26l16-9 16 9v18l-16 9-16-9z M16 26l16 9 16-9M32 35v18" fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      BorrowBox
    </span>
  );
}

function IdentityMenu() {
  const { me, switchTo, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => { if (open && !people.length) api.people().then(setPeople).catch(() => {}); }, [open, people.length]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  return (
    <div className="identity" ref={ref}>
      <button ref={buttonRef} className="identity-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar person={me} size={32} />
        <span className="identity-name">{me.firstName}</span>
        <span aria-hidden="true" className="caret">▾</span>
        <span className="sr-only">— switch person</span>
      </button>
      {open && (
        <div className="menu" role="group" aria-label="Switch person">
          <p className="menu-title">Demo: browse as…</p>
          {people.map((p) => (
            <button
              key={p.id}
              className={`menu-item ${p.id === me.id ? 'current' : ''}`}
              aria-current={p.id === me.id ? 'true' : undefined}
              onClick={() => { setOpen(false); if (p.id !== me.id) switchTo(p.id); }}
            >
              <Avatar person={p} size={28} />
              <span><strong>{p.name}</strong><small>{p.neighborhood}</small></span>
              {p.id === me.id && <span className="menu-check" aria-hidden="true">✓</span>}
            </button>
          ))}
          <hr />
          <button className="menu-item" onClick={() => { setOpen(false); signOut(); }}>Back to the welcome screen</button>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { attention, invitations } = useApp();
  const links = [
    { to: '/', label: 'Explore', icon: '🔍', end: true },
    { to: '/activity', label: 'Loans', icon: '🤝', badge: attention },
    { to: '/circles', label: 'Circles', icon: '🫶', badge: invitations, badgeLabel: 'invitations' },
    { to: '/shelf', label: 'My shelf', icon: '🧺' },
  ];
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo-link" aria-label="BorrowBox home"><Logo /></Link>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="nav-link">
              <span className="nav-icon" aria-hidden="true">{l.icon}</span>
              <span>{l.label}</span>
              {l.badge > 0 && <span className="badge" aria-label={`${l.badge} ${l.badgeLabel ?? 'waiting for you'}`}>{l.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <IdentityMenu />
      </div>
    </header>
  );
}
