export interface CrmScoreInput {
  commercialIntent: boolean;
  timelineMentioned: boolean;
  businessFit: boolean;
  validName: boolean;
  validContact: boolean;
  engagedUserTurns: number;
}

export interface CrmScoreBreakdown {
  commercialIntent: number;
  timeline: number;
  businessFit: number;
  contactQuality: number;
  engagement: number;
  total: number;
}

export const scoreCrmLead = (input: CrmScoreInput): CrmScoreBreakdown => {
  const breakdown = {
    commercialIntent: input.commercialIntent ? 25 : 0,
    timeline: input.timelineMentioned ? 20 : 0,
    businessFit: input.businessFit ? 20 : 0,
    contactQuality: input.validName && input.validContact ? 20 : input.validName || input.validContact ? 10 : 0,
    engagement: Math.min(15, Math.max(0, input.engagedUserTurns) * 5),
  };
  return { ...breakdown, total: breakdown.commercialIntent + breakdown.timeline + breakdown.businessFit + breakdown.contactQuality + breakdown.engagement };
};

export const isValidLeadName = (value: string): boolean => /^\p{L}+(?:[ '\u2019-]\p{L}+){0,3}$/u.test(value.trim());
export const isValidLeadEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());
export const isValidLeadPhone = (value: string): boolean => /^\+[1-9]\d{7,14}$/u.test(value.replace(/[ ()-]/g, ''));
