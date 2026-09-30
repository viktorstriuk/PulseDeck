#!/usr/bin/env python3
"""Run renderer suites sequentially; keep logs and report every failed process."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
LOG_TAIL_LINES = 80


def main(root: Path = ROOT, *, timeout: float = 300) -> int:
    version = json.loads((root / 'app/package.json').read_text(encoding='utf-8'))['version']
    out = root / 'test-results' / version
    out.mkdir(parents=True, exist_ok=True)
    scripts = sorted((root / 'tests').glob('browser-*.py'))
    results = []
    # A rerun must not leave the previous invocation's summary behind.
    summary = out / 'browser-suites.json'
    summary.write_text('[]\n', encoding='utf-8')
    if not scripts:
        print('ERROR: no browser-*.py suites found; refusing an empty successful run.', flush=True)
        return 1

    for index, script in enumerate(scripts, 1):
        log = out / (script.stem + '.log')
        print(f'[{index}/{len(scripts)}] Running {script.name}', flush=True)
        start = time.monotonic()
        with log.open('w', encoding='utf-8') as stream:
            try:
                result = subprocess.run(
                    [sys.executable, str(script)], cwd=root,
                    stdout=stream, stderr=subprocess.STDOUT, timeout=timeout,
                )
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
                stream.write(f'\nRUNNER: {script.name} timed out after {timeout:g} seconds.\n')
            except OSError as error:
                code = 127
                stream.write(f'\nRUNNER: could not start {script.name}: {error}\n')
        seconds = round(time.monotonic() - start, 2)
        results.append({'suite': script.name, 'exit': code, 'seconds': seconds})
        summary.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
        print(f'{script.name} {code} ({seconds:.2f}s)', flush=True)
        if code != 0:
            # Print the actual failing assertion/traceback, not just its exit code.
            # Individual suites use different JSON locations/formats; their
            # process status remains authoritative, with full evidence retained.
            print(f'--- {log.relative_to(root)} (last {LOG_TAIL_LINES} lines) ---', flush=True)
            lines = log.read_text(encoding='utf-8', errors='replace').splitlines()
            print('\n'.join(lines[-LOG_TAIL_LINES:]) or '(empty log)', flush=True)
            print(f'--- end {script.name} ---', flush=True)

    failed = [result for result in results if result['exit'] != 0]
    print(f'\nBrowser suites: {len(results) - len(failed)} passed, {len(failed)} failed, '
          f'{len(results)} total.', flush=True)
    if failed:
        print('Failed browser suites (later successes do not clear earlier failures):', flush=True)
        for result in failed:
            log = out / (Path(result['suite']).stem + '.log')
            print(f"  FAIL {result['suite']}: exit={result['exit']}; log={log.relative_to(root)}", flush=True)
    print(f'Summary: {summary.relative_to(root)}', flush=True)
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
