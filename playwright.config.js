import { defineConfig, devices } from '@playwright/test';

// Browser journeys against the real server and a freshly seeded database in .e2e-data/.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4400', trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/serve.js',
    url: 'http://localhost:4400/api/config',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
