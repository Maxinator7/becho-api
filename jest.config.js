/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  // Source uses NodeNext-style ".js" import specifiers for .ts files.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testTimeout: 30000,
};
