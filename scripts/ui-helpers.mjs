import { expect } from '@playwright/test';

// Open the grid menu on actual empty space, independent of seeded widget layout.
export async function openGridMenu(page, grid, { waitForItem = true } = {}) {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await expect(grid).toBeVisible();
  if (waitForItem)
    await expect(grid.locator('.grid-stack-item').first()).toBeVisible();
  let point;
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect
      .poll(async () => {
        point = await grid.evaluate((el) => {
          const r = el.getBoundingClientRect();
          for (
            let y = Math.max(12, r.top + 12);
            y < Math.min(innerHeight - 12, r.bottom);
            y += 24
          ) {
            for (
              let x = Math.max(12, r.left + 12);
              x < Math.min(innerWidth - 12, r.right);
              x += 24
            ) {
              const hit = document.elementFromPoint(x, y);
              if (
                hit &&
                el.contains(hit) &&
                !hit.closest(
                  '.grid-stack-item, button, a, input, textarea, select',
                )
              )
                return { x: x - r.left, y: y - r.top };
            }
          }
          return null;
        });
        return !!point;
      })
      .toBe(true);
    // Locator clicks wait for layout stability and retain the grid-relative
    // position when startup layout moves the entire grid between frames.
    const hit = grid.evaluate(
      (el) =>
        new Promise((resolve) => {
          document.addEventListener(
            'contextmenu',
            (event) =>
              resolve(
                el.contains(event.target) &&
                  !event.target.closest(
                    '.grid-stack-item, button, a, input, textarea, select',
                  ),
              ),
            { once: true, capture: true },
          );
        }),
    );
    await grid.click({ position: point, button: 'right' });
    if (await hit) break;
    // GridStack may move a widget under the sampled point while restoring a layout.
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('menu', { name: '收藏页菜单' })).toBeVisible();
  return point;
}
