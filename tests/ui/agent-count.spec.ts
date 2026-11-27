import { test, expect } from '@playwright/test';

test('navigation counts active agents and drops completed subagents', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-home')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  const badge = nav.getByRole('button', { name: 'Agents et sessions', exact: true }).locator('.count-badge');
  await expect(badge).toHaveCount(0);
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.create('one', 'codex'); agentStore.create('two', 'claude');
    agentStore.apply('one', [
      { type: 'toolStarted', itemId: 'spawn', tool: 'agent', title: 'spawnAgent', path: null },
      { type: 'toolCompleted', itemId: 'spawn', ok: true, output: JSON.stringify({ agents: { child: { status: 'running' } } }) },
    ]);
  });
  await expect(badge).toHaveText('3');
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.apply('one', [
      { type: 'toolStarted', itemId: 'wait', tool: 'agent', title: 'wait', path: null },
      { type: 'toolCompleted', itemId: 'wait', ok: true, output: JSON.stringify({ agents: { child: { status: 'completed' } } }) },
    ]);
  });
  await expect(badge).toHaveText('2');
  await page.evaluate(async () => { const { agentStore } = await import('/src/agents/store.ts'); agentStore.remove('one'); });
  await expect(badge).toHaveText('1');
});
