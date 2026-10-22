export const MAX_CRM_SUMMARY_LENGTH = 20_000;

export class CrmSummaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrmSummaryValidationError';
  }
}

const sectionFor = (label: string): string => {
  const normalized = label.toLowerCase();
  if (/customer request|project context|visitor requirements|requirement|interest summary/iu.test(normalized)) return 'Requirements';
  if (/contact|email|phone/iu.test(normalized)) return 'Contact';
  if (/document|ocr/iu.test(normalized)) return 'Supporting Documents';
  if (/conversation|visitor message|assistant response|engagement/iu.test(normalized)) return 'Engagement';
  if (/interest|intent|quality|validation|score|qualification/iu.test(normalized)) return 'Qualification';
  return 'Summary';
};

const cleanLine = (value: string): string => value
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
  .replace(/[ \t]+/gu, ' ')
  .trim();

const addValues = (sections: Map<string, string[]>, section: string, value: string): void => {
  for (const item of value.split(/\s+\|\s+/u).map(cleanLine).filter(Boolean)) {
    const values = sections.get(section) ?? [];
    if (!values.includes(item)) values.push(item);
    sections.set(section, values);
  }
};

/** Revalidates and converts every CRM summary write to a stable specification document. */
export const formatCrmSummarySpec = (summary: string): string => {
  if (typeof summary !== 'string') throw new CrmSummaryValidationError('CRM summary must be text.');
  const lines = summary.split(/\r?\n/gu).map(cleanLine).filter(Boolean);
  if (!lines.length) throw new CrmSummaryValidationError('CRM summary cannot be empty.');

  const sections = new Map<string, string[]>();
  let currentSection = 'Summary';
  for (const line of lines) {
    if (/^(?:#\s*)?CRM Opportunity Specification$/iu.test(line)) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      currentSection = cleanLine(heading[1] ?? '') || 'Summary';
      continue;
    }
    const plainHeading = line.match(/^(Qualification|Requirements|Contact|Supporting Documents|Engagement|Summary)$/iu);
    if (plainHeading) {
      currentSection = cleanLine(plainHeading[1] ?? '') || 'Summary';
      continue;
    }
    const value = line.replace(/^[-*]\s+/u, '').trim();
    const field = value.match(/^([A-Za-z][A-Za-z0-9 _/-]{1,80}):\s*(.+)$/u);
    if (field) {
      addValues(sections, sectionFor(field[1] ?? currentSection), `${cleanLine(field[1] ?? '')}: ${cleanLine(field[2] ?? '')}`);
    } else {
      addValues(sections, sectionFor(currentSection), value);
    }
  }

  const order = ['Qualification', 'Requirements', 'Contact', 'Supporting Documents', 'Engagement', 'Summary'];
  const body = order
    .filter((section) => (sections.get(section) ?? []).length > 0)
    .map((section) => `## ${section}\n${(sections.get(section) ?? []).map((value) => `- ${value}`).join('\n')}`)
    .join('\n\n');
  if (!body) throw new CrmSummaryValidationError('CRM summary has no usable content.');
  return `CRM OPPORTUNITY SPECIFICATION\n\n${body.replace(/^## /gmu, '')}`.slice(0, MAX_CRM_SUMMARY_LENGTH);
};
