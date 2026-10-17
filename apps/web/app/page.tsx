'use client';

import { useEffect, useRef, useState } from 'react';
import {
  formatNaturalAbstention,
  isChatActionState,
  isValidTenantSlug,
  normalizeVoiceTranscript,
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
    voiceName: string;
    voiceLanguage: string;
    voiceRate: number;
    voicePitch: number;
    voiceVolume: number;
  } | null;
};

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type SpeechRecognitionResultLike = { [index: number]: { transcript: string } };
type SpeechRecognitionEventLike = Event & {
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
type SpeechRecognitionErrorLike = Event & { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
};

export default function Home() {
  const [tenantSlug, setTenantSlug] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isAdminTestingMode, setIsAdminTestingMode] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef('');
  const voiceTurnRef = useRef(false);

  useEffect(() => {
    const supported = Boolean(getSpeechRecognitionConstructor()) &&
      typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    setVoiceSupported(supported);

    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const updateVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  // Requirement 3: Resolve tenant context without customer manual slug input
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const resolved = resolveTenantSlug(window.location.search);
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
      setSessionId(null);
      setMessages([]);
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

  const tenantName = config?.tenant?.name ?? 'Tenant workspace';
  const agentName = config?.persona?.name ?? 'AI assistant';
  const agentGreeting = config?.persona?.greeting ?? 'Create a tenant and configure its assistant to begin.';
  const agentTone = config?.persona?.tone ?? 'Not configured';
  const agentStyle = config?.persona?.speakingStyle ?? 'Not configured';
  const permittedLanguages = config?.persona?.permittedLanguages ?? [];
  const preferredLanguage = permittedLanguages[0] || 'en-US';
  const agentInitials = agentName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'AG';

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const configuredVoiceName = config?.persona?.voiceName ?? '';
    const configuredVoiceLanguage = config?.persona?.voiceLanguage ?? preferredLanguage;
    const selectedVoice = availableVoices.find((voice) => voice.name === configuredVoiceName && voice.lang === configuredVoiceLanguage)
      ?? availableVoices.find((voice) => voice.name === configuredVoiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = configuredVoiceLanguage;
    }
    utterance.rate = config?.persona?.voiceRate ?? 1;
    utterance.pitch = config?.persona?.voicePitch ?? 1;
    utterance.volume = config?.persona?.voiceVolume ?? 1;
    utterance.onend = () => setVoiceSpeaking(false);
    utterance.onerror = () => setVoiceSpeaking(false);
    setVoiceSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const send = async (voiceText?: string) => {
    const trimmed = (voiceText ?? message).trim();
    if (!trimmed || busy) return;
    if (!isValidTenantSlug(tenantSlug) || !config) {
      setError('Open a tenant-specific chat URL after an organization is created.');
      return;
    }

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
      if (voiceTurnRef.current) {
        speak(naturalText);
        voiceTurnRef.current = false;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error.');
      voiceTurnRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = () => {
    if (!voiceSupported) {
      setError('Voice mode is not supported by this browser. You can continue by typing.');
      return;
    }
    if (voiceSpeaking) {
      window.speechSynthesis.cancel();
      setVoiceSpeaking(false);
      return;
    }
    if (voiceListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = config?.persona?.permittedLanguages?.[0] || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    voiceTranscriptRef.current = '';
    voiceTurnRef.current = true;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        parts.push(event.results[index][0].transcript);
      }
      const transcript = normalizeVoiceTranscript(parts);
      voiceTranscriptRef.current = transcript;
      setMessage(transcript);
    };
    recognition.onerror = (event) => {
      voiceTurnRef.current = false;
      setVoiceListening(false);
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError('Voice input could not start. You can continue by typing.');
      }
    };
    recognition.onend = () => {
      setVoiceListening(false);
      const transcript = voiceTranscriptRef.current.trim();
      if (transcript) {
        void send(transcript);
      } else {
        voiceTurnRef.current = false;
      }
    };
    recognitionRef.current = recognition;
    setError('');
    setVoiceListening(true);
    try {
      recognition.start();
    } catch {
      voiceTurnRef.current = false;
      setVoiceListening(false);
      setError('Voice input could not start. You can continue by typing.');
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
    <div className="min-h-screen bg-[#fafafa] text-[#121214] flex flex-col justify-between selection:bg-neutral-900 selection:text-white font-sans">
      
      <div>
        {/* Sticky Top Navigation Bar */}
        <header className="sticky top-0 z-40 w-full border-b border-neutral-200/80 bg-white/95 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[1536px] items-center justify-between px-4 sm:px-6 lg:px-8">
            
            {/* Left Brand Group */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white shadow-sm">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" fillOpacity="0.1" />
                    <path d="M12 7v10M7 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold tracking-[0.18em] text-neutral-900 uppercase">Agentic RAG AI</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-neutral-600">v2.4</span>
                  </div>
                  <span className="text-[11px] font-normal text-neutral-500">Tenant conversational assistant</span>
                </div>
              </div>

              {/* Navigation Pill */}
              <div className="hidden md:flex items-center gap-1.5 border-l border-neutral-200/80 pl-6">
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-900 bg-neutral-100 rounded-md">
                  <svg className="w-3.5 h-3.5 text-neutral-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Customer Conversation</span>
                </span>
              </div>
            </div>

            {/* Right Action Bar */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-neutral-200/80 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Active Model: Azure GPT-4.1-mini</span>
              </div>

              {/* Reset Session CTA */}
              <button
                type="button"
                onClick={reset}
                disabled={messages.length === 0 && !sessionId}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors button-press shadow-subtle"
                title="Reset conversation"
              >
                <svg className="w-3.5 h-3.5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5" />
                </svg>
                <span>New Session</span>
              </button>
            </div>
          </div>
        </header>

        {/* Controlled Max Width Content Canvas */}
        <main className="mx-auto max-w-[1536px] px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in">
          
          {/* 1. Editorial Header Section */}
          <section className="border-b border-neutral-200/80 pb-6" aria-labelledby="page-title">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-neutral-400">
                    Agentic RAG AI
                  </span>
                  <span className="text-neutral-300">/</span>
                  <span className="text-xs font-mono font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">
                    {tenantName}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200/90 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    {config ? 'Tenant configured' : 'No tenant selected'}
                  </span>
                </div>

                <h1 id="page-title" className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 font-sans">
                  Enterprise Customer Concierge
                </h1>

                <p className="text-xs sm:text-sm text-neutral-500 max-w-3xl leading-relaxed">
                  Ask {tenantName}’s sales assistant. Every business claim is grounded strictly in authorized, active source documentation. Governed by zero-speculation model policy and PII masking.
                </p>
              </div>

              {/* Status Indicators */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 shadow-subtle">
                  <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  </svg>
                  <span>Zero PII Cloud Transfer</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 shadow-subtle">
                  <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
                  </svg>
                  <span>PostgreSQL pgvector</span>
                </span>
              </div>
            </div>
          </section>

          {/* 2. Responsive Workspace Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left: Premium White Conversation Canvas (8 columns) */}
            <div className="lg:col-span-8 flex flex-col rounded-2xl border border-neutral-200/90 bg-white shadow-card overflow-hidden min-h-[660px]">
              
              {/* Inner Card Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 bg-neutral-50/50">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white font-bold text-xs">
                    {agentInitials}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"></span>
                  </div>
                  <div>
                    <h2 className="text-xs font-semibold text-neutral-900">{agentName}</h2>
                    <p className="text-[11px] text-neutral-500">{agentTone}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-mono font-medium text-emerald-700 border border-emerald-200/60">
                    ✓ 100% Grounded Mode
                  </span>
                </div>
              </div>

              {/* Scrollable Conversation Canvas */}
              <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                className="flex-1 overflow-y-auto p-6 space-y-6 min-h-[380px] max-h-[520px]"
              >
                {/* Elegant Welcome State */}
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-center py-12 px-4 animate-fade-in max-w-md mx-auto">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white shadow-subtle mb-4">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                      </svg>
                    </div>

                    <h3 className="text-xl font-bold tracking-tight text-neutral-900">
                      Hello, I’m {agentName}.
                    </h3>

                    <p className="mt-2 text-xs text-neutral-600 leading-relaxed">
                      {agentGreeting}
                    </p>

                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-neutral-200/80 bg-neutral-50 px-3 py-1 text-[11px] font-medium text-neutral-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Responses strictly verified against published enterprise documents.</span>
                    </div>
                  </div>
                )}

                {/* Messages Feed */}
                {messages.map((msg) => (
                  <div key={msg.id} className="message-entry space-y-2">
                    {msg.role === 'user' ? (
                      /* User message: subtle right-aligned bubble */
                      <div className="flex justify-end">
                        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-neutral-900 text-white px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-subtle whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      /* Assistant message: clean left-aligned text */
                      <div className="flex justify-start">
                        <div className="max-w-[92%] sm:max-w-[85%] space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-neutral-900">{agentName}</span>
                            <span className="text-[10px] text-neutral-400 font-mono">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Rendered Markdown */}
                          <div
                            className="text-xs sm:text-sm text-neutral-800 leading-relaxed font-normal"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />

                          {/* Accessible Citations Toggle */}
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => toggleCitations(msg.id)}
                                aria-expanded={msg.expandedCitations}
                                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                              >
                                <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
                                </svg>
                                <span>{msg.citations.length} Verified {msg.citations.length === 1 ? 'Source' : 'Sources'}</span>
                                <svg
                                  className={`w-2.5 h-2.5 text-neutral-400 transition-transform ${msg.expandedCitations ? 'rotate-180' : ''}`}
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
                                      <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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

                          {/* Action Proposal Card */}
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
                                  {msg.actionState === 'unknown' ? 'Retry Request' : 'Confirm & Submit'}
                                </button>
                                {msg.actionState && (
                                  <span className="text-[11px] font-mono text-neutral-500">
                                    Status: {msg.actionState}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Utilities: Copy & Feedback */}
                          <div className="flex items-center gap-3 pt-1 text-neutral-400 text-xs">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(msg.id, msg.content)}
                              className="flex items-center gap-1 rounded py-0.5 px-1 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                              title="Copy answer"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                              {copiedId === msg.id && <span className="text-[10px] text-neutral-600">Copied</span>}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleFeedback(msg.id, 'up')}
                              className={`flex items-center gap-1 rounded py-0.5 px-1 transition-colors ${msg.feedback === 'up' ? 'text-neutral-900 font-medium' : 'hover:bg-neutral-100 hover:text-neutral-800'}`}
                              title="Helpful"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M7 10v12M15 10.5a3 3 0 0 0-3-3l.5-4a1.5 1.5 0 0 0-3 0L7 10v12h10.3a2 2 0 0 0 1.95-1.57l1.65-7.43A2 2 0 0 0 18.95 10.5H15Z" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleFeedback(msg.id, 'down')}
                              className={`flex items-center gap-1 rounded py-0.5 px-1 transition-colors ${msg.feedback === 'down' ? 'text-neutral-900 font-medium' : 'hover:bg-neutral-100 hover:text-neutral-800'}`}
                              title="Unhelpful"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M17 14V2M9 13.5a3 3 0 0 0 3 3l-.5 4a1.5 1.5 0 0 0 3 0L17 14V2H6.7a2 2 0 0 0-1.95 1.57l-1.65 7.43A2 2 0 0 0 5.05 13.5H9Z" />
                              </svg>
                            </button>

                            {msg.feedback && (
                              <span className="text-[10px] text-neutral-400 animate-fade-in">
                                Thank you for your feedback
                              </span>
                            )}
                          </div>

                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Busy Indicator */}
                {busy && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-xs text-neutral-500">
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce" />
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.2s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.4s]" />
                      </span>
                      <span>Thinking…</span>
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

              {/* Bottom Multiline Composer */}
              <div className="border-t border-neutral-100 p-4 sm:p-5 bg-white">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
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
                      aria-label="Your inquiry"
                    />

                    <button
                      type="button"
                      onClick={toggleVoice}
                      disabled={busy}
                      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-all button-press disabled:cursor-not-allowed disabled:opacity-40 ${voiceListening ? 'border-rose-300 bg-rose-50 text-rose-700' : voiceSpeaking ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'}`}
                      aria-label={voiceListening ? 'Stop listening' : voiceSpeaking ? 'Stop speaking' : 'Start voice mode'}
                      title={voiceSupported ? 'Speak a message; audio is not stored by this chat' : 'Voice mode is not supported by this browser'}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
                      </svg>
                      <span className="hidden sm:inline">{voiceListening ? 'Listening…' : voiceSpeaking ? 'Speaking…' : voiceSupported ? 'Voice' : 'Voice unavailable'}</span>
                    </button>

                    <button
                      type="submit"
                      disabled={busy || !message.trim()}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-subtle transition-all hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed button-press"
                      aria-label="Send message"
                      title="Send message"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                  <p className="mt-1 px-1 text-[10px] text-neutral-400">
                    Voice mode sends only the browser transcript to the current assistant; this chat does not record or store audio.
                  </p>
                </form>
              </div>

            </div>

            {/* Right: Context, Knowledge Scope & Policies (4 columns) */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Card 1: Verified Knowledge Boundary */}
              <section className="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                    Knowledge Boundary
                  </h3>
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-mono font-medium text-neutral-600">
                    Strict Mode
                  </span>
                </div>

                <p className="text-xs text-neutral-500 leading-relaxed">
                  Only documents explicitly published for public chat are accessible to this concierge.
                </p>

                <div className="space-y-2 pt-1 border-t border-neutral-100 text-xs">
                  <div className="flex items-center justify-between text-neutral-700">
                    <span className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                      </svg>
                      <span>Published sources</span>
                    </span>
                    <span className="font-mono text-[10px] text-neutral-400">—</span>
                  </div>

                  <div className="flex items-center justify-between text-neutral-700">
                    <span className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                      </svg>
                      <span>Source citations appear in responses</span>
                    </span>
                    <span className="font-mono text-[10px] text-neutral-400">—</span>
                  </div>

                  <div className="flex items-center justify-between text-neutral-700">
                    <span className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                      </svg>
                      <span>Tenant-managed knowledge</span>
                    </span>
                    <span className="font-mono text-[10px] text-neutral-400">—</span>
                  </div>
                </div>
              </section>

              {/* Card 2: Persona Directives */}
              <section className="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card space-y-4">
                <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                  Agent Persona Rules
                </h3>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="block text-[11px] font-semibold text-neutral-700">Display Name</span>
                    <span className="text-neutral-900 font-medium">{agentName}</span>
                  </div>

                  <div>
                    <span className="block text-[11px] font-semibold text-neutral-700">Tone & Style</span>
                    <span className="text-neutral-500 leading-relaxed">{agentTone} · {agentStyle}</span>
                  </div>

                  <div>
                    <span className="block text-[11px] font-semibold text-neutral-700 mb-1.5">Permitted Languages</span>
                    <div className="flex flex-wrap gap-1">
                      {permittedLanguages.map((lang) => (
                        <span key={lang} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono font-medium text-neutral-700">
                          {lang.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 3: Privacy & Security Architecture */}
              <section className="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-neutral-900" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  </svg>
                  <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                    Trust & Privacy Baseline
                  </h3>
                </div>

                <p className="text-xs text-neutral-500 leading-relaxed">
                  All customer PII and reversible token mappings remain inside the secured Node backend and PostgreSQL boundary.
                </p>

                <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                  <span>Reversible Token Vault</span>
                  <span>TLS 1.3 Strict</span>
                </div>
              </section>

            </div>

          </div>

        </main>
      </div>

      {/* Editorial Footer */}
      <footer className="border-t border-neutral-200/80 bg-white py-6 mt-16 text-xs text-neutral-500">
        <div className="mx-auto max-w-[1536px] px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-900 text-white">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" fillOpacity="0.1" />
                <path d="M12 7v10M7 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-semibold text-neutral-800">Agentic RAG AI</span>
            <span className="text-neutral-300">·</span>
            <span>Source-Grounded Autonomous Operations Platform</span>
          </div>

          <div className="flex items-center gap-6 text-[11px] text-neutral-400 font-mono">
            <span>PostgreSQL pgvector</span>
            <span>Azure AI Foundry GPT-4.1-mini</span>
            <span>n8n Verified Actions</span>
            <span>Zero PII Cloud Transfer</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
