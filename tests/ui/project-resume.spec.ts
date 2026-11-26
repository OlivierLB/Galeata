import { test, expect } from '@playwright/test';

test('reload restores conversation order, drafts, paused queues, split and files', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-home')).toBeVisible();
  await page.evaluate(async () => {
    const { startAgent } = await import('/src/agents/api.ts');
    const { agentStore } = await import('/src/agents/store.ts');
    const first = await startAgent('codex');
    agentStore.addUser(first, 'Analyse');
    agentStore.setDraft(first, 'Brouillon analyse');
    agentStore.pauseQueue(first, true);
    agentStore.enqueue(first, 'Message à envoyer plus tard');
    await startAgent('claude');
  });
  await page.getByRole('button', { name: 'Renommer Analyse' }).click();
  await page.getByRole('textbox', { name: 'Nom de la conversation' }).fill('Analyse conservée');
  await page.getByRole('textbox', { name: 'Nom de la conversation' }).press('Enter');
  await page.getByRole('button', { name: 'Renommer Claude Code 1' }).click();
  await page.getByRole('textbox', { name: 'Nom de la conversation' }).fill('Correction conservée');
  await page.getByRole('textbox', { name: 'Nom de la conversation' }).press('Enter');
  await page.getByRole('textbox', { name: 'Message à l’agent', exact: true }).fill('Brouillon correction');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message à l’agent', exact: true })).toHaveValue('Brouillon correction');
  await page.getByRole('tab', { name: /Analyse conservée/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message à l’agent', exact: true })).toHaveValue('Brouillon analyse');
  expect(await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    return agentStore.getAll().map(c => ({ provider: c.provider, paused: c.queuePaused, queue: c.queuedMessages.map(m => m.text) }));
  })).toEqual([
    { provider: 'codex', paused: true, queue: ['Message à envoyer plus tard'] },
    { provider: 'claude', paused: true, queue: [] },
  ]);
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('treeitem', { name: /App.tsx/ }).click();
  await page.getByRole('treeitem', { name: 'src', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Fichiers du projet' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'App.tsx', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await nav.getByRole('button', { name: 'Agents et sessions', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Analyse conservée/, selected: true })).toBeVisible();
});

test('project snapshots are isolated and damaged snapshots fall back safely', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { readProjectSession, saveProjectSession } = await import('/src/projectSession.ts');
    saveProjectSession('one', { expanded: ['src/one'] });
    saveProjectSession('two', { expanded: ['src/two'] });
    localStorage.setItem('galeata:project-session:broken', '{invalid');
    return [readProjectSession('one').expanded, readProjectSession('two').expanded, readProjectSession('broken')];
  });
  expect(result).toEqual([['src/one'], ['src/two'], { version: 1 }]);
});
