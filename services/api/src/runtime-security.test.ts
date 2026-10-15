import { describe, expect, it } from 'vitest';
import { assertExternalEndpoint } from './runtime-security.js';

describe('external endpoint security', () => {
  it('allows local HTTP but requires HTTPS and no URL credentials in production', () => {
    expect(() => assertExternalEndpoint('http://n8n:5678', 'n8n', 'development')).not.toThrow();
    expect(() => assertExternalEndpoint('http://n8n:5678', 'n8n', 'production')).toThrow('HTTPS');
    expect(() => assertExternalEndpoint('https://user:pass@example.test', 'Azure AI', 'development')).toThrow('credentials');
    expect(() => assertExternalEndpoint('ftp://example.test', 'Azure AI', 'development')).toThrow('HTTP(S)');
  });
});
