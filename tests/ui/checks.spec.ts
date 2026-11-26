import { test, expect } from '@playwright/test';

test('controls reuse the preferences modal and preserve selection and custom profiles', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Tests et contrôles', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Tests et contrôles', exact: true });
  await expect(dialog).toHaveClass(/preferences-dialog/);
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
  await dialog.getByRole('checkbox', { name: 'Types TypeScript', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Tests JavaScript', exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Lancer 2 contrôles' })).toBeDisabled();
  await expect(dialog).toContainText('aucune commande n’est exécutée');
  await dialog.getByRole('textbox', { name: 'Nom du profil de contrôles' }).fill('Avant commit');
  await dialog.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
  await dialog.getByRole('button', { name: 'Tout désélectionner', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Charger un profil de contrôles' }).selectOption('Avant commit');
  await expect(dialog.getByRole('checkbox', { name: 'Tests JavaScript', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Ajouter un contrôle', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Nom du contrôle', exact: true }).fill('Tests API Python');
  await dialog.getByRole('textbox', { name: 'Programme', exact: true }).fill('python3');
  await dialog.getByRole('textbox', { name: 'Arguments — un par ligne', exact: true }).fill('-m\nunittest\ndiscover');
  await dialog.getByRole('button', { name: 'Enregistrer le contrôle', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Tests API Python', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole('checkbox', { name: 'Types TypeScript', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Tests API Python', exact: true })).toBeVisible();
});

test('native request contract launches the selected checks and cancellation updates the results', async ({ page }) => {
  await page.addInitScript(() => {
    const fixture = window as any;
    let configuration: any = {};
    let run: any = null;
    let next = 0;
    const callbacks = new Map<number, Function>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const checks = [
      { id: 'unit', name: 'Tests unitaires', program: 'node', args: ['--test'], cwd: '', timeout: 600, origin: 'package.json', category: 'Tests' },
      { id: 'types', name: 'Types', program: 'npm', args: ['run', 'check'], cwd: '', timeout: 600, origin: 'package.json', category: 'Analyse' },
    ];
    const changed = () => { for (const [id, listener] of listeners) if (listener.event === 'checks:changed')
      callbacks.get(listener.handler)?.({ event: listener.event, id, payload: { workspaceId: 'fixture' } }); };
    fixture.__TAURI_INTERNALS__ = {
      transformCallback: (callback: Function) => { const id = ++next; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: any) => {
        if (command === 'startup_project') return null;
        if (command === 'plugin:event|listen') { const id = ++next; listeners.set(id, args); return id; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return null; }
        if (command !== 'request') return null;
        if (args.method === 'checks.catalog') return { checks: checks.map(definition => ({ definition, available: true })), configuration, scope: 'Fixture native' };
        if (args.method === 'checks.configure') { configuration = args.args; return null; }
        if (args.method === 'checks.status') return run ? [structuredClone(run)] : [];
        if (args.method === 'checks.start') {
          fixture.launchedChecks = args.args.ids;
          run = { id: 'run', createdAt: Date.now(), active: true, stale: false,
            jobs: args.args.ids.map((id: string, index: number) => ({ check: checks.find(check => check.id === id),
              status: index ? 'queued' : 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, message: '', hasOutput: true })) };
          changed(); return { id: 'run' };
        }
        if (args.method === 'checks.output') return 'Sortie du programme';
        if (args.method === 'checks.cancel') { run.active = false; for (const job of run.jobs) job.status = 'cancelled'; changed(); return null; }
        throw new Error(`Unexpected ${args.method}`);
      },
    };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: ChecksDialog } = await import('/src/components/checks/ChecksDialog.tsx');
    const { setActiveWorkspace } = await import('/src/api.ts');
    setActiveWorkspace({ id: 'fixture', name: 'Fixture', root: '/fixture' });
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = client.createRoot ?? client.default.createRoot;
    const container = document.createElement('div'); document.body.append(container);
    createRoot(container).render(createElement(ChecksDialog, { workspaceId: 'fixture', onClose: () => {} }));
  });
  const dialog = page.getByRole('dialog', { name: 'Tests et contrôles', exact: true });
  await dialog.getByRole('checkbox', { name: 'Tests unitaires', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Types', exact: true }).check();
  await dialog.getByRole('button', { name: 'Lancer 2 contrôles', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).launchedChecks)).toEqual(['unit', 'types']);
  await expect(dialog.locator('.check-job[data-status="running"]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Voir la sortie', exact: true }).first().click();
  await expect(dialog.locator('.check-output')).toContainText('Sortie du programme');
  await dialog.getByRole('button', { name: 'Annuler la sélection', exact: true }).click();
  await expect(dialog.locator('.check-job[data-status="cancelled"]')).toHaveCount(2);
});
