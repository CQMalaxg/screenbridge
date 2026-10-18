'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_USERS = 10_000;
const MAX_SESSIONS_PER_USER = 20;
const MAX_DEVICES_PER_USER = 50;
const MAX_STATE_BYTES = 32 * 1024 * 1024;

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 12 && Buffer.byteLength(value, 'utf8') <= 128;
}

function hasExactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}

function isHash(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateState(data) {
  if (!hasExactKeys(data, ['version', 'users', 'sessions', 'devices']) || data.version !== 1
      || !Array.isArray(data.users) || data.users.length > MAX_USERS
      || !Array.isArray(data.sessions) || data.sessions.length > MAX_USERS * MAX_SESSIONS_PER_USER
      || !Array.isArray(data.devices) || data.devices.length > MAX_USERS * MAX_DEVICES_PER_USER) {
    throw new Error('Invalid security state structure');
  }
  const users = new Set();
  const usernames = new Set();
  for (const user of data.users) {
    if (!hasExactKeys(user, ['id', 'username', 'passwordSalt', 'passwordHash', 'createdAt'])
        || !/^[0-9a-f-]{36}$/i.test(user.id) || !validUsername(user.username)
        || users.has(user.id) || usernames.has(user.username) || !validTimestamp(user.createdAt)) {
      throw new Error('Invalid account record');
    }
    const salt = Buffer.from(user.passwordSalt, 'base64url');
    const passwordHash = Buffer.from(user.passwordHash, 'base64url');
    if (salt.length !== 16 || salt.toString('base64url') !== user.passwordSalt
        || passwordHash.length !== PASSWORD_HASH_BYTES || passwordHash.toString('base64url') !== user.passwordHash) {
      throw new Error('Invalid account credential record');
    }
    users.add(user.id);
    usernames.add(user.username);
  }
  const sessions = new Set();
  for (const session of data.sessions) {
    if (!hasExactKeys(session, ['tokenHash', 'csrfHash', 'userId', 'expiresAt', 'createdAt'])
        || !users.has(session.userId) || !isHash(session.tokenHash) || !isHash(session.csrfHash)
        || sessions.has(session.tokenHash) || !validTimestamp(session.expiresAt) || !validTimestamp(session.createdAt)) {
      throw new Error('Invalid session record');
    }
    sessions.add(session.tokenHash);
  }
  const deviceIds = new Set();
  const codes = new Set();
  const ownerCounts = new Map();
  for (const device of data.devices) {
    if (!hasExactKeys(device, ['id', 'userId', 'code', 'secretHash', 'createdAt', 'lastSeenAt'])
        || !/^[0-9a-f-]{36}$/i.test(device.id) || !users.has(device.userId)
        || !/^[A-HJ-NP-Z2-9]{8}$/.test(device.code) || !isHash(device.secretHash)
        || deviceIds.has(device.id) || codes.has(device.code)
        || !validTimestamp(device.createdAt) || !validTimestamp(device.lastSeenAt)) {
      throw new Error('Invalid device record');
    }
    const count = (ownerCounts.get(device.userId) || 0) + 1;
    if (count > MAX_DEVICES_PER_USER) throw new Error('Too many devices for one account');
    ownerCounts.set(device.userId, count);
    deviceIds.add(device.id);
    codes.add(device.code);
  }
}

class SecurityStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.filename = path.join(this.directory, 'security-state.json');
    this.now = options.now || Date.now;
    this.data = { version: 1, users: [], sessions: [], devices: [] };
    this.userCreations = new Set();
    this.dummySalt = crypto.randomBytes(16);
    this.dummyHash = crypto.randomBytes(PASSWORD_HASH_BYTES);
    this.load();
  }

  load() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try {
      const directoryStat = fs.lstatSync(this.directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Invalid security state directory');
      if (process.platform !== 'win32') fs.chmodSync(this.directory, 0o700);
      const stat = fs.lstatSync(this.filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid security state file');
      if (stat.size > MAX_STATE_BYTES) throw new Error('Security state file is too large');
      if (process.platform !== 'win32') fs.chmodSync(this.filename, 0o600);
      const parsed = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      validateState(parsed);
      this.data = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw new Error(`Unable to load ScreenBridge security state: ${error.message}`);
    }
  }

  persist() {
    validateState(this.data);
    const stateText = JSON.stringify(this.data);
    if (Buffer.byteLength(stateText, 'utf8') > MAX_STATE_BYTES) throw new Error('Security state file is too large');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const tempPath = path.join(this.directory, `.security-state-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const fileDescriptor = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fileDescriptor, stateText, 'utf8');
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    try {
      fs.renameSync(tempPath, this.filename);
      if (process.platform !== 'win32') fs.chmodSync(this.filename, 0o600);
      try {
        const directoryFd = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch {}
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
  }

  async passwordHash(password, salt) {
    return scrypt(password, salt, PASSWORD_HASH_BYTES, PASSWORD_SCRYPT);
  }

  findUserByUsername(username) {
    return this.data.users.find((user) => user.username === normalizeUsername(username)) || null;
  }

  publicUser(user) {
    return user ? { id: user.id, username: user.username } : null;
  }

  async createUser(usernameInput, password) {
    const username = normalizeUsername(usernameInput);
    if (!validUsername(username)) throw new Error('账号需为 3 至 32 位字母、数字、点、下划线或连字符。');
    if (!validPassword(password)) throw new Error('密码需为 12 至 128 个 UTF-8 字节。');
    if (this.findUserByUsername(username) || this.userCreations.has(username)) throw new Error('账号或密码无效。');
    if (this.data.users.length >= MAX_USERS) throw new Error('暂时无法创建账号。');
    this.userCreations.add(username);
    try {
      const salt = crypto.randomBytes(16);
      const passwordHash = await this.passwordHash(password, salt);
      if (this.findUserByUsername(username)) throw new Error('账号或密码无效。');
      const user = {
        id: crypto.randomUUID(),
        username,
        passwordSalt: salt.toString('base64url'),
        passwordHash: passwordHash.toString('base64url'),
        createdAt: this.now()
      };
      this.data.users.push(user);
      try {
        this.persist();
      } catch (error) {
        this.data.users.pop();
        throw error;
      }
      return this.publicUser(user);
    } finally {
      this.userCreations.delete(username);
    }
  }

  async verifyPassword(usernameInput, password) {
    const user = this.findUserByUsername(usernameInput);
    const salt = user ? Buffer.from(user.passwordSalt, 'base64url') : this.dummySalt;
    const expected = user ? Buffer.from(user.passwordHash, 'base64url') : this.dummyHash;
    const inputValid = validPassword(password);
    const boundedPassword = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 128 ? password : '';
    const supplied = await this.passwordHash(boundedPassword, salt);
    return inputValid && user && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
      ? this.publicUser(user)
      : null;
  }

  createSession(userId) {
    if (!this.data.users.some((user) => user.id === userId)) throw new Error('Unknown account');
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const session = {
      tokenHash: hashToken(token),
      csrfHash: hashToken(csrfToken),
      userId,
      expiresAt: this.now() + SESSION_TTL_MS,
      createdAt: this.now()
    };
    const previousSessions = this.data.sessions;
    let sessions = previousSessions.filter((entry) => entry.expiresAt > this.now());
    const userSessions = sessions.filter((entry) => entry.userId === userId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      const oldest = userSessions.reduce((selected, entry) => entry.createdAt < selected.createdAt ? entry : selected);
      sessions = sessions.filter((entry) => entry !== oldest);
    }
    this.data.sessions = [...sessions, session];
    try {
      this.persist();
    } catch (error) {
      this.data.sessions = previousSessions;
      throw error;
    }
    return { token, csrfToken, expiresAt: session.expiresAt };
  }

  getSession(token) {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);
    const session = this.data.sessions.find((entry) => safeEqual(entry.tokenHash, tokenHash) && entry.expiresAt > this.now());
    if (!session) return null;
    const user = this.data.users.find((entry) => entry.id === session.userId);
    return user ? { user: this.publicUser(user), session } : null;
  }

  hasActiveSessionHash(tokenHash) {
    return Boolean(tokenHash && this.data.sessions.some((session) =>
      session.expiresAt > this.now() && safeEqual(session.tokenHash, tokenHash)));
  }

  validateCsrf(session, csrfToken) {
    return Boolean(session && csrfToken && safeEqual(session.csrfHash, hashToken(csrfToken)));
  }

  revokeSession(token) {
    const tokenHash = hashToken(token || '');
    const previousSessions = this.data.sessions;
    const sessions = previousSessions.filter((entry) => !safeEqual(entry.tokenHash, tokenHash));
    if (sessions.length === previousSessions.length) return;
    this.data.sessions = sessions;
    try { this.persist(); } catch (error) {
      this.data.sessions = previousSessions;
      throw error;
    }
  }

  addDevice(userId, code, secretHash) {
    const normalizedSecretHash = Buffer.isBuffer(secretHash) ? secretHash.toString('base64url') : String(secretHash || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(normalizedSecretHash)) throw new Error('设备密钥摘要格式无效。');
    const existing = this.data.devices.find((device) => device.code === code);
    if (existing) {
      if (existing.userId !== userId || !safeEqual(existing.secretHash, normalizedSecretHash)) throw new Error('设备已被其他账号绑定。');
      return { ...existing };
    }
    if (this.data.devices.filter((device) => device.userId === userId).length >= MAX_DEVICES_PER_USER) {
      throw new Error('此账号绑定的设备数量已达上限。');
    }
    const device = {
      id: crypto.randomUUID(),
      userId,
      code,
      secretHash: normalizedSecretHash,
      createdAt: this.now(),
      lastSeenAt: this.now()
    };
    this.data.devices.push(device);
    try { this.persist(); } catch (error) {
      this.data.devices.pop();
      throw error;
    }
    return { ...device };
  }

  getDeviceByCode(code) {
    const device = this.data.devices.find((entry) => entry.code === code) || null;
    return device ? { ...device } : null;
  }

  getDeviceById(id, userId) {
    const device = this.data.devices.find((entry) => entry.id === id && entry.userId === userId) || null;
    return device ? { ...device } : null;
  }

  listDevices(userId) {
    return this.data.devices
      .filter((device) => device.userId === userId)
      .map((device) => ({ id: device.id, code: device.code, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }));
  }

  listAllDevices() {
    return this.data.devices.map((device) => ({ ...device }));
  }

  touchDevice(id) {
    const device = this.data.devices.find((entry) => entry.id === id);
    if (!device) return false;
    const previousLastSeenAt = device.lastSeenAt;
    device.lastSeenAt = this.now();
    try { this.persist(); } catch (error) {
      device.lastSeenAt = previousLastSeenAt;
      throw error;
    }
    return true;
  }

  removeDevice(id, userId) {
    const index = this.data.devices.findIndex((entry) => entry.id === id && entry.userId === userId);
    if (index < 0) return null;
    const previousDevices = this.data.devices;
    const device = previousDevices[index];
    this.data.devices = previousDevices.filter((_, entryIndex) => entryIndex !== index);
    try { this.persist(); } catch (error) {
      this.data.devices = previousDevices;
      throw error;
    }
    return { ...device };
  }

  removeDeviceByCode(code) {
    const index = this.data.devices.findIndex((entry) => entry.code === code);
    if (index < 0) return null;
    const previousDevices = this.data.devices;
    const device = previousDevices[index];
    this.data.devices = previousDevices.filter((_, entryIndex) => entryIndex !== index);
    try { this.persist(); } catch (error) {
      this.data.devices = previousDevices;
      throw error;
    }
    return { ...device };
  }
}

module.exports = {
  PASSWORD_SCRYPT,
  SecurityStore,
  hashToken,
  normalizeUsername,
  safeEqual,
  validPassword,
  validUsername
};
