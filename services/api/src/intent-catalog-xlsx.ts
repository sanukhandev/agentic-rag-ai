import { deflateRawSync } from 'node:zlib';
import type {
  IntentCatalog,
  IntentCatalogExtensionRow,
  IntentCatalogVersion,
} from './types.js';

type CellValue = boolean | number | string | null | undefined;
type SheetDefinition = { name: string; headers: string[]; rows: CellValue[][] };

const escapeXml = (value: string): string => value
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;')
  .replace(/'/gu, '&apos;');

const columnName = (index: number): string => {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const snakeCase = (value: string): string => value
  .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
  .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
  .replace(/[ -]+/gu, '_')
  .toLocaleLowerCase('en-US');

const cellText = (value: unknown): CellValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of data) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const zip = (entries: Array<{ name: string; data: Buffer }>): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const xml = (value: string): Buffer => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`, 'utf8');

const cell = (address: string, value: CellValue, style = 0): string => {
  if (value === null || value === undefined || value === '') return `<c r="${address}" s="${style}"/>`;
  if (typeof value === 'boolean') return `<c r="${address}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
};

const sheetXml = (definition: SheetDefinition): Buffer => {
  const rowValues = [definition.headers, ...definition.rows];
  const lastColumn = columnName(Math.max(0, definition.headers.length - 1));
  const lastRow = Math.max(1, rowValues.length);
  const rows = rowValues.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 0)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const widths = definition.headers.map((header, columnIndex) => {
    const maxLength = Math.max(header.length, ...definition.rows.map((row) => String(row[columnIndex] ?? '').length));
    return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${Math.min(60, Math.max(12, Math.ceil(Math.min(60, maxLength + 2))))}" customWidth="1"/>`;
  }).join('');
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`);
};

const stylesXml = xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD9E2F3"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');

const workbookXml = (sheetNames: string[]): Buffer => xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${sheetNames.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
const workbookRelationshipsXml = (sheetNames: string[]): Buffer => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_name, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);

const contentTypesXml = (sheetCount: number): Buffer => xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: sheetCount }, (_value, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);

const rowsFromObjects = (rows: IntentCatalogExtensionRow[], preferredKeys: string[] = []): { headers: string[]; rows: CellValue[][] } => {
  const keys = [...preferredKeys, ...rows.flatMap((row) => Object.keys(row))].filter((key, index, values) => values.indexOf(key) === index);
  const headers = keys.map(snakeCase);
  return { headers, rows: rows.map((row) => keys.map((key) => cellText(row[key]))) };
};

const typedRows = <T extends Record<string, unknown>>(rows: T[], keys: string[]): { headers: string[]; rows: CellValue[][] } => ({
  headers: keys.map(snakeCase),
  rows: rows.map((row) => keys.map((key) => cellText(row[key]))),
});

const sheet = (name: string, headers: string[], rows: CellValue[][]): SheetDefinition => ({ name, headers, rows });

const catalogSheets = (version: IntentCatalogVersion, tenantSlug: string): SheetDefinition[] => {
  const catalog = version.catalog;
  const sheets: SheetDefinition[] = [sheet('README', ['Field', 'Value'], [
    ['Tenant scope', tenantSlug],
    ['Catalog status', version.status],
    ['Catalog version', version.version],
    ['Source file', version.sourceFileName],
    ['Source hash', version.sourceHash],
    ['Parser version', version.parserVersion],
    ['Exported at', new Date().toISOString()],
    ['Workflow policy', 'Bindings are exported from the published catalog. Review IDs and permissions before reuse.'],
    ['PII policy', 'No visitor PII is included in the catalog export.'],
  ])];
  sheets.push(sheet('Intents', ...Object.values(typedRows(catalog.intents as unknown as Array<Record<string, unknown>>, ['intentKey', 'displayName', 'description', 'category', 'workflowKey', 'minimumScore', 'confidenceThreshold', 'confirmationRequired', 'active', 'priority', 'versionNote'])) as [string[], CellValue[][]]));
  sheets.push(sheet('Signals', ...Object.values(typedRows(catalog.signals as unknown as Array<Record<string, unknown>>, ['intentKey', 'signalId', 'signalType', 'value', 'language', 'matchMode', 'weight', 'relationGroup', 'notes'])) as [string[], CellValue[][]]));
  sheets.push(sheet('Slots', ...Object.values(typedRows(catalog.slots as unknown as Array<Record<string, unknown>>, ['intentKey', 'slotKey', 'dataType', 'required', 'alternativeGroup', 'collectionOrder', 'promptKey', 'validationRule', 'retentionClass', 'qualityWeight'])) as [string[], CellValue[][]]));
  sheets.push(sheet('Relations', ...Object.values(typedRows(catalog.relations as unknown as Array<Record<string, unknown>>, ['sourceIntent', 'relatedIntent', 'relationType', 'triggerGroup', 'scoreAdjustment', 'minimumCooccurrence', 'clarificationPromptKey'])) as [string[], CellValue[][]]));
  sheets.push(sheet('WorkflowBindings', ...Object.values(typedRows(catalog.workflowBindings as unknown as Array<Record<string, unknown>>, ['workflowKey', 'n8nWorkflowId', 'webhookPath', 'payloadContract', 'sideEffectClass', 'active'])) as [string[], CellValue[][]]));
  if (catalog.qualityRules?.length) sheets.push(sheet('QualityRules', ...Object.values(typedRows(catalog.qualityRules as unknown as Array<Record<string, unknown>>, ['intentKey', 'qualityWorkflowKey', 'intentWeight', 'confidenceWeight', 'contactWeight', 'hotThreshold', 'warmThreshold', 'nurtureThreshold'])) as [string[], CellValue[][]]));
  if (catalog.journeyRequirements?.length) sheets.push(sheet('JourneyRequirements', ...Object.values(typedRows(catalog.journeyRequirements as unknown as Array<Record<string, unknown>>, ['intentKey', 'requirementKey', 'requirementType', 'required', 'collectionOrder', 'promptKey', 'validationRule', 'slotKey', 'documentType', 'fulfillmentMode', 'sourceOfTruth', 'notes'])) as [string[], CellValue[][]]));
  if (catalog.journeyTransitions?.length) sheets.push(sheet('JourneyTransitions', ...Object.values(typedRows(catalog.journeyTransitions as unknown as Array<Record<string, unknown>>, ['sourceIntentKey', 'targetIntentKey', 'activationMode', 'maxDepth', 'triggerGroup', 'promptKey', 'notes'])) as [string[], CellValue[][]]));
  if (catalog.documentPolicies?.length) sheets.push(sheet('DocumentPolicies', ...Object.values(typedRows(catalog.documentPolicies as unknown as Array<Record<string, unknown>>, ['intentKey', 'enabled', 'workflowKey', 'requestMode', 'required', 'requestPromptKey', 'allowedDocumentTypes', 'allowUserInitiated', 'consentRequired', 'preservePrimaryIntent', 'storeExtractedText', 'summaryTarget', 'autoCreateLead', 'autoIndexInRag', 'notes'])) as [string[], CellValue[][]]));
  if (catalog.documentSettings) sheets.push(sheet('DocumentSettings', ...Object.values(typedRows([catalog.documentSettings as unknown as Record<string, unknown>], ['schemaVersion', 'enabled', 'storageBackend', 'processingProvider', 'workflowKey', 'requireUploadConsent', 'maxFileBytes', 'maxFilesPerRequest', 'maxPdfPages', 'ocrLanguages', 'allowedMimeTypes', 'retentionPolicy', 'allowPublicDocumentUrls', 'allowAutomaticKnowledgeIngestion', 'allowPersonalIdentityDocumentsByDefault', 'summaryRendering', 'notes'])) as [string[], CellValue[][]]));
  const extensions: Array<[keyof IntentCatalog, string]> = [
    ['documentRequirements', 'DocumentRequirements'],
    ['crmFieldMappings', 'CRMFieldMappings'],
    ['channelCapabilities', 'ChannelCapabilities'],
    ['testUtterances', 'TestUtterances'],
    ['catalogManifest', 'CatalogManifest'],
  ];
  for (const [key, name] of extensions) {
    const rows = catalog[key] as IntentCatalogExtensionRow[] | undefined;
    if (rows?.length) {
      const prepared = rowsFromObjects(rows);
      sheets.push(sheet(name, prepared.headers, prepared.rows));
    }
  }
  return sheets;
};

export const exportIntentCatalogWorkbook = (version: IntentCatalogVersion, tenantSlug: string): Buffer => {
  const sheets = catalogSheets(version, tenantSlug);
  const sheetNames = sheets.map((item) => item.name);
  const entries = [
    { name: '[Content_Types].xml', data: contentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: workbookXml(sheetNames) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelationshipsXml(sheetNames) },
    { name: 'xl/styles.xml', data: stylesXml },
    ...sheets.map((item, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(item) })),
  ];
  return zip(entries);
};
