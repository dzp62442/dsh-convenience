import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const inject = ['slots', 'configForms'];
const description = '管理可信 IP 免登录规则；未命中的访问继续使用 DSH 官方鉴权。';
const styles = `
.dsh-convenience { max-width: 860px; color: inherit; font-size: 14px; line-height: 1.45; container: dsh-convenience / inline-size; }
.dsh-convenience h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.35; font-weight: 600; }
.dsh-convenience p { margin: 6px 0; }
.dsh-convenience .muted { opacity: .7; font-size: 12px; }
.dsh-convenience .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 14px 0 8px; }
.dsh-convenience .rule { display: grid; grid-template-columns: auto minmax(0, 3fr) minmax(0, 2fr) auto; grid-template-areas: 'toggle address remark delete'; align-items: end; gap: 10px; padding: 10px 12px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 8px; margin-bottom: 8px; }
.dsh-convenience .rule-toggle { grid-area: toggle; display: flex; align-items: center; gap: 5px; min-height: 32px; white-space: nowrap; }
.dsh-convenience .field { display: grid; min-width: 0; gap: 4px; font-size: 12px; }
.dsh-convenience .field-address { grid-area: address; }
.dsh-convenience .field-remark { grid-area: remark; }
.dsh-convenience .rule-delete { grid-area: delete; }
.dsh-convenience input[type=checkbox] { margin: 0 3px 0 0; vertical-align: middle; }
.dsh-convenience input[type=text] { width: 100%; min-width: 0; height: 32px; box-sizing: border-box; padding: 5px 8px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; color: inherit; background: transparent; font: inherit; font-size: 13px; }
.dsh-convenience button { min-height: 32px; padding: 5px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 13px; line-height: 1.4; }
.dsh-convenience button.primary { background: #3669d6; border-color: #3669d6; color: white; }
.dsh-convenience button.danger { color: #cf4545; }
.dsh-convenience button:disabled { opacity: .45; cursor: default; }
.dsh-convenience input:focus-visible, .dsh-convenience button:focus-visible { outline: 2px solid #6084e8; outline-offset: 2px; }
.dsh-convenience .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.dsh-convenience .notice { padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, currentColor 5%, transparent); }
.dsh-convenience .help { margin: 0 0 10px; }
.dsh-convenience .help summary { cursor: pointer; width: fit-content; }
.dsh-convenience .help p { overflow-wrap: anywhere; }
.dsh-convenience .error { color: #cf4545; }
.dsh-convenience fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
@container dsh-convenience (max-width: 600px) {
  .dsh-convenience .rule { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'toggle delete' 'address address' 'remark remark'; gap: 8px; }
  .dsh-convenience .rule-delete { justify-self: end; }
}
`;

