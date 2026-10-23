import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { runPlan } from '../../lib/runner.mjs';
import { formatSummary } from '../../lib/summary.mjs';

let server;
let projectDir;
let baseURL;
const requests = [];

before(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'qali-runtime-'));
  server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Runtime fixture</title><h1>Available</h1><a href="about:blank">Clear page</a>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(projectDir, { recursive: true, force: true });
});

function plan(total = 1) {
  return { version: 1, name: 'Runtime evidence', tests: Array.from({ length: total }, (_, index) => ({
    id: `test_${index + 1}`,
    title: `Check ${index + 1}`,
    steps: [{ action: 'request', path: `/check-${index + 1}`, expectedStatus: 200 }],
  })) };
}

function run(selectedPlan = plan(), options = {}) {
  return runPlan({
    config: { version: 1, name: 'Runtime fixture', baseURL, plan: 'qali.plan.json', outputDir: '.qali/runs', timeoutMs: 500 },
    plan: selectedPlan,
    projectDir,
    ...options,
  });
}

async function runtimeFailure(operation) {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'The runtime failure must reject instead of reporting a completed run');
  assert.ok(error.runDir, 'The rejected error must identify its fresh evidence directory');
  assert.equal(error.report?.status, 'error');
  assert.ok(error.report.error);
  assert.ok(error.report.finishedAt);
  const saved = JSON.parse(await readFile(path.join(error.runDir, 'report.json'), 'utf8'));
  assert.equal(saved.status, 'error');
  assert.equal(saved.error, error.report.error);
  assert.deepEqual(saved.counts, error.report.counts);
  assert.deepEqual(saved.tests, error.report.tests);
  const markdown = await readFile(path.join(error.runDir, 'report.md'), 'utf8');
  const html = await readFile(path.join(error.runDir, 'report.html'), 'utf8');
  assert.match(markdown, /incomplete|runtime error/i);
  assert.match(html, /incomplete|runtime error/i);
  assert.match(formatSummary(saved), /INCOMPLETE/);
  assert.match(formatSummary(saved), /doctor|diagnos/i);
  return error;
}

test('a real unavailable browser creates a fresh incomplete report instead of leaving the last pass as evidence', async () => {
  const successful = await run();
  const previousPath = process.env.QALI_BROWSER_PATH;
  process.env.QALI_BROWSER_PATH = path.join(projectDir, 'missing-browser');
  try {
    const error = await runtimeFailure(() => run());
    assert.notEqual(error.runDir, successful.runDir);
    assert.deepEqual(error.report.counts, { passed: 0, failed: 0, total: 1 });
    assert.deepEqual(error.report.tests, []);
    assert.match(error.report.error, /Chromium could not start/);
    assert.match(formatSummary(error.report), /0 of 1 tests completed/);
    const oldReport = JSON.parse(await readFile(path.join(successful.runDir, 'report.json'), 'utf8'));
    assert.equal(oldReport.status, 'passed');
  } finally {
    if (previousPath === undefined) delete process.env.QALI_BROWSER_PATH;
    else process.env.QALI_BROWSER_PATH = previousPath;
  }
});

test('a later context setup failure preserves completed tests and does not fabricate results for unrun checks', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  let browser;
  t.mock.method(chromium, 'launch', async (...args) => {
    browser = await originalLaunch(...args);
    const originalContext = browser.newContext.bind(browser);
    let contexts = 0;
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      contexts += 1;
      if (contexts === 2) throw new Error('Fixture context setup failure');
      return originalContext(...contextArgs);
    });
    return browser;
  });
  const beforeRequests = requests.length;
  const error = await runtimeFailure(() => run(plan(3)));
  assert.deepEqual(error.report.counts, { passed: 1, failed: 0, total: 3 });
  assert.deepEqual(error.report.tests.map((result) => result.status), ['passed', 'error']);
  assert.equal(error.report.tests[0].steps[0].status, 'passed');
  assert.equal(error.report.tests[1].steps.length, 0);
  assert.match(error.report.tests[1].runtimeError, /context setup failure/);
  assert.equal(error.report.tests.some((result) => result.id === 'test_3'), false);
  assert.deepEqual(requests.slice(beforeRequests), ['/check-1']);
  assert.match(formatSummary(error.report), /1 of 3 tests completed/);
  assert.equal(browser.isConnected(), false);
});

test('tracing setup failure records an incomplete test and still closes its real context', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  let contextClosed = false;
  t.mock.method(chromium, 'launch', async (...args) => {
    const browser = await originalLaunch(...args);
    const originalContext = browser.newContext.bind(browser);
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      const context = await originalContext(...contextArgs);
      context.on('close', () => { contextClosed = true; });
      t.mock.method(context.tracing, 'start', async () => { throw new Error('Fixture tracing setup failure'); });
      return context;
    });
    return browser;
  });
  const beforeRequests = requests.length;
  const error = await runtimeFailure(() => run());
  assert.deepEqual(error.report.counts, { passed: 0, failed: 0, total: 1 });
  assert.equal(error.report.tests[0].status, 'error');
  assert.deepEqual(error.report.tests[0].steps, []);
  assert.equal(requests.length, beforeRequests);
  assert.equal(contextClosed, true);
});

