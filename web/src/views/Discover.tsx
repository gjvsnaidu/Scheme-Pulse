import { useEffect, useRef, useState } from 'react';
import { api, errMsg, notify } from '../api';
import { Pulse, SchemeCard } from '../ui';
import { GOALS, OCCUPATIONS, STATUS_CLASS, STATUS_LABEL, inr, type Profile, type Rec } from '../types';
import type { Ctx } from '../App';

const EXAMPLES = [
  "I'm a 21-year-old B.Tech student from Andhra Pradesh. My family earns around ₹2.5 lakh a year and I need financial support for education.",
  "I'm a 45-year-old farmer in Telangana. Our household income is about 1.8 lakh a year.",
  "I'm 29 and want to start a small business in Tamil Nadu. Family income is 4 lakh.",
];
type Stage = 'describe' | 'working' | 'confirm' | 'results';

export default function Discover({ ctx }: { ctx: Ctx }) {
  const [stage, setStage] = useState<Stage>('describe');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Profile>({});
  const [detected, setDetected] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ items: Rec[]; summary: any } | null>(null);
  const [tab, setTab] = useState<'m' | 's'>('m');
  const [onlySaved, setOnlySaved] = useState(false);
  const [states, setStates] = useState<string[]>([]);
  useEffect(() => { api('/meta').then((m) => setStates(m.states)).catch(() => undefined); }, []);

  const parse = async () => {
    if (text.trim().length < 3) return setErr('Write a sentence or two about yourself, or pick an example.');
    setErr(''); setStage('working'); setStep(0.4); setMsg('Understanding your situation…');
    try {
      const r = await api('/profiles/parse', { body: { text } });
      setDraft(r.profile); setDetected(Object.fromEntries(r.detected.map((d: any) => [d.field, d.detected]))); setStep(1); setStage('confirm');
    } catch (e) { setErr(errMsg(e)); setStage('describe'); }
  };
  const run = async (p: Profile, save = false) => {
    setErr(''); setStage('working'); setStep(2); setMsg('Checking eligibility rules and ranking your matches…');
    try {
      if (save && ctx.user) await api('/profiles/me', { method: 'PUT', body: p });
      const r = await api('/recommendations', { body: { profile: p } });
      ctx.setProfile(p); setRes(r); setStep(4); setTab('m'); setStage('results');
    } catch (e) { setErr(errMsg(e)); setStage('confirm'); }
  };
  const useSaved = async () => { try { const r = await api('/profiles/me'); setDraft(r.profile); run(r.profile); } catch (e) { setErr(errMsg(e)); } };
  const submitFeedback = async (schemeId: string, rating: 'helpful' | 'not_helpful') => {
    if (!ctx.user) return ctx.needAuth();
    try {
      await api(`/recommendations/${schemeId}/feedback`, { method: 'POST', body: { rating } });
      setRes((current) => current && ({ ...current, items: current.items.map((item) => item.scheme.id === schemeId ? { ...item, feedback: rating } : item) }));
      notify('Thanks. Your feedback will help tune future rankings.');
    } catch (e) { notify(errMsg(e)); }
  };

  if (stage === 'working') return <section aria-live="polite"><h2>Working on it</h2><Pulse step={step} /><p className="lead">{msg}</p><div className="skel" /><div className="skel" /></section>;

  if (stage === 'confirm') {
    const set = (k: keyof Profile, v: string, num = false) => setDraft((d) => ({ ...d, [k]: v === '' ? undefined : num ? Number(v) : v }));
    const badge = (k: string) => <span className={`tag ${detected[k] ? 'ok' : 'wn'}`}>{detected[k] ? 'Detected' : 'Not detected'}</span>;
    return (
      <section><h2>Is this correct?</h2><p className="lead">Here is what we understood. Edit anything, or leave a field empty. Nothing is saved unless you choose to.</p><Pulse step={1} />
        <div className="box grid">
          <div><label htmlFor="age">Age {badge('age')}</label><input id="age" type="number" min={0} max={120} value={draft.age ?? ''} onChange={(e) => set('age', e.target.value, true)} /></div>
          <div><label htmlFor="occ">Your situation {badge('occupation')}</label><select id="occ" value={draft.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)}><option value="">Not sure</option>{Object.entries(OCCUPATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label htmlFor="st">State {badge('state')}</label><select id="st" value={draft.state ?? ''} onChange={(e) => set('state', e.target.value)}><option value="">Not sure</option>{states.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label htmlFor="inc">Family income per year (₹) {badge('income')}</label><input id="inc" type="number" min={0} step={10000} value={draft.income ?? ''} onChange={(e) => set('income', e.target.value, true)} /></div>
          <div><label htmlFor="goal">What you need {badge('goal')}</label><select id="goal" value={draft.goal ?? ''} onChange={(e) => set('goal', e.target.value)}><option value="">Not sure</option>{Object.entries(GOALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row"><button className="pri" onClick={() => run(draft, !!ctx.user)}>Show my matches</button>
          <button onClick={() => setStage('describe')}>Back</button></div>
        <p className="mut">{ctx.user ? 'Your confirmed details will be saved to your profile. You can edit or delete them any time in Library.' : 'You are not signed in, so these details are used only for this search and are not stored.'}</p></section>
    );
  }

  if (stage === 'results' && res) {
    const open = res.items.filter((r) => r.status !== 'not_eligible'); const no = res.items.filter((r) => r.status === 'not_eligible');
    const list = onlySaved ? open.filter((r) => ctx.saved.has(r.scheme.id)) : open;
    return (
      <section>
        <h2>{open.length ? `We found ${open.length} scheme${open.length > 1 ? 's' : ''} that may be relevant` : 'No matches with these details'}</h2>
        <p className="lead">Ranked by eligibility, need, location, benefit, deadline and preference.</p>
        <div className="grid"><div className="box"><div className="stat">{res.summary.eligible}</div>fully eligible on the details given</div><div className="box"><div className="stat">{res.summary.needsInfo}</div>need more information</div><div className="box"><div className="stat">{res.summary.closingSoon}</div>closing within 30 days</div></div>
        <div className="row" role="tablist"><button role="tab" aria-selected={tab === 'm'} onClick={() => setTab('m')}>Matches</button><button role="tab" aria-selected={tab === 's'} onClick={() => setTab('s')}>What-if simulator</button><button onClick={() => setStage('confirm')}>Edit my details</button></div>
        {tab === 'm' ? <>
          <div className="row"><button aria-pressed={onlySaved} onClick={() => setOnlySaved(!onlySaved)}>Saved only</button></div>
          {list.length ? list.map((r) => <SchemeCard key={r.scheme.id} rec={r} saved={ctx.saved.has(r.scheme.id)} onSave={() => ctx.toggleSave(r.scheme)} onOpen={() => ctx.openScheme(r.scheme.slug)} onFeedback={(rating) => submitFeedback(r.scheme.id, rating)} />)
            : <div className="box"><h3>{onlySaved ? 'Your saved list is empty.' : 'Nothing matches yet.'}</h3><p className="mut">{onlySaved ? 'Save schemes you want to revisit later.' : 'Edit your details to widen the search.'}</p></div>}
          {!!no.length && !onlySaved && <details><summary>Not eligible right now ({no.length})</summary>{no.map((r) => <div className="box" key={r.scheme.id}><h3>{r.scheme.name}</h3><p className="mut">{r.checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`).join('. ')}</p></div>)}</details>}
        </> : <Simulator profile={draft} />}
      </section>
    );
  }

  return (
    <section>
      <h1>Find the support that's meant for you.</h1>
      <p className="lead">SchemePulse uses your situation, goals, location and eligibility to discover government schemes that matter to you.</p>
      <Pulse step={4} hero />
      <div className="box"><label htmlFor="t">Tell us what you're looking for.</label>
        <textarea id="t" value={text} onChange={(e) => setText(e.target.value)} placeholder="Example: I'm a 21-year-old student from Andhra Pradesh. My family earns about ₹2.5 lakh a year." />
        <div className="row" aria-label="Example prompts">{EXAMPLES.map((e) => <button key={e} onClick={() => setText(e)}>{e.slice(0, 36)}…</button>)}</div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row"><button className="pri" onClick={parse}>Discover my schemes</button>
          <button onClick={() => run({})}>Explore all schemes</button>
          {ctx.user && <button onClick={useSaved}>Use my saved profile</button>}</div>
        <p className="mut">You will confirm everything we understood before it is used.</p></div>
    </section>
  );
}

function Simulator({ profile }: { profile: Profile }) {
  const [income, setIncome] = useState(profile.income ?? 300000);
  const [age, setAge] = useState(profile.age ?? 25);
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const t = useRef<number>();
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => api('/eligibility/simulate', { body: { profile, changes: { income, age } } }).then((r) => { setItems(r.items); setErr(''); }).catch((e) => setErr(errMsg(e))), 200);
    return () => window.clearTimeout(t.current);
  }, [income, age]);
  return (
    <div className="box"><h3>What if your situation changes?</h3><p className="mut">Simulated results only. Your real details are not changed.</p>
      <label htmlFor="si">Family income: {inr(income)}</label><input id="si" type="range" min={0} max={1500000} step={10000} value={income} onChange={(e) => setIncome(+e.target.value)} />
      <label htmlFor="sa" style={{ marginTop: 12 }}>Age: {age}</label><input id="sa" type="range" min={15} max={80} value={age} onChange={(e) => setAge(+e.target.value)} />
      <div className="row"><button onClick={() => { setIncome(profile.income ?? 300000); setAge(profile.age ?? 25); }}>Reset to my details</button></div>
      {err && <p className="err" role="alert">{err}</p>}
      {items.map((i) => <div className="srow" key={i.schemeId}><b>{i.name}</b><span className={`tag ${STATUS_CLASS[i.before as keyof typeof STATUS_CLASS]}`}>{STATUS_LABEL[i.before as keyof typeof STATUS_LABEL]}</span><span className={`tag ${STATUS_CLASS[i.after as keyof typeof STATUS_CLASS]}`}>{i.changed ? '→ ' : ''}{STATUS_LABEL[i.after as keyof typeof STATUS_LABEL]}</span><small>{i.changed ? '⚠ Eligibility may change. ' : ''}{i.why}</small></div>)}
    </div>
  );
}
