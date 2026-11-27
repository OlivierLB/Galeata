import { test, expect } from '@playwright/test';

test('file changes appear as clickable margin markers without removed lines in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('tab', { name: 'README.md', exact: true }).click();
  const marker = page.locator('.change-marker.change-added').first();
  await expect(marker).toBeVisible();
  await marker.click();
  const detail = page.getByRole('dialog', { name: 'Détail de la modification' });
  await expect(detail).toContainText('+- Un plan toujours visible');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});
