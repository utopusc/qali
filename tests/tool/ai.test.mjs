import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { generatePlan } from '../../lib/ai.mjs';

const config = { version: 1, name: 'Fixture app', baseURL: 'http://127.0.0.1:4321/', timeoutMs: 3000 };
const plan = { version: 1, name: 'Smoke', tests: [{ id: 'home', title: 'Home title', steps: [{ action: 'goto', path: '/' }, { action: 'expectTitle', value: 'Fixture' }] }] };

async function generate(args) {
  return generatePlan({ config, goal: 'Check the home page', observation: { title: 'Fixture', text: 'Welcome', controls: [] }, ...args });
}

async function provider(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

function envelope(value = plan) { return JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }); }

test('AI adapter sends the selected model and bounded app context over standard chat completions', async t => {
  let received;
  const baseURL = await provider(t, async (request, response) => {
    let raw = '';
    for await (const part of request) raw += part;
    received = { url: request.url, method: request.method, headers: request.headers, raw, body: JSON.parse(raw) };
    response.setHeader('content-type', 'application/json');
    response.end(envelope());
  });
  const result = await generate({ env: { QALI_AI_MODEL: 'local-fixture', QALI_AI_BASE_URL: `${baseURL}/` }, observation: { text: 'x'.repeat(500_000), controls: Array.from({ length: 5000 }, () => ({ tag: 'button', name: 'Go' })), hiddenPrivateData: 'DO_NOT_SEND' } });
  assert.deepEqual(result, plan);
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.method, 'POST');
  assert.equal(received.body.model, 'local-fixture');
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.body.messages[0].role, 'system');
  assert.equal(received.body.messages[1].role, 'user');
  assert.match(received.body.messages[1].content, /Check the home page/);
  assert.ok(received.raw.length < 100_000, 'page observations must be bounded before sending');
  assert.ok(!received.raw.includes('DO_NOT_SEND'), 'only documented observation fields may be sent');
  assert.equal(received.body.response_format, undefined, 'do not assume provider-specific structured output support');
});

test('AI adapter authenticates with an optional local key without placing it in the prompt', async t => {
  const secret = 'fixture-key-that-must-stay-in-header';
  let authorization;
  let raw = '';
  const baseURL = await provider(t, async (request, response) => {
    authorization = request.headers.authorization;
    for await (const part of request) raw += part;
    response.end(envelope());
  });
  await generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL, QALI_AI_API_KEY: secret } });
  assert.equal(authorization, `Bearer ${secret}`);
  assert.ok(!raw.includes(secret));
});

test('AI adapter rejects unsafe or incomplete endpoint setup before requesting a provider', async () => {
  for (const [env, pattern] of [
    [{}, /QALI_AI_MODEL/],
    [{ QALI_AI_MODEL: 'fixture' }, /QALI_AI_API_KEY/],
    [{ QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'http://example.com/v1', QALI_AI_API_KEY: 'secret' }, /https/i],
    [{ QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'https://user:secret@example.com/v1' }, /credential/i],
    [{ QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'file:///tmp/provider' }, /https|http/i],
    [{ QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'https://example.com/v1?token=secret' }, /query|fragment/i],
    [{ QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'not-a-url-secret' }, /QALI_AI_BASE_URL/],
  ]) await assert.rejects(generate({ env }), pattern);
});

test('AI adapter rejects HTTP errors without revealing response bodies or credentials', async t => {
  const baseURL = await provider(t, (_request, response) => { response.writeHead(401); response.end('upstream-private-token'); });
  await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL, QALI_AI_API_KEY: 'api-private-token' } }), error => {
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /private-token/);
    return true;
  });
});

test('AI adapter does not follow provider redirects', async t => {
  let redirectedHits = 0;
  const destination = await provider(t, (_request, response) => { redirectedHits++; response.end(envelope()); });
  const baseURL = await provider(t, (_request, response) => { response.writeHead(307, { location: `${destination}/chat/completions` }); response.end(); });
  await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL } }), /307|redirect/i);
  assert.equal(redirectedHits, 0);
});

test('AI adapter rejects malformed envelopes, malformed JSON plans, invalid plans and off-origin paths', async t => {
  const invalidPlan = { ...plan, tests: [{ id: 'unsafe', title: 'Unsafe', steps: [{ action: 'shell', command: 'private-provider-content' }] }] };
  const offOriginPlan = { ...plan, tests: [{ ...plan.tests[0], steps: [{ action: 'goto', path: 'https://external.example/' }, { action: 'expectTitle', value: 'External' }] }] };
  const payloads = ['upstream-private-content', '{}', JSON.stringify({ choices: [{ message: { content: 'not-json-private-content' } }] }), envelope(invalidPlan), envelope(offOriginPlan)];
  const baseURL = await provider(t, (_request, response) => response.end(payloads.shift()));
  for (let i = 0; i < 5; i++) {
    await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL } }), error => {
      assert.notEqual(error.code, 'ERR_ASSERTION', 'the production adapter must reject the provider response');
      assert.match(error.message, /response|plan|JSON|origin/i);
      assert.doesNotMatch(error.message, /private-content|private-provider-content/);
      return true;
    });
  }
});

test('AI adapter caps chunked response bytes instead of buffering unlimited provider output', async t => {
  const baseURL = await provider(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write(' '.repeat(180_000));
    response.end(' '.repeat(180_000));
  });
  await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL } }), /too large|size|limit/i);
});

test('AI adapter aborts a stalled provider at the caller-selected deadline', { timeout: 2000 }, async t => {
  const baseURL = await provider(t, () => {});
  const started = Date.now();
  await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: baseURL }, timeoutMs: 100 }), /timed out|timeout/i);
  assert.ok(Date.now() - started >= 90, 'the provider must be given the selected time to respond');
  assert.ok(Date.now() - started < 1500, 'deadline must terminate the real hanging request');
});

test('AI adapter rejects invalid caller-selected deadlines', async () => {
  for (const timeoutMs of [0, -1, 99, 120001, NaN, '100']) {
    await assert.rejects(generate({ env: { QALI_AI_MODEL: 'fixture', QALI_AI_BASE_URL: 'http://127.0.0.1:1/v1' }, timeoutMs }), /timeoutMs|deadline/i);
  }
});
