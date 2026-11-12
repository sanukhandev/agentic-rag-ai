import { createHash } from 'node:crypto';
import type { TrustedActor } from '../contracts.js';

/** Narrow structural adapter to the existing Store; no new auth/session database. */
export interface SessionTokenStore {
  verifySessionAccessToken(sessionId: string, tokenHash: string): Promise<boolean>;
}

export interface AuthorizedSession {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly closedAt: string | null;
  readonly tenantStatus: string;
}

export interface SessionAuthorizer {
  assertAuthorized(actor: TrustedActor, session: AuthorizedSession): Promise<void>;
}

export class SessionPermissionError extends Error {
  constructor() {
    super('Unauthorized or unavailable conversation session');
    this.name = 'SessionPermissionError';
  }
}

/**
 * Call ONLY inside the server-side authenticated chat route. Never accept
 * principalId from a browser request body. The raw bearer is never stored in
 * the actor, model envelope, audit event or DB log.
 */
export function customerActorFromSessionToken(input: {
  tenantId: string;
  sessionId: string;
  sessionAccessToken: string;
}): TrustedActor {
  if (!input.sessionAccessToken || input.sessionAccessToken.length > 8192) {
    throw new SessionPermissionError();
  }
  return {
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    role: 'customer',
    principalId: createHash('sha256').update(input.sessionAccessToken, 'utf8').digest('hex'),
  };
}

/** Fail-closed P2 support for public customer sessions only. */
export class ExistingSessionTokenAuthorizer implements SessionAuthorizer {
  constructor(private readonly store: SessionTokenStore) {}

  async assertAuthorized(actor: TrustedActor, session: AuthorizedSession): Promise<void> {
    if ((actor.role !== 'customer' && actor.role !== 'anonymous')
      || actor.tenantId !== session.tenantId
      || actor.sessionId !== session.sessionId
      || session.closedAt !== null
      || session.tenantStatus !== 'active'
      || !/^[a-f0-9]{64}$/u.test(actor.principalId)) {
      throw new SessionPermissionError();
    }
    if (!(await this.store.verifySessionAccessToken(actor.sessionId, actor.principalId))) {
      throw new SessionPermissionError();
    }
  }
}
