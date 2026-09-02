import tseslint from 'typescript-eslint';

// Two rules here are load-bearing, not style. They enforce invariants from
// CLAUDE.md that are otherwise easy to violate by accident and expensive to
// discover later.
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // INVARIANT: the engine is pure. It must stay testable without a browser,
    // and a session must be reproducible from {seed, cursor} alone.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window',   message: 'engine/ must not touch the DOM. Inject a port instead.' },
        { name: 'document', message: 'engine/ must not touch the DOM. Inject a port instead.' },
        { name: 'localStorage', message: 'Use the injected StorageAdapter, not localStorage directly.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Use mulberry32 from engine/random.ts. Decks must be reproducible from a seed ' +
            'so a bug report carries {seed, cursor}.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/**', '**/state/**'], message: 'engine/ must not depend on ui/ or state/.' },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist', 'dev-dist', 'node_modules', 'public'],
  },
);
