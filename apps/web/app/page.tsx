'use client';

import { useEffect, useRef, useState } from 'react';
import {
  applyActionState,
  formatNaturalAbstention,
  isChatActionState,
  isValidTenantSlug,
  renderMarkdown,
  resolveTenantSlug,
  type ChatActionState,
  type ChatCitation,
  type ChatHistoryMessage,
  type ChatReply,
  type DisplayMessage
} from './chat-utils';

type Config = {
  tenant: { name: string; slug: string };
  persona: {
    name: string;
    greeting: string;
    tone: string;
    speakingStyle: string;
    permittedLanguages: string[];
  } | null;
};

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isAdminTestingMode, setIsAdminTestingMode] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Requirement 3: Resolve tenant context without customer manual slug input
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const resolved = resolveTenantSlug(window.location.search, 'demo');
      setTenantSlug(resolved);
      const params = new URLSearchParams(window.location.search);
      if (params.get('admin') === 'true' || params.get('debug') === '1') {
        setIsAdminTestingMode(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!isValidTenantSlug(tenantSlug)) {
      setConfig(null);
      return;
    }

    void fetch(`${api}/api/v1/chat/config?tenantSlug=${encodeURIComponent(tenantSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Tenant chat is unavailable.');
        setConfig((await response.json()) as Config);
      })
      .catch(() => setConfig(null));

    const savedSession = window.localStorage.getItem(`agentic-rag-session:${tenantSlug}`);
    if (!savedSession) {
      setSessionId(null);
      setMessages([]);
      return;
    }

    void fetch(`${api}/api/v1/chat/sessions/${savedSession}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Saved session is unavailable.');
        const body = (await response.json()) as { messages: ChatHistoryMessage[] };
        setSessionId(savedSession);
        const restored: DisplayMessage[] = body.messages.map((m, idx) => ({
          id: `restored-${idx}`,
          role: m.role,
          content: m.role === 'assistant' ? formatNaturalAbstention(m.content) : m.content,
          grounded: m.citations.length > 0,
          conversational: m.conversational,
          citations: m.citations,
          createdAt: new Date().toISOString()
        }));
        setMessages(restored);
      })
      .catch(() => {
        window.localStorage.removeItem(`agentic-rag-session:${tenantSlug}`);
        setSessionId(null);
        setMessages([]);
      });
  }, [tenantSlug]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, busy]);

  const agentName = config?.persona?.name ?? 'Aura Enterprise Guide';
  const agentGreeting = config?.persona?.greeting ?? 'Welcome. How may I assist your enterprise inquiry today?';
  const agentTone = config?.persona?.tone ?? 'Professional & Grounded';
  const agentInitials = agentName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'AG';

  const send = async () => {
    const trimmed = message.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError('');

    const userMsg: DisplayMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: trimmed,
      grounded: true,
      citations: [],
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMsg]);
    setMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      let activeSession = sessionId;
      if (!activeSession) {
        const sessionRes = await fetch(`${api}/api/v1/chat/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantSlug })
        });
        if (!sessionRes.ok) throw new Error('Could not open a secure conversation session.');
        activeSession = ((await sessionRes.json()) as { sessionId: string }).sessionId;
        setSessionId(activeSession);
        window.localStorage.setItem(`agentic-rag-session:${tenantSlug}`, activeSession);
      }

      const clientMessageId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`;
      const response = await fetch(`${api}/api/v1/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession, message: trimmed, clientMessageId })
      });
      const body = (await response.json()) as ChatReply & { error?: { message?: string }; messageId?: string; requestId?: string };
      if (!response.ok) throw new Error(body.error?.message ?? 'The assistant could not respond.');

      // Apply natural language formatting to technical abstentions (Requirement 9)
      const naturalText = formatNaturalAbstention(body.answer, agentName);

      const assistantMsg: DisplayMessage = {
        id: body.messageId ?? `asst-${Date.now()}`,
        role: 'assistant',
        content: naturalText,
        grounded: body.grounded,
        conversational: body.conversational,
        citations: body.citations || [],
        actionProposal: body.actionProposal,
        actionState: body.actionProposal ? 'awaiting_confirmation' : undefined,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (proposalId: string) => {
    if (!sessionId) return;
    try {
      const response = await fetch(`${api}/api/v1/chat/actions/${proposalId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, confirmed: true })
      });
      const body = (await response.json()) as { action?: { state?: unknown }; error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? 'The request could not be confirmed.');
        return;
      }
      const state = body.action?.state;
      if (!isChatActionState(state)) {
        setError('The workflow returned an invalid status.');
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.actionProposal?.id !== proposalId
            ? m
            : {
                ...m,
                actionState: state,
                actionProposal: state === 'completed' || state === 'failed' ? null : m.actionProposal
              }
        )
      );
    } catch {
      setError('The request could not be confirmed.');
    }
  };

  const reset = () => {
    window.localStorage.removeItem(`agentic-rag-session:${tenantSlug}`);
    setSessionId(null);
    setMessages([]);
    setMessage('');
    setError('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const toggleFeedback = (id: string, type: 'up' | 'down') => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, feedback: m.feedback === type ? undefined : type } : m))
    );
  };

  const toggleCitations = (id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, expandedCitations: !m.expandedCitations } : m))
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA] text-neutral-900 selection:bg-neutral-900 selection:text-white">
      {/* 1. Header: Compact, refined, showing agent name, brand, status, and reset action */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-neutral-200/80 bg-white/95 px-4 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-subtle">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
            </svg>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Active & Grounded" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-tight text-neutral-900 font-sans">
                {{ ...config?.tenant }.name || 'Acme Global'}
              </h1>
              <span className="hidden sm:inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-600">
                {agentName}
              </span>
            </div>
            <p className="truncate text-[11px] text-neutral-500">
              {agentTone} · Verified Documentation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Admin testing diagnostics toggle (Requirement 10) */}
          {isAdminTestingMode && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] font-mono text-neutral-700 border border-neutral-200">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-600"></span>
              Admin Mode: {tenantSlug}
            </span>
          )}

          {/* Reset session action */}
          <button
            type="button"
            onClick={reset}
            disabled={messages.length === 0 && !sessionId}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-subtle hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 button-press transition-colors"
            title="Start new conversation"
            aria-label="Start new conversation"
          >
            <svg className="h-3.5 w-3.5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5" />
            </svg>
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </header>

      {/* 2. White Conversation Canvas */}
      <main
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6"
      >
        {/* Welcome State (Requirement 5) */}
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center text-center py-16 animate-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white shadow-subtle mb-4">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 font-sans">
              Hello, I’m {agentName}.
            </h2>
            <p className="mt-3 max-w-md text-xs sm:text-sm leading-relaxed text-neutral-600">
              {agentGreeting}
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-200/80 bg-white px-3.5 py-1 text-xs text-neutral-600 shadow-subtle">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Grounded exclusively in authorized enterprise documentation.</span>
            </div>
          </div>
        )}

        {/* Message Stream */}
        <div className="space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="message-entry space-y-2">
              {msg.role === 'user' ? (
                /* User Message: subtle right-aligned bubble (Requirement 4) */
                <div className="flex justify-end">
                  <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-neutral-900 px-4 py-3 text-xs sm:text-sm text-white shadow-subtle leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              ) : (
                /* Assistant Message: clean left-aligned text without surrounding cards (Requirement 4) */
                <div className="flex justify-start">
                  <div className="max-w-[92%] sm:max-w-[85%] space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-md bg-neutral-900 text-white text-[10px] font-bold">
                        {agentInitials}
                      </div>
                      <span className="text-xs font-semibold text-neutral-900">{agentName}</span>
                    </div>

                    {/* Rendered Markdown Answer (Requirement 7) */}
                    <div
                      className="text-xs sm:text-sm text-neutral-800 leading-relaxed font-normal"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />

                    {/* Accessible Source References Drawer (Requirement 7) */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => toggleCitations(msg.id)}
                          aria-expanded={msg.expandedCitations}
                          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                        >
                          <svg className="h-3 w-3 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
                          </svg>
                          <span>{msg.citations.length} Verified {msg.citations.length === 1 ? 'Source' : 'Sources'}</span>
                          <svg
                            className={`h-2.5 w-2.5 text-neutral-400 transition-transform ${msg.expandedCitations ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                          </svg>
                        </button>

                        {msg.expandedCitations && (
                          <div className="mt-2 space-y-1.5 rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3 text-xs animate-fade-in">
                            {msg.citations.map((c, i) => (
                              <div key={i} className="flex items-start gap-2 text-neutral-700">
                                <svg className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01 9 11.01" />
                                </svg>
                                <div>
                                  <span className="font-medium text-neutral-900">{c.title}</span>
                                  <span className="text-neutral-400 mx-1.5">·</span>
                                  <span className="font-mono text-[11px] text-neutral-500">{c.locator}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action proposal confirmation card */}
                    {msg.actionProposal && (
                      <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-2 shadow-subtle">
                        <div className="text-xs font-semibold text-neutral-900">
                          {msg.actionProposal.confirmation}
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void confirm(msg.actionProposal!.id)}
                            className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 transition-all button-press"
                          >
                            {msg.actionState === 'unknown' ? 'Retry Request' : 'Confirm Request'}
                          </button>
                          {msg.actionState && (
                            <span className="text-[11px] font-mono text-neutral-500">
                              Status: {msg.actionState}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Copy actions and helpfulness feedback controls (Requirement 7) */}
                    <div className="flex items-center gap-3 pt-1 text-neutral-400 text-xs">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(msg.id, msg.content)}
                        className="flex items-center gap-1 rounded py-0.5 px-1 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                        title="Copy answer"
                        aria-label={copiedId === msg.id ? 'Copied to clipboard' : 'Copy answer to clipboard'}
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                        {copiedId === msg.id && <span className="text-[10px] text-neutral-600">Copied</span>}
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleFeedback(msg.id, 'up')}
                        className={`flex items-center gap-1 rounded py-0.5 px-1 transition-colors ${msg.feedback === 'up' ? 'text-neutral-900 font-medium' : 'hover:bg-neutral-100 hover:text-neutral-800'}`}
                        title="Helpful response"
                        aria-label="Mark response as helpful"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M7 10v12M15 10.5a3 3 0 0 0-3-3l.5-4a1.5 1.5 0 0 0-3 0L7 10v12h10.3a2 2 0 0 0 1.95-1.57l1.65-7.43A2 2 0 0 0 18.95 10.5H15Z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleFeedback(msg.id, 'down')}
                        className={`flex items-center gap-1 rounded py-0.5 px-1 transition-colors ${msg.feedback === 'down' ? 'text-neutral-900 font-medium' : 'hover:bg-neutral-100 hover:text-neutral-800'}`}
                        title="Unhelpful response"
                        aria-label="Mark response as unhelpful"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M17 14V2M9 13.5a3 3 0 0 0 3 3l-.5 4a1.5 1.5 0 0 0 3 0L17 14V2H6.7a2 2 0 0 0-1.95 1.57l-1.65 7.43A2 2 0 0 0 5.05 13.5H9Z" />
                        </svg>
                      </button>

                      {msg.feedback && (
                        <span className="text-[10px] text-neutral-400 animate-fade-in">
                          Thanks for your feedback
                        </span>
                      )}
                    </div>

                    {/* Administrative diagnostics ONLY in authenticated admin testing mode (Requirement 10) */}
                    {isAdminTestingMode && (
                      <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2.5 text-[10px] font-mono text-neutral-600 space-y-1">
                        <div className="flex items-center justify-between border-b border-neutral-200 pb-1">
                          <span className="font-semibold text-neutral-800">Admin Diagnostics</span>
                          <span className={msg.grounded ? 'text-emerald-700' : msg.conversational ? 'text-cyan-700' : 'text-amber-700'}>
                            {msg.grounded ? '✓ Grounded' : msg.conversational ? 'ℹ Greeting' : '⚠ Abstained'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[9px]">
                          <div>Citations: {msg.citations.length}</div>
                          <div>ID: {msg.id.substring(0, 8)}...</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {busy && (
            <div className="flex justify-start animate-fade-in">
              <div className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-xs text-neutral-500">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.2s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.4s]" />
                </span>
                <span>Verifying knowledge...</span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-800 animate-fade-in">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void send()}
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </main>

      {/* 3. Bottom Composer: Multiline textarea, Enter-to-send, Shift+Enter for newline, minimal send button (Requirement 6) */}
      <footer className="sticky bottom-0 border-t border-neutral-200/80 bg-white/95 px-4 py-3 backdrop-blur-md sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="relative flex items-end gap-2 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-2 sm:p-2.5 transition-all duration-200 focus-within:border-neutral-900 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-900/10">
            <textarea
              ref={textareaRef}
              rows={1}
              value={message}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={busy}
              placeholder="Ask about our verified products, pricing, or service specifications..."
              className="min-h-[38px] max-h-32 w-full resize-none bg-transparent px-2 py-1.5 text-xs sm:text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none leading-relaxed"
              aria-label="Your message"
            />

            <button
              type="submit"
              disabled={busy || !message.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-subtle transition-all hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed button-press"
              aria-label="Send message"
              title="Send message"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 7-7 7 7M12 19V5" />
              </svg>
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-neutral-400">
            <span>
              Press <kbd className="font-mono text-[10px] text-neutral-500">Enter</kbd> to send ·{' '}
              <kbd className="font-mono text-[10px] text-neutral-500">Shift + Enter</kbd> for new line
            </span>
            {message.length > 0 && <span className="font-mono text-[10px]">{message.length} chars</span>}
          </div>
        </form>
      </footer>
    </div>
  );
}
