import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newKey } from '../api.js';

export function Avatar({ person, size = 36 }) {
  if (!person) return null;
  const initials = person.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <span className="avatar" style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function Chip({ tone = 'muted', children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function EmptyState({ icon = '📦', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-icon" aria-hidden="true">🌧️</div>
      <h3>{error?.status === 404 ? "We couldn't find that" : 'That didn’t load'}</h3>
      <p>{error?.message}</p>
      <div className="row-gap">
        {onRetry && error?.status !== 404 && <button className="btn" onClick={onRetry}>Try again</button>}
        <Link className="btn btn-ghost" to="/">Back to exploring</Link>
      </div>
    </div>
  );
}

/** Load data for a page, with reload and a stable error/loading story. */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const counter = useRef(0);
  const load = useCallback(async ({ quiet = false } = {}) => {
    const n = ++counter.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (n === counter.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (n === counter.current) setState({ loading: false, data: null, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

/**
 * One submission at a time, with one idempotency key per intent: a double click is ignored,
 * and a retry after a network failure reuses the key so it cannot create a duplicate.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyRef = useRef(null);
  const busyRef = useRef(false);
  const run = useCallback(async (fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    keyRef.current = keyRef.current ?? newKey();
    try {
      const result = await fn(keyRef.current);
      keyRef.current = null;
      return result;
    } catch (err) {
      // Keep the key only when the server never answered; a refusal means the next try is new.
      if (err.status !== 0) keyRef.current = null;
      setError(err);
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function FormError({ error }) {
  if (!error) return null;
  return <p className="form-error" role="alert">{error.message}</p>;
}

export function Button({ busy, children, className = 'btn btn-primary', busyLabel, ...props }) {
  return (
    <button className={className} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy ? <><span className="spinner spinner-sm" aria-hidden="true" /> {busyLabel ?? 'Saving…'}</> : children}
    </button>
  );
}

export function Photo({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`photo photo-missing ${className}`} role="img" aria-label={alt}>📷</div>;
  return <img className={`photo ${className}`} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
