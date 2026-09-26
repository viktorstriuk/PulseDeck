'use strict';

const fs = require('fs');
const path = require('path');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fsyncFile(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r+');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function writeFileDurable(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tmp = `${file}.${suffix}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    // renameSync is atomic on the same filesystem. On Windows an antivirus or
    // indexer can briefly hold the target; retry a few times, then fall back to
    // replacing the contents in-place rather than losing the user's settings.
    let renamed = false;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.renameSync(tmp, file);
        renamed = true;
        break;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(error?.code)) break;
      }
    }
    if (!renamed) {
      try {
        fs.copyFileSync(tmp, file);
        fsyncFile(file);
        fs.unlinkSync(tmp);
      } catch (fallbackError) {
        throw lastError || fallbackError;
      }
    }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

class JsonSettingsStore {
  constructor({ file, backupFile, legacyFiles = [], normalize = (value) => value }) {
    this.file = file;
    this.backupFile = backupFile || `${file}.bak`;
    this.legacyFiles = legacyFiles.filter(Boolean);
    this.normalize = normalize;
    this.cache = null;
    this.loadedFrom = '';
  }

  load() {
    if (this.cache) return deepClone(this.cache);
    const candidates = [this.file, this.backupFile, ...this.legacyFiles];
    let raw = null;
    let source = '';
    for (const candidate of candidates) {
      const value = readObject(candidate);
      if (value) {
        raw = value;
        source = candidate;
        break;
      }
    }
    const normalized = this.normalize(raw || {});
    this.cache = deepClone(normalized);
    this.loadedFrom = source;

    // Migrate legacy installs / recover from backup immediately so subsequent
    // launches always read one canonical file in the user's profile.
    if (source !== this.file || !source) this.persist();
    return deepClone(this.cache);
  }

  get() {
    return this.load();
  }

  set(next) {
    const previous = this.cache;
    this.cache = deepClone(this.normalize(next || {}));
    try { this.persist(); } catch (error) { this.cache = previous; throw error; }
    return deepClone(this.cache);
  }

  persist() {
    if (!this.cache) return this.load();
    const data = `${JSON.stringify(this.cache, null, 2)}\n`;
    writeFileDurable(this.file, data);
    // Keep a second fully current copy. A partial/corrupt primary file caused by
    // disk or external software can therefore recover the exact last save.
    try { writeFileDurable(this.backupFile, data); } catch {}
    return deepClone(this.cache);
  }

  flush() {
    return this.persist();
  }
}

module.exports = { JsonSettingsStore, deepClone, isPlainObject, readObject, writeFileDurable };
