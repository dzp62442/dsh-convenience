import http from 'node:http';
import { writeLoginPage } from './login-page.js';

export function allowedRequest(request, listener) {
  const authority = request.headers.host;
  if (typeof authority !== 'string' || /[\\/?#@\s]/u.test(authority)
      || !request.url?.startsWith('/') || request.url.startsWith('//')) return false;
  // Network admission belongs here; route-specific validation belongs to DSH.
  // In particular, OAuth callbacks use state/PKCE, not the API origin fence.
  try {
    const origin = new URL(`http://${authority}`).origin;
    const origins = [listener.host, ...listener.aliases].map(host =>
      new URL(`http://${host.includes(':') ? `[${host}]` : host}:${listener.port}`).origin);
    return origins.includes(origin) && new URL(request.url, origin).origin === origin;
  }
  catch { return false; }
}

export function shouldAutoAuthenticate(request, connection, matches) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  return matches(request.socket.remoteAddress) && request.method === 'GET' && ['/', '/index.html'].includes(url.pathname)
    && !url.searchParams.has('token')
    && connection.isTrusted(request) && connection.requestRejection(request) === 401;
}

function reject(response, status) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(http.STATUS_CODES[status]);
}

function rejectUpgrade(socket, status) {
  socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function upstreamHeaders(request) {
  const headers = { ...request.headers };
  for (const key of Object.keys(headers)) {
    if (key === 'forwarded' || key.startsWith('x-forwarded-') || key.startsWith('proxy-')) delete headers[key];
  }
  return headers;
}

export async function startProxy({ upstream: origin, listeners, connection, matches, logger }) {
  const upstream = new URL(origin);
  if (upstream.hostname !== '127.0.0.1' || upstream.protocol !== 'http:'
      || listeners.some(listener => listener.port === Number(upstream.port || 80))) {
    throw new Error('请将官方 DSH HTTP 服务绑定到 127.0.0.1，并使用不同于插件的端口。');
  }
  const servers = new Set();
  const sockets = new Set();
  const timers = new Set();
  let disposed = false;
  const track = (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const options = (request, path = request.url) => ({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path,
    headers: upstreamHeaders(request),
    agent: false,
  });

  const createListener = (listener) => {
    const server = http.createServer((request, response) => {
      if (!allowedRequest(request, listener)) return reject(response, 403);
      let path = request.url;
      const url = new URL(path, `http://${request.headers.host}`);
      const autoAuthenticate = shouldAutoAuthenticate(request, connection, matches);
      if (autoAuthenticate) {
        // Only a matching source gets an automatic login. Nonmatches pass through.
        // The launch token travels solely to the loopback backend; the official
        // handler issues its normal signed cookie. A same-site landing document
        // checks that the browser returns it before entering the application.
        url.pathname = '/';
        const authenticated = new URL(connection.authenticatedUrl(url.href));
        path = authenticated.pathname + authenticated.search;
      }
      const outgoing = http.request(options(request, path), (incoming) => {
        incoming.on('error', () => response.destroy());
        if (autoAuthenticate && incoming.statusCode === 303
            && incoming.headers['set-cookie']?.length) {
          incoming.resume();
          writeLoginPage(response, incoming.headers['set-cookie']);
          return;
        }
        response.writeHead(incoming.statusCode, incoming.rawHeaders);
        response.flushHeaders();
        incoming.pipe(response);
      });
      outgoing.on('socket', track);
      outgoing.on('error', () => {
        if (!response.headersSent && !response.destroyed) reject(response, 502);
        else response.destroy();
      });
      request.on('aborted', () => outgoing.destroy());
      request.on('error', () => outgoing.destroy());
      response.on('close', () => outgoing.destroy());
      request.pipe(outgoing);
    });
    server.on('connection', track);
    server.on('upgrade', (request, socket, head) => {
      socket.on('error', () => socket.destroy());
      if (!allowedRequest(request, listener)) return rejectUpgrade(socket, 403);
      // The official gateway still checks the browser cookie on every upgrade.
      const outgoing = http.request(options(request));
      outgoing.on('socket', track);
      outgoing.on('upgrade', (incoming, backend, backendHead) => {
        const headers = incoming.rawHeaders;
        let response = `HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n`;
        for (let i = 0; i < headers.length; i += 2) response += `${headers[i]}: ${headers[i + 1]}\r\n`;
        socket.write(response + '\r\n');
        if (backendHead.length) socket.write(backendHead);
        if (head.length) backend.write(head);
        backend.on('error', () => socket.destroy());
        socket.on('close', () => backend.destroy());
        backend.on('close', () => socket.destroy());
        socket.pipe(backend).pipe(socket);
      });
      outgoing.on('response', (incoming) => {
        rejectUpgrade(socket, incoming.statusCode);
        incoming.resume();
      });
      outgoing.on('error', () => rejectUpgrade(socket, 502));
      socket.on('close', () => outgoing.destroy());
      outgoing.end();
    });
    return server;
  };

  const close = async () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await Promise.all([...servers].map((server) => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })));
    servers.clear();
  };

  const bind = async (listener, waiting = false) => {
    const { host, port, waitForAddress } = listener;
    if (disposed) return;
    const server = createListener(listener);
    servers.add(server);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', (error) => logger.warn(`监听器异常: ${error.code ?? 'unknown'}`));
      logger.info(`网页入口已就绪：http://${host.includes(':') ? `[${host}]` : host}:${port}/`);
    } catch (error) {
      servers.delete(server);
      server.close();
      if (waitForAddress && error.code === 'EADDRNOTAVAIL') {
        // Keep localhost working when EasyTier starts late; retry only binding.
        if (!waiting) logger.info(`等待网络接口地址：${host}`);
        const timer = setTimeout(() => {
          timers.delete(timer);
          bind(listener, true).catch((failure) => logger.error(failure.message));
        }, 5000);
        timers.add(timer);
        return;
      }
      throw new Error(`无法监听 ${host}:${port}: ${error.code ?? 'unknown error'}`);
    }
  };

  try {
    for (const listener of listeners) await bind(listener);
  } catch (error) {
    await close();
    throw error;
  }
  return close;
}
