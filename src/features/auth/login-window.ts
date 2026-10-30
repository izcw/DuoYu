import { browser, type Browser } from 'wxt/browser';

/** Resize only the authorization popup created during this flow. */
export async function launchLoginWindow(url: string, parentWindowId?: number) {
  const parent =
    parentWindowId === undefined
      ? await browser.windows.getLastFocused()
      : await browser.windows.get(parentWindowId);
  const width = Math.min(1100, Math.max(320, (parent.width ?? 1148) - 48));
  const height = Math.min(840, Math.max(320, (parent.height ?? 888) - 48));
  const bounds = {
    width,
    height,
    left: Math.round(
      (parent.left ?? 0) + ((parent.width ?? width) - width) / 2,
    ),
    top: Math.round(
      (parent.top ?? 0) + ((parent.height ?? height) - height) / 2,
    ),
  };
  const created = new Set<number>();
  const positioned = new Set<number>();
  const issuer = new URL(url).origin;
  async function position(windowId: number, raw?: string) {
    if (!created.has(windowId) || positioned.has(windowId) || !raw) return;
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return;
    }
    if (
      target.origin !== issuer ||
      !['/authorize', '/login'].includes(target.pathname)
    )
      return;
    positioned.add(windowId);
    // Closing a popup while this request is in flight is harmless.
    await browser.windows
      .update(windowId, { state: 'normal', ...bounds })
      .catch(() => {});
  }
  function onCreated(window: Browser.windows.Window) {
    if (window.id === undefined || window.type !== 'popup') return;
    created.add(window.id);
    void browser.windows
      .get(window.id, { populate: true })
      .then((w) => {
        for (const tab of w.tabs ?? [])
          void position(window.id!, tab.url || tab.pendingUrl);
      })
      .catch(() => {});
  }
  function onUpdated(
    _id: number,
    change: Browser.tabs.OnUpdatedInfo,
    tab: Browser.tabs.Tab,
  ) {
    void position(tab.windowId, change.url || tab.url || tab.pendingUrl);
  }
  browser.windows.onCreated.addListener(onCreated);
  browser.tabs.onUpdated.addListener(onUpdated);
  try {
    return await browser.identity.launchWebAuthFlow({ url, interactive: true });
  } finally {
    browser.windows.onCreated.removeListener(onCreated);
    browser.tabs.onUpdated.removeListener(onUpdated);
  }
}
