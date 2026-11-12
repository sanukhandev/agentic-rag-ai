#!/usr/bin/env node
/**
 * Enforce effective TypeScript null safety, including inherited tsconfigs.
 * Actual compiler validation runs separately in the CI workflow.
 */
import ts from 'typescript';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const projects = [
  'tsconfig.base.json',
  'services/api/tsconfig.json',
  'apps/web/tsconfig.json',
  'apps/admin/tsconfig.json',
  'apps/admin/tsconfig.app.json',
  'apps/admin/tsconfig.spec.json',
];
const errors = [];
for (const relativePath of projects) {
  const path = resolve(relativePath);
  if (!existsSync(path)) {
    errors.push(relativePath + ': missing tsconfig');
    continue;
  }
  const file = ts.readConfigFile(path, ts.sys.readFile);
  if (file.error) {
    errors.push(relativePath + ': ' + ts.flattenDiagnosticMessageText(file.error.messageText, '\n'));
    continue;
  }
  const parsed = ts.parseJsonConfigFileContent(file.config, ts.sys, dirname(path), undefined, path);
  for (const error of parsed.errors) {
    errors.push(relativePath + ': ' + ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  const options = parsed.options;
  if (options.strict !== true) errors.push(relativePath + ': strict must be enabled');
  if (!(options.strictNullChecks ?? options.strict ?? false)) {
    errors.push(relativePath + ': strictNullChecks must be enabled');
  }
  if (relativePath === 'services/api/tsconfig.json' || relativePath === 'tsconfig.base.json') {
    if (options.noUncheckedIndexedAccess !== true) errors.push(relativePath + ': noUncheckedIndexedAccess must be enabled');
    if (options.exactOptionalPropertyTypes !== true) errors.push(relativePath + ': exactOptionalPropertyTypes must be enabled');
  }
}
if (errors.length) {
  for (const error of errors) console.error('ERROR: ' + error);
  process.exitCode = 1;
} else {
  console.log('PASS: all six TypeScript project configurations enforce strict null safety');
}
