import { useCallback, useEffect, useState } from 'react';
import { api, errMsg, refresh, setSession } from './api';
import { AuthModal, SchemeDetail } from './ui';
import type { Profile, Scheme, User } from './types';
import Discover from './views/Discover';
import Explore from './views/Explore';
import Assistant from './views/Assistant';
import Library, { Alerts } from './views/Library';
import Admin from './views/Admin';

export interface Ctx {
  user: User | null; profile: Profile; setProfile: (p: Profile) => void; saved: Set<string>;
  toggleSave: (s: Scheme) => Promise<void>; openScheme: (slug: string) => void; needAuth: () => void;
  signOut: (deleted?: boolean) => void; refreshUnread: () => void;
}
const VIEWS = [['discover', 'Discover'], ['explore', 'Explore'], ['ask', 'Ask AI'], ['library', 'Saved'], ['alerts', 'Alerts']] as const;
const readHash = () => (location.hash.replace('#/', '') || 'discover');

export default function App() {
  const [view, setView] = useState(readHash());
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [auth, setAuth] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [unread, setUnread] = useState(0);

  useEffect(() => { const h = () => setView(readHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  useEffect(() => { refresh().then((u) => { setUser(u); setReady(true); }); }, []);
  useEffect(() => {
    const t = (e: Event) => { setToast((e as CustomEvent).detail); setTimeout(() => setToast(''), 3200); };
    addEventListener('sp-toast', t); return () => removeEventListener('sp-toast', t);
  }, []);
  const refreshUnread = useCallback(() => { api('/notifications').then((r) => setUnread(r.unread)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!user) { setSaved(new Set()); setUnread(0); return; }
    api('/saved-schemes').then((r) => setSaved(new Set(r.items.map((i: any) => i.scheme.id)))).catch(() => undefined);
    api('/profiles/me').then((r) => setProfile((p) => (Object.keys(p).length ? p : r.profile))).catch(() => undefined);
    refreshUnread();
  }, [user?.id]);

  const needAuth = () => setAuth(true);
  const toggleSave = async (s: Scheme) => {
    if (!user) return needAuth();
    try {
      if (saved.has(s.id)) { await api(`/saved-schemes/${s.id}`, { method: 'DELETE' }); setSaved((x) => { const n = new Set(x); n.delete(s.id); return n; }); }
      else { await api('/saved-schemes', { body: { schemeId: s.id } }); setSaved((x) => new Set(x).add(s.id)); }
    } catch (e) { window.dispatchEvent(new CustomEvent('sp-toast', { detail: errMsg(e) })); }
  };
  const signOut = async (deleted?: boolean) => {
    if (!deleted) await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null); setUser(null); setProfile({}); location.hash = '#/discover';
  };
  const ctx: Ctx = { user, profile, setProfile, saved, toggleSave, openScheme: setDetail, needAuth, signOut, refreshUnread };
  const tabs = user?.role === 'admin' ? [...VIEWS, ['admin', 'Admin'] as const] : VIEWS;

  return (
    <>
      <header className="top"><span className="brand">SchemePulse</span>
        <nav className="tabs" aria-label="Main">{tabs.map(([k, l]) => <button key={k} aria-current={view === k ? 'page' : undefined} onClick={() => (location.hash = `#/${k}`)}>{l}{k === 'alerts' && unread > 0 ? ` (${unread})` : ''}</button>)}</nav>
        {user ? <button onClick={() => signOut()}>Sign out</button> : <button onClick={needAuth}>Sign in</button>}</header>
      <main id="main">{!ready ? <div className="skel" /> : <>
        {view === 'discover' && <Discover ctx={ctx} />}{view === 'explore' && <Explore ctx={ctx} />}{view === 'ask' && <Assistant ctx={ctx} />}
        {view === 'library' && <Library ctx={ctx} />}{view === 'alerts' && <Alerts ctx={ctx} />}{view === 'admin' && <Admin ctx={ctx} />}</>}</main>
      <footer>SchemePulse is an independent discovery service, not a government agency. Confirm eligibility, deadlines and application details with the issuing department before applying.</footer>
      {auth && <AuthModal onClose={() => setAuth(false)} onDone={(u, t) => { setSession(t); setUser(u); setAuth(false); }} />}
      {detail && <SchemeDetail slug={detail} user={user} onClose={() => setDetail(null)} needAuth={needAuth} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
