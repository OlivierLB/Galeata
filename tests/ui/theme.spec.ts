import { expect, test } from '@playwright/test';
test('theme choice persists and logo follows appearance', async ({ page }) => {
  await page.goto('/');
  for (const [label, theme] of [['Charbon', 'night'], ['Papier', 'paper']]) {
    await page.getByRole('button', { name: 'Préférences', exact: true }).click();
    await page.getByRole('radio', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.brand img')).toHaveCSS('filter', 'none');
    await expect(page.locator('.brand img')).toHaveAttribute('src', theme === 'night' ? '/galeata-logo-night.svg' : '/galeata-logo.svg');
  }
});
