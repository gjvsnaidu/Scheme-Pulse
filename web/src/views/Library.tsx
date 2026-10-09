import { useCallback, useEffect, useState } from 'react';
import { api, errMsg, notify } from '../api';
import { Deadline, Trust } from '../ui';
import { OCCUPATIONS, GOALS, type Scheme } from '../types';
import type { Ctx } from '../App';

const STEPS = ['discovered', 'eligibility_checked', 'documents_ready', 'started', 'submitted', 'under_review', 'approved', 'rejected'];
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function useLoad<T>(path: string | null) {
  const [d, setD] = useState<T | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => { if (path) api<T>(path).then((r) => { setD(r); setErr(''); }).catch((e) => setErr(errMsg(e))); }, [path]);
  useEffect(load, [load]);
  return { d, err, load };
}

export function SignInPrompt({ ctx, what }: { ctx: Ctx; what: string }) {
  return <section><h2>{what}</h2><div className="box"><h3>Sign in to continue</h3><p className="mut">Your account keeps saved schemes, documents and applications together and private to you.</p><button className="pri" onClick={ctx.needAuth}>Sign in or create an account</button></div></section>;
}

export default function Library({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<'saved' | 'apps' | 'docs' | 'privacy'>('saved');
  if (!ctx.user) return <SignInPrompt ctx={ctx} what="Your opportunity library" />;
  return (
    <section><h2>Your opportunity library</h2>
      <div className="row" role="tablist">{([['saved', 'Saved'], ['apps', 'Applications'], ['docs', 'Documents'], ['privacy', 'Privacy']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'saved' && <Saved ctx={ctx} />}{tab === 'apps' && <Apps />}{tab === 'docs' && <Docs />}{tab === 'privacy' && <Privacy ctx={ctx} />}
    </section>
  );
}

function Saved({ ctx }: { ctx: Ctx }) {
  const { d, err, load } = useLoad<{ items: { scheme: Scheme }[] }>('/saved-schemes');
  if (err) return <p className="err">{err}</p>; if (!d) return <div className="skel" />;
  if (!d.items.length) return <div className="box"><h3>Your opportunity library is empty.</h3><p className="mut">Save schemes you want to revisit later.</p></div>;
  return <>{d.items.map(({ scheme: s }) => (
    <article className="box" key={s.id}><h3>{s.name}</h3><p className="mut">{s.department}</p><p><b>{s.benefitText}</b></p>
      <div className="row"><Trust s={s} /><Deadline s={s} left={s.deadline ? Math.ceil((new Date(s.deadline + 'T23:59:59').getTime() - Date.now()) / 864e5) : null} /></div>
      <div className="row"><button onClick={() => ctx.openScheme(s.slug)}>Details</button><button onClick={async () => { await ctx.toggleSave(s); load(); }}>Remove</button></div></article>))}</>;
}

function Apps() {
  const { d, err, load } = useLoad<{ items: any[]; note: string }>('/applications');
  const set = async (id: string, status: string) => { try { await api(`/applications/${id}`, { method: 'PATCH', body: { status } }); notify('Updated'); load(); } catch (e) { notify(errMsg(e)); } };
  if (err) return <p className="err">{err}</p>; if (!d) return <div className="skel" />;
  return <><p className="mut">{d.note}</p>{d.items.length === 0 && <div className="box"><h3>No applications yet.</h3><p className="mut">Open a scheme and choose "Start tracking my application".</p></div>}
    {d.items.map((a) => <article className="box" key={a.id}><h3>{a.name}</h3><label htmlFor={`s${a.id}`} className="mut" style={{ marginTop: 8 }}>Your progress</label>
      <select id={`s${a.id}`} value={a.status} onChange={(e) => set(a.id, e.target.value)}>{STEPS.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></article>)}</>;
}

function Docs() {
  const { d, err, load } = useLoad<{ items: any[]; note: string }>('/documents');
  const [type, setType] = useState('');
  const declare = async () => { try { await api('/documents/declare', { body: { docType: type } }); setType(''); load(); } catch (e) { notify(errMsg(e)); } };
  const upload = async (f: File) => { try { const fd = new FormData(); fd.append('docType', type || f.name.replace(/\.[^.]+$/, '')); fd.append('file', f); await api('/documents/upload', { form: fd }); setType(''); notify('Uploaded'); load(); } catch (e) { notify(errMsg(e)); } };
  const del = async (id: string) => { await api(`/documents/${id}`, { method: 'DELETE' }); load(); };
  if (err) return <p className="err">{err}</p>; if (!d) return <div className="skel" />;
  return <><p className="mut">{d.note}</p>
    <div className="box"><label htmlFor="dt">Document name</label><input id="dt" value={type} onChange={(e) => setType(e.target.value)} placeholder="Example: Income certificate" />
      <div className="row"><button onClick={declare} disabled={type.trim().length < 2}>I have this document</button>
        <label className="link" style={{ display: 'inline', cursor: 'pointer' }}>Upload a PDF, PNG or JPEG (max 5 MB)<input type="file" hidden accept="application/pdf,image/png,image/jpeg" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label></div></div>
    {d.items.map((x) => <div className="srow" key={x.id}><b>{x.doc_type}</b><span className="tag">{x.status === 'uploaded' ? 'Uploaded by you' : 'Self-declared'}</span><button onClick={() => del(x.id)} aria-label={`Delete ${x.doc_type}`}>Delete</button></div>)}</>;
}

function Privacy({ ctx }: { ctx: Ctx }) {
  const { d } = useLoad<{ profile: any }>('/profiles/me');
  const [confirm, setConfirm] = useState(false);
  const exp = async () => { try { const d = await api('/privacy/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'schemepulse-data.json'; a.click(); } catch (e) { notify(errMsg(e)); } };
  const del = async () => { try { await api('/privacy/account', { method: 'DELETE' }); ctx.signOut(true); } catch (e) { notify(errMsg(e)); } };
  const p = d?.profile ?? {};
  return <><div className="box"><h3>What SchemePulse knows about you</h3>
    <ul className="ck"><li>Email: {ctx.user?.email}</li><li>Age: {p.age ?? 'not provided'}</li><li>Situation: {p.occupation ? OCCUPATIONS[p.occupation] ?? p.occupation : 'not provided'}</li><li>State: {p.state ?? 'not provided'}</li><li>Family income: {p.income !== undefined ? `₹${p.income.toLocaleString('en-IN')}` : 'not provided'}</li><li>Goal: {p.goal ? GOALS[p.goal] ?? p.goal : 'not provided'}</li></ul>
    <p className="mut">Saved schemes, applications, documents and notifications are also stored for your account. Edit your details by running Discover again and saving.</p></div>
    <div className="box"><h3>Your data, your control</h3><div className="row"><button onClick={exp}>Download my data</button>
      {!confirm ? <button onClick={() => setConfirm(true)}>Delete my account</button> : <><span className="err">This permanently deletes your account and uploaded files.</span><button className="pri" onClick={del}>Yes, delete everything</button><button onClick={() => setConfirm(false)}>Cancel</button></>}</div></div></>;
}

export function Alerts({ ctx }: { ctx: Ctx }) {
  const { d, err, load } = useLoad<{ items: any[]; unread: number }>(ctx.user ? '/notifications' : null);
  if (!ctx.user) return <SignInPrompt ctx={ctx} what="Alerts" />;
  if (err) return <p className="err">{err}</p>; if (!d) return <div className="skel" />;
  const readAll = async () => { await api('/notifications/read-all', { method: 'POST' }); load(); ctx.refreshUnread(); };
  return <section><h2>Alerts</h2>{d.items.length === 0 ? <div className="box"><h3>No alerts yet.</h3><p className="mut">When a scheme you saved is about to close, you will see it here.</p></div> : <>
    <div className="row"><button onClick={readAll} disabled={!d.unread}>Mark all as read</button></div>
    {d.items.map((n) => <div className="box" key={n.id} style={{ opacity: n.read_at ? 0.65 : 1 }}><h3>{n.title}</h3><p className="mut">{n.body}</p></div>)}</>}</section>;
}
