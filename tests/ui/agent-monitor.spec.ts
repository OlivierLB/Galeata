import { test, expect } from '@playwright/test';

test('missions show latest status, hierarchy, files and delegation reports', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: AgentMonitor } = await import('/src/components/AgentMonitor.tsx');
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.create('parent', 'codex');
    agentStore.apply('parent', [
      { type: 'session', sessionId: 'session-parent', model: null },
      { type: 'toolStarted', itemId: 'spawn', tool: 'agent', title: 'Analyser le stock', path: null },
      { type: 'toolCompleted', itemId: 'spawn', ok: true,
        output: JSON.stringify({ agents: { child: { status: 'running' } } }) },
    ]);
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = client.createRoot ?? client.default.createRoot;
    const container = document.createElement('div'); container.id = 'monitor-fixture';
    container.style.cssText = 'position:fixed;inset:0;background:white;z-index:9999';
    document.body.append(container);
    const event = (id, sessionId, status, message, createdAt, extra = {}) => ({
      id, kind: 'activity', author: 'agent', message, createdAt, data: { sessionId, status, ...extra },
    });
    const events = [
      event('old', 'child', 'running', 'Ancienne mission', 1),
      event('parent', 'session-parent', 'running', 'Coordonner le projet', 3),
      event('latest', 'child', 'blocked', 'Besoin du schéma', 4, { parentId: 'session-parent', files: ['src/schema.ts'] }),
      event('done', 'finished', 'done', 'Tests terminés', 5),
    ];
    createRoot(container).render(createElement(AgentMonitor, { events,
      onConversation: id => { document.body.dataset.openedAgent = id; },
      onOpen: path => { document.body.dataset.openedFile = path; },
      onDiff: () => {}, onError: () => {},
    }));
  });
  const monitor = page.locator('#monitor-fixture');
  await expect(monitor.locator('summary').first()).toContainText('1 mission active · 1 blocage');
  await expect(monitor.getByText('Ancienne mission', { exact: true })).not.toBeVisible();
  await expect(monitor.getByText('Besoin du schéma', { exact: true })).toBeVisible();
  await expect(monitor.getByText(/Parent session-pare/)).toBeVisible();
  await expect(monitor.getByText(/Travaille/)).toBeVisible();
  await monitor.getByText('1 fichier concerné', { exact: true }).click();
  await monitor.getByRole('button', { name: 'src/schema.ts' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-opened-file', 'src/schema.ts');
  await monitor.getByRole('button', { name: 'Ouvrir la conversation pilote' }).first().click();
  await expect(page.locator('body')).toHaveAttribute('data-opened-agent', 'parent');
  await monitor.getByRole('button', { name: 'Inclure les terminés' }).click();
  await expect(monitor.getByText('Tests terminés', { exact: true })).toBeVisible();
});
