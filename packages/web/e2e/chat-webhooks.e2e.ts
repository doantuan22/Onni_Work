import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('custom receiver preserves signing-key setup and rotation', async ({ app, screen }) => {
  await app.open('/p/default/settings/webhooks')
  await screen.getByRole('button', 'Add receiver').tap()
  await screen.getByLabel('Name').fill('Custom browser fixture')
  await screen.getByLabel('Receiver URL').fill('https://receiver.invalid/fictional')
  await screen.getByRole('button', 'Save receiver').tap()
  await expect(screen.getByRole('heading', 'Save your signing key')).toBeVisible()
  // Do not read, log or screenshot the generated signing key.
  await screen.getByRole('button', 'I’ve saved the key').tap()
  const card = screen.getByRole('article').filter({ hasText: 'Custom browser fixture' })
  await card.getByRole('button', 'More actions for Custom browser fixture').tap()
  await expect(screen.getByRole('menuitem', 'Rotate key')).toBeVisible()
  await expect(screen.getByRole('menuitem', 'Revoke old keys')).toBeVisible()
})
