import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**',
      '**/.angular/**', '**/coverage/**', '**/*.d.ts',
    ],
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'apps/admin/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-debugger': 'error',
      'no-constant-condition': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error', {
          argsIgnorePattern: '^_', varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true,
        },
      ],
    },
  },
];
