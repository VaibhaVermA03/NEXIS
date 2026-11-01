// NOT EXECUTED by the author: the build sandbox could not download browsers. Treat as unverified until you run it.
// Prerequisite: backend on :8000 (SEED_DEMO_DATA=true, no OPENAI_API_KEY needed) and `npm run dev` in frontend/ on :5173.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173', trace: 'retain-on-failure' },
})
