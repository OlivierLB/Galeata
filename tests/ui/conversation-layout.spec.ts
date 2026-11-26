import { test, expect } from '@playwright/test';

test('conversations use a single active tab without a split view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Plan', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: AgentWorkspace } = await import('/src/components/AgentWorkspace.tsx');
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = client.createRoot ?? client.default.createRoot;
    const container = document.createElement('div'); container.id = 'layout-fixture';
    container.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white';
    document.body.append(container);
    agentStore.create('first', 'codex');
    agentStore.addUser('first', 'Corriger les commandes');
    agentStore.create('second', 'codex');
    agentStore.addUser('second', 'Optimiser le stock');
    createRoot(container).render(createElement(AgentWorkspace, {
      providers: [], sessions: [], defaultAgent: 'codex', onOpenFile: () => {},
      onShowDiff: () => {}, onOpenTerminal: () => {}, onOpenPreferences: () => {},
      onError: () => {}, onRefreshProviders: () => {}, onActiveChange: () => {},
    }));
  });
  const fixture = page.locator('#layout-fixture');
  await expect(fixture.getByRole('button', { name: 'Afficher deux conversations côte à côte' })).toHaveCount(0);
  await fixture.getByRole('tab').first().click();
  await expect(fixture.locator('.agent-chat')).toHaveCount(1);
  await expect(fixture.locator('.conversation-drop-overlay')).toHaveCount(0);
  await fixture.getByRole('tab').nth(1).click();
  await expect(fixture.getByRole('tab', { selected: true })).toContainText('Optimiser le stock');
  await fixture.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await expect(fixture.locator('.agent-home')).toBeVisible();
  await expect(fixture.getByRole('tab')).toHaveCount(2);
});
