import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**'] },
  js.configs.recommended,
  // Type-aware rules: worth it here, where most of the risk is in what comes
  // back from the database and from request bodies.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Express handlers legitimately return the result of res.json().
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },
  {
    // Build/test config files sit outside tsconfig's project, so type-aware
    // rules can't see them.
    files: ['*.config.{js,ts}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // vitest's matchers are typed as `any`, which the unsafe-* rules flag on
    // every assertion.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier
);
