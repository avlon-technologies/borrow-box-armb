import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Header from './components/Header.jsx';
import Welcome from './pages/Welcome.jsx';
import Explore from './pages/Explore.jsx';
import ItemPage from './pages/ItemPage.jsx';
import ItemForm from './pages/ItemForm.jsx';
import Activity from './pages/Activity.jsx';
import LoanPage from './pages/LoanPage.jsx';
import Shelf from './pages/Shelf.jsx';
import NotFound from './pages/NotFound.jsx';
import { Spinner } from './components/ui.jsx';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = still loading
  const [config, setConfig] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [attention, setAttention] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);

  const refreshAttention = useCallback(async () => {
    try {
      const list = await api.reservations();
      setAttention(list.filter((r) => r.needsMe).length);
    } catch { /* badge is a nicety */ }
  }, []);

  useEffect(() => {
    api.session().then((s) => setMe(s.person)).catch(() => setMe(null));
    api.config().then(setConfig).catch(() => {});
    const onSignedOut = () => setMe(null);
    window.addEventListener('borrowbox:signed-out', onSignedOut);
    return () => window.removeEventListener('borrowbox:signed-out', onSignedOut);
  }, []);

  useEffect(() => { if (me) refreshAttention(); }, [me, location.pathname, refreshAttention]);

  // Move focus to the page content on navigation, so keyboard and screen-reader users land in context.
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const switchTo = useCallback(async (personId) => {
    const { person } = await api.signIn(personId);
    setMe(person);
    toast(`You're now browsing as ${person.firstName}.`);
    navigate('/');
  }, [navigate, toast]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setMe(null);
    navigate('/');
  }, [navigate]);

  const value = useMemo(() => ({ me, config, toast, switchTo, signOut, refreshAttention, attention }), [me, config, toast, switchTo, signOut, refreshAttention, attention]);

  return (
    <AppContext.Provider value={value}>
      <a className="skip-link" href="#main">Skip to content</a>
      {me && <Header />}
      <main id="main" ref={mainRef} tabIndex={-1} className={me ? 'page' : ''}>
        {me === undefined ? (
          <div className="center-pad"><Spinner label="Opening BorrowBox" /></div>
        ) : me === null ? (
          <Welcome />
        ) : (
          <Routes>
            <Route path="/" element={<Explore />} />
            <Route path="/items/new" element={<ItemForm />} />
            <Route path="/items/:id" element={<ItemPage />} />
            <Route path="/items/:id/edit" element={<ItemForm />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/loans/:id" element={<LoanPage />} />
            <Route path="/shelf" element={<Shelf />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </main>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
