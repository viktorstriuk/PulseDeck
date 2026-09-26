'use strict';
const I18n = require("../i18n");

// One owner for a helper process, all of its streams, its queue and its timers.
// Do not add a process-wide uncaughtException handler: unrelated defects must
// remain visible. A dead helper must never take down the music player.
const { spawn: nodeSpawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const COMMAND_TYPES = new Set(['bind', 'config', 'state', 'visual', 'audio', 'probe']);
const MAX_LINE_BYTES = 1024 * 1024;
const RETRY_DELAYS = [500, 1500, 4000, 10000];

class OverlayHostTransport {
  constructor(options) {
    if (!options || typeof options.executable !== 'string') throw new TypeError(I18n.t("GameOverlayExecutableIsRequired"));
    this.executable = options.executable;
    this.spawn = options.spawn || nodeSpawn;
    this.exists = options.exists || fs.existsSync;
    this.platform = options.platform || process.platform;
    this.clock = options.clock || { now: () => Date.now(), setTimeout, clearTimeout };
    this.onMessage = options.onMessage || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.log = options.log || (() => {});
    this.retryDelays = options.retryDelays || RETRY_DELAYS;
    this.startupMs = options.startupMs ?? 8000;
    this.stallMs = options.stallMs ?? 5000;
    this.heartbeatMs = options.heartbeatMs ?? 15000;
    this.stableMs = options.stableMs ?? 60000;
    this.stopMs = options.stopMs ?? 350;
    this.enabled = false;
    this.disposed = false;
    this.session = null;
    this.generation = 0;
    this.retryCount = 0;
    this.retryTimer = null;
    this.metrics = { sent: 0, coalesced: 0, failures: 0, launches: 0 };
  }

  _timer(fn, ms) { const timer = this.clock.setTimeout(fn, ms); timer?.unref?.(); return timer; }
  _clear(timer) { if (timer !== null && timer !== undefined) this.clock.clearTimeout(timer); }
  _record(event, fields = {}) {
    // Never log command payloads, audio samples, song metadata or passwords.
    try { this.log({ event, generation: this.generation, ...fields }); } catch {}
  }
  _status(patch) {
    const translation=patch.reason && I18n.recentTranslations?.get(patch.reason);
    this.onStatus(translation ? {...patch,reasonKey:translation.key,reasonParams:translation.params} : patch);
  }
  _inactive(reason, patch = {}) {
    this._status({ running: false, active: false, renderer: 'none', hostPid: 0,
      candidates: [], foreground: null, rtss: { running: false, hooked: false }, reason, ...patch });
  }
  _current(s) { return this.session === s && !s.closed; }

  start() {
    if (this.disposed) return false;
    if (!this.enabled) { this.enabled = true; this.retryCount = 0; }
    if (this.session) return !this.session.stopping && !this.session.failed;
    if (this.retryTimer || this.retryCount > this.retryDelays.length) return false;
    return this._launch();
  }

  restart() {
    if (this.disposed) return false;
    this.enabled = true;
    this.retryCount = 0;
    this._clear(this.retryTimer); this.retryTimer = null;
    // Do not race a still-alive old process (the Windows helper owns a mutex).
    if (this.session) { this._stopSession(this.session); return true; }
    return this._launch();
  }

  stop() {
    this.enabled = false;
    this._clear(this.retryTimer); this.retryTimer = null;
    this.retryCount = 0;
    if (this.session) this._stopSession(this.session);
    this._inactive(I18n.t("GameOverlayNativeModuleStopped"), { restarting: false, retryAttempt: 0 });
  }

  dispose() { this.stop(); this.disposed = true; }

  _launch() {
    if (!this.enabled || this.disposed || this.session) return false;
    if (this.platform !== 'win32') {
      this.enabled = false;
      this._inactive(I18n.t("GameOverlayGameOverlayIsOnlySupportedOnWindows"));
      return false;
    }
    if (!this.exists(this.executable)) {
      this.enabled = false;
      this._inactive(I18n.t("GameOverlayPulseDeckGameOverlayHostExeWasNotFound"), { lastError: 'ENOENT' });
      this._record('missing-helper');
      return false;
    }
    const s = { generation: ++this.generation, child: null, ready: false, failed: false,
      stopping: false, closed: false, queue: new Map(), inFlight: false, blocked: false,
      buffer: '', stderr: '', startup: null, stall: null, watchdog: null, kill: null,
      stable: null, lastMessageAt: this.clock.now(), exitCode: null, signal: null };
    this.session = s;
    try {
      const child = this.spawn(this.executable, [], { cwd: path.dirname(this.executable),
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      s.child = child;
      this.metrics.launches++;
      // Attach stream error handlers before doing ANY write, including 'stop'.
      // Keep them on the retiring process, so a delayed error is still handled.
      for (const [name, stream] of [['stdin', child.stdin], ['stdout', child.stdout], ['stderr', child.stderr]]) {
        stream?.on('error', error => this._fail(s, error, name));
      }
      child.on('error', error => this._fail(s, error, 'process'));
      child.on('exit', (code, signal) => {
        s.exitCode = code; s.signal = signal;
        if (this._current(s) && !s.stopping) this._fail(s,
          Object.assign(I18n.error("GameOverlayHelperHasExited"), { code: 'HELPER_EXIT' }), 'exit');
      });
      child.on('close', (code, signal) => this._closed(s, code, signal));
      child.stdin?.on('close', () => {
        if (!s.stopping) this._fail(s, Object.assign(I18n.error("GameOverlayInputChannelIsClosed"), { code: 'PIPE_CLOSED' }), 'stdin-close');
      });
      child.stdin?.on('finish', () => {
        if (!s.stopping) this._fail(s, Object.assign(I18n.error("GameOverlayInputChannelHasEnded"), { code: 'PIPE_FINISHED' }), 'stdin-finish');
      });
      child.stdin?.on('drain', () => {
        if (!this._current(s) || s.failed) return;
        s.blocked = false; this._pump(s);
      });
      child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', chunk => this._read(s, chunk));
      child.stderr?.on('data', chunk => {
        if (!this._current(s)) return;
        s.stderr = (s.stderr + String(chunk)).slice(-4096);
        // No raw stderr in the persistent log: native diagnostics can include
        // a user's file paths. Keep a short transient tail for the status UI.
        this._status({ lastError: s.stderr.slice(-1200) });
      });
      if (!child.stdin || !child.stdout || !child.stderr) throw I18n.error("GameOverlayCouldNotCreateTheHelperChannels");
      this._record('launch', { pid: child.pid || 0 });
      this._status({ running: true, active: false, renderer: 'none', hostPid: child.pid || 0,
        restarting: false, retryAttempt: this.retryCount, reason: I18n.t("GameOverlayStartingTheNativeModule") });
      s.startup = this._timer(() => this._fail(s,
        Object.assign(I18n.error("GameOverlayHelperDidNotRespondDuringStartup"), { code: 'STARTUP_TIMEOUT' }), 'startup'), this.startupMs);
      return true;
    } catch (error) {
      this._fail(s, error, 'spawn');
      if (!s.child) this._closed(s, null, null);
      return false;
    }
  }

  _read(s, chunk) {
    if (!this._current(s) || s.stopping || s.failed) return;
    s.buffer += String(chunk || '');
    if (Buffer.byteLength(s.buffer) > MAX_LINE_BYTES) {
      this._fail(s, Object.assign(I18n.error("GameOverlayHelperResponseIsTooLong"), { code: 'PROTOCOL_LIMIT' }), 'stdout');
      return;
    }
    let end;
    while ((end = s.buffer.indexOf('\n')) >= 0) {
      const line = s.buffer.slice(0, end).trim(); s.buffer = s.buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object' || !['hello', 'status'].includes(message.type)) continue;
      // Only a handshake establishes a new helper, not arbitrary stdout data.
      if (message.type === 'hello') {
        if (s.ready) continue;
        s.ready = true;
        this._clear(s.startup); s.startup = null;
        this._record('ready', { pid: s.child.pid || 0, version: String(message.version || '').slice(0, 64) });
        s.stable = this._timer(() => {
          if (this._current(s) && !s.failed && !s.stopping) this.retryCount = 0;
        }, this.stableMs);
      } else if (!s.ready) continue;
      s.lastMessageAt = this.clock.now();
      this._clear(s.watchdog);
      s.watchdog = this._timer(() => this._fail(s,
        Object.assign(I18n.error("GameOverlayHelperStoppedResponding"), { code: 'HEARTBEAT_TIMEOUT' }), 'heartbeat'), this.heartbeatMs);
      this.onMessage(message);
      this._pump(s);
      if (!this._current(s) || s.failed || s.stopping) break;
    }
  }

  send(payload) {
    const s = this.session;
    if (!s || !this.enabled || s.stopping || s.failed || s.closed || !payload || !COMMAND_TYPES.has(payload.type)) return false;
    let line;
    try { line = JSON.stringify(payload) + '\n'; } catch { return false; }
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) return false;
    // Replace stale unsent state/audio instead of accumulating a 30 fps queue.
    // Remove+set preserves the order of the most recent commands across types.
    if (s.queue.has(payload.type)) { this.metrics.coalesced++; s.queue.delete(payload.type); }
    s.queue.set(payload.type, line);
    this._pump(s);
    return !s.failed;
  }

  _pump(s) {
    if (!this._current(s) || s.failed || s.inFlight || s.blocked || (!s.ready && !s.stopping)) return;
    if (!s.queue.size) { this._clear(s.stall); s.stall = null; return; }
    const stream = s.child?.stdin;
    if (!stream || stream.destroyed || stream.writableEnded || stream.writableFinished || !stream.writable ||
        s.child.exitCode != null || s.child.signalCode != null) {
      this._fail(s, Object.assign(I18n.error("GameOverlayHelperChannelIsUnavailable"), { code: 'PIPE_UNAVAILABLE' }), 'write');
      return;
    }
    const [type, line] = s.queue.entries().next().value; s.queue.delete(type);
    s.inFlight = true;
    this._clear(s.stall);
    s.stall = this._timer(() => this._fail(s,
      Object.assign(I18n.error("GameOverlayHelperIsNotReadingCommands"), { code: 'WRITE_TIMEOUT' }), 'write'), this.stallMs);
    let returned = false, completed = false;
    const finish = () => {
      if (!this._current(s) || s.failed) return;
      s.inFlight = false;
      if (type === 'stop') {
        // 'error' stays installed for asynchronous end()/close failures too.
        try { if (!stream.destroyed && !stream.writableEnded) stream.end(); }
        catch (error) { this._fail(s, error, 'end'); }
      } else this._pump(s);
    };
    try {
      const accepted = stream.write(line, error => {
        completed = true;
        if (error) { this._fail(s, error, 'write-callback'); return; }
        if (returned) finish();
      });
      s.blocked = !accepted;
      returned = true;
      this.metrics.sent++;
      if (completed) finish();
    } catch (error) { this._fail(s, error, 'write-throw'); }
  }

  _clearSessionTimers(s) {
    for (const key of ['startup', 'stall', 'watchdog', 'stable']) { this._clear(s[key]); s[key] = null; }
  }

  _stopSession(s) {
    if (!this._current(s) || s.stopping) return;
    s.stopping = true;
    this._clearSessionTimers(s); s.queue.clear();
    s.queue.set('stop', '{"type":"stop"}\n');
    this._record('stop', { pid: s.child?.pid || 0 });
    if (!s.failed) this._pump(s);
    this._scheduleKill(s, this.stopMs);
  }

  _scheduleKill(s, delay) {
    if (s.kill) return;
    s.kill = this._timer(() => {
      s.kill = null;
      if (!this._current(s)) return;
      try { s.child?.stdin?.destroy(); } catch {}
      try {
        if (s.child && s.child.exitCode == null && s.child.signalCode == null) s.child.kill();
      } catch (error) { this._record('kill-error', { code: String(error.code || 'ERROR').slice(0, 64) }); }
      // We intentionally wait for close before a new launch. A failed kill
      // must not create multiple helpers that fight over the same OSD slot.
    }, delay);
  }

  _fail(s, error, source) {
    if (!this._current(s) || s.failed) return;
    s.failed = true;
    s.queue.clear(); this._clearSessionTimers(s);
    const code = String(error?.code || 'HELPER_ERROR').slice(0, 64);
    s.failureCode = code;
    if (!s.stopping) {
      this.metrics.failures++;
      this._record('failure', { code, source, pid: s.child?.pid || 0 });
      this._inactive(I18n.t("GameOverlayConnectionToTheGameModuleWasLostThe"),
        { lastError: `${code}: ${String(error?.message || error || '').slice(0, 500)}`, restarting: this.enabled });
    }
    // On Windows kill() ends the child. EOF is also observed by the helper.
    this._scheduleKill(s, s.stopping ? this.stopMs : 0);
  }

  _closed(s, code, signal) {
    if (s.closed) return;
    const current = this.session === s;
    s.closed = true; this._clearSessionTimers(s); this._clear(s.kill);
    s.queue.clear(); s.buffer = ''; s.stderr = '';
    if (!current) return;
    this.session = null;
    this._record('close', { pid: s.child?.pid || 0, code: code ?? s.exitCode,
      signal: signal ?? s.signal, expected: s.stopping });
    if (!this.enabled || this.disposed) return;
    if (s.stopping) { this._launch(); return; }
    this.retryCount++;
    if (this.retryCount > this.retryDelays.length) {
      this._inactive(I18n.t("GameOverlayGameModuleWasPausedAfterRepeatedFailuresSelect"),
        { restarting: false, retryAttempt: this.retryCount, lastError: s.failureCode || 'HELPER_CLOSED' });
      this._record('retry-limit', { attempts: this.retryCount });
      return;
    }
    const delay = this.retryDelays[this.retryCount - 1];
    this._inactive(I18n.t("GameOverlayGameModuleWillRestartInSAttempt", {value1:(delay / 1000),value2:(this.retryCount),value3:(this.retryDelays.length)}),
      { restarting: true, retryAttempt: this.retryCount });
    this._record('retry-scheduled', { attempt: this.retryCount, delayMs: delay });
    this.retryTimer = this._timer(() => {
      this.retryTimer = null;
      if (this.enabled && !this.disposed && !this.session) this._launch();
    }, delay);
  }

  snapshot() {
    const s = this.session;
    return { enabled: this.enabled, ready: !!s?.ready, failed: !!s?.failed,
      stopping: !!s?.stopping, queued: s?.queue.size || 0, inFlight: !!s?.inFlight,
      generation: this.generation, retryCount: this.retryCount, ...this.metrics };
  }
}

function createDiagnosticLog(file, maxBytes = 128 * 1024) {
  return entry => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        fs.rmSync(file + '.1', { force: true }); fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
    } catch { /* A read-only/full disk must not stop playback. */ }
  };
}

module.exports = { OverlayHostTransport, createDiagnosticLog, RETRY_DELAYS, MAX_LINE_BYTES };
