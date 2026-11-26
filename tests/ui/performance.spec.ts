import { test, expect } from '@playwright/test';

test('long conversations mount only recent items and keep older messages accessible', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: AgentChat } = await import('/src/components/AgentChat.tsx');
    agentStore.create('stress', 'codex', true);
    agentStore.apply('stress', Array.from({ length: 2000 }, (_, i) => ({
      type: 'message', itemId: `m-${i}`, text: `Message ${i}`,
    })));
    const container = document.createElement('div');
    container.id = 'stress-chat';
    document.body.append(container);
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = client.createRoot ?? client.default.createRoot;
    createRoot(container).render(createElement(AgentChat, {
      id: 'stress', onOpenFile: () => {}, onShowDiff: () => {},
    }));
  });
  const chat = page.locator('#stress-chat');
  await expect(chat.locator('.chat-assistant')).toHaveCount(100);
  await expect(chat).toContainText('Message 1999');
  await chat.getByRole('button', { name: 'Afficher 100 éléments précédents' }).click();
  await expect(chat.locator('.chat-assistant')).toHaveCount(200);
  await expect(chat).toContainText('Message 1800');
});
