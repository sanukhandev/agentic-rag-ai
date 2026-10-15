'use client';

import { useEffect, useState } from 'react';
import { applyActionState, historyToReplies, isChatActionState, isValidTenantSlug, type ChatHistoryMessage, type ChatReply } from './chat-utils';

type Reply = ChatReply;
type Config = { tenant: { name: string; slug: string }; persona: { name: string; greeting: string; tone: string; speakingStyle: string; permittedLanguages: string[] } | null };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [replies, setReplies] = useState<Reply[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    if (!isValidTenantSlug(tenantSlug)) { setConfig(null); return; }
    void fetch(`${api}/api/v1/chat/config?tenantSlug=${encodeURIComponent(tenantSlug)}`).then(async (response) => {
      if (!response.ok) throw new Error('Tenant chat is unavailable.');
      setConfig(await response.json() as Config);
    }).catch(() => setConfig(null));
    const savedSession = window.localStorage.getItem(`agentic-rag-session:${tenantSlug}`);
    if (!savedSession) { setSessionId(null); setReplies([]); return; }
    void fetch(`${api}/api/v1/chat/sessions/${savedSession}`).then(async (response) => {
      if (!response.ok) throw new Error('Saved session is unavailable.');
      const body = await response.json() as { messages: ChatHistoryMessage[] };
      setSessionId(savedSession);
      setReplies(historyToReplies(body.messages));
    }).catch(() => { window.localStorage.removeItem(`agentic-rag-session:${tenantSlug}`); setSessionId(null); setReplies([]); });
  }, [tenantSlug]);

  const send = async () => {
    setBusy(true); setError('');
    try {
      let activeSession = sessionId;
      if (!activeSession) {
        const session = await fetch(`${api}/api/v1/chat/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantSlug }) });
        if (!session.ok) throw new Error('Could not open a tenant session.');
        activeSession = (await session.json()).sessionId as string;
        setSessionId(activeSession);
        window.localStorage.setItem(`agentic-rag-session:${tenantSlug}`, activeSession);
      }
      const response = await fetch(`${api}/api/v1/chat/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: activeSession, message, clientMessageId: crypto.randomUUID() }) });
      const body = await response.json() as Reply & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'The assistant could not respond.');
      setReplies((items) => [...items, body]); setMessage('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unexpected error.'); }
    finally { setBusy(false); }
  };

  const confirm = async (proposalId: string) => {
    if (!sessionId) return;
    try {
      const response = await fetch(`${api}/api/v1/chat/actions/${proposalId}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, confirmed: true }) });
      const body = await response.json() as { action?: { state?: unknown }; error?: { message?: string } };
      if (!response.ok) { setError(body.error?.message ?? 'The request could not be confirmed.'); return; }
      const state = body.action?.state;
      if (!isChatActionState(state)) { setError('The workflow returned an invalid status.'); return; }
      setReplies((items) => applyActionState(items, proposalId, state));
    } catch { setError('The request could not be confirmed.'); }
  };

  const reset = () => { window.localStorage.removeItem(`agentic-rag-session:${tenantSlug}`); setSessionId(null); setReplies([]); setMessage(''); setError(''); };

  return <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-10">
    <header className="mb-8"><p className="mb-2 text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">Agentic RAG AI</p><h1 className="text-4xl font-semibold tracking-tight">Answers with evidence, not guesses.</h1><p className="mt-3 max-w-2xl text-slate-300">Ask a tenant’s sales assistant. Only approved, audience-authorized source material can support a business claim.</p>{config?.persona && <p className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 text-sm text-cyan-100">{config.persona.name}: {config.persona.greeting} · {config.persona.tone}</p>}</header>
    <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-2xl">
      <div className="flex items-end gap-3"><label className="block min-w-0 flex-1 text-sm text-slate-300">Tenant slug<input value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400" disabled={Boolean(sessionId)} /></label>{sessionId && <button onClick={reset} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Reset</button>}</div>
      <div className="mt-6 space-y-4">{replies.map((reply, index) => <article key={index} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4"><p className="leading-7">{reply.answer}</p><p className={`mt-3 text-xs ${reply.grounded ? 'text-emerald-300' : 'text-amber-300'}`}>{reply.grounded ? 'Grounded in approved evidence' : 'No approved evidence — no claim made'}</p>{reply.citations.length > 0 && <ul className="mt-2 text-xs text-slate-400">{reply.citations.map((citation) => <li key={`${citation.title}-${citation.locator}`}>Source: {citation.title} · {citation.locator}</li>)}</ul>}{reply.actionState && <p className="mt-3 text-xs text-cyan-200">Workflow status: {reply.actionState}</p>}{reply.actionProposal && <button onClick={() => void confirm(reply.actionProposal!.id)} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">{reply.actionState === 'unknown' ? 'Retry workflow' : reply.actionProposal.confirmation}</button>}</article>)}</div>
      {error && <div className="mt-4 flex items-center gap-3 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><p role="alert" className="min-w-0 flex-1">{error}</p>{message.trim() && <button onClick={() => void send()} className="rounded-lg border border-rose-500 px-3 py-1">Retry</button>}</div>}
      <div className="mt-6 flex gap-3"><label className="sr-only" htmlFor="chat-message">Message</label><input id="chat-message" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy && message.trim()) void send(); }} placeholder="Ask about an approved product or service…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-cyan-400" /><button onClick={() => void send()} disabled={busy || !message.trim()} className="rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Ask'}</button></div>
    </section>
  </main>;
}
