import { test, expect } from '@playwright/test';

for (const theme of ['paper', 'night']) {
  test(`navigation counters remain readable through 999 in ${theme}`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (theme) => {
      document.documentElement.dataset.theme = theme;
      const react = await import('/node_modules/.vite/deps/react.js');
      const client = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { CountBadge } = await import('/src/components/CountBadge.tsx');
      const createElement = react.createElement ?? react.default.createElement;
      const createRoot = client.createRoot ?? client.default.createRoot;
      const container = document.createElement('div');
      container.id = 'counter-fixture';
      container.style.cssText = 'position:fixed;top:100px;left:100px;display:flex;gap:20px;z-index:9999';
      document.body.append(container);
      createRoot(container).render(createElement('div', { className: 'activity-rail' },
        ...[1, 99, 999, 1234].map(count => createElement('button', {
          className: 'rail-button', key: count,
        }, 'Git', createElement(CountBadge, { count, label: 'fichiers modifiés', placement: 'navigation' })))));
    }, theme);
    const badges = page.locator('#counter-fixture .count-badge');
    await expect(badges).toHaveText(['1', '99', '999', '999+']);
    for (const badge of await badges.all()) {
      const metrics = await badge.evaluate(element => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { height: box.height, width: box.width, scroll: element.scrollWidth,
          client: element.clientWidth, fontSize: parseFloat(style.fontSize),
          color: style.color, background: style.backgroundColor };
      });
      expect(metrics.height).toBeGreaterThanOrEqual(22);
      expect(metrics.fontSize).toBeGreaterThanOrEqual(12);
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
      expect(metrics.width).toBeLessThanOrEqual(52);
      expect(metrics.color).toBe('rgb(255, 255, 255)');
      expect(metrics.background).toBe('rgb(146, 52, 24)');
    }
    await expect(badges.last()).toHaveAttribute('title', '1234 fichiers modifiés');
  });
}
