import { describe, expect, it } from 'vitest';
import { CrmSummaryValidationError, formatCrmSummarySpec } from './crm-summary.js';

describe('CRM summary specification formatting', () => {
  it('revalidates and formats summary updates into stable sections', () => {
    const summary = formatCrmSummarySpec('Customer request: Build an ERP.\nInterest: Software development.\nContact details: Provided.\nSupporting documents: requirements.pdf: OCR completed');

    expect(summary).toContain('CRM OPPORTUNITY SPECIFICATION');
    expect(summary).toContain('Qualification\n- Interest: Software development.');
    expect(summary).toContain('Requirements\n- Customer request: Build an ERP.');
    expect(summary).toContain('Supporting Documents\n- Supporting documents: requirements.pdf: OCR completed');
    expect(formatCrmSummarySpec(summary)).toBe(summary);
  });

  it('rejects empty or control-only summaries', () => {
    expect(() => formatCrmSummarySpec(' \u0000\u0001 ')).toThrow(CrmSummaryValidationError);
  });
});
