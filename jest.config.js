module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/tests'],
  testMatch: ['**/*.test.js', '**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.js',
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**',
    '!src/**/*.interface.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  // Handle both TypeScript and JavaScript files
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': 'babel-jest'
  },
  // Module file extensions
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Handle CommonJS modules
  extensionsToTreatAsEsm: []
};