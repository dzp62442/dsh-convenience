import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createMatcher } from '../src/ip-rules.js';
import { startProxy, allowedRequest, shouldAutoAuthenticate } from '../src/proxy.js';

const listener = { host: '127.0.0.1', port: 3080, aliases: ['localhost'] };
const req = (url = '/', source = '127.0.0.1', headers = {}) => ({ method: 'GET', url, headers: { host: '127.0.0.1:3080', ...headers }, socket: { remoteAddress: source } });
test('source rules never block official authentication; authority and target remain checked', () => {
  assert.ok(allowedRequest(req('/', '192.0.2.1'), listener));
  for (const host of ['evil.example:3080', '127.0.0.1:3081']) assert.equal(allowedRequest(req('/', '127.0.0.1', { host }), listener), false);
  for (const url of ['//evil.example/', 'http://evil.example/', '/\\evil.example/']) assert.equal(allowedRequest(req(url), listener), false);
  assert.ok(allowedRequest(req('/oauth/callback?state=s&code=c', '192.0.2.1', { origin: 'https://platform.deepseek.com', 'sec-fetch-site': 'cross-site' }), listener));
  assert.ok(allowedRequest(req('/', '::1', { host: '[0:0:0:0:0:0:0:1]:3080' }), { ...listener, host: '::1', aliases: [] }));
  for (const host of ['localhost', 'LOCALHOST:80']) assert.ok(allowedRequest(req('/', '127.0.0.1', { host }), { ...listener, port: 80 }));
  for (const host of ['evil@127.0.0.1:3080', '127.0.0.1:3080/path']) assert.equal(allowedRequest(req('/', '127.0.0.1', { host }), listener), false);
});

test('auto-login only for a matched, trusted, unauthenticated GET home page', () => {
  const connection = { isTrusted: request => !request.headers.origin, requestRejection: () => 401 };
  const match = ip => ip === '127.0.0.1';
  for (const url of ['/', '/index.html']) assert.ok(shouldAutoAuthenticate(req(url), connection, match));
  for (const url of ['/?token=manual', '/api/test', '/oauth/callback?state=s', '/assets/app.js']) assert.equal(shouldAutoAuthenticate(req(url), connection, match), false);
  assert.equal(shouldAutoAuthenticate(req('/', '192.0.2.1', { 'x-forwarded-for': '127.0.0.1' }), connection, match), false);
  assert.equal(shouldAutoAuthenticate(req('/', '127.0.0.1', { origin: 'https://evil.example' }), connection, match), false);
  assert.equal(shouldAutoAuthenticate({ ...req(), method: 'POST' }, connection, match), false);
  for (const status of [undefined, 403]) assert.equal(shouldAutoAuthenticate(req(), { ...connection, requestRejection: () => status }, match), false);
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
test('real HTTP proxy handles rule changes, cookie fallback, OAuth, streaming and cleanup', async (t) => {
  const seen = [];
  const backend = http.createServer((request, response) => {
    seen.push({ path: request.url, headers: request.headers });
    if (request.url.includes('token=test-only')) {
      response.writeHead(303, { 'set-cookie': 'test-auth=ok; HttpOnly; SameSite=Strict; Path=/', location: './' });
      response.end();
    } else if (request.url.startsWith('/oauth/callback')) { response.writeHead(400); response.end('official callback validation'); }
    else if (request.headers.cookie === 'test-auth=ok' || request.url === '/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); response.write('first\n'); setTimeout(() => response.end('second\n'), 15);
    } else { response.writeHead(401); response.end('official authentication required'); }
  });
  const backendPort = await listen(backend);
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  let access = { enabled: true, rules: [{ enabled: true, address: '127.0.0.1', remark: '' }] };
  const connection = {
    isTrusted: request => !request.headers.origin || request.headers.origin === `http://127.0.0.1:${port}`,
    requestRejection: request => request.headers.cookie === 'test-auth=ok' ? undefined : 401,
    authenticatedUrl: url => url + '?token=test-only',
  };
  const close = await startProxy({ upstream: `http://127.0.0.1:${backendPort}`, listeners: [{ ...listener, port }], connection, matches: createMatcher(() => access), logger: { info() {}, warn() {}, error() {} } });
  t.after(close);
  const request = (source = '127.0.0.1', path = '/', headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path, localAddress: source, headers, method, agent: false }, incoming => {
      let body = ''; incoming.setEncoding('utf8'); incoming.on('data', chunk => body += chunk);
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  const landing = await request();
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.location, undefined);
  assert.equal(landing.headers['cache-control'], 'no-store');
  assert.deepEqual(landing.headers['set-cookie'], ['test-auth=ok; HttpOnly; SameSite=Strict; Path=/']);
  assert.match(landing.body, /浏览器未能带回登录 Cookie/);
  assert.ok(!landing.body.includes('test-only') && !landing.body.includes('test-auth=ok'));
  // A browser that withholds cookies gets one 401 probe, never another login redirect.
  const probeDenied = await request('127.0.0.1', '/', {}, 'HEAD');
  assert.equal(probeDenied.status, 401);
  assert.equal(probeDenied.headers.location, undefined);
  assert.equal(probeDenied.headers['set-cookie'], undefined);
  assert.equal((await request('127.0.0.1', '/', { cookie: 'test-auth=ok' }, 'HEAD')).status, 200);
  assert.equal((await request('127.0.0.1', '/', { cookie: 'test-auth=ok' })).body, 'first\nsecond\n');
  // Explicit official launch links retain their own token exchange behavior.
  assert.equal((await request('127.0.0.1', '/?token=test-only')).status, 303);
  assert.equal((await request('127.0.0.2')).status, 401);
  assert.equal((await request('127.0.0.2', '/', { cookie: 'test-auth=ok' })).status, 200);
  assert.equal((await request('127.0.0.2', '/?token=test-only')).status, 303);
  assert.equal((await request('127.0.0.2', '/', { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1' })).status, 401);
  assert.equal(seen.at(-1).headers['x-forwarded-for'], undefined);
  assert.equal(seen.at(-1).headers.forwarded, undefined);
  assert.equal((await request('127.0.0.1', '/', { origin: 'https://evil.example' })).status, 401);
  const callback = '/oauth/callback?state=unchanged&code=unchanged';
  assert.equal((await request('127.0.0.2', callback, { origin: 'https://platform.deepseek.com', 'sec-fetch-site': 'cross-site' })).status, 400);
  assert.equal(seen.at(-1).path, callback);
  assert.equal(seen.at(-1).headers.origin, 'https://platform.deepseek.com');
  access = { ...access, rules: [{ enabled: true, address: '127.0.0.2', remark: '' }] };
  assert.equal((await request()).status, 401);
  assert.equal((await request('127.0.0.2')).status, 200);
  access = { ...access, enabled: false };
  assert.equal((await request('127.0.0.2')).status, 401);
  assert.equal((await request('127.0.0.2', '/stream')).body, 'first\nsecond\n');
  assert.equal((await request('127.0.0.2', '/', { host: 'evil.example' })).status, 403);
  await close();
  const rebound = http.createServer();
  await new Promise((resolve, reject) => { rebound.once('error', reject); rebound.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => rebound.close(resolve));
});
