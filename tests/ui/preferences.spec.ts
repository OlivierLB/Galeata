import { expect, test } from '@playwright/test';

test('preferences are a modal over the current view with only settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  const files = page.getByRole('region', { name: 'Fichiers du projet' });
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Préférences', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Préférences', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('open', true);
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
  await expect(dialog.getByRole('radiogroup')).toHaveCount(4);
  await expect(dialog).not.toContainText('MCP interne');
  await expect(dialog).not.toContainText('Raccourcis');
  await expect(dialog).not.toContainText('Un espace local');
  await expect(dialog.getByRole('button', { name: /le plan/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Fermer les préférences' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Fermer les préférences' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(files).toBeVisible();
});

test('agent preferences persist and reflect the latest conversation defaults', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Préférences', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Préférences', exact: true });
  await dialog.getByRole('radiogroup', { name: 'Agent par défaut' }).getByRole('radio', { name: 'Codex', exact: true }).click();
  await dialog.getByRole('radiogroup', { name: 'Mode de Claude Code au démarrage' }).getByRole('radio', { name: 'Demander', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fermer les préférences' }).click();
  await page.reload();
  await trigger.click();
  await expect(dialog.getByRole('radiogroup', { name: 'Agent par défaut' }).getByRole('radio', { name: 'Codex', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radiogroup', { name: 'Mode de Claude Code au démarrage' }).getByRole('radio', { name: 'Demander', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { writeStartMode } = await import('/src/agents/preferences.ts');
    writeStartMode('claude', 'plan');
  });
  await trigger.click();
  await expect(dialog.getByRole('radiogroup', { name: 'Mode de Claude Code au démarrage' }).getByRole('radio', { name: 'Plan', exact: true })).toHaveAttribute('aria-checked', 'true');
});
