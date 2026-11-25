import { expect, test } from '@playwright/test';

test('la branche du pied de page ouvre les branches locales et distantes, puis permet une fusion explicite', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gérer les branches : main', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Branches et stash' });
  await expect(manager.getByRole('heading', { name: 'Branches locales' })).toBeVisible();
  await expect(manager.getByRole('heading', { name: 'Branches distantes' })).toBeVisible();
  await manager.getByRole('button', { name: 'Activer feature/interface', exact: true }).click();
  await expect(manager).toContainText('Remplacer la branche active main par feature/interface');
  await manager.getByRole('button', { name: 'Changer de branche', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Gérer les branches : feature/interface', exact: true }),
  ).toBeVisible();
  await manager
    .getByRole('button', { name: 'Fusionner main dans feature/interface', exact: true })
    .click();
  await expect(manager).toContainText('Source : main');
  await expect(manager).toContainText('Destination : feature/interface (branche active)');
  await manager
    .getByRole('button', { name: 'Fusionner dans feature/interface', exact: true })
    .click();
  await expect(manager.getByRole('status')).toContainText('Opération terminée');
  await manager
    .getByRole('textbox', { name: 'Nouvelle branche depuis feature/interface' })
    .fill('feature/test-ui');
  await manager.getByRole('button', { name: 'Créer et activer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Gérer les branches : feature/test-ui', exact: true }),
  ).toBeVisible();
  await manager.getByRole('button', { name: 'Activer origin/feature/plan', exact: true }).click();
  await manager.getByRole('button', { name: 'Changer de branche', exact: true }).click();
  await expect(manager).toContainText('origin/feature/plan');
  await expect(
    page.getByRole('button', { name: 'Gérer les branches : feature/plan', exact: true }),
  ).toBeVisible();
});

test('mettre de côté, changer de branche et restaurer le stash sans terminal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  const review = page.getByRole('region', { name: 'Relecture du code' });
  await review.getByRole('button', { name: 'Stash', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Branches et stash' });
  await manager
    .getByRole('textbox', { name: 'Mettre les modifications de côté' })
    .fill('Travail à reprendre');
  await manager.getByRole('button', { name: 'Créer le stash', exact: true }).click();
  await expect(manager.locator('.git-stash-row')).toContainText('Travail à reprendre');
  await expect(review.getByRole('heading', { name: 'Tout est à jour.' })).toBeVisible();
  await manager.getByRole('tab', { name: /Branches/ }).click();
  await manager.getByRole('button', { name: 'Activer feature/interface', exact: true }).click();
  await manager.getByRole('button', { name: 'Changer de branche', exact: true }).click();
  await manager.getByRole('tab', { name: /Stash/ }).click();
  await manager.getByRole('button', { name: 'Restaurer et retirer (pop)', exact: true }).click();
  await expect(manager).toContainText('Restaurer les fichiers sur feature/interface');
  await manager.getByRole('button', { name: 'Restaurer et retirer', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'Aucun stash en attente.' })).toBeVisible();
  await manager.getByRole('button', { name: 'Fermer la gestion Git' }).click();
  await expect(review.locator('.git-change-path')).toContainText('README.md');
  await review.getByRole('button', { name: 'Récupérer', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Références distantes actualisées.' }),
  ).toBeVisible();
});

test('les onglets non enregistrés bloquent les changements de fichiers mais laissent fetch disponible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Fichiers du projet' });
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Brouillon non enregistré');
  await page.getByRole('button', { name: 'Gérer les branches : main', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Branches et stash' });
  await expect(manager).toContainText('Des onglets contiennent du texte non enregistré');
  await expect(
    manager.getByRole('button', { name: 'Activer feature/interface', exact: true }),
  ).toBeDisabled();
  await expect(
    manager.getByRole('button', { name: 'Récupérer (fetch)', exact: true }),
  ).toBeEnabled();
  await manager.getByRole('button', { name: 'Fermer la gestion Git' }).click();
  await expect(editor.locator('.view-lines')).toContainText('Brouillon non enregistré');
});
