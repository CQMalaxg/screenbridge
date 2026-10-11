'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const DEFAULT_ROOM_TTL_MS = 15 * 60 * 1000;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[-\s]/g, '');
}

function displayCode(value) {
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function randomCode() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  });
  response.end(body);
}

function staticFile(response, filename, contentType) {
  const body = fs.readFileSync(filename);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' blob: data:; connect-src 'self' http: https: wss:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  response.end(body);
}

function createRelayServer(options = {}) {
  const now = options.now || Date.now;
  const roomTtlMs = options.roomTtlMs || DEFAULT_ROOM_TTL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || 25_000;
  const frameTimeoutMs = options.frameTimeoutMs || 7000;
  const frameMinIntervalMs = options.frameMinIntervalMs ?? 350;
  const maxFrameBytes = options.maxFrameBytes || MAX_FRAME_BYTES;
  const maxConfigBytes = options.maxConfigBytes || MAX_CONFIG_BYTES;
  const maxRooms = options.maxRooms || 10_000;
  const maxConnections = options.maxConnections || 512;
  const maxConnectionAttempts = options.maxConnectionAttempts || 120;
  const connectionWindowMs = options.connectionWindowMs || 5 * 60 * 1000;
  const maxRateLimitEntries = options.maxRateLimitEntries || 20_000;
  const trustProxy = options.trustProxy === true;
  const publicDirectory = options.publicDirectory || path.join(__dirname, 'public');
  const rooms = new Map();
  const rateLimits = new Map();
  const socketContexts = new WeakMap();
  let closed = false;

  function remoteAddress(request) {
    if (trustProxy) {
      const forwarded = String(request.headers['x-real-ip'] || '').trim();
      if (forwarded && forwarded.length <= 64) return forwarded;
    }
    return request.socket.remoteAddress || 'unknown';
  }

  function rateLimited(key, maximum, windowMs) {
    const timestamp = now();
    let entry = rateLimits.get(key);
    if (!entry || entry.expiresAt <= timestamp) {
      if (!entry && rateLimits.size >= maxRateLimitEntries) {
        const oldestKey = rateLimits.keys().next().value;
        if (oldestKey !== undefined) rateLimits.delete(oldestKey);
      }
      entry = { count: 0, expiresAt: timestamp + windowMs };
      rateLimits.set(key, entry);
    }
    entry.count += 1;
    return entry.count > maximum;
  }

  function closeRoom(room, code = 1001, reason = '配对已结束') {
    if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
    rooms.delete(room.code);
    for (const socket of [room.source, room.viewer]) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    }
  }

  function sweepExpiredRooms() {
    const timestamp = now();
    for (const room of rooms.values()) {
      if (!room.active && room.expiresAt <= timestamp) closeRoom(room, 1008, '配对码已过期');
    }
    for (const [key, entry] of rateLimits) {
      if (entry.expiresAt <= timestamp) rateLimits.delete(key);
    }
  }

  function failSocket(socket, message, closeCode = 1008) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'error', message }));
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close(closeCode, message);
    }, 20).unref?.();
  }

  function attachRole(socket, request, firstMessage) {
    let payload;
    try {
      if (firstMessage.isBinary || firstMessage.data.length > 2048) throw new Error('invalid');
      payload = JSON.parse(firstMessage.data.toString());
    } catch {
      failSocket(socket, '连接信息无效。');
      return;
    }

    if (payload.type === 'join' && rateLimited(`join:${remoteAddress(request)}`, 10, 5 * 60 * 1000)) {
      failSocket(socket, '尝试次数过多，请稍后再试。');
      return;
    }

    const code = normalizeCode(payload.code);
    if (!CODE_PATTERN.test(code)) {
      failSocket(socket, '配对码无效或已过期。');
      return;
    }
    const room = rooms.get(code);
    if (!room || (!room.active && room.expiresAt <= now())) {
      if (room) closeRoom(room, 1008, '配对码已过期');
      failSocket(socket, '配对码无效或已过期。');
      return;
    }

    if (payload.type === 'authenticate') {
      let suppliedHash;
      try {
        suppliedHash = crypto.createHash('sha256').update(String(payload.secret || '')).digest();
      } catch {
        failSocket(socket, '采集端认证失败。');
        return;
      }
      if (suppliedHash.length !== room.secretHash.length || !crypto.timingSafeEqual(suppliedHash, room.secretHash)) {
        failSocket(socket, '采集端认证失败。');
        return;
      }
      if (room.active) {
        failSocket(socket, '此配对会话已建立，请在采集端创建新的配对码。');
        return;
      }
      if (room.source && room.source !== socket && room.source.readyState === WebSocket.OPEN) {
        room.source.close(1001, '采集端重新连接');
      }
      room.source = socket;
      socketContexts.set(socket, { role: 'source', room });
      socket.send(JSON.stringify({ type: 'authenticated', expiresAt: room.expiresAt }));
      if (room.viewer && room.viewer.readyState === WebSocket.OPEN) {
        room.viewer.send(JSON.stringify({ type: 'source-connected' }));
      }
      return;
    }

    if (payload.type !== 'join') {
      failSocket(socket, '连接信息无效。');
      return;
    }
    if (!room.source || room.source.readyState !== WebSocket.OPEN) {
      failSocket(socket, '采集电脑当前未连接，请稍后再试。', 1013);
      return;
    }
    if (room.viewer && room.viewer !== socket && room.viewer.readyState === WebSocket.OPEN) {
      failSocket(socket, '该配对码已被其他查看设备使用。');
      return;
    }
    if (room.active) {
      failSocket(socket, '此配对会话已建立，请使用新的配对码。');
      return;
    }
    room.active = true;
    room.pairedAt = now();
    room.expiresAt = null;
    room.viewer = socket;
    socketContexts.set(socket, { role: 'viewer', room });
    socket.send(JSON.stringify({ type: 'joined', expiresAt: room.expiresAt }));
    room.source.send(JSON.stringify({ type: 'viewer-connected', pairedAt: room.pairedAt }));
  }

  function handleViewerMessage(socket, room, data, isBinary) {
    if (isBinary || data.length > 1024) return failSocket(socket, '请求格式无效。');
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return failSocket(socket, '请求格式无效。');
    }
    if (payload.type !== 'request-frame') return failSocket(socket, '请求类型无效。');
    const timestamp = now();
    if (room.pendingFrameId || timestamp - room.lastFrameRequestAt < frameMinIntervalMs) {
      socket.send(JSON.stringify({ type: 'busy', message: '正在获取画面，请稍候。' }));
      return;
    }
    if (!room.source || room.source.readyState !== WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'source-disconnected', message: '采集电脑已断开。' }));
      return;
    }
    const requestId = crypto.randomBytes(12).toString('hex');
    room.lastFrameRequestAt = timestamp;
    room.pendingFrameId = requestId;
    room.pendingFrameTimer = setTimeout(() => {
      room.pendingFrameId = '';
      room.pendingFrameTimer = null;
      if (room.viewer && room.viewer.readyState === WebSocket.OPEN) {
        room.viewer.send(JSON.stringify({ type: 'frame-timeout', message: '采集电脑响应超时。' }));
      }
    }, frameTimeoutMs);
    room.pendingFrameTimer.unref?.();
    room.source.send(JSON.stringify({ type: 'frame-request', requestId }));
  }

  function handleSourceMessage(socket, room, data, isBinary) {
    if (!isBinary) {
      if (data.length > maxConfigBytes) return failSocket(socket, '配置消息超过允许大小。', 1009);
      if (data.length <= maxConfigBytes) {
        try {
          const payload = JSON.parse(data.toString());
          if (payload.type === 'stop') {
            closeRoom(room, 1000, '采集端已结束共享');
            return;
          }
          if (payload.type === 'frame-error' && room.pendingFrameId && room.viewer?.readyState === WebSocket.OPEN) {
            if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
            room.pendingFrameTimer = null;
            room.pendingFrameId = '';
            room.viewer.send(JSON.stringify({ type: 'frame-error', message: String(payload.message || '采集屏幕失败').slice(0, 160) }));
            return;
          }
          if (payload.type === 'config') {
            if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
              return failSocket(socket, '配置消息无效。');
            }
            if (room.viewer?.readyState === WebSocket.OPEN) {
              room.viewer.send(JSON.stringify({ type: 'source-config', config: payload.config }));
            }
            return;
          }
        } catch {}
      }
      return failSocket(socket, '采集端只允许发送屏幕画面。');
    }
    if (data.length > maxFrameBytes) return failSocket(socket, '截图超过允许大小。', 1009);
    if (!room.pendingFrameId || !room.viewer || room.viewer.readyState !== WebSocket.OPEN) return;
    clearTimeout(room.pendingFrameTimer);
    room.pendingFrameTimer = null;
    room.pendingFrameId = '';
    room.viewer.send(JSON.stringify({ type: 'frame', contentType: 'image/jpeg', bytes: data.length }));
    room.viewer.send(data, { binary: true });
  }

  function onConnection(socket, request) {
    socketContexts.set(socket, { role: '', request, address: remoteAddress(request) });
    const authTimeout = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN && !socketContexts.get(socket)?.role) {
        failSocket(socket, '连接认证超时。');
      }
    }, 5000);
    authTimeout.unref?.();

    socket.on('message', (data, isBinary) => {
      const context = socketContexts.get(socket);
      if (!context) return;
      if (!context.role) {
        clearTimeout(authTimeout);
        attachRole(socket, context.request, { data, isBinary });
      } else if (context.role === 'viewer') {
        handleViewerMessage(socket, context.room, data, isBinary);
      } else {
        handleSourceMessage(socket, context.room, data, isBinary);
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      const context = socketContexts.get(socket);
      if (!context?.role) return;
      const { room } = context;
      if (room.active) {
        if ((context.role === 'source' && room.source === socket)
            || (context.role === 'viewer' && room.viewer === socket)) {
          closeRoom(room, 1001, context.role === 'source' ? '采集电脑已断开，配对已失效' : '查看设备已断开，配对已失效');
        }
        return;
      }
      if (context.role === 'source' && room.source === socket) {
        room.source = null;
        if (room.viewer?.readyState === WebSocket.OPEN) {
          room.viewer.send(JSON.stringify({ type: 'source-disconnected', message: '采集电脑已断开。' }));
        }
      }
      if (context.role === 'viewer' && room.viewer === socket) {
        room.viewer = null;
        room.pendingFrameId = '';
        if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
        room.pendingFrameTimer = null;
        if (room.source?.readyState === WebSocket.OPEN) {
          room.source.send(JSON.stringify({ type: 'viewer-disconnected' }));
        }
      }
    });
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/view')) {
      return staticFile(response, path.join(publicDirectory, 'index.html'), 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/viewer.js') {
      return staticFile(response, path.join(publicDirectory, 'viewer.js'), 'text/javascript; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/workbench.js') {
      return staticFile(response, path.join(publicDirectory, 'workbench.js'), 'text/javascript; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/viewer.css') {
      return staticFile(response, path.join(publicDirectory, 'viewer.css'), 'text/css; charset=utf-8');
    }
    if (request.method === 'POST' && url.pathname === '/api/pair') {
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0) {
        return json(response, 413, { error: '请求内容无效。' });
      }
      const ip = remoteAddress(request);
      if (rateLimited(`create:${ip}`, 5, 10 * 60 * 1000)) {
        return json(response, 429, { error: '创建配对码过于频繁，请稍后再试。' });
      }
      sweepExpiredRooms();
      if (rooms.size >= maxRooms) return json(response, 503, { error: '当前配对服务繁忙，请稍后再试。' });
      let code;
      do {
        code = randomCode();
      } while (rooms.has(code));
      const secret = crypto.randomBytes(32).toString('base64url');
      const expiresAt = now() + roomTtlMs;
      rooms.set(code, {
        code,
        secretHash: crypto.createHash('sha256').update(secret).digest(),
        expiresAt,
        active: false,
        pairedAt: null,
        source: null,
        viewer: null,
        pendingFrameId: '',
        pendingFrameTimer: null,
        lastFrameRequestAt: 0
      });
      return json(response, 201, { code: displayCode(code), secret, expiresAt });
    }
    return json(response, 404, { error: 'Not found' });
  });

  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: maxFrameBytes,
    perMessageDeflate: false
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
  server.on('upgrade', (request, socket, head) => {
    if (closed || new URL(request.url || '/', 'http://127.0.0.1').pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (websocketServer.clients.size >= maxConnections) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (rateLimited(`upgrade:${remoteAddress(request)}`, maxConnectionAttempts, connectionWindowMs)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: 300\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request);
    });
  });
  websocketServer.on('connection', onConnection);

  const heartbeatTimer = setInterval(() => {
    for (const socket of websocketServer.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();
  websocketServer.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
  });

  const sweepTimer = setInterval(sweepExpiredRooms, options.sweepIntervalMs || 30_000);
  sweepTimer.unref?.();

  return {
    server,
    rooms,
    async listen(port = Number(process.env.PORT || 3086), host = process.env.HOST || '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      closed = true;
      clearInterval(sweepTimer);
      clearInterval(heartbeatTimer);
      for (const room of rooms.values()) closeRoom(room);
      for (const socket of websocketServer.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.close(1001, '服务正在停止');
      }
      websocketServer.close();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
    sweepExpiredRooms
  };
}

if (require.main === module) {
  const relay = createRelayServer({ trustProxy: true });
  relay.listen().then((address) => {
    process.stdout.write(`ScreenBridge relay listening on ${address.address}:${address.port}\n`);
  }).catch((error) => {
    process.stderr.write(`ScreenBridge relay failed to start: ${error.message}\n`);
    process.exitCode = 1;
  });
  const shutdown = () => relay.close().finally(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createRelayServer };
