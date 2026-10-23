import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { inspectPage } from '../../lib/inspect.mjs';

async function inspect(baseURL) {
  return inspectPage({ config: { version: 1, name: 'Fixture app', baseURL, timeoutMs: 3000 } });
}

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Inspector reads rendered page structure without capturing input, textarea or editable values', async t => {
  const baseURL = await serve(t, (_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Fixture shop</title><h1>Welcome shopper</h1><button data-testid="browse">Browse</button><label for="email">Email address</label><input id="email" value="private-email@example.test"><label for="password">Password</label><input id="password" type="password" value="secret-password"><textarea aria-label="Notes">private-textarea-value</textarea><div contenteditable="true" aria-label="Editor">private-editor-value</div><input type="hidden" value="hidden-secret"><script>document.body.insertAdjacentHTML("beforeend", "<a href=/help>Help center</a>")</script><p hidden>hidden-page-data</p>');
  });
  const observation = await inspect(`${baseURL}/`);
  assert.deepEqual(Object.keys(observation).sort(), ['controls', 'text', 'title', 'url']);
  assert.equal(observation.url, `${baseURL}/`);
  assert.equal(observation.title, 'Fixture shop');
  assert.match(observation.text, /Welcome shopper/);
  assert.ok(observation.controls.some(control => control.role === 'heading' && control.name === 'Welcome shopper'));
  assert.ok(observation.controls.some(control => control.name === 'Browse' && control.testId === 'browse'));
  assert.ok(observation.controls.some(control => control.label === 'Email address'));
  assert.ok(observation.controls.some(control => control.name === 'Help center'));
  assert.doesNotMatch(JSON.stringify(observation), /private-email|secret-password|private-textarea|private-editor|hidden-secret|hidden-page-data|insertAdjacentHTML/);
});

test('Inspector bounds page text, titles and controls', async t => {
  const baseURL = await serve(t, (_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>${'T'.repeat(10_000)}</title><p>${'Page text '.repeat(50_000)}</p><button>${'B'.repeat(2000)}</button>${Array.from({ length: 1000 }, (_, i) => `<button data-testid="button-${i}">Button ${i}</button>`).join('')}`);
  });
  const observation = await inspect(baseURL);
  assert.ok(observation.text.length <= 12_000);
  assert.ok(observation.title.length <= 512);
  assert.ok(observation.controls.length <= 100);
  assert.ok(JSON.stringify(observation).length < 100_000);
  for (const control of observation.controls) for (const value of Object.values(control)) if (typeof value === 'string') assert.ok(value.length <= 256);
});

test('Inspector omits nested editable values from ancestor names, wrapping labels and referenced labels', async t => {
  const baseURL = await serve(t, (_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Private form</title><div role="group">Account<div contenteditable="true">nested-editor-secret</div></div><label>Notes<textarea>wrapped-textarea-secret</textarea></label><textarea id="private-label-source">referenced-textarea-secret</textarea><button aria-labelledby="private-label-source">Fallback</button><div role="group">Public <span hidden>hidden-name-secret</span></div>');
  });
  const observation = await inspect(baseURL);
  assert.doesNotMatch(JSON.stringify(observation), /nested-editor-secret|wrapped-textarea-secret|referenced-textarea-secret|hidden-name-secret/);
  assert.ok(observation.controls.some(control => control.label === 'Notes'));
  assert.ok(observation.controls.some(control => control.name === 'Account'));
});

test('Inspector blocks off-origin redirects before the destination receives a request', async t => {
  let destinationHits = 0;
  const destination = await serve(t, (_request, response) => { destinationHits++; response.end('<title>External</title>'); });
  const baseURL = await serve(t, (_request, response) => { response.writeHead(302, { location: `${destination}/outside` }); response.end(); });
  await assert.rejects(inspect(baseURL), /outside|origin|navigation/i);
  assert.equal(destinationHits, 0);
});

test('Inspector permits same-origin redirects but blocks a later redirect out of the origin', async t => {
  let destinationHits = 0;
  const destination = await serve(t, (_request, response) => { destinationHits++; response.end('External'); });
  const baseURL = await serve(t, (request, response) => {
    if (request.url === '/home') { response.setHeader('content-type', 'text/html'); response.end('<title>Home</title><p>Actual home</p>'); }
    else { response.writeHead(302, { location: request.url === '/chain' ? `${destination}/outside` : request.url === '/unsafe' ? '/chain' : '/home' }); response.end(); }
  });
  const observation = await inspect(baseURL);
  assert.equal(observation.url, `${baseURL}/home`);
  assert.match(observation.text, /Actual home/);
  await assert.rejects(inspect(`${baseURL}/unsafe`), /outside|origin|navigation/i);
  assert.equal(destinationHits, 0);
});

test('Inspector rejects unsupported URL schemes without launching a page', async () => {
  await assert.rejects(inspect('file:///etc/passwd'), /http|URL/i);
  await assert.rejects(inspect('https://user:private-pass@example.com'), /credential/i);
});
