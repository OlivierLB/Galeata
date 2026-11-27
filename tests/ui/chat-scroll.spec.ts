import { test, expect } from '@playwright/test';

test('new messages follow after inactivity but preserve a recent manual scroll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
  await page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    const conversation = agentStore.getAll()[0];
    agentStore.apply(conversation.id, Array.from({ length: 80 }, (_, index) => ({ type: 'message', itemId: `m${index}`, text: `Message ${index}\n\nUn texte pour remplir la conversation.` })));
  });
  const scroller = page.locator('.chat-scroll');
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  await scroller.evaluate(element => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -400 })); element.scrollTop = 0; });
  const append = () => page.evaluate(async () => {
    const { agentStore } = await import('/src/agents/store.ts');
    agentStore.apply(agentStore.getAll()[0].id, [{ type: 'message', itemId: crypto.randomUUID(), text: 'Nouveau message' }]);
  });
  await append();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(3);
  await page.waitForTimeout(3100);
  await append();
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
});