export function AccessSettings({ view, accessForm: form }) {
  const state = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form));
  const [draft, setDraft] = useState(null);
  const [revision, setRevision] = useState();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    if (!dirty && state.value) {
      setDraft(structuredClone(state.value.access));
      setRevision(state.revision);
    }
  }, [state.value, state.revision, dirty]);
  if (view === 'summary') return description;
  const conflict = dirty && revision !== state.revision;
  const edit = (next) => { setDraft(next); setDirty(true); setError(''); setMessage(''); };
  const editRule = (index, patch) => edit({ ...draft, rules: draft.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
  const discard = () => { setDirty(false); setError(''); setMessage('已重新读取当前设置。'); };
  const save = async () => {
    if (inFlight.current || !draft || conflict) return;
    if (draft.rules.some(rule => !rule.address.trim())) { setError('请填写每条规则的 IP 或范围，或删除空白规则。'); return; }
    inFlight.current = true;
    setSaving(true); setError(''); setMessage('');
    try {
      const access = { ...draft, rules: draft.rules.map(rule => ({ ...rule, address: rule.address.trim(), remark: rule.remark.trim() })) };
      const accepted = await form.mutate([{ op: 'set', path: ['access'], value: access }], revision);
      if (accepted) { setDirty(false); setMessage('已保存并立即生效。'); }
      else setError('保存未被接受：请检查 IP、网段和起止顺序；配置若已被其他页面修改，请先重新读取。');
    } catch { setError('保存失败，请检查连接后重试。你的修改仍保留在页面中。'); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <section className="dsh-convenience" aria-label="DSH 便捷工具设置">
    <style>{styles}</style>
    <h2>可信 IP 免登录</h2>
    <p className="muted">未命中的访问继续使用 DSH 官方鉴权。</p>
    {state.status !== 'ready' || !draft ? <p role="status">{state.status === 'loading' ? '正在读取设置…' : '插件暂不可配置，请检查它是否已启用。'}</p> : <>
      {!state.writable && <p className="notice">当前部署的配置为只读。</p>}
      <fieldset disabled={!state.writable || saving}>
        <div className="toolbar">
          <label><input type="checkbox" checked={draft.enabled} onChange={event => edit({ ...draft, enabled: event.target.checked })} /> 启用可信 IP 免登录</label>
          <span className="muted">{draft.rules.filter(rule => rule.enabled).length} / {draft.rules.length} 条规则已启用</span>
        </div>
        <details className="help muted">
          <summary>支持 IPv4、IPv6、网段和范围 · 查看示例</summary>
          <p>例如：192.168.1.8、192.168.1.0/24、192.168.1.10-192.168.1.30、fd00::/64。</p>
        </details>
        {draft.rules.length === 0 && <p className="notice">暂无规则，所有访问均使用官方鉴权。</p>}
        {draft.rules.map((rule, index) => <div className="rule" key={index}>
          <label className="rule-toggle"><input type="checkbox" aria-label={`启用第 ${index + 1} 条规则`} checked={rule.enabled} onChange={event => editRule(index, { enabled: event.target.checked })} /> 规则 {index + 1}</label>
          <label className="field field-address">IP 或范围<input type="text" aria-label={`第 ${index + 1} 条规则的 IP 或范围`} value={rule.address} placeholder="192.168.1.0/24" spellCheck={false} onChange={event => editRule(index, { address: event.target.value })} /></label>
          <label className="field field-remark">备注<input type="text" aria-label={`第 ${index + 1} 条规则的备注`} value={rule.remark} placeholder="例如：家中的可信设备" onChange={event => editRule(index, { remark: event.target.value })} /></label>
          <button className="danger rule-delete" type="button" aria-label={`删除第 ${index + 1} 条规则`} onClick={() => edit({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}>删除</button>
        </div>)}
        <button type="button" disabled={draft.rules.length >= 1000} onClick={() => edit({ ...draft, rules: [...draft.rules, { enabled: true, address: '', remark: '' }] })}>＋ 添加规则</button>
      </fieldset>
      <div className="actions">
        <button className="primary" type="button" disabled={!state.writable || !dirty || saving || conflict || state.status !== 'ready'} onClick={save}>{saving ? '保存中…' : '保存设置'}</button>
        <button type="button" disabled={!dirty || saving} onClick={discard}>放弃修改并重新读取</button>
        {dirty && <span className="muted">有未保存的修改</span>}
      </div>
      {conflict && <p role="alert" className="error">配置已在其他页面更新。请先重新读取，再进行修改，避免覆盖他人的设置。</p>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <p className="notice muted">规则只影响自动登录，已有登录状态仍然有效。验证新规则请用无痕窗口。</p>
  </section>;
}

export function apply(ctx) {
  const form = ctx.configForms.get('convenience');
  // Third-party bundle detail pages render this keyed slot. plugins.item is
  // reserved for separate official cards and is absent from bundle details.
  ctx.effect(() => ctx.configForms.whileServed(['convenience'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-convenience',
    inject: () => ({ accessForm: form }),
  }, AccessSettings))), 'convenience.settings');
}
