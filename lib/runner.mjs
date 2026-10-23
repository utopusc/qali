import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { validatePlan } from './plan.mjs';
import { installNavigationGuard } from './navigation.mjs';
import { writeReports } from './summary.mjs';

const INTERACTIONS = new Set(['click', 'fill', 'press', 'select', 'check']);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function message(error, maximum = 8000) {
  return String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, '').slice(0, maximum);
}

function scopedURL(value, baseURL) {
  const url = new URL(value, baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.origin !== new URL(baseURL).origin) {
    throw new Error('Plan paths must stay within the selected baseURL origin and must not contain credentials.');
  }
  return url.href;
}

function locator(page, target) {
  if (Object.hasOwn(target, 'role')) {
    return page.getByRole(target.role, { name: target.name, exact: target.exact });
  }
  if (Object.hasOwn(target, 'label')) return page.getByLabel(target.label);
  if (Object.hasOwn(target, 'text')) return page.getByText(target.text);
  if (Object.hasOwn(target, 'testId')) return page.getByTestId(target.testId);
  return page.locator(`css=${target.css}`);
}

function substringPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Follow GET redirects explicitly so no out-of-scope redirect request is sent. */
async function checkRequest(context, step, config) {
  let url = scopedURL(step.path, config.baseURL);
  const deadline = Date.now() + config.timeoutMs;
  for (let redirect = 0; redirect <= 10; redirect += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Request check exceeded the configured timeout.');
    const response = await context.request.get(url, {
      maxRedirects: 0,
      timeout: remaining,
      failOnStatusCode: false,
    });
    try {
      const status = response.status();
      const location = response.headers().location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        url = scopedURL(new URL(location, url).href, config.baseURL);
        continue;
      }
      expect(status, `GET status should be ${step.expectedStatus}`).toBe(step.expectedStatus);
      if (step.bodyContains !== undefined) {
        const body = await response.body();
        if (body.length > MAX_RESPONSE_BYTES) {
          throw new Error('Request body is larger than the 2 MiB check limit.');
        }
        expect(body.toString('utf8'), 'GET response should contain the expected text').toContain(step.bodyContains);
      }
      return;
    } finally {
      await response.dispose();
    }
  }
  throw new Error('Request exceeded the maximum of 10 same-origin redirects.');
}

