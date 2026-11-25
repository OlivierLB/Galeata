import { expect, test } from '@playwright/test';

test('chaque destination possède sa page et les fichiers restent ouverts', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(navigation.getByRole('button', { name: /GitHub|GitLab/ })).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Fichiers', exact: true }).click();
  const files = page.getByRole('region', { name: 'Fichiers du projet' });
  // The preview restores README from the project's saved open files.
  await files.getByRole('button', { name: 'Fermer README.md', exact: true }).click();
  await expect(files.getByRole('heading', { name: /Les fichiers de/ })).toBeVisible();
  await expect(files.getByRole('button', { name: /Trouver un fichier/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /README.md/ }).click();
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  await expect(files.locator('.monaco-editor')).toBeVisible();

  await navigation.getByRole('button', { name: 'Git', exact: true }).click();
  const git = page.getByRole('region', { name: 'Relecture du code' });
  await expect(git.getByRole('heading', { name: 'Vos changements, en perspective.' })).toBeVisible();
  await expect(git.getByRole('heading', { name: 'Fichiers à relire' })).toBeVisible();
  await git.locator('.git-change-path').filter({ hasText: 'README.md' }).click();
  await expect(git.getByRole('tab', { name: /README.md · diff/ })).toBeVisible();
  await git.getByRole('button', { name: 'Vue d’ensemble', exact: true }).click();
  await expect(git.getByRole('heading', { name: 'Fichiers à relire' })).toBeVisible();
  await git.locator('.git-change-path').filter({ hasText: 'README.md' }).click();
  await git.getByRole('button', { name: 'Fermer le diff' }).click();
  await expect(git.getByRole('heading', { name: 'Fichiers à relire' })).toBeVisible();

  await navigation.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  await files.getByRole('button', { name: 'Fermer README.md', exact: true }).click();
  await expect(files.getByRole('heading', { name: /Les fichiers de/ })).toBeVisible();
});

test('la recherche a son accueil, ses résultats et un aperçu qui conserve la requête', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const search = page.getByRole('region', { name: 'Recherche dans le projet' });
  await expect(search.getByRole('heading', { name: 'Du détail à l’ensemble.' })).toBeVisible();
  await search.getByRole('checkbox', { name: 'Noms de fichiers uniquement' }).check();
  await search.getByRole('textbox', { name: 'Rechercher dans le projet' }).fill('App.tsx');
  await search.getByRole('button', { name: /src\/App.tsx/ }).click();
  const preview = page.getByRole('region', { name: 'Volet de code' });
  await expect(preview.getByRole('tab', { name: 'App.tsx', exact: true })).toBeVisible();
  await expect(search.getByRole('textbox')).toHaveValue('App.tsx');
  await preview.getByRole('button', { name: 'Fermer le volet de code' }).click();
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.locator('.agent-home')).toBeVisible();
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(search.getByRole('textbox')).toHaveValue('App.tsx');
  await search.getByRole('button', { name: 'Effacer la recherche' }).click();
  await expect(search.getByRole('heading', { name: 'Du détail à l’ensemble.' })).toBeVisible();
  await expect(search.locator('.search-result-group')).toHaveCount(0);
});
