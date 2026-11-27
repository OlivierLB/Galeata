import { expect, test } from '@playwright/test';

test('les icônes affichées utilisent le catalogue Doodle local', async ({ page, request }) => {
  const sprite = await request.get('/icons/doodle.svg');
  expect(sprite.ok()).toBeTruthy();
  const source = await sprite.text();
  expect((source.match(/<symbol /g) ?? []).length).toBe(439);
  await page.goto('/');
  await expect(page.locator('svg[data-icon]').first()).toBeVisible();
  const references = await page.locator('svg[data-icon] use').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('href')));
  expect(references.length).toBeGreaterThan(10);
  for (const reference of references) {
    expect(reference).toMatch(/^\/icons\/doodle\.svg#/);
    expect(source).toContain('id="' + reference!.split('#')[1] + '"');
  }
  await page.getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('treeitem', { name: /README.md/ }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.locator('.monaco-editor textarea').first().focus();
  await page.keyboard.press('Control+f');
  const editorIcon = page.locator('.monaco-editor .codicon[class*="codicon-"]').first();
  await expect(editorIcon).toBeAttached();
  await expect.poll(() => editorIcon.evaluate(node => getComputedStyle(node, '::before').maskImage))
    .toContain('/icons/doodle/');
});
