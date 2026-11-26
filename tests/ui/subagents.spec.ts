import { test, expect } from '@playwright/test';

test('composer opens conversation-scoped subagent tabs with complete prompts and live states', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Plan', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.create('parent-a', 'codex', true);
    agentStore.create('parent-b', 'codex', true);
    agentStore.apply('parent-a', [
      { type: 'toolInput', itemId: 'spawn-a', input: { action: 'spawn_agent', prompt: 'Mission A complète : analyser les permissions et vérifier les règles.', destinations: ['child-a'] } },
      { type: 'toolStarted', itemId: 'spawn-a', tool: 'agent', title: 'spawn_agent', path: null },
      { type: 'toolCompleted', itemId: 'spawn-a', ok: true, output: JSON.stringify({ agents: { 'child-a': { status: 'running' } } }) },
      { type: 'toolInput', itemId: 'spawn-c', input: { action: 'spawn_agent', prompt: 'Mission C : tester les commandes.', destinations: ['child-c'] } },
      { type: 'toolStarted', itemId: 'spawn-c', tool: 'agent', title: 'spawn_agent', path: null },
      { type: 'toolCompleted', itemId: 'spawn-c', ok: true, output: JSON.stringify({ agents: { 'child-c': { status: 'running' } } }) },
    ]);
    agentStore.apply('parent-b', [
      { type: 'toolInput', itemId: 'spawn-b', input: { action: 'spawn_agent', prompt: 'Mission B secrète.', destinations: ['child-b'] } },
      { type: 'toolStarted', itemId: 'spawn-b', tool: 'agent', title: 'spawn_agent', path: null },
      { type: 'toolCompleted', itemId: 'spawn-b', ok: true, output: JSON.stringify({ agents: { 'child-b': { status: 'running' } } }) },
    ]);
  });
  await page.getByRole('tab', { name: 'Codex 1', exact: true }).click();
  await expect(page.locator('.agent-monitor')).toHaveCount(0);
  await expect(page.getByText('Entrée pour envoyer · Tab pour mettre en file', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Sous-agents · 2 actifs/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Sous-agents de cette conversation' });
  await expect(dialog.getByRole('tab')).toHaveCount(2);
  await expect(dialog.getByRole('tabpanel')).toContainText('Mission A complète');
  await expect(dialog).not.toContainText('Mission B secrète');
  await dialog.getByRole('tab', { name: /child-c/ }).click();
  await expect(dialog.getByRole('tabpanel')).toContainText('Mission C');
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.apply('parent-a', [
      { type: 'toolStarted', itemId: 'wait-c', tool: 'agent', title: 'wait', path: null },
      { type: 'toolCompleted', itemId: 'wait-c', ok: true, output: JSON.stringify({ agents: { 'child-c': { status: 'completed', message: 'Tests réussis' } } }) },
    ]);
  });
  await expect(dialog.getByRole('tab')).toHaveCount(1);
  await dialog.getByRole('checkbox', { name: 'Inclure les terminés' }).check();
  await dialog.getByRole('tab', { name: /child-c/ }).click();
  await expect(dialog.getByRole('tabpanel')).toContainText('Tests réussis');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: 'Codex 2', exact: true }).click();
  await page.getByRole('button', { name: /Sous-agents · 1 actif/ }).click();
  await expect(page.getByRole('dialog').getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toContainText('Mission B secrète');
});
