import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { validatePlan } from '../../lib/plan.mjs';
import { runPlan } from '../../lib/runner.mjs';
import { formatSummary, writeReports } from '../../lib/summary.mjs';

let server;
let foreignServer;
let baseURL;
let foreignURL;
let projectDir;
let hits = [];
let foreignHits = 0;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function fixturePage() {
  return `<!doctype html><html><head><title>Independent notes app</title></head><body>
    <h1>Notes</h1><label>Note<input aria-label="Note"></label>
    <button id="save">Save note</button><output data-testid="result">No note saved</output>
    <label><input type="checkbox" aria-label="Pinned">Pinned</label>
    <label>Category<select aria-label="Category"><option value="home">Home</option><option value="work">Work</option></select></label>
    <p id="state"></p><p id="choice"></p><p id="keys"></p><p id="late">Loading</p>
    <a href="${foreignURL}/escape">Leave this app</a>
    <a href="/redirect-out">Redirect away</a>
    <a href="/redirect-chain" target="_blank">Open redirected tab</a>
    <a href="about:blank">Clear page</a>
    <script>
      document.querySelector('#state').textContent = localStorage.getItem('saved') || 'Empty storage';
      document.querySelector('#save').onclick = () => {
        localStorage.setItem('saved', 'Stored');
        document.querySelector('output').textContent = document.querySelector('input').value;
        console.log('A note was saved');
      };
      document.querySelector('select').onchange = (event) => document.querySelector('#choice').textContent = event.target.value;
      document.querySelector('input').onkeydown = (event) => document.querySelector('#keys').textContent = event.key;
      setTimeout(() => document.querySelector('#late').textContent = 'Ready now', 80);
    </script></body></html>`;
}

before(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'qali-runner-'));
  foreignServer = createServer((_request, response) => {
    foreignHits += 1;
    response.end('Outside application');
  });
  await listen(foreignServer);
  foreignURL = `http://127.0.0.1:${foreignServer.address().port}`;
  server = createServer((request, response) => {
    hits.push(request.url);
    if (request.url === '/redirect-out') {
      response.writeHead(302, { Location: `${foreignURL}/escaped` });
      return response.end();
    }
    if (request.url === '/redirect-chain') {
      response.writeHead(302, { Location: '/redirect-out' });
      return response.end();
    }
    if (request.url === '/redirect-local') {
      response.writeHead(302, { Location: '/' });
      return response.end();
    }
    if (request.url === '/api/status') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end('{"state":"healthy"}');
    }
    if (request.url === '/broken') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      return response.end('<h1>Broken app</h1><script>throw new Error("fixture page crashed")</script>');
    }
    if (request.url === '/missing') {
      response.writeHead(404, { 'Content-Type': 'text/html' });
      return response.end('<h1>Not found</h1>');
    }
    if (request.url === '/favicon.ico') return response.end();
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(fixturePage());
  });
  await listen(server);
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => server?.close(resolve)),
    new Promise((resolve) => foreignServer?.close(resolve)),
  ]);
  await rm(projectDir, { recursive: true, force: true });
});

function config() {
  return { version: 1, name: 'Independent notes', baseURL, plan: 'qali.plan.json', outputDir: '.qali/runs', timeoutMs: 350 };
}

function planWith(steps, name = 'Fixture plan') {
  return { version: 1, name, tests: [{ id: 'home', title: 'Home behavior', steps }] };
}

function run(plan, options = {}) {
  return runPlan({ config: config(), plan, projectDir, ...options });
}

test('browser checks cannot pass without first visiting the app', () => {
  assert.throws(() => validatePlan(planWith([{action: 'expectNoPageErrors'}])), /goto/);
  assert.throws(() => validatePlan(planWith([{action: 'click', target: {role: 'button'}}, {action: 'goto', path: '/'}, {action: 'expectVisible', target: {css: 'body'}}])), /goto/);
  assert.doesNotThrow(() => validatePlan(planWith([{action: 'request', path: '/api/status', expectedStatus: 200}])));
});

test('validation rejects unknown data, ambiguous targets, missing assertions, and oversized plans', () => {
  const valid = planWith([{ action: 'goto', path: '/' }, { action: 'expectVisible', target: { role: 'heading', name: 'Notes', exact: true } }]);
  assert.equal(validatePlan(valid), valid);
  const invalid = [
    { ...valid, version: 2 },
    { ...valid, script: 'anything' },
    { ...valid, tests: [] },
    { ...valid, tests: Array.from({ length: 31 }, (_, i) => ({ ...valid.tests[0], id: `test_${i}` })) },
    { ...valid, tests: [valid.tests[0], valid.tests[0]] },
    planWith([{ action: 'goto', path: '/' }]),
    planWith([{ action: 'evaluate', value: 'process.exit()' }]),
    planWith([{ action: 'expectVisible', target: { role: 'button', css: '#save' } }]),
    planWith([{ action: 'expectVisible', target: { role: 'button', exact: 'true' } }]),
    planWith([{ action: 'expectVisible', target: { css: 'h1', name: 'Notes' } }]),
    planWith([{ action: 'expectTitle', value: 'Notes', timeout: 10000 }]),
    planWith([{ action: 'request', path: '/', expectedStatus: 600 }]),
    planWith([{ action: 'request', path: '/', expectedStatus: 200, method: 'POST' }]),
    planWith([{ action: 'expectURL', path: 'javascript:alert(1)' }]),
    planWith(Array.from({ length: 31 }, () => ({ action: 'expectTitle', value: 'Notes' }))),
  ];
  for (const value of invalid) assert.throws(() => validatePlan(value), /plan|test|step|target|field|action|path|status|version|assert/i);
});

