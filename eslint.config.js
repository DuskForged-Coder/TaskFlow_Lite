import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-desktop/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/core/tasks/taskService.ts', 'src/core/projects/projectService.ts', 'src/config/credentialStore.ts', 'src/utils/terminal.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/sqliteNative.test.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
  {
    // The orb renderer runs in the browser context, and the preload bridge must
    // stay CommonJS because Electron sandboxes the renderer.
    files: ['src/desktop/preload/orb.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/desktop/preload/preload.cjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'commonjs',
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);