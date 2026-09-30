'use strict';
// These tests run Python's standard-library-only runner against tiny isolated
// suites. They do not start Chromium or require any browser-test dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const runner = path.resolve(__dirname, '../tools/run-browser-tests.py');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const invoke = `
import importlib.util, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('browser_runner',sys.argv[1])
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
if len(sys.argv)>4 and sys.argv[4]=='launch-error':
    def unavailable(*args,**kwargs): raise OSError('deliberate launch failure')
    runner.subprocess.run=unavailable
elif len(sys.argv)>4 and sys.argv[4]=='timeout':
    real_run=runner.subprocess.run
    def delayed(command,**kwargs):
        if Path(command[-1]).name=='browser-a.py':
            kwargs['stdout'].write('before hang\\n')
            raise runner.subprocess.TimeoutExpired(command,kwargs['timeout'])
        return real_run(command,**kwargs)
    runner.subprocess.run=delayed
raise SystemExit(runner.main(Path(sys.argv[2]),timeout=float(sys.argv[3])))
`;

function fixture(t, scripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-browser-runner-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'app'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'app/package.json'), '{"version":"test"}');
  for (const [name, script] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(root, 'tests', name), script);
  }
  return root;
}
function run(root, {timeout = 10, launchError = false, simulateTimeout = false} = {}) {
  const result = spawnSync(python,
    ['-c', invoke, runner, root, String(timeout), ...(launchError ? ['launch-error'] : simulateTimeout ? ['timeout'] : [])],
    {encoding: 'utf8', timeout: 60000});
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  const out = path.join(root, 'test-results/test');
  return {...result, out, suites: JSON.parse(fs.readFileSync(path.join(out, 'browser-suites.json'), 'utf8'))};
}

test('browser runner passes only when every discovered suite exits zero', t => {
  const root = fixture(t, {'browser-z.py': 'print("second")', 'browser-a.py': 'print("first")'});
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.suites.map(r => [r.suite, r.exit]), [['browser-a.py', 0], ['browser-z.py', 0]]);
  assert.match(result.stdout, /2 passed, 0 failed, 2 total/);
  assert.match(fs.readFileSync(path.join(result.out, 'browser-a.log'), 'utf8'), /first/);
});

test('browser runner keeps an early failure after a later successful suite', t => {
  const root = fixture(t, {
    'browser-a.py': 'raise AssertionError("AUDIO_BASELINE_EMPTY")',
    'browser-z.py': 'print("later success")',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(result.suites.map(r => r.exit), [1, 0]);
  assert.match(result.stdout, /AUDIO_BASELINE_EMPTY/);
  assert.match(result.stdout, /Traceback/);
  assert.match(result.stdout, /1 passed, 1 failed, 2 total/);
  assert.ok(result.stdout.lastIndexOf('FAIL browser-a.py: exit=1') > result.stdout.indexOf('browser-z.py 0'));
  assert.ok(result.stdout.includes(`log=${path.join('test-results', 'test', 'browser-a.log')}`));
});

test('browser runner preserves actual nonzero process status without parsing unrelated JSON', t => {
  const root = fixture(t, {'browser-a.py': 'import sys\nprint("deliberate exit")\nsys.exit(7)'});
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.suites[0].exit, 7);
  assert.match(result.stdout, /FAIL browser-a.py: exit=7/);
});

test('browser runner records TimeoutExpired and continues with the remaining suites', t => {
  const root = fixture(t, {
    'browser-a.py': 'print("not reached after timeout")',
    'browser-z.py': 'print("after timeout")',
  });
  const result = run(root, {simulateTimeout: true});
  assert.equal(result.status, 1);
  assert.deepEqual(result.suites.map(r => r.exit), [124, 0]);
  assert.match(result.stdout, /before hang/);
  assert.match(result.stdout, /timed out after 10 seconds/);
  assert.match(result.stdout, /FAIL browser-a.py: exit=124/);
});

test('browser runner fails explicitly when a child process cannot start', t => {
  const root = fixture(t, {'browser-a.py': 'print("unreachable")'});
  const result = run(root, {launchError: true});
  assert.equal(result.status, 1);
  assert.equal(result.suites[0].exit, 127);
  assert.match(result.stdout, /could not start browser-a.py: deliberate launch failure/);
});

test('browser runner clears the previous summary and rejects an empty suite set', t => {
  const root = fixture(t, {});
  const out = path.join(root, 'test-results/test');
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'browser-suites.json'), '[{"suite":"stale","exit":0}]');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(result.suites, []);
  assert.match(result.stdout, /no browser-\*\.py suites found/);
});

test('browser runner keeps full logs while limiting the failing excerpt', t => {
  const root = fixture(t, {
    'browser-a.py': 'print("HEAD_ONLY")\nfor i in range(100): print(i)\nraise AssertionError("TAIL_FAILURE")',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /HEAD_ONLY/);
  assert.match(result.stdout, /TAIL_FAILURE/);
  assert.match(fs.readFileSync(path.join(result.out, 'browser-a.log'), 'utf8'), /HEAD_ONLY/);
});

test('browser runner rerun replaces old failure state and logs rather than retaining it', t => {
  const root = fixture(t, {'browser-a.py': 'raise AssertionError("old failure")'});
  assert.equal(run(root).status, 1);
  fs.writeFileSync(path.join(root, 'tests/browser-a.py'), 'print("new success")');
  const result = run(root);
  assert.equal(result.status, 0);
  assert.deepEqual(result.suites.map(r => r.exit), [0]);
  assert.doesNotMatch(fs.readFileSync(path.join(result.out, 'browser-a.log'), 'utf8'), /old failure/);
});
