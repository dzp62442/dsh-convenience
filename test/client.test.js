import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

let client;
vm.runInNewContext(readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load({ factory }) { client = factory(createRequire(import.meta.url)); } } }, structuredClone,
});
function setup() {
  let state = { status: 'ready', writable: true, revision: 1, value: { access: { enabled: true, rules: [{ enabled: true, address: '127.0.0.1', remark: '本机' }] } } };
  const subscribers = new Set();
  const writes = [];
  const notify = () => { for (const subscriber of subscribers) subscriber(); };
  const form = {
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    getSnapshot() { return state; },
    async mutate(ops, revision) {
      writes.push({ ops, revision });
      if (revision !== state.revision) return false;
      state = { ...state, revision: state.revision + 1, value: { access: structuredClone(ops[0].value) } };
      notify(); return true;
    },
  };
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(client.AccessSettings, { view: 'page', accessForm: form })); });
  return { renderer, writes, form, externalChange() { state = { ...state, revision: state.revision + 1 }; notify(); } };
}
const button = (root, text) => root.findAllByType('button').find(node => node.children.join('') === text);

test('Chinese settings UI adds, edits, annotates, disables, deletes and saves rules', async () => {
  const { renderer, writes } = setup();
  const root = renderer.root;
  act(() => button(root, '＋ 添加规则').props.onClick());
  await act(async () => { await button(root, '保存设置').props.onClick(); });
  assert.equal(writes.length, 0, 'empty rule is refused');
  act(() => root.findByProps({ 'aria-label': '第 2 条规则的 IP 或范围' }).props.onChange({ target: { value: ' 192.0.2.0/24 ' } }));
  act(() => root.findByProps({ 'aria-label': '第 2 条规则的备注' }).props.onChange({ target: { value: '测试网段' } }));
  act(() => root.findByProps({ 'aria-label': '启用第 1 条规则' }).props.onChange({ target: { checked: false } }));
  await act(async () => { await button(root, '保存设置').props.onClick(); });
  assert.equal(writes[0].revision, 1);
  assert.equal(writes[0].ops[0].value.rules[1].address, '192.0.2.0/24');
  assert.equal(writes[0].ops[0].value.rules[1].remark, '测试网段');
  assert.equal(writes[0].ops[0].value.rules[0].enabled, false);
  act(() => root.findByProps({ 'aria-label': '删除第 1 条规则' }).props.onClick());
  await act(async () => { await button(root, '保存设置').props.onClick(); });
  assert.equal(writes[1].ops[0].value.rules.length, 1);
  act(() => renderer.unmount());
});

test('concurrent update preserves draft and blocks stale overwrites until discard', () => {
  const { renderer, externalChange, writes } = setup();
  act(() => button(renderer.root, '＋ 添加规则').props.onClick());
  act(externalChange);
  assert.equal(button(renderer.root, '保存设置').props.disabled, true);
  assert.equal(writes.length, 0);
  act(() => button(renderer.root, '放弃修改并重新读取').props.onClick());
  assert.equal(renderer.root.findAllByProps({ 'aria-label': '删除第 2 条规则' }).length, 0);
  act(() => renderer.unmount());
});

test('opening the installed bundle detail selects and renders its editable settings', async () => {
  const registered = [];
  const disposers = [];
  const { form, writes, renderer: directRenderer } = setup();
  act(() => directRenderer.unmount());
  client.apply({
    configForms: { get: ns => { assert.equal(ns, 'convenience'); return form; }, whileServed: (ids, callback) => { assert.deepEqual([...ids], ['convenience']); return callback(); } },
    slots: { inject: (name, callback) => { assert.equal(name, 'plugins.bundle.config'); return callback(); }, register: (entry, component) => { registered.push({ entry, component }); return () => registered.pop(); } },
    effect: callback => disposers.push(callback()),
  });
  // Mirrors the official PackageDetail contract: keyed by package name,
  // not a list id or the host namespace. Owner props must not hide our form.
  const selected = registered.find(({ entry }) => entry.name === 'plugins.bundle.config' && entry.key === 'dsh-convenience');
  assert.ok(selected, 'the installed bundle detail must have a settings entry');
  let rendered;
  act(() => { rendered = TestRenderer.create(React.createElement(selected.component, { ...selected.entry.inject(), view: 'page', form: undefined })); });
  assert.equal(rendered.root.findByType('h2').children.join(''), '可信 IP 免登录');
  act(() => rendered.root.findByProps({ 'aria-label': '第 1 条规则的备注' }).props.onChange({ target: { value: '详情页保存验证' } }));
  await act(async () => { await button(rendered.root, '保存设置').props.onClick(); });
  assert.equal(writes[0].ops[0].value.rules[0].remark, '详情页保存验证');
  act(() => rendered.unmount());
  disposers.forEach(dispose => dispose());
  assert.equal(registered.length, 0);
});
