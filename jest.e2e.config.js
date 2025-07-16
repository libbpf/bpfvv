module.exports = {
  preset: 'jest-puppeteer',
  testMatch: ['**/e2e/**/*.e2e.test.js'],
  testEnvironment: 'jest-environment-puppeteer',
  setupFilesAfterEnv: [],
  transform: {},
  moduleFileExtensions: ['js', 'json'],
};
