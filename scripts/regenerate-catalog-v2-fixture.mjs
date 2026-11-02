import { readFile, writeFile } from 'node:fs/promises';
import { exportCatalogV2Workbook } from '../services/api/src/catalog-v2-xlsx.ts';

const output = process.argv[2];
if (!output) throw new Error('Usage: node --import tsx/esm scripts/regenerate-catalog-v2-fixture.mjs <output.xlsx>');
const catalog = JSON.parse(await readFile(new URL('../services/api/src/fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8'));
await writeFile(output, exportCatalogV2Workbook(catalog));
console.log(`Wrote v2 reference workbook to ${output}`);
