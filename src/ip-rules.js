import { isIP } from 'node:net';

/** Parse only IP literals, never DNS names or permissive legacy IPv4 syntax. */
export function parseIP(text) {
  if (typeof text !== 'string' || text.includes('%')) throw new Error('请输入有效的 IPv4 或 IPv6 地址，不含端口或区域标识。');
  const family = isIP(text);
  if (!family) throw new Error('请输入有效的 IPv4 或 IPv6 地址。');
  if (family === 4) {
    return { bits: 32, value: text.split('.').reduce((n, octet) => (n << 8n) | BigInt(octet), 0n) };
  }
  let expanded = text;
  if (text.includes('.')) {
    const split = text.lastIndexOf(':');
    const v4 = parseIP(text.slice(split + 1)).value;
    expanded = text.slice(0, split + 1) + (v4 >> 16n).toString(16) + ':' + (v4 & 65535n).toString(16);
  }
  const halves = expanded.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  const value = words.reduce((n, word) => (n << 16n) | BigInt('0x' + word), 0n);
  // A dual-stack Node socket reports IPv4 peers in IPv4-mapped notation.
  if (value >> 32n === 65535n) return { bits: 32, value: value & 0xffffffffn, mapped: true };
  return { bits: 128, value };
}

export function parseRule(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('IP 或范围不能为空。');
  const text = input.trim();
  if (text.includes('-')) {
    const parts = text.split('-').map(part => part.trim());
    if (parts.length !== 2) throw new Error('范围格式应为 起始IP-结束IP。');
    const start = parseIP(parts[0]);
    const end = parseIP(parts[1]);
    if (start.bits !== end.bits || start.value > end.value) throw new Error('范围两端必须属于同一地址类型，且起始地址不大于结束地址。');
    return { bits: start.bits, start: start.value, end: end.value };
  }
  const parts = text.split('/');
  if (parts.length > 2) throw new Error('CIDR 格式应为 IP/前缀长度。');
  const ip = parseIP(parts[0]);
  let prefix = ip.bits;
  if (parts.length === 2) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[1])) throw new Error('CIDR 前缀长度必须是整数。');
    prefix = Number(parts[1]);
    if (ip.mapped) {
      if (prefix < 96 || prefix > 128) throw new Error('IPv4 映射地址的前缀长度应为 96 至 128。');
      prefix -= 96;
    }
    if (prefix > ip.bits) throw new Error(`CIDR 前缀长度应为 0 至 ${ip.bits}。`);
  }
  const hostBits = BigInt(ip.bits - prefix);
  const start = (ip.value >> hostBits) << hostBits;
  return { bits: ip.bits, start, end: start + (1n << hostBits) - 1n };
}

export function compileRules(access) {
  return access.rules.map((rule, index) => {
    try { return { ...parseRule(rule.address), enabled: rule.enabled }; }
    catch (error) { throw new Error(`第 ${index + 1} 条规则：${error.message}`); }
  });
}

/** Cache by immutable volatile value identity; edits replace that identity. */
export function createMatcher(getAccess) {
  let previous;
  let ranges = [];
  return (source) => {
    const access = getAccess();
    if (!access.enabled) return false;
    if (previous !== access) {
      // Never retain old grants if a future host version bypasses validation.
      ranges = [];
      previous = access;
      try { ranges = compileRules(access).filter(rule => rule.enabled); }
      catch { return false; }
    }
    try {
      const ip = parseIP(source?.split('%')[0]);
      return ranges.some(rule => ip.bits === rule.bits && ip.value >= rule.start && ip.value <= rule.end);
    } catch { return false; }
  };
}
