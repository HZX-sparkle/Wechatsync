/**
 * Anti-detection scripts for Playwright browser automation
 * Ported from MultiPost publish-agent (agent.js)
 */
import type { Page } from 'playwright'

export const ANTI_DETECT_SCRIPT = `
  // Hide automation
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Mimic Chrome runtime
  window.chrome = { runtime: {} };

  // Prevent permissions popup
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters: any) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
      : origQuery(parameters);

  // Crack closed Shadow DOM: force all attachShadow to open mode
  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    return origAttachShadow.call(this, { ...init, mode: 'open' });
  };
`

export async function injectAntiDetect(page: Page): Promise<void> {
  await page.addInitScript(ANTI_DETECT_SCRIPT)
}
