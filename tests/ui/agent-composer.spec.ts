import { test, expect } from '@playwright/test';

for (const provider of ['claude', 'codex']) {
  test(`${provider}: commands, skills, file references and keyboard shortcuts`, async ({
    page,
  }) => {
    await page.addInitScript((provider) => {
      localStorage.setItem('galeata:default-agent', provider);
    }, provider);
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
      .click();
    const chat = page.locator('.agent-chat');
    const input = chat.getByRole('textbox', { name: 'Message à l’agent' });
    const modes = chat.getByRole('radiogroup', {
      name: 'Mode d’autorisation',
      includeHidden: true,
    });
    await input.fill('/plan');
    await expect(chat.getByRole('option', { name: /\/plan/ })).toBeVisible();
    await input.press('Enter');
    await expect(
      modes.getByRole('radio', { includeHidden: true, name: 'Plan', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(input).toHaveValue('');
    await expect(chat.locator('.chat-user')).toHaveCount(0);
    await input.press('Control+Alt+p');
    await expect(
      modes.getByRole('radio', { includeHidden: true, name: 'Auto', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');

    await input.fill('Relis @README');
    await expect(chat.getByRole('option', { name: /README.md/ })).toBeVisible();
    await input.press('Enter');
    await expect(input).toHaveValue('Relis [README.md](<README.md>) ');
    await expect(chat.locator('.chat-user')).toHaveCount(0);
    await input.press('End');
    await input.press('Control+Alt+s');
    const search = chat.getByRole('textbox', { name: 'Rechercher une suggestion' });
    await expect(search).toBeFocused();
    await search.fill('review');
    await expect(chat.getByRole('option', { name: /review/ })).toBeVisible();
    await search.press('Enter');
    await expect(input).toHaveValue(/Relis \[README.md\].*Utilise le skill \[review\]/);
    await expect(input).toBeFocused();
    // Compaction preserves the message being composed.
    const draft = await input.inputValue();
    if (await page.locator('.palette-backdrop').count())
      await page.locator('.palette-backdrop').click({ position: { x: 5, y: 5 } });
    await chat.getByRole('button', { name: 'Compacter le contexte', exact: true }).click();
    await expect(chat).toContainText('Démonstration : le contexte serait compacté ici.');
    await expect(input).toHaveValue(draft);
    await input.press('Control+Alt+f');
    await search.fill('no-such-file');
    await expect(chat.getByRole('status')).toHaveText('Aucun résultat.');
    await search.press('Escape');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(draft);
    await input.press('Enter');
    await expect(chat.locator('.chat-user')).toContainText('Utilise le skill [review]');
    await expect(input).toHaveValue('');
  });
}

test('slash palette supports arrows, Escape and skill completion without sending', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Message à l’agent' });
  await input.fill('/');
  await input.press('ArrowDown');
  await expect(page.getByRole('option', { name: /\/plan/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Suggestions' })).toHaveCount(0);
  await input.fill('$rev');
  await expect(page.getByRole('option', { name: /review/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue(/^Utilise le skill \[review\]/);
  await expect(page.locator('.chat-user')).toHaveCount(0);
});

for (const provider of ['claude', 'codex']) {
  test(`${provider}: Tab queues separate turns and waits through approval and questions`, async ({
    page,
  }) => {
    await page.addInitScript(
      (provider) => localStorage.setItem('galeata:default-agent', provider),
      provider,
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
      .click();
    const chat = page.locator('.agent-chat');
    const input = chat.getByRole('textbox', { name: 'Message à l’agent' });
    await input.fill('Premier tour');
    await input.press('Enter');
    await expect(chat.locator('.chat-assistant').last()).toHaveText('ok');
    await input.fill('Deuxième tour');
    await input.press('Enter');
    await expect(chat.locator('.chat-assistant').last()).toHaveText('Bonjour depuis Galeata');
    await input.fill('Troisième tour');
    await input.press('Enter');
    const approval = chat.getByRole('region', { name: 'Autorisation demandée' });
    await expect(approval).toBeVisible();
    await expect(input).toBeEnabled();
    await input.fill('Suite A');
    await input.press('Tab');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await input.fill('Suite B');
    await input.press('Tab');
    const queue = chat.getByRole('region', { name: 'File d’attente des messages' });
    await expect(queue).toContainText('2 messages en attente');
    await expect(chat.locator('.chat-user')).toHaveCount(3);
    // Leaving the conversation does not discard its queue.
    await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
    await page.getByRole('tablist', { name: 'Conversations' }).getByRole('tab').first().click();
    await expect(queue).toContainText('2 messages en attente');
    await approval.getByRole('button', { name: 'Autoriser', exact: true }).click();
    const question = chat.getByRole('region', { name: 'Question de l’agent' });
    await expect(question).toBeVisible();
    await expect(chat.locator('.chat-user').last()).toHaveText('Suite A');
    await expect(queue).toContainText('1 message en attente');
    await expect(chat.locator('.chat-user')).toHaveCount(4);
    await question.getByRole('radio', { includeHidden: true, name: /Bleu/ }).click();
    await expect(chat.getByRole('region', { name: 'Plan proposé' })).toBeVisible();
    await expect(chat.locator('.chat-user').last()).toHaveText('Suite B');
    await expect(queue).toHaveCount(0);
  });
}

test('queue controls pause, remove and resume without changing the draft', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Message à l’agent' });
  // Pause the provider at an approval request using the recorded third turn.
  for (const text of ['un', 'deux']) {
    await input.fill(text);
    await input.press('Enter');
    await expect(page.locator('.agent-state')).toContainText('Prêt');
  }
  await input.fill('trois');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'Autorisation demandée' })).toBeVisible();
  await input.fill('À retirer');
  await input.press('Tab');
  await input.fill('À conserver');
  await input.press('Tab');
  const queue = page.getByRole('region', { name: 'File d’attente des messages' });
  await queue.getByRole('button', { name: 'Mettre la file en pause' }).click();
  await queue.getByRole('button', { name: 'Retirer le message 1 de la file' }).click();
  await input.fill('Brouillon conservé');
  await page.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(page.locator('.agent-state')).toContainText('Prêt');
  await expect(queue.getByRole('status')).toHaveText('En pause');
  await expect(page.locator('.chat-user')).toHaveCount(3);
  await queue.getByRole('button', { name: 'Reprendre la file' }).click();
  await expect(page.locator('.chat-user').last()).toHaveText('À conserver');
  await expect(input).toHaveValue('Brouillon conservé');
});

test('composer menus close on outside clicks while preserving the draft', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true })
    .click();
  const chat = page.locator('.agent-chat');
  const input = chat.getByRole('textbox', { name: 'Message à l’agent' });
  await input.fill('Brouillon à conserver');
  for (const name of ['Commandes', 'Fichier', 'Skill']) {
    await chat.getByRole('button', { name: new RegExp(name) }).click();
    const suggestions = chat.locator('.composer-palette');
    await expect(suggestions).toBeVisible();
    await suggestions.getByRole('textbox').click();
    await expect(suggestions).toBeVisible();
    await chat.locator('.chat-empty h2').click();
    await expect(suggestions).toHaveCount(0);
    await expect(input).toHaveValue('Brouillon à conserver');
  }
});
