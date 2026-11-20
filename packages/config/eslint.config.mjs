// Shared flat ESLint config; root eslint.config.mjs re-exports this.
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.tmp-playwright/**',
      '**/public/ocr/**',
      '**/public/games/cyberverse/**',
      // Vite build output; authored game code is linted in apps/game-engine/src.
      '**/public/games/assets/**',
      // Pinned third-party source distributed solely for license attribution.
      '**/public/licenses/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