test('malformed late steps and read-only interaction rejection happen before any HTTP request', async () => {
  const beforeCount = hits.length;
  await assert.rejects(run(planWith([
    { action: 'goto', path: '/' },
    { action: 'expectVisible', target: { css: 'h1' } },
    { action: 'click', target: { css: '#save' } },
  ])), /allow-actions/);
  await assert.rejects(run(planWith([
    { action: 'goto', path: '/' },
    { action: 'expectTitle', value: 'Notes', unexpected: true },
  ])), /field|unexpected/i);
  await assert.rejects(run(planWith([
    { action: 'goto', path: '/' },
    { action: 'expectURL', path: `${foreignURL}/escape` },
  ])), /origin|scope/i);
  assert.equal(hits.length, beforeCount);
});

test('real checks retry asynchronous expectations, fail honestly, continue tests, and save fresh evidence', async () => {
  const plan = {
    version: 1,
    name: 'Real pass and failure',
    tests: [
      { id: 'pass', title: 'Wait for ready text', steps: [
        { action: 'goto', path: '/' },
        { action: 'expectTitle', value: 'Independent notes' },
        { action: 'expectText', target: { css: '#late' }, value: 'Ready now' },
        { action: 'expectURL', path: '/' },
        { action: 'request', path: '/api/status', expectedStatus: 200, bodyContains: 'healthy' },
        { action: 'expectNoPageErrors' },
      ] },
      { id: 'fail', title: 'Intentional wrong heading', steps: [
        { action: 'goto', path: '/' },
        { action: 'expectText', target: { role: 'heading' }, value: 'Wrong heading' },
        { action: 'request', path: '/must-not-run', expectedStatus: 200 },
      ] },
      { id: 'after', title: 'Continue after failure', steps: [
        { action: 'request', path: '/api/status', expectedStatus: 200 },
      ] },
    ],
  };
  const result = await run(plan);
  assert.equal(result.report.status, 'failed');
  assert.deepEqual(result.report.counts, { passed: 2, failed: 1, total: 3 });
  assert.deepEqual(result.report.tests.map((item) => item.status), ['passed', 'failed', 'passed']);
  assert.equal(result.report.tests[1].steps.length, 2);
  assert.match(result.report.tests[1].error, /Wrong heading/);
  assert.equal(hits.includes('/must-not-run'), false);
  assert.equal(result.report.tests[0].steps.every((step) => step.status === 'passed'), true);
  const screenshot = result.report.tests[1].screenshot;
  assert.equal((await stat(path.join(result.runDir, screenshot))).size > 0, true);
  const files = await readdir(result.runDir, { recursive: true });
  assert.equal(files.some((file) => file.endsWith('.zip')), true);
  for (const file of ['report.json', 'report.md', 'report.html']) {
    assert.equal((await stat(path.join(result.runDir, file))).size > 0, true);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(result.runDir, 'report.json'), 'utf8')).counts, { passed: 2, failed: 1, total: 3 });
  assert.match(formatSummary(result.report), /2 passed.*1 failed.*3 total/s);
  assert.match(formatSummary(result.report), /Intentional wrong heading.*expectText/s);
  assert.match(formatSummary(result.report), /Wrong heading/);
  assert.match(formatSummary(result.report), /report|screenshot|trace/i);
  const html = await readFile(path.join(result.runDir, 'report.html'), 'utf8');
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /data:application\/zip;base64,/);
  const second = await run(planWith([{ action: 'request', path: '/api/status', expectedStatus: 200 }]));
  assert.notEqual(second.runDir, result.runDir);
  assert.equal(second.report.status, 'passed');
  assert.equal(path.relative(projectDir, result.runDir).startsWith('.qali/runs/'), true);
});

test('reviewed interaction actions execute and every test gets a fresh browser context', async () => {
  const result = await run({ version: 1, name: 'Interaction and isolation', tests: [
    { id: 'write', title: 'Exercise controls', steps: [
      { action: 'goto', path: '/' },
      { action: 'fill', target: { label: 'Note' }, value: 'A real note' },
      { action: 'press', target: { label: 'Note' }, key: 'Tab' },
      { action: 'expectText', target: { css: '#keys' }, value: 'Tab' },
      { action: 'click', target: { role: 'button', name: 'Save note' } },
      { action: 'expectText', target: { testId: 'result' }, value: 'A real note' },
      { action: 'check', target: { label: 'Pinned' }, checked: true },
      { action: 'expectVisible', target: { css: 'input[type=checkbox]:checked' } },
      { action: 'check', target: { label: 'Pinned' }, checked: false },
      { action: 'expectVisible', target: { css: 'input[type=checkbox]:not(:checked)' } },
      { action: 'select', target: { label: 'Category' }, value: 'work' },
      { action: 'expectText', target: { css: '#choice' }, value: 'work' },
    ] },
    { id: 'isolation', title: 'Storage is fresh', steps: [
      { action: 'goto', path: '/' },
      { action: 'expectVisible', target: { text: 'Empty storage' } },
    ] },
  ] }, { allowActions: true });
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report.tests));
  assert.deepEqual(result.report.counts, { passed: 2, failed: 0, total: 2 });
  assert.equal(result.report.tests[0].console.some((entry) => JSON.stringify(entry).includes('A note was saved')), true);
});

