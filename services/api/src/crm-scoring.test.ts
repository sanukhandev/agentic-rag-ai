import { describe, expect, it } from 'vitest';
import { isValidLeadEmail, isValidLeadName, isValidLeadPhone, scoreCrmLead } from './crm-scoring.js';

describe('deterministic CRM qualification', () => {
  it('uses the five fixed score categories and caps at 100', () => {
    expect(scoreCrmLead({ commercialIntent: true, timelineMentioned: true, businessFit: true, validName: true, validContact: true, engagedUserTurns: 9 })).toEqual({ commercialIntent: 25, timeline: 20, businessFit: 20, contactQuality: 20, engagement: 15, total: 100 });
    expect(scoreCrmLead({ commercialIntent: false, timelineMentioned: false, businessFit: false, validName: false, validContact: false, engagedUserTurns: 0 }).total).toBe(0);
  });

  it('validates only normalized visitor contact values', () => {
    expect(isValidLeadName('Alice Karim')).toBe(true);
    expect(isValidLeadName('Alice 123')).toBe(false);
    expect(isValidLeadEmail('alice@example.com')).toBe(true);
    expect(isValidLeadEmail('not-an-email')).toBe(false);
    expect(isValidLeadPhone('+97150120000')).toBe(true);
    expect(isValidLeadPhone('050120000')).toBe(false);
  });
});
