/**
 * Browser code must not reach for Node. The tests pull Node's types in
 * through vitest, so the type checker cannot catch a stray `process` or
 * `node:fs` in shipped code; these rules do. Tests, test data and type
 * shims are left out: they run in Node.
 */
const NODE_GLOBALS = ['process', 'Buffer', 'global', 'require', 'module', 'exports', '__dirname', '__filename'].map((name) => ({
  name,
  message: 'browser code: Node globals are not available in the app',
}));
const NODE_MODULE_MESSAGE = 'browser code: Node modules are not available in the app';
const NODE_MODULES = {
  paths: ['fs', 'path', 'url', 'os', 'child_process', 'crypto'].map((name) => ({ name, message: NODE_MODULE_MESSAGE })),
  patterns: [{ group: ['node:*'], message: NODE_MODULE_MESSAGE }],
};
const NOT_THREE = {
  paths: [{ name: 'three', message: 'core package must not import Three.js' }],
  patterns: [{ group: ['three/*'], message: 'core package must not import Three.js' }],
};
const NOT_SHIPPED = ['**/*.test.ts', '**/*.testdata.ts', '**/*.d.ts'];

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
    'no-restricted-imports': ['error', NOT_THREE],
  },
  overrides: [
    {
      files: ['app/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    {
      files: ['app/src/**/*.ts'],
      excludedFiles: NOT_SHIPPED,
      rules: {
        'no-restricted-globals': ['error', ...NODE_GLOBALS],
        'no-restricted-imports': ['error', NODE_MODULES],
      },
    },
    {
      // An override replaces a rule's options, so core's Three.js ban is restated here.
      files: ['packages/core/src/**/*.ts'],
      excludedFiles: NOT_SHIPPED,
      rules: {
        'no-restricted-globals': ['error', ...NODE_GLOBALS],
        'no-restricted-imports': ['error', { paths: [...NOT_THREE.paths, ...NODE_MODULES.paths], patterns: [...NOT_THREE.patterns, ...NODE_MODULES.patterns] }],
      },
    },
  ],
};
