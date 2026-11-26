import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const samples = JSON.parse(readFileSync(new URL('../fixtures/language-samples.json', import.meta.url), 'utf8')) as { language: string; path: string; code: string }[];
async function editor(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  await page.getByRole('treeitem', { name: /App.tsx/ }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enregistrer automatiquement', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Fermer les préférences' }).click();
}
async function chooseLanguage(page: Page, language: string) {
  await page.locator('.editor-language-picker > summary').click();
  await page.getByRole('radiogroup', { name: 'Langage du fichier' }).getByRole('radio', { name: language, exact: true }).click();
}
async function typeCode(page: Page, code: string) {
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Control+a');
  await page.evaluate(code => {
    const input = document.querySelector('.monaco-editor textarea.inputarea')!;
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', code);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, code);
}
test('Ctrl-click on an import path opens the imported declaration and the language uses the shared select', async ({ page }) => {
  await editor(page);
  await expect(page.locator('.editor-language-picker')).toBeVisible();
  await chooseLanguage(page, 'typescript');
  await typeCode(page, "import { languageExtensions } from './domain.ts';\nconsole.log(languageExtensions);\n");
  const path = page.locator('.view-lines span').filter({ hasText: /^['"]?\.\/domain\.ts['"]?$/ }).last();
  await expect(path).toBeVisible();
  await page.keyboard.down('Control');
  await path.hover();
  await path.click();
  await page.keyboard.up('Control');
  await expect(page.getByRole('tab', { name: 'domain.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.view-lines').first()).toContainText('export const languageExtensions');
  await expect.poll(() => page.locator('.editor-surface').first().evaluate(element => {
    const line = [...element.querySelectorAll('.view-line')].find(line => line.textContent?.includes('export'));
    const highlight = element.querySelector('.view-overlays .current-line');
    return line && highlight ? Math.abs(line.getBoundingClientRect().top - highlight.getBoundingClientRect().top) : 999;
  })).toBeLessThan(2);
});
test('isolated Monaco keeps syntax errors without false project module errors', async ({ page }) => {
  await editor(page);
  await chooseLanguage(page, 'typescript');
  await typeCode(page, 'const broken = ;');
  await expect(page.locator('.squiggly-error').first()).toBeVisible();
  await typeCode(page, "import Worker from 'monaco-editor/esm/vs/editor/editor.worker?worker';\nnew Worker();\n");
  await expect(page.locator('.squiggly-error')).toHaveCount(0);
});
test('code commands stay contextual and symbol search uses the temporary palette', async ({ page }) => {
  await editor(page);
  await expect(page.locator('.code-navigation')).toHaveCount(0);
  for (const name of ['Précédent', 'Suivant', 'Structure', 'Symboles du projet', 'Renommer le symbole', 'Corrections', 'Organiser les imports'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await page.locator('.view-lines').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Organiser les imports/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Control+Shift+o');
  await expect(page.locator('.quick-input-widget')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Control+t');
  const palette = page.getByRole('dialog', { name: 'Fichiers et actions' });
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder('Rechercher un symbole…')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('galeata:symbols', { detail: [
    { name: 'firstFunction', path: 'src/App.tsx', line: 1 }, { name: 'secondFunction', path: 'src/App.tsx', line: 2 },
  ] })));
  await palette.getByRole('textbox').fill('second');
  await expect(palette.getByRole('button', { name: /secondFunction/ })).toBeVisible();
  await expect(palette.getByRole('button', { name: /firstFunction/ })).toHaveCount(0);
  await palette.getByRole('textbox').press('Enter');
  await expect(palette).not.toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(palette.getByPlaceholder('Rechercher un fichier ou choisir une action…')).toBeVisible();
});
test('all fifty languages produce syntax tokens for representative source files', async ({ page }) => {
  test.setTimeout(180_000);
  await editor(page);
  for (const sample of samples) {
    await chooseLanguage(page, sample.language);
    await typeCode(page, sample.code);
    await expect.poll(() => page.locator('.view-lines').first().evaluate(element => {
      const colors = new Set([...element.querySelectorAll('span')].filter(span => !span.querySelector('span') && span.textContent?.trim()).map(span => getComputedStyle(span).color));
      return colors.size;
    }), { message: `Coloration : ${sample.language} (${sample.path})` }).toBeGreaterThan(1);
  }
});
test('Vue and Svelte color embedded TypeScript and CSS', async ({ page }) => {
  await editor(page);
  for (const language of ['vue', 'svelte']) {
    await chooseLanguage(page, language);
    await typeCode(page, '<script lang="ts">\nconst count: number = 42;\n</script>\n<style>\n.box { color: red; }\n</style>\n<div class="box">Hello</div>');
    await expect(page.locator('.view-lines').first()).toContainText('count');
    await expect.poll(() => page.locator('.view-lines').first().evaluate(element => {
      const keyword = [...element.querySelectorAll('span')].find(span => !span.querySelector('span') && span.textContent === 'const');
      return keyword ? getComputedStyle(keyword).color : '';
    }), { message: `TypeScript embarqué dans ${language}` }).toBe('rgb(101, 83, 125)');
  }
});
test('global replacement previews selected files and applies into undoable buffers', async ({ page }) => {
  await editor(page);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rechercher dans le contenu' }).fill('Galeata');
  await page.getByRole('button', { name: 'Filtrer les fichiers', exact: true }).click();
  await page.getByRole('button', { name: 'Remplacer dans les fichiers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Fichiers à inclure' }).fill('README.md');
  await page.getByRole('textbox', { name: 'Texte de remplacement' }).fill('Atelier');
  await expect(page.getByRole('button', { name: 'Prévisualiser le remplacement' })).toBeEnabled();
  await page.getByRole('button', { name: 'Prévisualiser le remplacement' }).click();
  const preview = page.getByRole('dialog', { name: 'Remplacer dans le projet' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('README.md');
  await expect(preview.locator('.edit-preview-columns')).toContainText('Atelier');
  await preview.getByRole('button', { name: 'Appliquer les changements' }).click();
  await expect(preview).not.toBeVisible();
  await page.getByRole('tab', { name: 'README.md', exact: true }).click();
  await expect(page.locator('.view-lines').first()).toContainText('Atelier');
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines').first()).toContainText('Galeata');
});
test('workspace edits reject a stale buffer instead of overwriting it', async ({ page }) => {
  await editor(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('galeata:workspace-edit', { detail: {
    title: 'Correction contrôlée', edit: { changes: { 'file:///aperçu/galeata/src/App.tsx': [{ range: { start: { line: 0, character: 24 }, end: { line: 0, character: 27 } }, newText: 'Renamed' }] } },
  } })));
  const preview = page.getByRole('dialog', { name: 'Correction contrôlée' });
  await expect(preview).toBeVisible();
  // A second edit can arrive from an external agent while the preview is open.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('galeata:apply-model-edits', { detail: [{ path: 'src/App.tsx', before: 'export default function App() {\n  return (\n    <main>\n      <h1>Bienvenue dans Galeata</h1>\n      <p>Gardez le fil. Construisez la suite.</p>\n    </main>\n  );\n}\n', after: 'const newer = 1;' }] })));
  await preview.getByRole('button', { name: 'Appliquer les changements' }).click();
  await expect(preview.getByRole('alert')).toContainText('a changé depuis l’aperçu');
  await preview.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('.view-lines').first()).toContainText('const newer = 1;');
});
test('code history returns to the previous file and editing preferences survive reload', async ({ page }) => {
  await editor(page);
  await page.getByRole('treeitem', { name: /styles.css/ }).click();
  await page.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('tab', { name: 'App.tsx', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await page.getByRole('textbox', { name: 'Police du code' }).fill('monospace');
  await page.locator('.editor-advanced summary').filter({ hasText: 'Raccourcis de l’éditeur' }).click();
  await page.getByRole('textbox', { name: 'Raccourci formatage', exact: true }).fill('Ctrl+Alt+F');
  await page.getByRole('checkbox', { name: /Formater à la sauvegarde/ }).check();
  await page.reload();
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Police du code' })).toHaveValue('monospace');
  await page.locator('.editor-advanced summary').filter({ hasText: 'Raccourcis de l’éditeur' }).click();
  await expect(page.getByRole('textbox', { name: 'Raccourci formatage', exact: true })).toHaveValue('Ctrl+Alt+F');
  await expect(page.getByRole('checkbox', { name: /Formater à la sauvegarde/ })).toBeChecked();
});
test('missing files retain their recoverable drafts instead of discarding them', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('galeata:file-drafts:preview', JSON.stringify([{ path: 'missing.ts', content: 'important unsaved work', stamp: 'old' }]));
    localStorage.setItem('galeata:project-session:preview', JSON.stringify({ version: 1, editor: { openFiles: ['missing.ts'], activeFile: 'missing.ts', panel: 'files' } }));
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('galeata:file-drafts:preview'))).toContain('important unsaved work');
  // Let the delayed persistence pass run, so this does not merely check the seed.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => localStorage.getItem('galeata:file-drafts:preview'))).toContain('important unsaved work');
});
test('a recovered conflict offers an explicit keep action without losing the draft', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('galeata:autosave:preview', 'false');
    localStorage.setItem('galeata:file-drafts:preview', JSON.stringify([{ path: 'src/App.tsx', content: 'const recovered = 42;', stamp: 'outdated' }]));
    localStorage.setItem('galeata:project-session:preview', JSON.stringify({ version: 1, editor: { openFiles: ['src/App.tsx'], activeFile: 'src/App.tsx', panel: 'files' } }));
  });
  await page.goto('/');
  await expect(page.locator('.conflict-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Conserver mes changements' }).click();
  await expect(page.locator('.conflict-banner')).not.toBeVisible();
  await expect(page.locator('.view-lines').first()).toContainText('const recovered = 42;');
});
test('large plain-text files keep a virtualized editor and responsive controls', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem('galeata:autosave:preview', 'false');
    localStorage.setItem('galeata:file-drafts:preview', JSON.stringify([{ path: 'src/App.tsx', content: 'line 42\n'.repeat(100_000), stamp: 'large-fixture' }]));
    localStorage.setItem('galeata:project-session:preview', JSON.stringify({ version: 1, editor: { openFiles: ['src/App.tsx'], activeFile: 'src/App.tsx', panel: 'files', languages: { 'src/App.tsx': 'plaintext' } } }));
  });
  await page.goto('/');
  await expect(page.locator('.view-lines').first()).toContainText('line 42');
  expect(await page.locator('.view-lines').first().locator(':scope > div').count()).toBeLessThan(300);
  await page.getByRole('button', { name: 'Préférences de l’éditeur', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Police du code' })).toBeVisible();
});
test('formatting keeps native TypeScript, JSON, CSS and HTML tools usable without a server', async ({ page }) => {
  await editor(page);
  const fixtures = [
    { language: 'typescript', code: 'const value={a:1,b:2};', expected: 'value = ' },
    { language: 'json', code: '{"a":1,"b":2}', expected: '"a": 1' },
    { language: 'css', code: 'a{color:red}', expected: 'color: red' },
    { language: 'html', code: '<div>\n<span>text</span>\n</div>', expected: '  <span>' },
  ];
  for (const fixture of fixtures) {
    await chooseLanguage(page, fixture.language);
    await typeCode(page, fixture.code);
    const formatted = await page.evaluate(async fixture => {
      const { formatOpenFile } = await import('/src/components/EditorSurface.tsx');
      const { defaultEditorPreferences } = await import('/src/editorPreferences.ts');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return formatOpenFile('preview:src/App.tsx', fixture.code, { path: 'src/App.tsx', language: fixture.language, content: fixture.code, savedContent: fixture.code, stamp: 'fixture' }, '/aperçu/galeata', defaultEditorPreferences);
    }, fixture);
    expect(formatted, fixture.language).toContain(fixture.expected);
  }
});
