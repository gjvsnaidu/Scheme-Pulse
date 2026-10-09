import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { Modal, Trust } from '../ui';
import type { Scheme } from '../types';
import type { Ctx } from '../App';

export default function Explore({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(''); const [cat, setCat] = useState('');
  const [cats, setCats] = useState<{ name: string; count: number }[]>([]);
  const [items, setItems] = useState<Scheme[] | null>(null);
  const [pick, setPick] = useState<string[]>([]); const [cmp, setCmp] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/categories').then(setCats).catch(() => undefined); }, []);
  useEffect(() => {
    const t = setTimeout(() => api(`/schemes?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}&pageSize=50`).then((r) => { setItems(r.items); setErr(''); }).catch((e) => setErr(errMsg(e))), 250);
    return () => clearTimeout(t);
  }, [q, cat]);
  const compare = async () => { try { setCmp((await api(`/compare?ids=${pick.join(',')}`)).items); } catch (e) { setErr(errMsg(e)); } };
  return (
    <section><h2>Explore schemes</h2><p className="lead">Search by what you need, like "financial help for engineering students" or "support for starting a small business".</p>
      <div className="official-catalog">
        <div><h3>Full official catalog</h3><p className="mut">Browse the live myScheme listings by category, state, ministry and eligibility filters.</p></div>
        <div className="catalog-actions">
          <a className="catalog-link" href="https://www.myscheme.gov.in/search" target="_blank" rel="noopener noreferrer">Browse myScheme</a>
          <a className="catalog-link" href="https://www.msme.gov.in/offerings/schemes-and-services" target="_blank" rel="noopener noreferrer">MSME schemes</a>
        </div>
      </div>
      <label htmlFor="q" className="mut">Search schemes</label><input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you need help with?" />
      <div className="row"><button aria-pressed={cat === ''} onClick={() => setCat('')}>All</button>{cats.map((c) => <button key={c.name} aria-pressed={cat === c.name} onClick={() => setCat(c.name)}>{c.name} ({c.count})</button>)}</div>
      {err && <p className="err" role="alert">{err}</p>}
      {pick.length >= 2 && <div className="row"><button className="pri" onClick={compare}>Compare {pick.length} schemes</button></div>}
      {!items ? <div className="skel" /> : items.length === 0 ? <div className="box"><h3>{q || cat ? 'No schemes found.' : 'No official schemes are published yet.'}</h3>
        <p className="mut">{q || cat ? 'Try different words, or clear the category filter.' : 'Scheme sources are connected by an administrator. You can browse the official myScheme catalog while this site is being connected.'}</p>
        {!q && !cat && <a href="https://www.myscheme.gov.in/" target="_blank" rel="noopener noreferrer">Open the official myScheme catalog</a>}
      </div> :
        items.map((s) => (
          <article className="box" key={s.id}><div className="cardhead"><div><h3>{s.name}</h3><div className="mut">{s.department} ({s.category})</div></div><Trust s={s} /></div>
            <p><b>{s.benefitText}</b><br /><span className="mut">{s.summary}</span></p>
            <div className="row"><button onClick={() => ctx.openScheme(s.slug)}>Details</button><button aria-pressed={ctx.saved.has(s.id)} onClick={() => ctx.toggleSave(s)}>{ctx.saved.has(s.id) ? '★ Saved' : '☆ Save'}</button>
              <label style={{ fontWeight: 500, display: 'flex', gap: 6, margin: 0 }}><input type="checkbox" checked={pick.includes(s.slug)} disabled={!pick.includes(s.slug) && pick.length >= 3} onChange={(e) => setPick(e.target.checked ? [...pick, s.slug] : pick.filter((x) => x !== s.slug))} />Compare</label></div></article>))}
      {cmp && <Modal title="Compare schemes" onClose={() => setCmp(null)}><div style={{ overflowX: 'auto' }}><table><thead><tr><th></th>{cmp.map((c) => <th key={c.slug}>{c.name}</th>)}</tr></thead><tbody>
        {[['Benefit', 'benefit'], ['Available in', 'level'], ['Deadline', 'deadline'], ['Documents', 'documents']].map(([l, k]) => <tr key={k}><th>{l}</th>{cmp.map((c) => <td key={c.slug}>{String(c[k] ?? 'Not listed')}</td>)}</tr>)}
        <tr><th>Verified</th>{cmp.map((c) => <td key={c.slug}>{c.verified ? 'Yes' : 'Not yet'}</td>)}</tr></tbody></table></div>
        <p className="mut">Never assume schemes can be combined. Check scheme rules before combining benefits.</p></Modal>}
    </section>
  );
}
