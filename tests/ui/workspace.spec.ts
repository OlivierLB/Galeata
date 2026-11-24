import { expect, test } from '@playwright/test';

test('explorer, rechercher et ouvrir un fichier sans annoncer de connexion locale', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('APERÇU INTERFACE')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Plan du projet' })).toBeVisible();
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rechercher dans le projet' }).fill('App.tsx');
  await page.getByRole('checkbox', { name: 'Noms de fichiers uniquement' }).check();
  await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
  await expect(page.getByRole('tab', { name: /App.tsx/ })).toBeVisible();
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lancer codex' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('modifier le plan, retrouver son historique et le conserver après rechargement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Modifier l’objectif' }).click();
  await page.getByRole('textbox', { name: 'Objectif', exact: true }).fill('Livrer une mission vérifiable');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livrer une mission vérifiable' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une étape' }).click();
  await page.getByRole('textbox', { name: 'Nouvelle étape' }).fill('Relire les changements');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relire les changements' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Livrer une mission vérifiable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Relire les changements' })).toBeVisible();
});

test('replier le plan et retrouver les actions au clavier', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Replier le plan', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Plan du projet' })).toHaveCount(0);
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog', { name: 'Fichiers et actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Afficher ou replier le plan', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Plan du projet' })).toBeVisible();
});
