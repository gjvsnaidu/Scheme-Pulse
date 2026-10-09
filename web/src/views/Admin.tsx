import { useState } from 'react';
import { api, errMsg, notify } from '../api';
import { Modal } from '../ui';
import { SignInPrompt } from './Library';
import type { Ctx } from '../App';
import { useEffect } from 'react';

const TEMPLATE = {
  slug: 'example-scheme', name: 'Example Scheme Name', department: 'Department name', category: 'Education', level: 'national', states: [],
  summary: 'One or two plain-language sentences.', benefitText: 'Up to ₹10,000 a year', benefitValue: 10000, goal: 'education', deadline: null,
  sourceUrl: null, isDemo: false,
  rules: [{ field: 'age', op: 'between', value: [18, 30], label: 'Age' }, { field: 'income', op: 'lte', value: 300000, label: 'Family income' }],
  documents: ['Aadhaar', 'Income certificate'],
};

export default function Admin({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<'schemes' | 'sources' | 'analytics' | 'weights' | 'audit'>('schemes');
  if (!ctx.user) return <SignInPrompt ctx={ctx} what="Admin" />;
  if (ctx.user.role !== 'admin') return <section><h2>Admin</h2><div className="box"><h3>You do not have access to this area.</h3><p className="mut">Admin tools are limited to reviewers.</p></div></section>;
  return <section><h2>Admin command center</h2>
    <div className="row" role="tablist">{(['schemes', 'sources', 'analytics', 'weights', 'audit'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
    {tab === 'schemes' && <Schemes />}{tab === 'sources' && <Sources />}{tab === 'analytics' && <Analytics />}{tab === 'weights' && <Weights />}{tab === 'audit' && <Audit />}</section>;
}

function Sources() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api('/admin/sources').then(setData).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const sync = async (key?: string) => {
    setBusy(key ?? 'all'); setErr('');
    try {
      const result = await api('/admin/sources/sync', { method: 'POST', body: key ? { key } : {} });
      const summary = result.results.map((r: any) => `${r.sourceName}: ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.rejected} rejected`).join('; ');
      notify(summary || 'No official feeds are configured.');
      await load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  if (!data && !err) return <div className="skel" />;
  return <div>
    <div className="row"><h3 style={{ flex: 1 }}>Official portal feeds</h3><button className="pri" disabled={!data?.configured || !!busy} onClick={() => sync()}>{busy === 'all' ? 'Syncing…' : 'Sync all feeds'}</button></div>
    <p className="mut">Feed definitions are stored in the server environment. New records enter review as drafts; changes to published records return to review before replacing live information.</p>
    {!data?.configured ? <div className="box"><h3>No official feed connected</h3><p>Set <code>OFFICIAL_SCHEME_FEEDS</code> in the server environment and restart the API. Feeds must use HTTPS on <code>gov.in</code> or <code>nic.in</code> and return the normalized SchemePulse JSON format.</p>
      <p className="mut">No undocumented portal endpoints are queried. Connect a portal API or approved export feed before enabling automatic sync.</p></div> : <div className="box" style={{ overflowX: 'auto' }}><table><thead><tr><th>Source</th><th>Latest run</th><th>Imported</th><th>Action</th></tr></thead><tbody>
      {data.feeds.map((feed: any) => {
        const latest = data.runs.find((run: any) => run.source_key === feed.key);
        return <tr key={feed.key}><td><b>{feed.name}</b><div className="mut">{feed.portal}</div></td><td>{latest ? `${latest.status.replaceAll('_', ' ')} · ${new Date(latest.started_at).toLocaleString()}` : 'Not synced yet'}</td>
          <td>{latest ? `${latest.created} new · ${latest.updated} updated · ${latest.rejected} rejected` : '—'}</td><td><button disabled={!!busy} onClick={() => sync(feed.key)}>{busy === feed.key ? 'Syncing…' : 'Sync now'}</button></td></tr>;
      })}</tbody></table></div>}
    {data?.runs?.length > 0 && <div className="box" style={{ overflowX: 'auto' }}><h3>Recent sync runs</h3><table><thead><tr><th>Started</th><th>Source</th><th>Status</th><th>Records</th><th>Rejected</th></tr></thead><tbody>
      {data.runs.map((run: any) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString()}</td><td>{run.source_name}</td><td>{run.status.replaceAll('_', ' ')}{run.error ? <div className="err">{run.error}</div> : null}</td><td>{run.items_seen} seen · {run.created} new · {run.updated} updated · {run.unchanged} unchanged</td><td>{run.rejected}</td></tr>)}
    </tbody></table></div>}
    {err && <p className="err" role="alert">{err}</p>}
  </div>;
}

function Schemes() {
  const [items, setItems] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<{ id?: string; json: string } | null>(null);
  const [err, setErr] = useState('');
  const load = () => api('/admin/schemes').then((r) => setItems(r.items)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const review = async (id: string, decision: string) => { try { await api(`/admin/schemes/${id}/review`, { body: { decision } }); notify(`Marked ${decision}`); load(); } catch (e) { notify(errMsg(e)); } };
  const save = async () => {
    try { const body = JSON.parse(edit!.json); await api(edit!.id ? `/admin/schemes/${edit!.id}` : '/admin/schemes', { method: edit!.id ? 'PUT' : 'POST', body }); setEdit(null); notify('Saved'); load(); }
    catch (e) { setErr(e instanceof SyntaxError ? 'That is not valid JSON.' : errMsg(e)); }
  };
  const open = (s?: any) => { setErr(''); setEdit(s ? { id: s.id, json: JSON.stringify({ ...s, id: undefined, status: undefined, verifiedAt: undefined, version: undefined }, null, 2) } : { json: JSON.stringify(TEMPLATE, null, 2) }); };
  const job = async () => { try { const r = await api('/admin/jobs/deadlines', { method: 'POST' }); notify(`Deadline job created ${r.created} notifications`); } catch (e) { notify(errMsg(e)); } };
  return <><div className="row"><button className="pri" onClick={() => open()}>New scheme</button><button onClick={job}>Run deadline reminders</button></div>
    {!items ? <div className="skel" /> : <div className="box" style={{ overflowX: 'auto' }}><table><thead><tr><th>Scheme</th><th>Status</th><th>Version</th><th>Verified</th><th>Actions</th></tr></thead><tbody>
      {items.map((s) => <tr key={s.id}><td><b>{s.name}</b><div className="mut">{s.department}</div></td><td><span className={`tag ${s.status === 'published' ? 'ok' : 'wn'}`}>{s.status.replace('_', ' ')}</span></td><td>{s.version}</td><td>{s.verifiedAt ? new Date(s.verifiedAt).toLocaleDateString() : s.isDemo ? 'Demo' : 'No'}</td>
        <td><div className="row" style={{ margin: 0 }}><button onClick={() => open(s)}>Edit</button><button onClick={() => review(s.id, 'published')} disabled={s.status === 'published'}>Publish</button><button onClick={() => review(s.id, 'verified')}>Verify</button><button onClick={() => review(s.id, 'archived')} disabled={s.status === 'archived'}>Archive</button></div></td></tr>)}</tbody></table></div>}
    {edit && <Modal title={edit.id ? 'Edit scheme' : 'New scheme'} onClose={() => setEdit(null)}>
      <p className="mut">Edits to a published scheme send it back to review. Verification requires an official source URL.</p>
      <label htmlFor="js">Scheme definition (JSON)</label><textarea id="js" className="json" style={{ minHeight: 340 }} value={edit.json} onChange={(e) => setEdit({ ...edit, json: e.target.value })} />
      {err && <p className="err" role="alert">{err}</p>}<div className="row"><button className="pri" onClick={save}>Save</button><button onClick={() => setEdit(null)}>Cancel</button></div></Modal>}
    {err && !edit && <p className="err">{err}</p>}</>;
}

function Analytics() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/admin/analytics').then(setD).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <p className="err">{err}</p>; if (!d) return <div className="skel" />;
  const c = d.counts;
  const list = (title: string, rows: any[], k: string) => <div className="box"><h3>{title}</h3>{rows.length ? rows.map((r) => <div className="srow" key={r[k]}><span>{r[k] ?? '(none)'}</span><b>{r.n}</b><span /></div>) : <p className="mut">No activity yet.</p>}</div>;
  return <><div className="grid">{[['Schemes', c.schemes], ['Published', c.published], ['Pending review', c.pending], ['Verified', c.verified], ['Expiring in 30 days', c.expiring], ['Needs verification', c.needs_review], ['Users', c.users]].map(([l, v]) => <div className="box" key={l as string}><div className="stat">{v}</div>{l}</div>)}</div>
    <div className="grid">{list('Most saved', d.mostSaved, 'name')}{list('Most recommended', d.mostRecommended, 'name')}{list('Top searches', d.topSearches, 'q')}{list('Assistant topics', d.assistantTopics, 'intent')}{list('Category demand (views)', d.categoryDemand, 'category')}</div></>;
}

function Weights() {
  const [w, setW] = useState<Record<string, number> | null>(null);
  useEffect(() => { api('/admin/weights').then((r) => setW(r.weights)).catch((e) => notify(errMsg(e))); }, []);
  if (!w) return <div className="skel" />;
  const save = async () => { try { await api('/admin/weights', { method: 'PUT', body: w }); notify('Weights saved'); } catch (e) { notify(errMsg(e)); } };
  return <div className="box"><h3>Recommendation score weights</h3><p className="mut">Weights are normalised to 100%. Eligibility rules are never changed by weights.</p>
    {Object.entries(w).map(([k, v]) => <div key={k}><label htmlFor={k} style={{ textTransform: 'capitalize' }}>{k}: {v}</label><input id={k} type="range" min={0} max={60} value={v} onChange={(e) => setW({ ...w, [k]: +e.target.value })} /></div>)}
    <div className="row"><button className="pri" onClick={save}>Save weights</button></div></div>;
}

function Audit() {
  const [d, setD] = useState<any[] | null>(null);
  useEffect(() => { api('/admin/audit').then((r) => setD(r.items)).catch(() => setD([])); }, []);
  if (!d) return <div className="skel" />;
  return <div className="box" style={{ overflowX: 'auto' }}><table><thead><tr><th>When</th><th>Action</th><th>Entity</th></tr></thead><tbody>{d.map((a) => <tr key={a.id}><td>{new Date(a.created_at).toLocaleString()}</td><td>{a.action}</td><td>{a.entity} <span className="mut">{a.entity_id?.slice(0, 8)}</span></td></tr>)}</tbody></table></div>;
}
