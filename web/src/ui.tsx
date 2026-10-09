import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errMsg, notify } from './api';
import { inr, STATUS_CLASS, STATUS_LABEL, type Check, type Rec, type Scheme, type User } from './types';

const PD = 'M0 40H105l8-24 12 48 8-24H225l8-24 12 48 8-24H345l8-24 12 48 8-24H465l8-24 12 48 8-24H600';
const NODES = ['You', 'Understanding', 'Eligibility', 'Recommendation', 'Opportunity'];
/** The SchemePulse line: step 0-4 shows how far the analysis has actually progressed. */
export const Pulse = ({ step, hero }: { step: number; hero?: boolean }) => (
  <div className={`pl ${hero ? 'hero' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 600 80"><path className="g" d={PD} pathLength={1} /><path className="f" d={PD} pathLength={1} style={{ strokeDashoffset: 1 - step / 4 }} />
      {NODES.map((_, i) => <circle key={i} className={i <= Math.round(step) ? 'on' : ''} cx={60 + 120 * i} cy={40} r={8} />)}</svg>
    <div className="lb">{NODES.map((n) => <span key={n}>{n}</span>)}</div>
  </div>
);

export const Ring = ({ n }: { n: number }) => (
  <svg className="ring" viewBox="0 0 64 64" role="img" aria-label={`Match score ${n} out of 100`}>
    <circle cx="32" cy="32" r="26" /><circle className="f" cx="32" cy="32" r="26" style={{ strokeDasharray: `${n * 1.634} 163.4` }} />
    <text x="32" y="39" textAnchor="middle">{n}</text>
  </svg>
);

export const Bars = ({ c }: { c: Record<string, number> }) => (
  <>{Object.entries(c).map(([k, v]) => <div className="bar" key={k}><span>{k}</span><div><u style={{ width: `${v}%` }} /></div><b>{v}</b></div>)}</>
);

const ICON = { pass: '✓', unknown: '⚠', fail: '✕' };
export const Checks = ({ checks }: { checks: Check[] }) => (
  <ul className="ck">{checks.map((c, i) => <li key={i} className={c.status}><b>{ICON[c.status]}</b>{c.label}: <span className="mut">{c.detail}</span></li>)}</ul>
);

export const Trust = ({ s }: { s: Scheme }) => <>
  {s.verifiedAt ? <span className="tag ok">✓ Verified {new Date(s.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    : <span className="tag wn">{s.isDemo ? 'Demo record, not official' : '⚠ Verification needed'}</span>}
  {s.sourceSyncedAt && <span className="tag">Source synced {new Date(s.sourceSyncedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
</>;

export const Deadline = ({ s, left }: { s: Scheme; left: number | null }) =>
  s.deadline ? <span className={`tag ${left !== null && left >= 0 && left <= 14 ? 'wn' : ''}`}>{left !== null && left < 0 ? 'Closed' : `${left} days left`} (listed {s.deadline})</span> : <span className="tag">No deadline listed</span>;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row"><h2 style={{ margin: 0, flex: 1 }}>{title}</h2><button onClick={onClose} aria-label="Close">Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function SchemeCard({ rec, saved, onSave, onOpen, onFeedback }: { rec: Rec; saved: boolean; onSave: () => void; onOpen: () => void; onFeedback?: (rating: 'helpful' | 'not_helpful') => void }) {
  const { scheme: s } = rec;
  return (
    <article className="box">
      <div className="cardhead"><Ring n={rec.score.total} />
        <div><h3>{s.name}</h3><div className="mut">{s.department}</div></div>
        <span className={`tag ${STATUS_CLASS[rec.status]}`}>{STATUS_LABEL[rec.status]}</span></div>
      <p style={{ margin: '10px 0 0' }}><b>{s.benefitText}</b><br /><span className="mut">{rec.score.band}. {rec.reasons.length ? rec.reasons[rec.reasons.length - 1] : 'Add more details to improve this result.'}</span></p>
      <div className="row"><span className="tag">{s.level === 'national' ? 'National' : s.states.join(' and ')}</span><Deadline s={s} left={rec.daysLeft} /><Trust s={s} /></div>
      <details><summary>Why this result</summary>
        <Checks checks={rec.checks} />
        <h4>How we calculated {rec.score.total}</h4><Bars c={rec.score.components} />
        <p className="mut">Eligibility comes from fixed rules. Scores only rank schemes that pass them.</p></details>
      <div className="row"><button onClick={onSave} aria-pressed={saved}>{saved ? '★ Saved' : '☆ Save'}</button><button onClick={onOpen}>Details and documents</button></div>
      {onFeedback && <div className="row feedback" aria-label="Recommendation feedback">
        <span className="mut">Was this useful?</span>
        <button aria-pressed={rec.feedback === 'helpful'} onClick={() => onFeedback('helpful')}>Helpful</button>
        <button aria-pressed={rec.feedback === 'not_helpful'} onClick={() => onFeedback('not_helpful')}>Not for me</button>
      </div>}
    </article>
  );
}

export function SchemeDetail({ slug, user, onClose, needAuth }: { slug: string; user: User | null; onClose: () => void; needAuth: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => api(`/schemes/${slug}`).then(setD).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, [slug, user?.id]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (!user) return needAuth(); try { await fn(); notify(ok); load(); } catch (e) { notify(errMsg(e)); } };
  if (err) return <Modal title="Scheme" onClose={onClose}><p className="err">{err}</p></Modal>;
  if (!d) return <Modal title="Loading" onClose={onClose}><div className="skel" /></Modal>;
  const s: Scheme = d.scheme; const ev: Rec | null = d.evaluation;
  const upload = (docType: string, f: File) => act(() => { const fd = new FormData(); fd.append('docType', docType); fd.append('file', f); return api('/documents/upload', { form: fd }); }, 'Uploaded');
  return (
    <Modal title={s.name} onClose={onClose}>
      <p className="mut">{s.department}</p><p>{s.summary}</p>
      <h3>{s.benefitText}</h3>
      <div className="row"><Trust s={s} /><Deadline s={s} left={ev?.daysLeft ?? Math.ceil((new Date(s.deadline + 'T23:59:59').getTime() - Date.now()) / 864e5)} /></div>
      <div className="box" role="note"><b>Be careful.</b> SchemePulse will never ask you to pay anyone to unlock a government benefit. {s.sourceUrl ? <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open the official source</a> : <>No official source link is on record for this scheme. Confirm details with {s.department}.</>}</div>
      <h4>Are you eligible?</h4>
      {ev ? <><span className={`tag ${STATUS_CLASS[ev.status]}`}>{STATUS_LABEL[ev.status]}</span><Checks checks={ev.checks} /></> : <p className="mut">Sign in and save your profile to see a personal result here, or use Discover.</p>}
      <h4>Documents: {d.readiness}% ready</h4>
      <ul className="ck">{d.documents.map((x: any) => (
        <li key={x.name} className={x.held ? 'pass' : 'unknown'}><b>{x.held ? '✓' : '○'}</b>{x.name} <span className="mut">{x.held === 'uploaded' ? '(uploaded by you)' : x.held ? '(you say you have it)' : ''}</span>
          {!x.held && <> <button className="link" onClick={() => act(() => api('/documents/declare', { body: { docType: x.name } }), 'Marked as available')}>I have this</button></>}
          {' '}<label className="link" style={{ display: 'inline', fontWeight: 500, cursor: 'pointer' }}>Upload<input type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(x.name, e.target.files[0])} /></label></li>))}</ul>
      <p className="mut">{d.note} Check whether benefits can be combined with other schemes before applying.</p>
      <div className="row"><button className="pri" onClick={() => act(() => api('/applications', { body: { schemeId: s.id } }), 'Added to your tracker')}>Start tracking my application</button>
        <button onClick={() => act(() => api('/saved-schemes', { body: { schemeId: s.id } }), 'Saved')}>☆ Save</button></div>
    </Modal>
  );
}

export function AuthModal({ onClose, onDone }: { onClose: () => void; onDone: (u: User, token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ email: '', password: '', name: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api(`/auth/${mode}`, { body: mode === 'login' ? { email: f.email, password: f.password } : f }); onDone(r.user, r.accessToken); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={mode === 'login' ? 'Sign in' : 'Create your account'} onClose={onClose}>
      <p className="mut">An account lets you save schemes, keep your profile and track applications. You can export or delete your data anytime.</p>
      {mode === 'register' && <><label htmlFor="n">Name (optional)</label><input id="n" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></>}
      <label htmlFor="e" style={{ marginTop: 10 }}>Email</label><input id="e" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label htmlFor="p" style={{ marginTop: 10 }}>Password (8 or more characters)</label><input id="p" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="pri" disabled={busy} onClick={submit}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button></div>
    </Modal>
  );
}
export { inr };
