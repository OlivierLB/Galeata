import { expect, test } from '@playwright/test';

test('le gestionnaire Git conserve sa liste et sa hauteur pendant les actualisations', async ({
  page,
}) => {
  // Emulate the native request latency; browser preview responses are synchronous.
  await page.addInitScript(() => {
    const fixture = window as any;
    fixture.gitOverviewRequests = 0;
    fixture.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command !== 'request' || args.method !== 'git.overview')
          throw new Error('Unexpected request');
        fixture.gitOverviewRequests++;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return {
          branches: [
            {
              name: 'main',
              remote: false,
              current: true,
              upstream: 'origin/main',
              inWorktree: false,
            },
            {
              name: 'feature/stable',
              remote: false,
              current: false,
              upstream: '',
              inWorktree: false,
            },
          ],
          stashes: [],
          remotes: ['origin'],
        };
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ouvrir un dossier', exact: true }).first().waitFor();
  await page.evaluate(async () => {
    const fixture = window as any;
    const react = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createElement = react.createElement ?? react.default.createElement;
    const createRoot = client.createRoot ?? client.default.createRoot;
    const { default: GitManager } = await import('/src/components/GitManager.tsx');
    const { setActiveWorkspace } = await import('/src/api.ts');
    setActiveWorkspace({ id: 'fixture', name: 'Fixture', root: '/fixture' });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let git = { branch: 'main', isRepo: true, files: [], upstream: 'origin/main', ahead: 0 };
    fixture.renderGitStatus = (changes = {}) => {
      git = { ...git, ...changes };
      root.render(
        createElement(GitManager, {
          git: structuredClone(git),
          workspaceId: 'fixture',
          initialTab: 'branches',
          dirty: false,
          busy: false,
          onClose: () => {},
          onMutate: async () => {},
        }),
      );
    };
    fixture.renderGitStatus();
  });
  const manager = page.getByRole('dialog', { name: 'Branches et stash' });
  const list = manager.locator('.git-branch-list');
  await expect(
    manager.getByRole('button', { name: 'Activer feature/stable', exact: true }),
  ).toBeVisible();
  const before = (await manager.boundingBox())!;
  await manager.evaluate((element) => {
    const fixture = window as any;
    fixture.gitHeights = [];
    const sample = () => {
      fixture.gitHeights.push(element.getBoundingClientRect().height);
      fixture.gitSampleFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  for (let index = 0; index < 8; index++) {
    await page.evaluate(() => (window as any).renderGitStatus());
    await page.waitForTimeout(60);
  }
  expect(await page.evaluate(() => (window as any).gitOverviewRequests)).toBe(1);
  await page.evaluate(() => (window as any).renderGitStatus({ ahead: 1 }));
  await expect(list).toHaveAttribute('aria-busy', 'true');
  await expect(manager.getByRole('heading', { name: 'Branches locales' })).toBeVisible();
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await manager.getByRole('button', { name: 'Actualiser les branches et stash' }).click();
  await expect(list).toHaveAttribute('aria-busy', 'true');
  await expect(manager.getByRole('heading', { name: 'Branches locales' })).toBeVisible();
  await expect(list).toHaveAttribute('aria-busy', 'false');
  const heights = await page.evaluate(() => {
    const fixture = window as any;
    cancelAnimationFrame(fixture.gitSampleFrame);
    return fixture.gitHeights as number[];
  });
  expect(heights.length).toBeGreaterThan(5);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  expect((await manager.boundingBox())!.height).toBe(before.height);
});
