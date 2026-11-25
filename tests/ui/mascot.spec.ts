import { expect, test } from '@playwright/test';

test('la mascotte peut être mise en pause et le choix est mémorisé', async ({ page }) => {
  await page.goto('/');
  const mascot = page.locator('.turtle-mascot');
  await expect(mascot).toHaveCount(1);
  await expect(page.locator('.activity-rail .turtle-mascot.compact')).toBeVisible();
  await expect(page.locator('[title="Espace personnel"]')).toHaveCount(0);
  await expect(mascot.locator('.mascot-caption')).toHaveCount(0);
  const size = (await mascot.locator('canvas').boundingBox())!;
  expect(size.width).toBeLessThanOrEqual(40);
  expect(size.height).toBeLessThanOrEqual(46);
  await expect(mascot.locator('canvas')).toHaveAttribute('data-frame', /\d/);
  await mascot.getByRole('button', { name: 'Mettre la mascotte en pause' }).click();
  await expect(mascot).toHaveAttribute('data-moving', 'false');
  const frame = await mascot.locator('canvas').getAttribute('data-frame');
  await page.waitForTimeout(650);
  await expect(mascot.locator('canvas')).toHaveAttribute('data-frame', frame!);
  await page.reload();
  await expect(mascot).toHaveAttribute('data-moving', 'false');
  await mascot.getByRole('button', { name: 'Animer la mascotte' }).click();
  await expect(mascot).toHaveAttribute('data-moving', 'true');
  await mascot.getByRole('button', { name: 'Faire danser la mascotte' }).click();
  await expect(mascot).toHaveAttribute('data-animation', 'working');
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await expect(page.locator('.activity-rail .turtle-mascot')).toHaveCount(1);
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
  await expect(page.locator('.turtle-mascot')).toHaveCount(1);
  await expect(page.locator('.chat-composer .turtle-mascot')).toHaveCount(0);
});

test('le réglage système de réduction des animations conserve une pose fixe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const mascot = page.locator('.turtle-mascot');
  await expect(mascot).toHaveAttribute('data-moving', 'false');
  await expect(mascot.locator('canvas')).toHaveAttribute('data-frame', '0');
  await page.waitForTimeout(650);
  await expect(mascot.locator('canvas')).toHaveAttribute('data-frame', '0');
  await expect(mascot.locator('.mascot-motion')).toHaveCount(0);
});
