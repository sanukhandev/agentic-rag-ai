'use client';

import React, { useEffect } from 'react';
import {
  type VoiceState,
  getVoiceStateMeta
} from './chat-utils';

export interface VoiceVisualizerProps {
  isOpen: boolean;
  state: VoiceState;
  transcript: string;
  assistantCaption?: string;
  countdown: number | null;
  agentName: string;
  agentInitials?: string;
  onClose: () => void;
  onSendNow?: () => void;
  onInterrupt?: () => void;
}

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({
  isOpen,
  state,
  transcript,
  assistantCaption,
  countdown,
  agentName,
  agentInitials,
  onClose,
  onSendNow,
  onInterrupt
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const meta = getVoiceStateMeta(state, countdown, agentName);
  const isListening = state === 'listening';
  const isSpeaking = state === 'speaking';
  const isProcessing = state === 'processing';
  const isWaiting = state === 'waiting_for_next';

  const initials = agentInitials || agentName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'AG';

  // State-specific colors for concentric waves
  const waveBorderClass = isListening || isSpeaking
    ? 'border-emerald-500/35 bg-emerald-500/[0.03]'
    : isWaiting
    ? 'border-amber-400/40 bg-amber-400/[0.04]'
    : 'border-neutral-400/30 bg-neutral-900/[0.02]';

  // State-specific colors for central voice dots
  const dotColorClass = isListening || isSpeaking
    ? 'text-emerald-400'
    : isWaiting
    ? 'text-amber-300'
    : 'text-neutral-300';

  // Dot animation class by state
  const getDotClass = (index: number): string => {
    if (isListening || isSpeaking) return `voice-dot voice-dot-active-${index + 1}`;
    if (isProcessing) return `voice-dot voice-dot-shimmer-${index + 1}`;
    if (isWaiting) return `voice-dot voice-dot-waiting-${index + 1}`;
    return 'voice-dot';
  };

  return (
    <div
      className="flex flex-col justify-between flex-1 p-6 sm:p-8 min-h-[660px] bg-gradient-to-b from-white via-neutral-50/50 to-white transition-all duration-300 animate-fade-in select-none"
      role="region"
      aria-label="Voice conversation assistant"
    >
      {/* Top Header: Agent Branding, Status Badge, Inactivity Countdown & Exit */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-white font-bold text-xs shadow-sm">
            {initials}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                isListening || isSpeaking
                  ? 'bg-emerald-500 animate-pulse'
                  : isWaiting
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-neutral-400'
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-neutral-900">{agentName}</h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${meta.badgeClass}`}
              >
                <span>{meta.badgeText}</span>
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-mono">Hands-free voice mode</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 10s Inactivity Countdown Badge */}
          {countdown !== null && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/90 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-800 transition-all shadow-subtle"
              title="Voice mode will close if no speech is detected before timer runs out"
            >
              <svg className="h-3 w-3 text-amber-600 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{countdown}s inactivity timer</span>
            </span>
          )}

          {/* Return to Chat Button */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 transition-colors button-press shadow-subtle"
            aria-label="Return to chat"
            title="Return to text chat (Esc)"
          >
            <span>Return to Chat</span>
            <kbd className="hidden sm:inline-block rounded bg-neutral-100 px-1 py-0.2 font-mono text-[10px] text-neutral-500">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Central Stage: Animated Circle with Concentric Waves and Voice Waveform Dots */}
      <div className="flex flex-col items-center justify-center my-auto py-8">
        <div className="relative flex h-48 w-48 sm:h-56 sm:w-56 items-center justify-center">
          
          {/* Concentric Expanding Wave 3 (Outermost Ambient Ripple) */}
          <div
            className={`absolute h-full w-full rounded-full border pointer-events-none voice-wave-ring-3 ${waveBorderClass}`}
            aria-hidden="true"
          />

          {/* Concentric Expanding Wave 2 (Middle Acoustic Wave) */}
          <div
            className={`absolute h-[80%] w-[80%] rounded-full border pointer-events-none voice-wave-ring-2 ${waveBorderClass}`}
            aria-hidden="true"
          />

          {/* Concentric Expanding Wave 1 (Inner Resonant Wave) */}
          <div
            className={`absolute h-[62%] w-[62%] rounded-full border pointer-events-none voice-wave-ring-1 ${waveBorderClass}`}
            aria-hidden="true"
          />

          {/* Satellite Acoustic Dots on Wave Perimeter */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-2" aria-hidden="true">
            <span className={`h-1.5 w-1.5 rounded-full ${dotColorClass} opacity-60`} />
            <span className={`h-1.5 w-1.5 rounded-full ${dotColorClass} opacity-60`} />
          </div>
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-2" aria-hidden="true">
            <span className={`h-1.5 w-1.5 rounded-full ${dotColorClass} opacity-60`} />
            <span className={`h-1.5 w-1.5 rounded-full ${dotColorClass} opacity-60`} />
          </div>

          {/* Central High-Contrast Circle */}
          <div
            className="relative z-10 flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center rounded-full bg-neutral-950 text-white shadow-2xl voice-circle-breathe select-none"
            aria-hidden="true"
          >
            {/* Dots to Animate the Voice (Realistic Audio Frequency Waveform) */}
            <div className={`flex items-center gap-1.5 sm:gap-2 h-8 ${dotColorClass}`}>
              {[0, 1, 2, 3, 4].map((idx) => (
                <span
                  key={idx}
                  className={getDotClass(idx)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Live Spoken Speech Caption & Guidance Area */}
        <div className="mt-8 text-center max-w-xl px-4 w-full">
          <div
            className="min-h-[64px] flex items-center justify-center text-sm sm:text-base font-medium text-neutral-800 leading-relaxed"
            aria-live="polite"
          >
            {isListening && transcript ? (
              <p className="italic text-neutral-900 bg-neutral-100/80 px-4 py-2.5 rounded-2xl border border-neutral-200/80 shadow-subtle max-h-32 overflow-y-auto">
                “{transcript}”
              </p>
            ) : isListening ? (
              <div className="space-y-1">
                <p className="text-neutral-700 font-medium">
                  Listening to your voice...
                </p>
                <p className="text-xs text-neutral-400 font-mono">
                  Speak clearly into your microphone
                </p>
              </div>
            ) : isProcessing ? (
              <p className="text-neutral-600 flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin text-neutral-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Transcribing & querying approved knowledge...</span>
              </p>
            ) : isSpeaking && assistantCaption ? (
              <div className="text-neutral-800 bg-emerald-50/80 px-4 py-3 rounded-2xl border border-emerald-200/70 shadow-subtle max-h-36 overflow-y-auto text-left">
                <span className="font-semibold text-emerald-900 block mb-1 text-xs uppercase tracking-wider">{agentName}:</span>
                <p className="text-xs sm:text-sm text-neutral-800">“{assistantCaption}”</p>
              </div>
            ) : isWaiting ? (
              <div className="space-y-1.5">
                <p className="text-neutral-800 font-semibold text-base">
                  Waiting for your next question...
                </p>
                <p className="text-xs text-neutral-500 font-mono">
                  {countdown !== null
                    ? `Auto-closing in ${countdown}s if no response · Speak anytime to continue`
                    : 'Listening continuously · Speak your next question'}
                </p>
              </div>
            ) : (
              <p className="text-neutral-400">Voice mode active</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="flex flex-wrap items-center justify-center gap-3 border-t border-neutral-100 pt-4">
        {/* Send Now Button (when user has spoken and wants to trigger immediately) */}
        {isListening && transcript.trim().length > 0 && onSendNow && (
          <button
            type="button"
            onClick={onSendNow}
            className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-subtle hover:bg-neutral-800 transition-colors button-press"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 7-7 7 7M12 19V5" />
            </svg>
            <span>Send Question Now</span>
          </button>
        )}

        {/* Skip / Interrupt Speech */}
        {isSpeaking && onInterrupt && (
          <button
            type="button"
            onClick={onInterrupt}
            className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors button-press shadow-subtle"
          >
            <svg className="h-3 w-3 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            <span>Interrupt &amp; Ask Next</span>
          </button>
        )}

        {/* End Voice Button */}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors button-press shadow-subtle"
        >
          <span>Return to Text Chat</span>
        </button>
      </div>
    </div>
  );
};
