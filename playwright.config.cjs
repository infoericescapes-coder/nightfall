const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'browser.spec.cjs', timeout: 30000,
  fullyParallel: false, workers: 1, reporter: 'list',
  outputDir: '/tmp/nightfall-qa/results',
  use: {headless: true, viewport: {width: 1200, height: 900}},
  projects: [{name: 'chromium', use: {browserName: 'chromium'}}, {name: 'webkit', use: {browserName: 'webkit'}}],
});