test('context cleanup failure preserves the executed check and stops later tests with a runtime error', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  let browser;
  t.mock.method(chromium, 'launch', async (...args) => {
    browser = await originalLaunch(...args);
    const originalContext = browser.newContext.bind(browser);
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      const context = await originalContext(...contextArgs);
      const originalClose = context.close.bind(context);
      t.mock.method(context, 'close', async (...closeArgs) => {
        await originalClose(...closeArgs);
        throw new Error('Fixture context cleanup failure');
      });
      return context;
    });
    return browser;
  });
  const error = await runtimeFailure(() => run(plan(2)));
  assert.deepEqual(error.report.counts, { passed: 1, failed: 0, total: 2 });
  assert.equal(error.report.tests.length, 1);
  assert.equal(error.report.tests[0].status, 'passed');
  assert.equal(error.report.tests[0].steps[0].status, 'passed');
  assert.match(error.report.tests[0].runtimeError, /context cleanup failure/);
  assert.equal(browser.isConnected(), false);
});

test('trace finalization failure is not silently swallowed after a passing check', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  t.mock.method(chromium, 'launch', async (...args) => {
    const browser = await originalLaunch(...args);
    const originalContext = browser.newContext.bind(browser);
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      const context = await originalContext(...contextArgs);
      const originalStop = context.tracing.stop.bind(context.tracing);
      t.mock.method(context.tracing, 'stop', async (...stopArgs) => {
        await originalStop(...stopArgs);
        throw new Error('Fixture trace finalization failure');
      });
      return context;
    });
    return browser;
  });
  const error = await runtimeFailure(() => run());
  assert.deepEqual(error.report.counts, { passed: 1, failed: 0, total: 1 });
  assert.match(error.report.error, /trace finalization failure/);
});

test('browser cleanup failure is reported after preserving every completed result', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  let browser;
  t.mock.method(chromium, 'launch', async (...args) => {
    browser = await originalLaunch(...args);
    const originalClose = browser.close.bind(browser);
    t.mock.method(browser, 'close', async (...closeArgs) => {
      await originalClose(...closeArgs);
      throw new Error('Fixture browser cleanup failure');
    });
    return browser;
  });
  const error = await runtimeFailure(() => run());
  assert.deepEqual(error.report.counts, { passed: 1, failed: 0, total: 1 });
  assert.equal(error.report.tests[0].status, 'passed');
  assert.match(error.report.error, /browser cleanup failure/);
  assert.equal(browser.isConnected(), false);
});


test('a real assertion failure remains a failed check when saving its trace also encounters a runtime error', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  t.mock.method(chromium, 'launch', async (...args) => {
    const browser = await originalLaunch(...args);
    const originalContext = browser.newContext.bind(browser);
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      const context = await originalContext(...contextArgs);
      const originalStop = context.tracing.stop.bind(context.tracing);
      t.mock.method(context.tracing, 'stop', async (...stopArgs) => {
        await originalStop(...stopArgs);
        throw new Error('Fixture failure trace could not finalize');
      });
      return context;
    });
    return browser;
  });
  const selectedPlan = plan();
  selectedPlan.tests[0].steps = [
    { action: 'goto', path: '/' },
    { action: 'expectTitle', value: 'Deliberately incorrect title' },
  ];
  const error = await runtimeFailure(() => run(selectedPlan));
  assert.deepEqual(error.report.counts, { passed: 0, failed: 1, total: 1 });
  assert.equal(error.report.tests[0].status, 'failed');
  assert.match(error.report.tests[0].error, /Deliberately incorrect title/);
  assert.match(error.report.error, /failure trace could not finalize/);
  assert.ok(error.report.tests[0].screenshot);
});

test('navigation to about:blank cannot turn a real app check into a passing empty-page check', async () => {
  const selectedPlan = plan();
  selectedPlan.tests[0].steps = [
    { action: 'goto', path: '/' },
    { action: 'click', target: { role: 'link', name: 'Clear page' } },
    { action: 'expectNoPageErrors' },
  ];
  const result = await run(selectedPlan, { allowActions: true });
  assert.equal(result.report.status, 'failed');
  assert.deepEqual(result.report.counts, { passed: 0, failed: 1, total: 1 });
  assert.match(result.report.tests[0].error, /origin|scope/);
  assert.equal(result.report.tests[0].steps.length, 2);
});
