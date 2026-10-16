import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getTenantChatUrl, openTenantChatWindow } from './tenant-chat-url';

describe('tenant chat url helpers', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '4200',
        origin: 'http://localhost:4200'
      },
      open: vi.fn()
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('builds tenant-specific chat URLs with clean slug query parameter', () => {
    const url = getTenantChatUrl('alpha-tenant', 'https://chat.acme.com');
    expect(url).toBe('https://chat.acme.com/?tenant=alpha-tenant');
  });

  it('strips trailing slashes from publicOrigin before appending query', () => {
    const url = getTenantChatUrl('beta-corp', 'https://chat.acme.com/');
    expect(url).toBe('https://chat.acme.com/?tenant=beta-corp');
  });

  it('defaults to localhost:3000 in dev when publicOrigin is missing', () => {
    const url = getTenantChatUrl('dev-tenant');
    expect(url).toBe('http://localhost:3000/?tenant=dev-tenant');
  });

  it('opens a new browser window when openTenantChatWindow is invoked', () => {
    const openSpy = vi.spyOn((globalThis as any).window, 'open');
    const targetUrl = openTenantChatWindow('new-org', 'https://chat.enterprise.com');

    expect(openSpy).toHaveBeenCalledWith('https://chat.enterprise.com/?tenant=new-org', '_blank', 'noopener,noreferrer');
    expect(targetUrl).toBe('https://chat.enterprise.com/?tenant=new-org');
  });
});
