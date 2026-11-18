import z from '@deepseek-ai/schemastery';
import { compileRules, parseIP } from './ip-rules.js';

export const Config = z.object({
  access: z.object({
    enabled: z.boolean().default(true).description('启用可信 IP 免登录'),
    rules: z.array(z.object({
      enabled: z.boolean().default(true).description('启用此规则'),
      address: z.string().required().description('IP、CIDR 网段或起止范围'),
      remark: z.string().default('').description('备注'),
    })).default([
      { enabled: true, address: '127.0.0.1', remark: '本机 IPv4' },
      { enabled: true, address: '::1', remark: '本机 IPv6' },
    ]).max(1000).description('免登录规则'),
  }).volatile().description('可信 IP 访问'),
  // These are deployment settings. Changing listeners requires a plugin reload.
  listeners: z.array(z.object({
    host: z.string().required(),
    port: z.number().min(1).max(65535).step(1).default(3080),
    aliases: z.array(z.string()).default([]),
    waitForAddress: z.boolean().default(false),
  })).default([{ host: '127.0.0.1', port: 3080, aliases: ['localhost'] }]),
});

// Keep the wire schema plain so the official browser can rehydrate it.
// The host's Standard Schema validation additionally checks semantic IP ranges
// before ConfigEditor persists anything (also during startup and reload).
const standard = Config['~standard'];
Object.defineProperty(Config, '~standard', { value: {
  ...standard,
  validate(input) {
    const result = standard.validate(input);
    if (result.issues) return result;
    try {
      compileRules(result.value.access.get());
      const seen = new Set();
      for (const listener of result.value.listeners) {
        const ip = parseIP(listener.host);
        if (ip.value === 0n || ip.mapped) throw new Error('监听地址须为具体的本机接口 IP，不能是全接口或 IPv4 映射地址。');
        const key = `${listener.host}:${listener.port}`;
        if (seen.has(key)) throw new Error('监听地址和端口不能重复。');
        seen.add(key);
        if (listener.aliases.some(alias => !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(alias))) throw new Error('访问别名须为主机名，不含协议或端口。');
      }
      return result;
    } catch (error) { return { issues: [{ message: error.message }] }; }
  },
} });
