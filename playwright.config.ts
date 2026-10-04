import { defineConfig } from '@playwright/test';

// UI smoke tests against the Vite dev server, using the system Chrome
// (channel: 'chrome') so no browser download is needed. Needs
// src/wasm-build from engine/build-wasm.sh, same as `npm run dev`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174/ftl-visual-simulator-app/',
    channel: 'chrome',
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174/ftl-visual-simulator-app/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
