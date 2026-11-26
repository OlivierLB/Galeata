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
  await expect(git.getByRole('heading', { name: 'Changements' })).toBeVisible();
  await expect(git.getByRole('textbox', { name: 'Filtrer les fichiers Git' })).toBeVisible();
  await git.getByRole('textbox', { name: 'Filtrer les fichiers Git' }).fill('README');
  await expect(git.locator('.git-change-row')).toHaveCount(1);
  await git.locator('.git-change-path').filter({ hasText: 'README.md' }).click();
  await expect(git.getByRole('tab', { name: /README.md · diff/ })).toBeVisible();
  await git.getByRole('button', { name: 'Vue d’ensemble', exact: true }).click();
  await expect(git.getByRole('textbox', { name: 'Filtrer les fichiers Git' })).toBeVisible();
  await git.locator('.git-change-path').filter({ hasText: 'README.md' }).click();
  await git.getByRole('button', { name: 'Fermer le diff' }).click();
  await expect(git.getByRole('textbox', { name: 'Filtrer les fichiers Git' })).toBeVisible();

  await navigation.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await expect(files.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible();
  await files.getByRole('button', { name: 'Fermer README.md', exact: true }).click();
  await expect(files.getByRole('heading', { name: /Les fichiers de/ })).toBeVisible();
});

test('la recherche de contenu reste à côté des fichiers et conserve la requête', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Rechercher', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+f');
  const search = page.getByRole('region', { name: 'Recherche dans les fichiers' });
  const input = search.getByRole('textbox', { name: 'Rechercher dans le contenu' });
  await expect(input).toBeFocused();
  await input.fill('Bienvenue');
  await search.getByRole('button', { name: 'src/App.tsx, ligne 4', exact: true }).click();
  const files = page.getByRole('region', { name: 'Fichiers du projet' });
  await expect(files.getByRole('tab', { name: 'App.tsx', exact: true })).toBeVisible();
  await expect(files.locator('.monaco-editor')).toBeVisible();
  const resultLine = files.locator('.view-lines .view-line').filter({ hasText: 'Bienvenue' });
  await expect(resultLine).toBeVisible();
  await expect.poll(() => files.locator('.editor-surface').evaluate(root => {
    const row = Array.from(root.querySelectorAll('.view-lines .view-line')).find(element => element.textContent?.includes('Bienvenue'));
    const selected = root.querySelector('.view-overlays .current-line')?.parentElement;
    return !!row && !!selected && Math.abs(row.getBoundingClientRect().top - selected.getBoundingClientRect().top) < 1;
  })).toBe(true);
  await resultLine.click();
  await page.keyboard.press('Control+Shift+f');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Bienvenue');
  await page.getByRole('button', { name: 'Arborescence', exact: true }).click();
  await expect(search).toHaveCount(0);
  await page.getByRole('button', { name: 'Contenu', exact: true }).click();
  await expect(input).toHaveValue('Bienvenue');
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.locator('.agent-home')).toBeVisible();
  await page.keyboard.press('Control+Shift+f');
  await expect(input).toHaveValue('Bienvenue');
  await page.reload();
  await expect(input).toHaveValue('Bienvenue');
  await search.getByRole('button', { name: 'Effacer la recherche' }).click();
  await expect(search.locator('.search-result-group')).toHaveCount(0);
  await input.fill('aucune-correspondance-123');
  await expect(search.getByText('Aucune correspondance.', { exact: true })).toBeVisible();
});

test('Ctrl+P ouvre un fichier par son nom dans les fichiers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-home')).toBeVisible();
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Fichiers et actions' });
  await palette.getByRole('textbox', { name: 'Fichier ou action' }).fill('App.tsx');
  await expect(palette.getByRole('button', { name: 'src/App.tsx', exact: true })).toBeVisible();
  await palette.getByRole('textbox').press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Fichiers du projet' }).getByRole('tab', { name: 'App.tsx', exact: true })).toBeVisible();
  await page.locator('.editor-surface .view-line').first().click();
  await page.keyboard.press('Control+p');
  await expect(palette).toBeVisible();
});


test('le plan et son séparateur sont réservés aux agents', async ({ page }) => {
  await page.goto('/');
  const plan = page.locator('.plan-panel');
  const divider = page.getByRole('separator', { name: 'Largeur du plan' });
  await expect(plan).toBeVisible();
  await expect(divider).toBeVisible();
  for (const name of ['Fichiers', 'Git', 'Outils IA', 'Historique']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(plan).toHaveCount(0);
    await expect(divider).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(plan).toBeVisible();
  await expect(divider).toBeVisible();
});
