#!/usr/bin/env python3
"""Create a clean source archive; no results, executables, local data or credentials."""
from __future__ import annotations
import argparse,hashlib,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EXCLUDE_PARTS={'.git','node_modules','__pycache__','.cache','test-results','playwright-report','dist'}
EXCLUDE_ROOT={'music','data'}
EXCLUDE_SUFFIX={'.exe','.dll','.pem','.key','.pfx','.p12','.log','.tmp','.pyc','.woff','.woff2','.ttf','.otf'}
def source_files():
 for p in sorted(ROOT.rglob('*')):
  if not p.is_file() or p.is_symlink():continue
  rel=p.relative_to(ROOT)
  if set(rel.parts)&EXCLUDE_PARTS or rel.parts[0] in EXCLUDE_ROOT or p.suffix.lower() in EXCLUDE_SUFFIX:continue
  if str(rel).replace('\\','/').startswith('app/licenses/') or rel.as_posix() in {'installer/engine/payload.bin','SOURCE_MANIFEST_SHA256.txt'}:continue
  if p.name.startswith('.env') or p.name in {'storage.json','updates.json'}:continue
  yield p,rel.as_posix()
def main():
 a=argparse.ArgumentParser(description=__doc__);a.add_argument('--out',type=Path,default=ROOT/'dist');opts=a.parse_args();opts.out.mkdir(parents=True,exist_ok=True)
 version=json.loads((ROOT/'app/package.json').read_text())['version'];prefix=f'PulseDeck-{version}-source';archive=opts.out/f'{prefix}.zip';records=[]
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for p,rel in source_files():
   if p.resolve()==archive.resolve():continue
   data=p.read_bytes();records.append(f'{hashlib.sha256(data).hexdigest()}  {rel}')
   info=zipfile.ZipInfo(prefix+'/'+rel,date_time=(2026,1,1,0,0,0));info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
  info=zipfile.ZipInfo(prefix+'/SOURCE_MANIFEST_SHA256.txt',date_time=(2026,1,1,0,0,0));info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,'\n'.join(records)+'\n')
 print(json.dumps({'source':str(archive),'source_files':len(records),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2))
if __name__=='__main__':main()
