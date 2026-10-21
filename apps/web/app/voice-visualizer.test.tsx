import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceVisualizer } from './voice-visualizer';

describe('VoiceVisualizer Component', () => {
  it('renders nothing when isOpen is false', () => {
    const html = renderToString(
      <VoiceVisualizer
        isOpen={false}
        state="idle"
        transcript=""
        countdown={null}
        agentName="Nova"
        onClose={() => {}}
      />
    );
    expect(html).toBe('');
  });

  it('renders listening state with animated wave rings and voice dots', () => {
    const html = renderToString(
      <VoiceVisualizer
        isOpen={true}
        state="listening"
        transcript="Hello there"
        countdown={null}
        agentName="Nova"
        onClose={() => {}}
      />
    );
    expect(html).toContain('Listening');
    expect(html).toContain('Hello there');
    expect(html).toContain('voice-wave-ring-1');
    expect(html).toContain('voice-wave-ring-2');
    expect(html).toContain('voice-wave-ring-3');
    expect(html).toContain('voice-circle-breathe');
    expect(html).toContain('voice-dot-active-1');
  });

  it('renders waiting_for_next state with 10-second inactivity countdown', () => {
    const html = renderToString(
      <VoiceVisualizer
        isOpen={true}
        state="waiting_for_next"
        transcript=""
        countdown={10}
        agentName="Nova"
        onClose={() => {}}
      />
    );
    expect(html).toContain('10');
    expect(html).toContain('remaining');
    expect(html).toContain('inactivity timer');
    expect(html).toContain('Waiting for your next question');
    expect(html).toContain('voice-dot-waiting-1');
  });

  it('renders speaking state with assistant caption and interrupt button', () => {
    const html = renderToString(
      <VoiceVisualizer
        isOpen={true}
        state="speaking"
        transcript=""
        assistantCaption="We provide verified enterprise tier services."
        countdown={null}
        agentName="Nova"
        onClose={() => {}}
        onInterrupt={() => {}}
      />
    );
    expect(html).toContain('Nova');
    expect(html).toContain('We provide verified enterprise tier services.');
    expect(html).toContain('Interrupt &amp; Ask Next');
  });

  it('renders processing state with spinner and transcribing label', () => {
    const html = renderToString(
      <VoiceVisualizer
        isOpen={true}
        state="processing"
        transcript=""
        countdown={null}
        agentName="Nova"
        onClose={() => {}}
      />
    );
    expect(html).toContain('Transcribing');
    expect(html).toContain('voice-dot-shimmer-1');
  });
});
