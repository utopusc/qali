import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../../bin/qali.mjs', import.meta.url));
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', value => stdout += value);
    child.stderr.on('data', value => stderr += value);
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI did not finish within 25 seconds')); }, 25_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', status => { clearTimeout(timer); resolve({status, stdout, stderr}); });
  });
}
async function setup(t) {
  const project = await mkdtemp(path.join(tmpdir(), 'qali user project '));
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'content-type': 'text/html'});
    const logs = req.url === '/noisy' ? '<script>for(let i=0;i<100;i++)console.log("x".repeat(2000));</script>' : '';
    res.end('<!doctype html><title>Independent shop</title><h1>Welcome to my shop</h1><label>Search products<input></label><button>Search</button>' + logs);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(project, {recursive: true, force: true}); });
  return {project, url: `http://127.0.0.1:${server.address().port}`};
}

test('a new user can initialize, inspect, pass checks, detect a real failure and read the latest summary', async t => {
  const {project, url} = await setup(t);
  let result = await run(['init', '--project', project, '--url', url]);
  assert.equal(result.status, 0, result.stderr);
  result = await run(['inspect', '--project', project]);
  assert.equal(result.status, 0, result.stderr);
  const observation = JSON.parse(await readFile(path.join(project, '.qali/inspection.json'), 'utf8'));
  assert.equal(observation.title, 'Independent shop');
  result = await run(['run', '--project', project]);
  assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(await readFile(path.join(project, '.qali/latest.json'), 'utf8'));
  const firstReport = JSON.parse(await readFile(path.join(project, first.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(firstReport.counts, {passed: 2, failed: 0, total: 2});
  await writeFile(path.join(project, 'reviewed.json'), JSON.stringify({version: 1, name: 'Visible heading', tests: [
    {id: 'HEADING', title: 'Correct welcome heading', steps: [{action: 'goto', path: '/'}, {action: 'expectText', target: {role: 'heading'}, value: 'Welcome to a different app'}]},
  ]}));
  // A failed assertion should be a recorded result, not a successful exit or setup error.
  const config = JSON.parse(await readFile(path.join(project, 'qali.config.json'), 'utf8'));config.timeoutMs = 500;
  await writeFile(path.join(project, 'qali.config.json'), JSON.stringify(config));
  result = await run(['run', '--project', project, '--plan', 'reviewed.json']);
  assert.equal(result.status, 1, result.stderr);
  const latest = JSON.parse(await readFile(path.join(project, '.qali/latest.json'), 'utf8'));
  assert.notEqual(latest.runDir, first.runDir);
  const report = JSON.parse(await readFile(path.join(project, latest.runDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');assert.equal(report.counts.failed, 1);
  result = await run(['summary', '--project', project]);
  assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /fail/i);assert.match(result.stdout, /Correct welcome heading/);
});

test('summary handles a valid report with substantial console evidence', async t => {
  const {project, url} = await setup(t);
  await run(['init', '--project', project, '--url', url + '/noisy']);
  let result = await run(['run', '--project', project]);
  assert.equal(result.status, 0, result.stderr);
  const latest = JSON.parse(await readFile(path.join(project, '.qali/latest.json'), 'utf8'));
  const contents = await readFile(path.join(project, latest.runDir, 'report.json'));
  assert.ok(contents.length > 256 * 1024, 'Fixture must exceed the config/plan size limit');
  result = await run(['summary', '--project', project]);
  assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /PASSED/);
});

test('a failed later attempt never presents an earlier passing run as current success', async t => {
  const {project, url} = await setup(t);
  await run(['init', '--project', project, '--url', url]);
  let result = await run(['run', '--project', project]);
  assert.equal(result.status, 0, result.stderr);
  result = await run(['run', '--project', project], {QALI_BROWSER_PATH: path.join(project, 'missing-chromium')});
  assert.equal(result.status, 2);
  result = await run(['summary', '--project', project]);
  assert.match(result.stdout + result.stderr, /incomplete|could not start/i);
  assert.doesNotMatch(result.stdout, /PASSED/);
});

test('a rejected plan invalidates the latest success even before a browser run starts', async t => {
  const {project, url} = await setup(t);
  await run(['init', '--project', project, '--url', url]);
  assert.equal((await run(['run', '--project', project])).status, 0);
  await writeFile(path.join(project, 'qali.plan.json'), '{invalid');
  const rejected = await run(['run', '--project', project]);
  assert.equal(rejected.status, 2);
  const summary = await run(['summary', '--project', project]);
  assert.equal(summary.status, 2);
  assert.match(summary.stdout, /INCOMPLETE/);
  assert.match(summary.stdout, /Invalid JSON/);
  assert.doesNotMatch(summary.stdout, /PASSED/);
});

test('repairing configuration cannot make an older passing run look like the current result', async t => {
  const {project, url} = await setup(t);
  await run(['init', '--project', project, '--url', url]);
  assert.equal((await run(['run', '--project', project])).status, 0);
  const configPath = path.join(project, 'qali.config.json');
  const originalConfig = await readFile(configPath, 'utf8');
  await writeFile(configPath, JSON.stringify({...JSON.parse(originalConfig), timeoutMs: -1}));
  assert.equal((await run(['run', '--project', project])).status, 2);
  await writeFile(configPath, originalConfig);
  const result = await run(['summary', '--project', project]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /INCOMPLETE/);
  assert.match(result.stdout, /timeoutMs/);
  assert.doesNotMatch(result.stdout, /PASSED/);
});

test('direct AI command saves a reviewable draft and never changes the active plan', async t => {
  const {project, url} = await setup(t);
  await run(['init', '--project', project, '--url', url]);
  const original = await readFile(path.join(project, 'qali.plan.json'), 'utf8');
  let requests = 0;
  const proposed = {version: 1, name: 'Generated proposal', tests: [{id: 'TITLE', title: 'Shop title', steps: [{action: 'goto', path: '/'}, {action: 'expectTitle', value: 'Independent shop'}]}]};
  const provider = http.createServer((req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(proposed)}}]}));
  });
  provider.listen(0, '127.0.0.1');await once(provider, 'listening');
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
  const env = {QALI_AI_MODEL: 'protocol-fixture', QALI_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`};
  const args = ['plan', '--ai', '--project', project, '--goal', 'The shop has the expected title'];
  let result = await run(args, env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, 'qali.plan.draft.json'), 'utf8')), proposed);
  assert.equal(await readFile(path.join(project, 'qali.plan.json'), 'utf8'), original);
  result = await run(args, env);
  assert.equal(result.status, 2);assert.equal(requests, 1, 'An existing draft must be rejected before another paid request');
});