async function executeStep({ step, page, context, config, pageErrors }) {
  const options = { timeout: config.timeoutMs };
  switch (step.action) {
    case 'goto': {
      const response = await page.goto(scopedURL(step.path, config.baseURL), {
        waitUntil: 'load',
        ...options,
      });
      if (response && response.status() >= 400) {
        throw new Error(`Navigation returned HTTP ${response.status()}.`);
      }
      break;
    }
    case 'click':
      await locator(page, step.target).click(options);
      break;
    case 'fill':
      await locator(page, step.target).fill(step.value, options);
      break;
    case 'press':
      await locator(page, step.target).press(step.key, options);
      break;
    case 'select':
      await locator(page, step.target).selectOption(step.value, options);
      break;
    case 'check':
      await locator(page, step.target).setChecked(step.checked, options);
      break;
    case 'expectVisible':
      await expect(locator(page, step.target)).toBeVisible(options);
      break;
    case 'expectText':
      await expect(locator(page, step.target)).toContainText(step.value, options);
      break;
    case 'expectTitle':
      await expect(page).toHaveTitle(substringPattern(step.value), options);
      break;
    case 'expectURL':
      await expect(page).toHaveURL(scopedURL(step.path, config.baseURL), options);
      break;
    case 'expectNoPageErrors':
      expect(pageErrors, 'No uncaught page errors should have been observed before this step').toEqual([]);
      break;
    case 'request':
      await checkRequest(context, step, config);
      break;
    default:
      throw new Error(`Unsupported action: ${step.action}.`);
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function createRunDirectory(config, projectDir) {
  const root = path.resolve(projectDir);
  const outputRoot = path.resolve(root, config.outputDir);
  if (!inside(root, outputRoot)) throw new Error('The run output directory must stay inside the project directory.');
  const realRoot = await realpath(root);
  // Check the nearest existing parent before mkdir can follow a symlink.
  let existing = outputRoot;
  while (true) {
    try {
      if (!inside(realRoot, await realpath(existing))) {
        throw new Error('The run output directory must not follow a symlink outside the project directory.');
      }
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      existing = path.dirname(existing);
    }
  }
  await mkdir(outputRoot, { recursive: true });
  return mkdtemp(path.join(outputRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
}

async function runTest({ browser, test, config, runDir }) {
  let context;
  let page;
  let tracing = false;
  const result = { id: test.id, title: test.title, status: 'error', steps: [], console: [] };
  const pageErrors = [];
  const runtimeErrors = [];
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    context.setDefaultTimeout(config.timeoutMs);
    context.setDefaultNavigationTimeout(config.timeoutMs);
    const guard = await installNavigationGuard(context, config.baseURL);
    page = await context.newPage();
    await guard.ready(page);
    page.on('console', (entry) => {
      if (result.console.length < 100) result.console.push({ type: entry.type(), text: entry.text().slice(0, 2000) });
    });
    page.on('pageerror', (error) => {
      if (pageErrors.length < 100) pageErrors.push(message(error, 2000));
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    tracing = true;

    for (const step of test.steps) {
      const stepResult = { action: step.action, status: 'passed' };
      result.steps.push(stepResult);
      try {
        guard.assertAllowed();
        await executeStep({ step, page, context, config, pageErrors });
        guard.assertAllowed();
        if (step.action !== 'request') {
          const currentURL = new URL(page.url());
          if (currentURL.origin !== new URL(config.baseURL).origin || currentURL.username || currentURL.password) {
            throw new Error('The current page left the selected origin. This destination is outside the plan scope.');
          }
        }
      } catch (error) {
        try {
          guard.assertAllowed();
        } catch (scopeError) {
          error = scopeError;
        }
        stepResult.status = 'failed';
        stepResult.error = message(error);
        result.status = 'failed';
        result.error = stepResult.error;
        break;
      }
    }

    if (result.status !== 'failed') result.status = 'passed';

    if (result.status === 'failed') {
      const screenshot = `${test.id}.png`;
      try {
        await page.screenshot({ path: path.join(runDir, screenshot), timeout: Math.min(config.timeoutMs, 5000) });
        result.screenshot = screenshot;
      } catch (error) {
        result.evidenceErrors = [`Screenshot could not be captured: ${message(error, 500)}`];
      }
      const trace = `${test.id}.zip`;
      try {
        await context.tracing.stop({ path: path.join(runDir, trace) });
        result.trace = trace;
      } catch (error) {
        const traceError = `Trace could not be saved: ${message(error, 500)}`;
        result.evidenceErrors = [...(result.evidenceErrors ?? []), traceError];
        runtimeErrors.push(traceError);
      }
      tracing = false;
    }
  } catch (error) {
    runtimeErrors.push(message(error));
  } finally {
    if (context) {
      if (tracing) {
        try {
          await context.tracing.stop();
        } catch (error) {
          runtimeErrors.push(`Trace could not be finalized: ${message(error, 500)}`);
        }
      }
      try {
        await context.close();
      } catch (error) {
        runtimeErrors.push(`Browser context cleanup failed: ${message(error, 500)}`);
      }
    }
  }
  if (runtimeErrors.length) {
    result.runtimeError = runtimeErrors.join('\n');
    const error = new Error(result.runtimeError);
    error.testResult = result;
    throw error;
  }
  return result;
}

/** Execute a reviewed declarative plan against the selected application. */
export async function runPlan({ config, plan, projectDir, allowActions = false, headed = false }) {
  validatePlan(plan);
  let baseURL;
  try {
    baseURL = new URL(config.baseURL);
  } catch {
    throw new Error('Configure baseURL as an HTTP(S) URL before running checks.');
  }
  if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password) {
    throw new Error('Configure baseURL as an HTTP(S) URL without credentials.');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120000) {
    throw new Error('Configure timeoutMs as an integer between 1 and 120000.');
  }
  if (typeof config.outputDir !== 'string' || !config.outputDir || typeof projectDir !== 'string') {
    throw new Error('A project directory and outputDir are required.');
  }
  for (const test of plan.tests) {
    for (const step of test.steps) {
      if (INTERACTIONS.has(step.action) && !allowActions) {
        throw new Error('This plan includes interactions. Review the plan, then run with --allow-actions to enable them.');
      }
      if (Object.hasOwn(step, 'path')) scopedURL(step.path, config.baseURL);
    }
  }

  const startedAt = new Date().toISOString();
  const runDir = await createRunDirectory(config, projectDir);
  const report = {
    version: 1,
    runId: path.basename(runDir),
    project: config.name,
    baseURL: config.baseURL,
    startedAt,
    finishedAt: '',
    status: 'passed',
    counts: { passed: 0, failed: 0, total: plan.tests.length },
    tests: [],
  };
  let browser;
  const runtimeErrors = [];
  function retainResult(result) {
    report.tests.push(result);
    if (result.status === 'passed' || result.status === 'failed') {
      report.counts[result.status] += 1;
    }
  }

  try {
    try {
      browser = await chromium.launch({
        headless: !headed,
        ...(process.env.QALI_BROWSER_PATH ? { executablePath: process.env.QALI_BROWSER_PATH } : {}),
      });
    } catch (error) {
      throw new Error(`Chromium could not start. Run "npx playwright install chromium" and "npm run qali -- doctor". ${message(error, 700)}`);
    }
    for (const test of plan.tests) {
      try {
        retainResult(await runTest({ browser, test, config, runDir }));
      } catch (error) {
        if (error.testResult) retainResult(error.testResult);
        throw error;
      }
    }
  } catch (error) {
    runtimeErrors.push(message(error));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        runtimeErrors.push(`Browser cleanup failed: ${message(error, 500)}`);
      }
    }
  }
  report.status = runtimeErrors.length ? 'error' : report.counts.failed ? 'failed' : 'passed';
  if (runtimeErrors.length) report.error = runtimeErrors.join('\n');
  report.finishedAt = new Date().toISOString();
  try {
    await writeReports(report, runDir);
  } catch (error) {
    report.status = 'error';
    report.error = [...runtimeErrors, `Reports could not be saved completely: ${message(error, 500)}`].join('\n');
    const reportError = new Error(report.error);
    reportError.runDir = runDir;
    reportError.report = report;
    throw reportError;
  }
  if (runtimeErrors.length) {
    const error = new Error(report.error);
    error.runDir = runDir;
    error.report = report;
    throw error;
  }
  return { runDir, report };
}
