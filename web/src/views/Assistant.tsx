import { useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { SchemeCard } from '../ui';
import type { Rec } from '../types';
import type { Ctx } from '../App';

interface Msg { me?: boolean; text: string; schemes?: Rec[]; meta?: string }
const ASKS = ['Which schemes can I apply for?', 'Which scheme gives the highest benefit?', 'What are the deadlines?', 'What documents do I need?', 'Compare these schemes.'];

export default function Assistant({ ctx }: { ctx: Ctx }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ text: 'Ask me about schemes, eligibility, documents or deadlines. I answer from stored scheme records and rule checks, and I tell you when I cannot say.' }]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const hasProfile = Object.values(ctx.profile).some((v) => v !== undefined);
  const send = async (m: string) => {
    if (!m.trim() || busy) return;
    setMsgs((x) => [...x, { me: true, text: m }]); setText(''); setBusy(true);
    try {
      const r = await api('/ai/chat', { body: { message: m, ...(hasProfile ? { profile: ctx.profile } : {}) } });
      setMsgs((x) => [...x, { text: r.text, schemes: r.schemes, meta: `${r.disclaimer} (answered by: ${r.provider})` }]);
    } catch (e) { setMsgs((x) => [...x, { text: errMsg(e) }]); } finally { setBusy(false); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  };
  return (
    <section><h2>Ask SchemePulse</h2>
      {!hasProfile && !ctx.user && <p className="mut">Tip: describe yourself in Discover first so answers fit your situation.</p>}
      <div className="row" aria-label="Suggested questions">{ASKS.map((a) => <button key={a} onClick={() => send(a)}>{a}</button>)}</div>
      <div className="chat" aria-live="polite">{msgs.map((m, i) => (
        <div key={i} className={`msg ${m.me ? 'me' : ''}`}><p style={{ margin: 0 }}>{m.text}</p>
          {m.schemes?.map((r) => <SchemeCard key={r.scheme.id} rec={r} saved={ctx.saved.has(r.scheme.id)} onSave={() => ctx.toggleSave(r.scheme)} onOpen={() => ctx.openScheme(r.scheme.slug)} />)}
          {m.meta && <p className="mut" style={{ margin: '8px 0 0' }}>{m.meta}</p>}</div>))}
        {busy && <div className="skel" />}<div ref={end} /></div>
      <div className="row"><input aria-label="Your question" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} placeholder="Ask a question…" /><button className="pri" disabled={busy} onClick={() => send(text)}>Ask</button></div>
    </section>
  );
}
