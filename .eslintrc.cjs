/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Enforce that core package never imports from three or DOM
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'three', message: 'core package must not import Three.js' },
      ],
      patterns: [
        { group: ['three/*'], message: 'core package must not import Three.js' },
      ],
    }],
  },
  overrides: [
    {
      files: ['app/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