test('page errors and HTTP errors produce real failures', async () => {
  for (const [pathname, assertion] of [
    ['/broken', { action: 'expectNoPageErrors' }],
    ['/missing', { action: 'expectVisible', target: { css: 'h1' } }],
  ]) {
    const result = await run(planWith([{ action: 'goto', path: pathname }, assertion]));
    assert.equal(result.report.status, 'failed');
    assert.match(result.report.tests[0].error, /fixture page crashed|404/);
  }
});

test('navigation, redirected navigation, and request redirects cannot reach another origin', async () => {
  const beforeCount = foreignHits;
  for (const steps of [
    [{ action: 'goto', path: '/redirect-out' }, { action: 'expectTitle', value: 'anything' }],
    [{ action: 'goto', path: '/redirect-chain' }, { action: 'expectTitle', value: 'anything' }],
    [{ action: 'request', path: '/redirect-chain', expectedStatus: 200 }],
    [{ action: 'goto', path: '/' }, { action: 'click', target: { text: 'Leave this app' } }, { action: 'expectTitle', value: 'anything' }],
    [{ action: 'goto', path: '/' }, { action: 'click', target: { text: 'Redirect away' } }, { action: 'expectTitle', value: 'anything' }],
    [{ action: 'goto', path: '/' }, { action: 'click', target: { text: 'Open redirected tab' } }, { action: 'expectText', target: { css: '#late' }, value: 'Ready now' }],
  ]) {
    const result = await run(planWith(steps), { allowActions: true });
    assert.equal(result.report.status, 'failed');
    assert.match(result.report.tests[0].error, /origin|scope/i);
  }
  assert.equal(foreignHits, beforeCount, 'Blocked navigation must never reach the foreign server');
  const allowed = await run(planWith([
    { action: 'goto', path: '/redirect-local' },
    { action: 'expectURL', path: '/' },
    { action: 'expectVisible', target: { role: 'heading', name: 'Notes' } },
  ]));
  assert.equal(allowed.report.status, 'passed', JSON.stringify(allowed.report.tests));
});

test('HTML reports escape target-controlled values and embed screenshot evidence without scripts', async () => {
  const runDir = await mkdtemp(path.join(projectDir, 'report-'));
  const hostile = '<script>alert("unsafe")</script>&';
  const report = {
    version: 1, runId: 'fixture', project: hostile, baseURL, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    status: 'failed', counts: { passed: 0, failed: 1, total: 1 },
    tests: [{ id: 'escaped', title: hostile, status: 'failed', error: hostile, steps: [{ action: 'expectTitle', status: 'failed', error: hostile }], console: [{ type: 'log', text: hostile }] }],
  };
  await writeReports(report, runDir);
  const html = await readFile(path.join(runDir, 'report.html'), 'utf8');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.match(html, /coverage|only.*checks/i);
  assert.match(html, /Content-Security-Policy/i);
});

test('browser closes after failed tests and after runtime setup errors', async (t) => {
  const originalLaunch = chromium.launch.bind(chromium);
  const browsers = [];
  let failContext = false;
  t.mock.method(chromium, 'launch', async (...args) => {
    const browser = await originalLaunch(...args);
    browsers.push(browser);
    if (failContext) t.mock.method(browser, 'newContext', async () => { throw new Error('Fixture setup unavailable'); });
    return browser;
  });
  await run(planWith([{ action: 'goto', path: '/' }, { action: 'expectTitle', value: 'Wrong title' }]));
  assert.equal(browsers[0].isConnected(), false);
  failContext = true;
  await assert.rejects(run(planWith([{ action: 'goto', path: '/' }, { action: 'expectTitle', value: 'Anything' }])), /Fixture setup unavailable/);
  assert.equal(browsers[1].isConnected(), false);
});

test('an explicit browser path is honored and unavailable Chromium gives actionable setup guidance', async () => {
  const originalPath = process.env.QALI_BROWSER_PATH;
  process.env.QALI_BROWSER_PATH = path.join(projectDir, 'unavailable-chromium');
  try {
    await assert.rejects(
      run(planWith([{ action: 'request', path: '/api/status', expectedStatus: 200 }])),
      /Chromium could not start.*playwright install chromium.*doctor/s,
    );
  } finally {
    if (originalPath === undefined) delete process.env.QALI_BROWSER_PATH;
    else process.env.QALI_BROWSER_PATH = originalPath;
  }
});
