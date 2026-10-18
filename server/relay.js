'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { SecurityStore, hashToken } = require('./security-store');

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

function json(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    ...headers
  });
  response.end(body);
}

function readJsonBody(request, maximumBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(Object.assign(new Error('请求内容过大。'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求格式无效。'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

function normalizedAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function requestHasSameOrigin(request, trustProxy = false, trustedProxyAddresses = new Set()) {
  const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  const origin = String(request.headers.origin || '');
  const host = String(request.headers.host || '').toLowerCase();
  const proxyIsTrusted = trustProxy
    && trustedProxyAddresses.has(normalizedAddress(request.socket.remoteAddress));
  try {
    const parsed = new URL(origin);
    if (parsed.host.toLowerCase() !== host) return false;
    if (parsed.protocol === 'https:') {
      return request.socket.encrypted === true
        || (proxyIsTrusted && String(request.headers['x-forwarded-proto'] || '').toLowerCase() === 'https');
    }
    return parsed.protocol === 'http:' && !trustProxy
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const SESSION_COOKIE = '__Host-screenbridge_session';
const CSRF_COOKIE = '__Host-screenbridge_csrf';
const SESSION_COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';
const CSRF_COOKIE_ATTRIBUTES = 'Path=/; Secure; SameSite=Strict';

function sessionCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;
}

function csrfCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return `${CSRF_COOKIE}=${token}; ${CSRF_COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;
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
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
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
  const trustedProxyAddresses = new Set((options.trustedProxyAddresses === undefined
    ? ['127.0.0.1', '::1']
    : options.trustedProxyAddresses).map(normalizedAddress).filter(Boolean));
  const publicDirectory = options.publicDirectory || path.join(__dirname, 'public');
  const stateDirectory = path.resolve(options.stateDirectory || process.env.SCREENBRIDGE_STATE_DIR || path.join(__dirname, 'state'));
  const securityStore = options.securityStore || new SecurityStore(stateDirectory, { now });
  const rooms = new Map();
  const rateLimits = new Map();
  const socketContexts = new WeakMap();
  let closed = false;

  function roomFromDevice(device) {
    return {
      code: device.code,
      secretHash: Buffer.from(device.secretHash, 'base64url'),
      resumeTokenHash: null,
      expiresAt: null,
      active: true,
      pairedAt: device.createdAt,
      source: null,
      viewer: null,
      pendingFrameId: '',
      pendingFrameTimer: null,
      lastFrameRequestAt: 0,
      persistent: true,
      deviceId: device.id,
      ownerId: device.userId
    };
  }

  for (const device of securityStore.listAllDevices()) {
    rooms.set(device.code, roomFromDevice(device));
  }

  function remoteAddress(request) {
    if (trustProxy && trustedProxyAddresses.has(normalizedAddress(request.socket.remoteAddress))) {
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

  function closeRoom(room, code = 1001, reason = '配对已结束', revokeDevice = false) {
    if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
    const shouldRevoke = revokeDevice && room.persistent;
    if (shouldRevoke) {
      try {
        securityStore.removeDeviceByCode(room.code);
      } catch {
        if (room.source?.readyState === WebSocket.OPEN) {
          room.source.send(JSON.stringify({ type: 'error', code: 'REVOKE_FAILED', message: '设备撤销未能保存，请稍后重试。' }));
        }
        return false;
      }
    }
    const sockets = [room.source, room.viewer];
    room.active = false;
    room.persistent = false;
    room.pendingFrameId = '';
    room.source = null;
    room.viewer = null;
    rooms.delete(room.code);
    for (const socket of sockets) {
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

  function failSocket(socket, message, closeCode = 1008, errorCode = '') {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'error', message, ...(errorCode ? { code: errorCode } : {}) }));
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close(closeCode, message);
    }, 20).unref?.();
  }

  function viewerUser(request, requireOrigin = false) {
    if (requireOrigin && !requestHasSameOrigin(request, trustProxy, trustedProxyAddresses)) return null;
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    return securityStore.getSession(token);
  }

  function viewerSessionIsActive(socket) {
    const context = socketContexts.get(socket);
    return Boolean(context?.role === 'viewer' && securityStore.hasActiveSessionHash(context.sessionHash));
  }

  function enforceCsrf(request, sessionContext) {
    if (!requestHasSameOrigin(request, trustProxy, trustedProxyAddresses)) return false;
    const cookies = parseCookies(request.headers.cookie);
    const cookieToken = cookies.get(CSRF_COOKIE);
    const headerToken = String(request.headers['x-csrf-token'] || '');
    return Boolean(cookieToken && headerToken && cookieToken === headerToken
      && securityStore.validateCsrf(sessionContext?.session, headerToken));
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

    if (['join', 'connect-device'].includes(payload.type)
        && rateLimited(`join:${remoteAddress(request)}`, 30, 5 * 60 * 1000)) {
      failSocket(socket, '尝试次数过多，请稍后再试。', 1008, 'RATE_LIMITED');
      return;
    }

    if (payload.type === 'authenticate') {
      const code = normalizeCode(payload.code);
      if (!CODE_PATTERN.test(code)) return failSocket(socket, '采集端认证失败。');
      let room = rooms.get(code);
      if (!room) {
        const device = securityStore.getDeviceByCode(code);
        if (device) {
          room = roomFromDevice(device);
          rooms.set(code, room);
        }
      }
      if (!room || (!room.active && room.expiresAt <= now())) {
        if (room) closeRoom(room, 1008, '配对码已过期');
        return failSocket(socket, '采集端认证失败。', 1008, payload.paired ? 'DEVICE_REVOKED' : 'PAIR_EXPIRED');
      }
      let suppliedHash;
      try {
        suppliedHash = crypto.createHash('sha256').update(String(payload.secret || '')).digest();
      } catch {
        failSocket(socket, '采集端认证失败。', 1008, room.persistent ? 'DEVICE_REVOKED' : 'PAIR_EXPIRED');
        return;
      }
      if (suppliedHash.length !== room.secretHash.length || !crypto.timingSafeEqual(suppliedHash, room.secretHash)) {
        failSocket(socket, '采集端认证失败。');
        return;
      }
      if (room.active && !room.persistent) {
        failSocket(socket, '设备会话无效，请重新绑定。');
        return;
      }
      if (room.source && room.source !== socket && room.source.readyState === WebSocket.OPEN) {
        room.source.close(1001, '采集端已自动恢复连接');
      }
      const resumed = room.active;
      room.source = socket;
      socketContexts.set(socket, { role: 'source', room, deviceId: room.deviceId || '' });
      if (room.persistent) {
        try { securityStore.touchDevice(room.deviceId); } catch {}
      }
      socket.send(JSON.stringify({ type: 'authenticated', expiresAt: room.expiresAt, resumed }));
      if (room.viewer && room.viewer.readyState === WebSocket.OPEN) {
        room.viewer.send(JSON.stringify({ type: 'source-connected', deviceId: room.deviceId || '' }));
      }
      return;
    }

    if (!['join', 'connect-device'].includes(payload.type)) {
      failSocket(socket, '连接信息无效。');
      return;
    }
    const sessionContext = viewerUser(request, true);
      if (!sessionContext) return failSocket(socket, '请先登录并从账号设备列表连接。', 1008, 'AUTH_REQUIRED');
    const user = sessionContext.user;

    if (payload.type === 'connect-device') {
      const deviceId = String(payload.deviceId || '');
      const device = securityStore.getDeviceById(deviceId, user.id);
      if (!device) return failSocket(socket, '设备不存在或无权访问。', 1008, 'DEVICE_NOT_FOUND');
      let room = rooms.get(device.code);
      if (!room) {
        room = roomFromDevice(device);
        rooms.set(device.code, room);
      }
      const previousViewer = room.viewer;
      room.viewer = socket;
      room.pendingFrameId = '';
      if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
      room.pendingFrameTimer = null;
      socketContexts.set(socket, { role: 'viewer', room, userId: user.id, sessionHash: sessionContext.session.tokenHash });
      socket.send(JSON.stringify({ type: 'joined', deviceId: room.deviceId, sourceOnline: Boolean(room.source?.readyState === WebSocket.OPEN) }));
      if (room.source?.readyState === WebSocket.OPEN) {
        room.source.send(JSON.stringify({ type: 'viewer-connected', pairedAt: room.pairedAt, resumed: true }));
      } else {
        socket.send(JSON.stringify({ type: 'source-offline', message: '采集电脑离线，等待自动重连。' }));
      }
      if (previousViewer && previousViewer !== socket && previousViewer.readyState === WebSocket.OPEN) {
        previousViewer.close(1001, '网页会话已在其他连接恢复');
      }
      return;
    }

    const code = normalizeCode(payload.code);
    if (!CODE_PATTERN.test(code)) return failSocket(socket, '配对码无效或已过期。');
    const room = rooms.get(code);
    if (!room || (!room.active && room.expiresAt <= now())) {
      if (room) closeRoom(room, 1008, '配对码已过期');
      return failSocket(socket, '配对码无效或已过期。');
    }

    if (payload.type !== 'join') return failSocket(socket, '连接信息无效。');
    if (room.persistent || room.active) return failSocket(socket, '该设备已绑定，请从账号设备列表连接。', 1008, 'DEVICE_ALREADY_BOUND');
    if (!room.source || room.source.readyState !== WebSocket.OPEN) {
      failSocket(socket, '采集电脑当前未连接，请稍后再试。', 1013);
      return;
    }
    if (room.viewer && room.viewer !== socket && room.viewer.readyState === WebSocket.OPEN) {
      failSocket(socket, '该配对码已被其他查看设备使用。');
      return;
    }
    let device;
    try {
      device = securityStore.addDevice(user.id, room.code, room.secretHash);
    } catch {
      failSocket(socket, '该设备已绑定到其他账号，无法认领。');
      return;
    }
    room.active = true;
    room.pairedAt = now();
    room.expiresAt = null;
    room.persistent = true;
    room.deviceId = device.id;
    room.ownerId = user.id;
    room.viewer = socket;
    socketContexts.set(socket, { role: 'viewer', room, userId: user.id, sessionHash: sessionContext.session.tokenHash });
    socket.send(JSON.stringify({ type: 'joined', deviceId: device.id, sourceOnline: true }));
    room.source.send(JSON.stringify({ type: 'viewer-connected', pairedAt: room.pairedAt, deviceId: device.id }));
  }

  function handleViewerMessage(socket, room, data, isBinary) {
    if (room.viewer !== socket) return;
    if (!viewerSessionIsActive(socket)) {
      socket.close(1008, '账号会话已失效');
      return;
    }
    if (isBinary || data.length > 1024) return failSocket(socket, '请求格式无效。');
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return failSocket(socket, '请求格式无效。');
    }
    if (payload.type === 'disconnect') {
      if (room.persistent) {
        room.viewer = null;
        room.pendingFrameId = '';
        if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
        room.pendingFrameTimer = null;
        if (room.source?.readyState === WebSocket.OPEN) room.source.send(JSON.stringify({ type: 'viewer-disconnected' }));
      } else {
        closeRoom(room, 1000, '查看设备已结束配对');
      }
      return;
    }
    if (payload.type !== 'request-frame') return failSocket(socket, '请求类型无效。');
    const timestamp = now();
    if (room.pendingFrameId || timestamp - room.lastFrameRequestAt < frameMinIntervalMs) {
      socket.send(JSON.stringify({ type: 'busy', message: '正在获取画面，请稍候。' }));
      return;
    }
    if (!room.source || room.source.readyState !== WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: room.persistent ? 'source-offline' : 'source-disconnected', message: '采集电脑已断开，等待自动重连。' }));
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
    if (room.source !== socket) return;
    if (!isBinary) {
      if (data.length > maxConfigBytes) return failSocket(socket, '配置消息超过允许大小。', 1009);
      if (data.length <= maxConfigBytes) {
        try {
          const payload = JSON.parse(data.toString());
          if (payload.type === 'stop') {
            closeRoom(room, 1000, '采集端已结束共享', true);
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
            if (room.viewer?.readyState === WebSocket.OPEN && viewerSessionIsActive(room.viewer)) {
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
    if (!viewerSessionIsActive(room.viewer)) {
      room.viewer.close(1008, '账号会话已失效');
      return;
    }
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
      if (context.role === 'source' && room.active && room.persistent && room.source === socket) {
        room.source = null;
        room.pendingFrameId = '';
        if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
        room.pendingFrameTimer = null;
        if (room.viewer?.readyState === WebSocket.OPEN) {
          room.viewer.send(JSON.stringify({ type: 'source-offline', message: '采集电脑离线，等待自动重连。' }));
        }
        return;
      }
      if (context.role === 'viewer' && room.active && room.viewer === socket) {
        room.viewer = null;
        room.pendingFrameId = '';
        if (room.pendingFrameTimer) clearTimeout(room.pendingFrameTimer);
        room.pendingFrameTimer = null;
        if (room.source?.readyState === WebSocket.OPEN) {
          room.source.send(JSON.stringify({ type: 'viewer-disconnected' }));
        }
        return;
      }
      if (room.active) return;
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

  async function handleHttpRequest(request, response) {
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

    if (request.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
      if (!requestHasSameOrigin(request, trustProxy, trustedProxyAddresses)) return json(response, 403, { error: '请求来源无效。' });
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return json(response, 415, { error: '请求格式无效。' });
      }
      const ip = remoteAddress(request);
      const isRegister = url.pathname.endsWith('/register');
      const maximum = isRegister ? 3 : 8;
      const windowMs = isRegister ? 10 * 60 * 1000 : 10 * 60 * 1000;
      if (rateLimited(`auth:${isRegister ? 'register' : 'login'}:${ip}`, maximum, windowMs)) {
        return json(response, 429, { error: '尝试次数过多，请稍后再试。' }, { 'Retry-After': '600' });
      }
      const body = await readJsonBody(request, 4096);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(response, 400, { error: '请求格式无效。' });
      const username = String(body.username || '').trim().toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      const accountRateLimitKey = `auth:login-user:${username}`;
      const accountRateLimited = !isRegister && rateLimited(accountRateLimitKey, 8, 15 * 60 * 1000);
      if (isRegister) {
        try {
          await securityStore.createUser(username, password);
        } catch {
          return json(response, 400, { error: '无法创建账号，请检查输入或更换账号名。' });
        }
      }
      const user = await securityStore.verifyPassword(username, password);
      if (!user) {
        return json(response, accountRateLimited ? 429 : 401, { error: '账号或密码无效。' },
          accountRateLimited ? { 'Retry-After': '900' } : {});
      }
      if (!isRegister) rateLimits.delete(accountRateLimitKey);
      const session = securityStore.createSession(user.id);
      const maxAge = Math.max(1, Math.ceil((session.expiresAt - now()) / 1000));
      return json(response, 200, { user }, {
        'Set-Cookie': [sessionCookie(session.token, maxAge), csrfCookie(session.csrfToken, maxAge)]
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      const context = viewerUser(request);
      const csrfToken = context && securityStore.validateCsrf(
        context.session,
        parseCookies(request.headers.cookie).get(CSRF_COOKIE)
      ) ? parseCookies(request.headers.cookie).get(CSRF_COOKIE) : '';
      return json(response, 200, { user: context?.user || null, csrfToken });
    }

    if (request.method === 'GET' && url.pathname === '/api/devices') {
      const context = viewerUser(request);
      if (!context) return json(response, 401, { error: '请先登录。' });
      const devices = securityStore.listDevices(context.user.id).map((device) => {
        const room = rooms.get(device.code);
        return {
          id: device.id,
          code: displayCode(device.code),
          codeHint: device.code.slice(-4),
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          online: Boolean(room?.source?.readyState === WebSocket.OPEN)
        };
      });
      return json(response, 200, { devices });
    }

    if (request.method === 'POST' && url.pathname === '/api/device/revoke') {
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return json(response, 415, { error: '请求格式无效。' });
      }
      if (request.headers.origin && !requestHasSameOrigin(request, trustProxy, trustedProxyAddresses)) return json(response, 403, { error: '请求来源无效。' });
      if (rateLimited(`device-revoke:${remoteAddress(request)}`, 8, 10 * 60 * 1000)) {
        return json(response, 429, { error: '尝试次数过多，请稍后再试。' }, { 'Retry-After': '600' });
      }
      const body = await readJsonBody(request, 4096);
      const code = normalizeCode(body?.code);
      const secret = String(body?.secret || '');
      if (!CODE_PATTERN.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
        return json(response, 401, { error: '设备认证失败。' });
      }
      const device = securityStore.getDeviceByCode(code);
      const room = rooms.get(code);
      const expectedHash = device?.secretHash || (room && Buffer.from(room.secretHash).toString('base64url'));
      const suppliedHash = crypto.createHash('sha256').update(secret).digest();
      const expectedHashBytes = expectedHash ? Buffer.from(expectedHash, 'base64url') : Buffer.alloc(0);
      if (expectedHashBytes.length !== suppliedHash.length || !crypto.timingSafeEqual(expectedHashBytes, suppliedHash)) {
        return json(response, 401, { error: '设备认证失败。' });
      }
      if (device) securityStore.removeDeviceByCode(code);
      if (room) closeRoom(room, 1008, '设备已撤销');
      return json(response, 200, { ok: true });
    }

    if ((request.method === 'POST' && url.pathname === '/api/auth/logout')
        || (request.method === 'DELETE' && /^\/api\/devices\/[0-9a-f-]{36}$/i.test(url.pathname))) {
      const context = viewerUser(request);
      if (!context) return json(response, 401, { error: '请先登录。' });
      if (!enforceCsrf(request, context)) return json(response, 403, { error: '请求校验失败，请刷新页面后重试。' });

      if (url.pathname === '/api/auth/logout') {
        securityStore.revokeSession(parseCookies(request.headers.cookie).get(SESSION_COOKIE));
        for (const socket of websocketServer.clients) {
          const socketContext = socketContexts.get(socket);
          if (socketContext?.role === 'viewer' && socketContext.sessionHash === context.session.tokenHash) {
            socket.close(1008, '账号已退出');
          }
        }
        return json(response, 200, { ok: true }, {
          'Set-Cookie': [sessionCookie('', 0), csrfCookie('', 0)]
        });
      }

      const deviceId = url.pathname.slice('/api/devices/'.length);
      const device = securityStore.removeDevice(deviceId, context.user.id);
      if (!device) return json(response, 404, { error: '设备不存在。' });
      const room = rooms.get(device.code);
      if (room) closeRoom(room, 1008, '设备已撤销');
      return json(response, 200, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/pair') {
      if (request.headers.origin && !requestHasSameOrigin(request, trustProxy, trustedProxyAddresses)) return json(response, 403, { error: '请求来源无效。' });
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
        resumeTokenHash: null,
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
  }

  const server = http.createServer((request, response) => {
    handleHttpRequest(request, response).catch((error) => {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (response.headersSent || response.destroyed) return response.destroy();
      json(response, status, { error: status === 500 ? '服务暂时无法处理请求。' : error.message });
    });
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
      const context = socketContexts.get(socket);
      if (context?.role === 'viewer' && !viewerSessionIsActive(socket)) {
        socket.close(1008, '账号会话已失效');
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
