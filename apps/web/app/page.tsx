'use client';

import { useState } from 'react';

type Citation = { title: string; locator: string };
type Reply = { answer: string; grounded: boolean; citations: Citation[]; actionProposal?: { id: string; confirmation: string } | null };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [replies, setReplies] = useState<Reply[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true); setError('');
    try {
      let activeSession = sessionId;
      if (!activeSession) {
        const session = await fetch(`${api}/api/v1/chat/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantSlug }) });
        if (!session.ok) throw new Error('Could not open a tenant session.');
        activeSession = (await session.json()).sessionId as string;
        setSessionId(activeSession);
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
    const response = await fetch(`${api}/api/v1/chat/actions/${proposalId}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, confirmed: true }) });
    if (!response.ok) setError('The request could not be confirmed.');
  };

  return <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-10">
    <header className="mb-8"><p className="mb-2 text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">Agentic RAG AI</p><h1 className="text-4xl font-semibold tracking-tight">Answers with evidence, not guesses.</h1><p className="mt-3 max-w-2xl text-slate-300">Ask a tenant’s sales assistant. Only approved, audience-authorized source material can support a business claim.</p></header>
    <section className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-2xl">
      <label className="block text-sm text-slate-300">Tenant slug<input value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400" disabled={Boolean(sessionId)} /></label>
      <div className="mt-6 space-y-4">{replies.map((reply, index) => <article key={index} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4"><p className="leading-7">{reply.answer}</p><p className={`mt-3 text-xs ${reply.grounded ? 'text-emerald-300' : 'text-amber-300'}`}>{reply.grounded ? 'Grounded in approved evidence' : 'No approved evidence — no claim made'}</p>{reply.citations.length > 0 && <ul className="mt-2 text-xs text-slate-400">{reply.citations.map((citation) => <li key={`${citation.title}-${citation.locator}`}>Source: {citation.title} · {citation.locator}</li>)}</ul>}{reply.actionProposal && <button onClick={() => void confirm(reply.actionProposal!.id)} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">{reply.actionProposal.confirmation}</button>}</article>)}</div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
      <div className="mt-6 flex gap-3"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy && message.trim()) void send(); }} placeholder="Ask about an approved product or service…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-cyan-400" /><button onClick={() => void send()} disabled={busy || !message.trim()} className="rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Ask'}</button></div>
    </section>
  </main>;
}
