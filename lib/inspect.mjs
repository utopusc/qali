import { chromium } from '@playwright/test';
import { installNavigationGuard } from './navigation.mjs';

/** Read a bounded DOM observation in a fresh browser context without form values. */
export async function inspectPage({ config }) {
  let base;
  try { base = new URL(config.baseURL); }
  catch { throw new Error('App baseURL must be a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('App baseURL must use http or https.');
  if (base.username || base.password) throw new Error('App baseURL must not contain embedded credentials.');
  let browser;
  let context;
  let guard;
  try {
    browser = await chromium.launch(process.env.QALI_BROWSER_PATH ? { executablePath: process.env.QALI_BROWSER_PATH } : {});
    context = await browser.newContext({ serviceWorkers: 'block' });
    guard = await installNavigationGuard(context, base.href);
    const page = await context.newPage();
    await guard.ready(page);
    page.setDefaultTimeout(config.timeoutMs || 10_000);
    await page.goto(base.href, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs || 10_000 });
    guard.assertAllowed();
    const observation = await page.evaluate(() => {
      const clean = (value, max = 256) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const excluded = 'input,textarea,select,script,style,noscript,[contenteditable]:not([contenteditable="false"])';
      const safeText = (root, maximum = 256, nodeLimit = 1000) => {
        if (!root) return '';
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts = [];
        let length = 0;
        let visited = 0;
        while (length < maximum && visited++ < nodeLimit && walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (!parent || parent.closest(excluded) || !visible(parent)) continue;
          const value = clean(walker.currentNode.textContent, maximum - length);
          if (value) { parts.push(value); length += value.length + 1; }
        }
        return parts.join(' ').slice(0, maximum);
      };
      const controls = [];
      const elements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,button,a[href],input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"]');
      let controlNodes = 0;
      for (const element of elements) {
        if (controls.length >= 100 || controlNodes++ >= 20_000) break;
        if (!visible(element)) continue;
        const tag = element.tagName.toLowerCase();
        const label = clean(element.labels ? Array.from(element.labels, item => safeText(item)).join(' ') : '');
        const labelledBy = clean((element.getAttribute('aria-labelledby') || '').split(/\s+/).slice(0, 10).map(id => safeText(document.getElementById(id))).join(' '));
        const name = clean(element.getAttribute('aria-label') || labelledBy || label || safeText(element));
        const role = clean(element.getAttribute('role')) || (/^h[1-6]$/.test(tag) ? 'heading' : tag === 'button' ? 'button' : tag === 'a' ? 'link' : '');
        const control = { tag };
        for (const [key, value] of Object.entries({ role, name, label, testId: clean(element.getAttribute('data-testid')), type: tag === 'input' ? clean(element.getAttribute('type') || 'text') : '' })) {
          if (value) control[key] = value;
        }
        controls.push(control);
      }
      return { url: location.href.slice(0, 2048), title: clean(document.title, 512), text: safeText(document.body || document.documentElement, 12_000, 20_000), controls };
    });
    guard.assertAllowed();
    if (new URL(page.url()).origin !== base.origin) throw new Error('Inspection navigation left the configured app origin.');
    return observation;
  } catch (error) {
    guard?.assertAllowed();
    if (/executable|browser.*not found|playwright install/i.test(error.message)) throw new Error('Chromium is unavailable. Run npx playwright install chromium, or set QALI_BROWSER_PATH to an installed Chromium executable.');
    throw new Error(`Could not inspect the app: ${error.message}`);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
