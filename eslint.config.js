import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'docs',
      'public/data',
      'src-event-v0',
      // The design lab is git-ignored and dev-only (?lab=); never part of the site.
      'design-lab',
      // Published research evidence (Python, byte-identical to its source; not part of the site).
      'research',
      'pipeline',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
