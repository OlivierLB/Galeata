import { test, expect } from '@playwright/test';
async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('treeitem', { name: /App.tsx/ }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
}
test('preview preserves local drafts without claiming disk saving', async ({ page }) => {
  await openEditor(page);
  const input = page.locator('.monaco-editor textarea.inputarea').first();
  await input.focus(); await page.keyboard.press('Control+a');
  await page.keyboard.insertText('export const automatic = 123;');
  await expect(page.getByRole('status').filter({ hasText: 'Brouillon local conservé' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le fichier', exact: true })).toBeDisabled();
  await page.getByRole('treeitem', { name: /styles.css/ }).click();
  await expect(page.locator('.editor-file-status')).toContainText('Fichier d’exemple');
  await page.getByRole('tab', { name: 'App.tsx', exact: true }).click();
  await expect(page.locator('.editor-file-status')).toContainText('Brouillon local conservé');
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enregistrer automatiquement', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Fermer les préférences' }).click();
  await input.focus(); await page.keyboard.press('Control+a');
  await page.keyboard.insertText('export const draft = 456;');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('galeata:file-drafts:preview'))).toContain('export const draft = 456;');
  await page.reload();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.locator('.view-lines').first()).toContainText('export const draft = 456;');
});
test('switching files retains the model and undo history', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enregistrer automatiquement', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Fermer les préférences' }).click();
  const input = page.locator('.monaco-editor textarea.inputarea').first();
  await input.focus(); await page.keyboard.press('Control+a');
  await page.keyboard.insertText('const changed = true;');
  await page.getByRole('treeitem', { name: /styles.css/ }).click();
  await page.getByRole('tab', { name: 'App.tsx', exact: true }).click();
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines').first()).toContainText('export default function App');
});

test('two views share the file and editor preferences persist', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await page.getByLabel('Taille du texte', { exact: true }).fill('16');
  await page.getByRole('button', { name: 'Fermer les préférences' }).click();
  await page.locator('.editor-file-actions > summary').click();
  await page.getByRole('menuitem', { name: 'Afficher ce fichier à côté' }).click();
  await expect(page.locator('.editor-surface')).toHaveCount(2);
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('const shared = 42;');
  await expect(page.locator('.view-lines').nth(1)).toContainText('const shared = 42;');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('galeata:editor-preferences:preview')!).fontSize)).toBe(16);
});

test('editor preferences are grouped, validate committed fields and restore focus', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.editor-settings')).toHaveCount(0);
  await expect(page.locator('.editor-tab-actions').getByRole('checkbox')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Préférences', exact: true });
  await expect(dialog.getByRole('tab', { name: 'Éditeur', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Enregistrement', exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Raccourci formatage', exact: true })).not.toBeVisible();
  const size = dialog.getByRole('textbox', { name: 'Taille du texte', exact: true });
  await size.fill('');
  await expect(size).toHaveValue('');
  await size.press('Tab');
  await expect(dialog.getByRole('alert')).toContainText('entre 10 et 32');
  await size.fill('18'); await size.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('galeata:editor-preferences:preview')!).fontSize)).toBe(18);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test('preferences report storage failures instead of claiming a successful change', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('galeata:autosave:')) throw new Error('Quota exceeded'); original.call(this, key, value); }; });
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  const autoSave = page.getByRole('checkbox', { name: 'Enregistrer automatiquement', exact: true });
  await autoSave.click();
  await expect(autoSave).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
});
