import { test, expect } from '@playwright/test';

test('shared variables update controls, icons, tree spacing and canvas typography readers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  const entry = page.getByRole('treeitem', { name: 'App.tsx', exact: true });
  const icon = page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).locator('svg');
  const before = await icon.evaluate(element => getComputedStyle(element).width);
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty('--icon-size-14', '21px');
    style.setProperty('--space-lg', '18px');
    style.setProperty('--tree-indent', '20px');
    style.setProperty('--radius-control', '9px');
    style.setProperty('--font-size-compact', '14px');
    style.setProperty('--terminal-font-size', '17px');
    style.setProperty('--editor-line-height', '29px');
  });
  expect(before).toBe('14px');
  await expect.poll(() => icon.evaluate(element => getComputedStyle(element).width)).toBe('21px');
  expect(await entry.evaluate(element => getComputedStyle(element).paddingLeft)).toBe('38px');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Rechercher dans le contenu' });
  expect(await input.evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
  expect(await input.locator('..').evaluate(element => getComputedStyle(element).borderRadius)).toBe('9px');
  const typography = await page.evaluate(async () => {
    const { readUiNumber } = await import('/src/uiTokens.ts');
    return [readUiNumber('--terminal-font-size'), readUiNumber('--editor-line-height')];
  });
  expect(typography).toEqual([17, 29]);
  await page.getByRole('button', { name: 'Arborescence', exact: true }).click();
  await entry.click();
  await expect.poll(() => page.locator('.editor-surface .view-line').first().evaluate(element => element.getBoundingClientRect().height)).toBe(29);
});
