import test from 'node:test';
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import { Config } from '../src/config.js';
import { parseIP, parseRule, createMatcher } from '../src/ip-rules.js';

const access = (addresses, enabled = true) => ({ enabled, rules: addresses.map(address => ({ enabled: true, address, remark: '' })) });
test('IPv4 CIDR and explicit ranges include exactly their boundaries', () => {
  const matches = createMatcher(() => rules);
  const rules = access(['192.0.2.0/24', '192.168.1.10 - 192.168.1.30']);
  for (const ip of ['192.0.2.0', '192.0.2.255', '192.168.1.10', '192.168.1.30']) assert.ok(matches(ip));
  for (const ip of ['192.0.1.255', '192.0.3.0', '192.168.1.9', '192.168.1.31', undefined]) assert.equal(matches(ip), false);
  assert.deepEqual(parseRule('192.168.1.42/24'), parseRule('192.168.1.0/24'));
  const all = access(['0.0.0.0/0']);
  assert.ok(createMatcher(() => all)('255.255.255.255'));
});

test('IPv6 literals, compression, CIDR, ranges and mapped IPv4', () => {
  const rules = access(['::1', '2001:db8::/64', 'fd00::10-fd00::20', '192.0.2.1']);
  const matches = createMatcher(() => rules);
  for (const ip of ['::1', '0:0:0:0:0:0:0:1', '2001:db8::ffff:ffff:ffff:ffff', 'fd00::10', 'fd00::20', '::ffff:192.0.2.1', '::FFFF:c000:201']) assert.ok(matches(ip), ip);
  for (const ip of ['::2', '2001:db8:0:1::', 'fd00::f', 'fd00::21', '::ffff:192.0.2.2']) assert.equal(matches(ip), false, ip);
  assert.deepEqual(parseRule('::ffff:192.0.2.0/120'), parseRule('192.0.2.0/24'));
  assert.equal(parseIP('::192.0.2.1').bits, 128);
  assert.equal(parseRule('::/0').end, (1n << 128n) - 1n);
  assert.equal(parseRule('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128').start, (1n << 128n) - 1n);
});

test('invalid syntax and reversed or mixed-family ranges fail closed', () => {
  for (const value of ['', '*', 'localhost', '10.1.1.999', '127.1', '0x7f000001', '012.1.1.1', '1.1.1.1:80', 'fe80::1%eth0', '1.1.1.1/33', '::/129', '::ffff:192.0.2.1/80', '1.1.1.1/-1', '1.1.1.1/1.5', '1.1.1.1/024', '1.1.1.1/24/24', '1.1.1.2-1.1.1.1', '::1-1.1.1.1', '::-::1-::2']) {
    assert.throws(() => parseRule(value), undefined, value);
  }
});

test('live replacements, empty lists, individual disable and master disable', () => {
  let rules = access(['127.0.0.1']);
  const matches = createMatcher(() => rules);
  assert.ok(matches('127.0.0.1'));
  rules = access(['127.0.0.2']);
  assert.equal(matches('127.0.0.1'), false);
  assert.ok(matches('127.0.0.2'));
  rules = { ...rules, rules: [{ ...rules.rules[0], enabled: false }] };
  assert.equal(matches('127.0.0.2'), false);
  rules = access(['127.0.0.1'], false);
  assert.equal(matches('127.0.0.1'), false);
  rules = access([]);
  assert.equal(matches('127.0.0.1'), false);
  rules = access(['bad']);
  assert.equal(matches('127.0.0.1'), false);
  assert.equal(matches('127.0.0.1'), false);
});

test('host validation rejects invalid rules before persistence; wire schema remains rehydratable', () => {
  const validate = input => Config['~standard'].validate(input);
  assert.equal(validate({}).issues, undefined);
  assert.match(validate({ access: access(['bad']) }).issues[0].message, /第 1 条规则/);
  for (const host of ['0.0.0.0', '::', '::ffff:0.0.0.0', 'hostname']) assert.ok(validate({ listeners: [{ host }] }).issues);
  assert.ok(validate({ listeners: [{ host: '127.0.0.1', aliases: ['bad:80'] }] }).issues);
  const schema = new z(JSON.parse(JSON.stringify(Config.toJSON())));
  assert.equal(schema({ access: access(['192.0.2.0/24']) }).access.get().rules[0].address, '192.0.2.0/24');
});
