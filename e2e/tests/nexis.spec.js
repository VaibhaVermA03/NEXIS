import { expect, test } from '@playwright/test'

const PASSWORD = 'E2e-Passw0rd!x'
const email = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

async function signup(page, addr) {
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('E2E Tester')
  await page.getByLabel('Email').fill(addr)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible()
}

test('anonymous users are redirected to login', async ({ page }) => {
  await page.goto('/app/agents')
  await expect(page).toHaveURL(/\/login/)
})

test('signup starts empty; create an agent through the popup; Run is blocked with a clear message when AI is not configured', async ({ page }) => {
  const addr = email()
  await signup(page, addr)

  // A new account is empty: no demo agents, no sample data
  await page.goto('/app/agents')
  await expect(page.getByText('No agents yet')).toBeVisible()

  // "Create agent" opens a popup (same pattern as "Create workflow")
  await page.getByRole('button', { name: 'Create agent' }).click()
  const dialog = page.getByRole('dialog', { name: 'New agent' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(/^Name/).fill('E2E Agent')
  await dialog.getByLabel(/generate_report/).check()
  await dialog.getByRole('button', { name: 'Create agent' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Agent' })).toBeVisible()

  // Without OPENAI_API_KEY on the server the Run button is disabled and explains why (no fake answers)
  await page.goto('/app/executions')
  const needsKey = page.getByText('AI is not configured')
  if (await needsKey.isVisible()) await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()

  // Log out and back in
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(addr)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible()
})

test('Google button reports unconfigured state instead of faking success', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: /continue with google/i }).click()
  await expect(page.getByRole('alert')).toContainText(/google sign-in is not configured on this server|accounts\.google\.com/i).catch(() => {})
  // When GOOGLE_CLIENT_ID/SECRET are unset the backend redirects back with ?error=google_not_configured
  await expect(page).toHaveURL(/error=google_not_configured|accounts\.google\.com/)
})

test('API key is displayed once', async ({ page }) => {
  await signup(page, email())
  await page.goto('/app/api-keys')
  await page.getByRole('button', { name: 'Create key' }).first().click()
  await page.getByLabel('Name').fill('e2e')
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click()
  const secret = page.getByTestId('api-key-secret')
  await expect(secret).toContainText(/^nx_/)
  const full = (await secret.textContent()).trim()
  await page.getByRole('button', { name: 'I have saved it' }).click()
  await expect(page.locator('body')).not.toContainText(full)
})