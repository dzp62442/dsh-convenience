import { createHash } from 'node:crypto';

// Commit a same-site document before checking the official Strict cookie.
// Never automatically repeat the exchange if the browser does not return it.
const script = `
const status = document.getElementById('status');
const help = document.getElementById('help');
const retry = document.getElementById('retry');
retry.addEventListener('click', () => location.reload());
(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('./', {
      method: 'HEAD', credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', signal: controller.signal,
    });
    if (response.status === 200) {
      location.replace('./');
      return;
    }
    status.textContent = response.status === 401
      ? '浏览器未能带回登录 Cookie'
      : '暂时无法完成登录';
    help.textContent = response.status === 401
      ? '请允许此站点保存和读取 Cookie，再点击重试。如果浏览器使用了代理或隐私扩展，也请检查它们是否移除了此站点的 Cookie。'
      : '登录检查未通过（HTTP ' + response.status + '）。请稍后重试。';
  } catch {
    status.textContent = '登录检查未完成';
    help.textContent = '连接失败或超时，请检查网络后重试。';
  } finally {
    clearTimeout(timer);
    retry.hidden = false;
  }
})();
`;
const style = `
:root { color-scheme: light dark; font: 15px/1.6 system-ui, sans-serif; }
body { margin: 0; padding: 24px; }
main { max-width: 560px; margin: 12vh auto; }
h1 { font-size: 22px; margin-bottom: 12px; }
p { opacity: .75; }
button { font: inherit; padding: 6px 18px; cursor: pointer; }
`;
const digest = value => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>正在登录 DSH</title><style>${style}</style></head><body><main>
<h1 id="status">正在登录 DSH</h1>
<p id="help">正在确认浏览器登录状态，请稍候。</p>
<button id="retry" type="button" hidden>重试</button>
<noscript><p>请允许此站点运行 JavaScript，然后刷新页面以继续。</p></noscript>
</main><script>${script}</script></body></html>`;

export function writeLoginPage(response, cookies) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; script-src ${digest(script)}; style-src ${digest(style)}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    // Preserve the official signed cookie and every security attribute verbatim.
    'set-cookie': cookies,
  });
  response.end(html);
}
