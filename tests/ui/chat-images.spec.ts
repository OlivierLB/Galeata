import { test, expect } from '@playwright/test';

for (const provider of ['claude', 'codex']) {
  test(`${provider}: image-only messages preview, remove and send attachments`, async ({ page }) => {
    await page.addInitScript(provider => localStorage.setItem('galeata:default-agent', provider), provider);
    await page.goto('/');
    await page.getByRole('button', { name: 'Nouvelle conversation de démonstration', exact: true }).click();
    const chat = page.locator('.agent-chat');
    const picker = chat.locator('input[type=file]');
    const image = { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
    await picker.setInputFiles(image);
    await expect(chat.locator('.composer-images img')).toHaveCount(1);
    await chat.getByRole('button', { name: 'Retirer l’image 1' }).click();
    await expect(chat.locator('.composer-images img')).toHaveCount(0);
    await picker.setInputFiles(image);
    await chat.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(chat.locator('.chat-user img')).toHaveCount(1);
    await expect(chat.locator('.composer-images img')).toHaveCount(0);
    await expect(chat.locator('.chat-user time')).toHaveCount(1);
  });
}
