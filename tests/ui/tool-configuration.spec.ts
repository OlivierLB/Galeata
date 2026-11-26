import { expect, test } from '@playwright/test';

test('configuration sources expose scope, editing and bundled read-only files for both providers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Outils IA', exact: true }).click();
  const tools = page.getByRole('region', { name: 'Configuration des outils IA' });
  await tools.getByRole('button', { name: /config.toml/ }).click();
  const content = tools.getByRole('textbox', { name: 'Contenu de la configuration' });
  await expect(content).toContainText('model');
  await content.fill('# Updated config\nmodel = "test"\n');
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('button', { name: 'Outils IA', exact: true }).click();
  await expect(content).toHaveValue('# Updated config\nmodel = "test"\n');
  await tools.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(tools.getByRole('status')).toContainText('Fichier enregistré');
  await tools.getByRole('combobox', { name: 'Outil à configurer' }).selectOption('claude');
  await tools.getByRole('button', { name: /settings.json/ }).click();
  await expect(content).toContainText('hooks');
  await tools.getByRole('combobox', { name: 'Type de configuration' }).selectOption('plugins');
  await tools.getByRole('button', { name: /plugin-skill/ }).click();
  await expect(content).toHaveAttribute('readonly', '');
  await expect(tools.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
});

test('changing the source asks before abandoning a draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Outils IA', exact: true }).click();
  const tools = page.getByRole('region', { name: 'Configuration des outils IA' });
  await tools.getByRole('button', { name: /config.toml/ }).click();
  const content = tools.getByRole('textbox', { name: 'Contenu de la configuration' });
  await content.fill('draft');
  page.once('dialog', dialog => dialog.dismiss());
  await tools.getByRole('combobox', { name: 'Outil à configurer' }).selectOption('claude');
  await expect(tools.getByRole('combobox', { name: 'Outil à configurer' })).toHaveValue('codex');
  await expect(content).toHaveValue('draft');
});
