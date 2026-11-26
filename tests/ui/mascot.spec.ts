import { expect, test } from '@playwright/test';

test('la mascotte reste animée sans commande play/pause', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('galeata:mascot-motion', 'false'));
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
  await expect(mascot.getByRole('button')).toHaveCount(1);
  await expect(mascot).toHaveAttribute('data-moving', 'true');
  await page.reload();
  await expect(mascot).toHaveAttribute('data-moving', 'true');
  await mascot.getByRole('button', { name: 'Faire danser la mascotte' }).click();
  await expect(mascot).toHaveAttribute('data-animation', 'working');
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await expect(page.locator('.activity-rail .turtle-mascot')).toHaveCount(1);
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
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

test('la tortue réagit aux modifications de fichier et aux opérations Git longues', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fichiers', exact: true }).click();
  const file = page.getByRole('region', { name: 'Fichiers du projet' });
  await file.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Texte en cours de modification');
  const turtle = page.locator('.turtle-mascot');
  await expect(turtle).toHaveAttribute('data-animation', 'responding');
  await expect(turtle.locator('canvas')).toHaveAttribute('aria-label', 'Mascotte : À l’écriture…');
  // Control the completion time of the same request adapter used by the Git buttons.
  await page.evaluate(async () => {
    const fixture = window as any;
    const { trackMascotRequest } = await import('/src/mascot/requests.ts');
    fixture.gitAnimation = trackMascotRequest(
      'git.mutate',
      { action: 'commit' },
      () =>
        new Promise((resolve) => {
          fixture.finishGitAnimation = resolve;
        }),
    );
  });
  await expect(turtle).toHaveAttribute('data-animation', 'working');
  await expect(turtle.locator('canvas')).toHaveAttribute(
    'aria-label',
    'Mascotte : Création du commit…',
  );
  await page.waitForTimeout(1400);
  await expect(turtle).toHaveAttribute('data-animation', 'working');
  await page.evaluate(async () => {
    const fixture = window as any;
    fixture.finishGitAnimation({});
    await fixture.gitAnimation;
  });
  await expect(turtle).toHaveAttribute('data-animation', 'goal');
  await expect(turtle.locator('canvas')).toHaveAttribute('aria-label', 'Mascotte : Commit créé');
});

test('une IA attend une réponse même dans un autre onglet et pendant une action Git', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const composer = page.getByRole('textbox', { name: 'Message à l’agent' });
  const chat = page.locator('.agent-chat');
  for (const [index, text] of ['un', 'deux'].entries()) {
    await composer.fill(text);
    await composer.press('Enter');
    await expect(chat.locator('.chat-assistant')).toHaveCount(index + 1);
    await expect(chat.locator('.chat-assistant').last()).not.toHaveText('');
    await expect(chat.locator('.agent-state')).toContainText('Prêt');
  }
  await composer.fill('trois');
  await composer.press('Enter');
  await expect(chat.getByRole('region', { name: 'Autorisation demandée' })).toBeVisible();
  const turtle = page.locator('.turtle-mascot');
  await expect(turtle).toHaveAttribute('data-animation', 'waiting');
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await expect(turtle).toHaveAttribute('data-animation', 'waiting');
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page
    .getByRole('region', { name: 'Relecture du code' })
    .getByRole('button', { name: 'Récupérer', exact: true })
    .click();
  await expect(turtle).toHaveAttribute('data-animation', 'waiting');
  await page.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await page.getByRole('tablist', { name: 'Conversations' }).getByRole('tab').first().click();
  await chat.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(turtle).not.toHaveAttribute('data-animation', 'waiting');
});
