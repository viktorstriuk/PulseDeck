#!/usr/bin/env python3
"""Run actual-renderer regression suites sequentially and retain individual logs."""
import json,subprocess,time,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];version=json.loads((ROOT/'app/package.json').read_text())['version'];out=ROOT/'test-results'/version;out.mkdir(parents=True,exist_ok=True);results=[]
for script in sorted((ROOT/'tests').glob('browser-*.py')):
 start=time.monotonic()
 with (out/(script.stem+'.log')).open('w') as f:
  try:r=subprocess.run([sys.executable,str(script)],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,timeout=300);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 results.append({'suite':script.name,'exit':code,'seconds':round(time.monotonic()-start,2)});(out/'browser-suites.json').write_text(json.dumps(results,indent=2));print(script.name,code,flush=True)
sys.exit(int(any(r['exit'] for r in results)))
