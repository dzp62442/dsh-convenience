import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { writeLoginPage } from '../src/login-page.js';

function page() {
  const result = {};
  writeLoginPage({
    writeHead(status, headers) { Object.assign(result, { status, headers }); },
    end(body) { result.body = body; },
  }, ['test-auth=opaque; HttpOnly; SameSite=Strict; Path=/']);
  return result;
}

test('login landing keeps credentials out of HTML and permits only its own script and style', () => {
  const { headers, body } = page();
  assert.ok(!body.includes('opaque'));
  assert.equal(headers['content-length'], Buffer.byteLength(body));
  for (const tag of ['script', 'style']) {
    const source = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    const hash = createHash('sha256').update(source).digest('base64');
    assert.ok(headers['content-security-policy'].includes(`${tag}-src 'sha256-${hash}'`));
  }
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('landing probes once and navigates only after official cookie authentication succeeds', async () => {
  const source = page().body.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const outcome of [200, 401, 403, 'network-error']) {
    const elements = new Map(['status', 'help', 'retry'].map(id => [id, {
      textContent: '', hidden: true, addEventListener() {},
    }]));
    const requests = [], navigations = [];
    let cleared = false;
    await vm.runInNewContext(source, {
      document: { getElementById: id => elements.get(id) },
      location: { replace: url => navigations.push(url) },
      AbortController,
      setTimeout() { return 1; },
      clearTimeout() { cleared = true; },
      fetch: async (url, options) => {
        requests.push({ url, options });
        if (outcome === 'network-error') throw new Error('network');
        return { status: outcome };
      },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, './');
    assert.equal(requests[0].options.method, 'HEAD');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.redirect, 'error');
    assert.deepEqual(navigations, outcome === 200 ? ['./'] : []);
    assert.ok(cleared);
    if (outcome !== 200) assert.equal(elements.get('retry').hidden, false);
    if (outcome === 401) assert.match(elements.get('status').textContent, /Cookie/);
  }
});
