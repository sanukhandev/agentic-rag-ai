import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createChannelSignature } from './channel-auth.js';

describe('omnichannel HMAC gateway', () => {
  it('supports a tenant-scoped static API key for controlled connector use', async () => {
    const runtime = createApp({ nodeEnv: 'test', jwtSecret: 'channel-test-jwt', channelCredentialKey: 'channel-test-credential-key', staticChannelApiKey: 'a'.repeat(32), staticChannelTenantSlug: 'channel-tenant', staticChannelName: 'vm-connector' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-static@channel.test', password: 'Platform1Password' }).expect(201);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Channel Tenant', slug: 'channel-tenant', adminEmail: 'admin-static@channel.test', adminPassword: 'Tenant1Password' }).expect(201);
    const session = await api.post('/api/v1/chat/sessions').set('X-Agentic-Api-Key', 'a'.repeat(32)).send({}).expect(201);
    expect(session.body.tenantId).toEqual(expect.any(String));
    expect((await api.get('/api/v1/chat/config').set('X-Agentic-Api-Key', 'a'.repeat(32)).expect(200)).body.tenant.slug).toBe('channel-tenant');
    await api.get('/api/v1/chat/config?tenantSlug=channel-tenant').set('X-Agentic-Api-Key', 'a'.repeat(32)).expect(400);
    await api.post('/api/v1/chat/sessions').set('X-Agentic-Api-Key', 'wrong-key').send({}).expect(401);
    await api.post('/api/v1/chat/sessions').set('X-Agentic-Api-Key', 'a'.repeat(32)).send({ tenantSlug: 'other-tenant' }).expect(400);
  });

  it('resolves tenant scope from a credential and rejects nonce replay', async () => {
    const runtime = createApp({ nodeEnv: 'test', jwtSecret: 'channel-test-jwt', channelCredentialKey: 'channel-test-credential-key' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform@channel.test', password: 'Platform1Password' }).expect(201);
    const tenant = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Channel Tenant', slug: 'channel-tenant', adminEmail: 'admin@channel.test', adminPassword: 'Tenant1Password' }).expect(201);
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin@channel.test', password: 'Tenant1Password' }).expect(200);
    const staticCredential = await api.post('/api/v1/admin/channels').set('Authorization', `Bearer ${admin.body.token}`).send({ channel: 'static-app', authMode: 'api_key' }).expect(201);
    expect(staticCredential.body.credential.authMode).toBe('api_key');
    expect(staticCredential.body.secret).toMatch(/^zv3_channel-tenant-[A-Za-z0-9_-]{36}$/);
    expect((await api.get('/api/v1/chat/config').set('X-Agentic-Api-Key', staticCredential.body.secret).expect(200)).body.tenant.slug).toBe('channel-tenant');
    await api.post('/api/v1/chat/sessions').set('X-Agentic-Api-Key', staticCredential.body.secret).send({}).expect(201);
    await api.post(`/api/v1/admin/channels/${staticCredential.body.credential.id}/revoke`).set('Authorization', `Bearer ${admin.body.token}`).expect(200);
    await api.post('/api/v1/chat/sessions').set('X-Agentic-Api-Key', staticCredential.body.secret).send({}).expect(401);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Channel Tenant B', slug: 'channel-tenant-b', adminEmail: 'admin-b@channel.test', adminPassword: 'Tenant1Password' }).expect(201);
    const adminB = await api.post('/api/v1/auth/login').send({ email: 'admin-b@channel.test', password: 'Tenant1Password' }).expect(200);
    const staticCredentialB = await api.post('/api/v1/admin/channels').set('Authorization', `Bearer ${adminB.body.token}`).send({ channel: 'static-app', authMode: 'api_key' }).expect(201);
    expect((await api.get('/api/v1/chat/config').set('X-Agentic-Api-Key', staticCredentialB.body.secret).expect(200)).body.tenant.slug).toBe('channel-tenant-b');
    const created = await api.post('/api/v1/admin/channels').set('Authorization', `Bearer ${admin.body.token}`).send({ channel: 'mobile-app' }).expect(201);
    expect(created.body.secret).toEqual(expect.any(String));
    expect((await api.get('/api/v1/admin/channels').set('Authorization', `Bearer ${admin.body.token}`).expect(200)).body.items[0]).not.toHaveProperty('secret');

    const body = {};
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'nonce-channel-001';
    const headers = {
      'X-Agentic-Key-Id': created.body.credential.keyId,
      'X-Agentic-Timestamp': timestamp,
      'X-Agentic-Nonce': nonce,
      'X-Agentic-Signature': createChannelSignature(created.body.secret, 'POST', '/api/v1/chat/sessions', timestamp, nonce, body)
    };
    const session = await api.post('/api/v1/chat/sessions').set(headers).send(body).expect(201);
    expect(session.body.tenantId).toBe(tenant.body.tenant.id);
    const messageBody = { sessionId: session.body.sessionId, message: 'Hello', clientMessageId: 'channel-message-001' };
    const messageTimestamp = Math.floor(Date.now() / 1000).toString();
    const messageNonce = 'nonce-channel-msg-001';
    await api.post('/api/v1/chat/messages').set({
      'X-Agentic-Key-Id': created.body.credential.keyId,
      'X-Agentic-Timestamp': messageTimestamp,
      'X-Agentic-Nonce': messageNonce,
      'X-Agentic-Signature': createChannelSignature(created.body.secret, 'POST', '/api/v1/chat/messages', messageTimestamp, messageNonce, messageBody)
    }).send(messageBody).expect(200);
    await api.post('/api/v1/chat/sessions').set(headers).send(body).expect(401).expect((response) => expect(response.body.error.code).toBe('CHANNEL_REPLAYED'));

    await api.post(`/api/v1/admin/channels/${created.body.credential.id}/revoke`).set('Authorization', `Bearer ${admin.body.token}`).expect(200);
    const replacement = await api.post('/api/v1/admin/channels').set('Authorization', `Bearer ${admin.body.token}`).send({ channel: 'mobile-app' }).expect(201);
    expect(replacement.body.credential.keyId).not.toBe(created.body.credential.keyId);
    const revokedTimestamp = Math.floor(Date.now() / 1000).toString();
    const revokedNonce = 'nonce-channel-002';
    await api.post('/api/v1/chat/sessions').set({
      ...headers,
      'X-Agentic-Timestamp': revokedTimestamp,
      'X-Agentic-Nonce': revokedNonce,
      'X-Agentic-Signature': createChannelSignature(created.body.secret, 'POST', '/api/v1/chat/sessions', revokedTimestamp, revokedNonce, body)
    }).send(body).expect(401).expect((response) => expect(response.body.error.code).toBe('CHANNEL_UNAUTHORIZED'));
  });
});
