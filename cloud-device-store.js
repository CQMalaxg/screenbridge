'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAME = 'cloud-device.json';

function validateCredentials(value) {
  return Boolean(value && typeof value === 'object'
    && /^[A-HJ-NP-Z2-9]{8}$/.test(value.code)
    && /^[A-Za-z0-9_-]{43}$/.test(value.secret)
    && Number.isFinite(value.expiresAt));
}

class CloudDeviceStore {
  constructor(directory, safeStorage) {
    this.directory = path.resolve(directory);
    this.filename = path.join(this.directory, FILE_NAME);
    this.safeStorage = safeStorage;
  }

  assertEncryptionAvailable() {
    if (!this.safeStorage?.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，已停止保存设备凭据。');
    }
  }

  load() {
    let file;
    try {
      const stat = fs.lstatSync(this.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid credential file');
      file = fs.readFileSync(this.filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('无法读取本机设备凭据。');
    }
    try {
      const envelope = JSON.parse(file);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.version !== 1) {
        throw new Error('invalid');
      }
      if (envelope.disabled === true
          && Object.keys(envelope).length === 2 && Object.hasOwn(envelope, 'version')) return null;
      if (typeof envelope.encrypted !== 'string'
          || Object.keys(envelope).length !== 2 || !Object.hasOwn(envelope, 'version')) throw new Error('invalid');
      this.assertEncryptionAvailable();
      const plaintext = this.safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'));
      const credentials = JSON.parse(plaintext);
      if (!validateCredentials(credentials)) throw new Error('invalid');
      return credentials;
    } catch {
      throw new Error('本机设备凭据无法解密或格式无效，请从网页端撤销旧设备后重新配对。');
    }
  }

  save(credentials) {
    if (!validateCredentials(credentials)) throw new Error('设备凭据格式无效。');
    this.assertEncryptionAvailable();
    const encrypted = this.safeStorage.encryptString(JSON.stringify(credentials)).toString('base64');
    this.writeEnvelope({ version: 1, encrypted });
  }

  writeEnvelope(value) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = fs.lstatSync(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('本机设备凭据目录无效。');
    if (process.platform !== 'win32') fs.chmodSync(this.directory, 0o700);
    const envelope = JSON.stringify(value);
    const temporary = path.join(this.directory, `.cloud-device-${crypto.randomBytes(12).toString('hex')}.tmp`);
    let fileDescriptor = null;
    try {
      fileDescriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fileDescriptor, envelope, 'utf8');
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = null;
      fs.renameSync(temporary, this.filename);
      if (process.platform !== 'win32') fs.chmodSync(this.filename, 0o600);
      try {
        const directoryFd = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch {}
    } catch (error) {
      if (fileDescriptor !== null) {
        try { fs.closeSync(fileDescriptor); } catch {}
      }
      try { fs.unlinkSync(temporary); } catch {}
      throw new Error(`无法安全保存本机设备凭据：${error.message}`);
    }
  }

  clear() {
    this.writeEnvelope({ version: 1, disabled: true });
  }
}

module.exports = { CloudDeviceStore, FILE_NAME, validateCredentials };
