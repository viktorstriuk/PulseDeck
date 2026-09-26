#!/usr/bin/env python3
"""Inspect and extract the verifiable payload from a PulseDeck 2.8+ installer.
This script never runs the EXE. Each manifest file must match size and SHA-256.
"""
import argparse,hashlib,io,json,struct,zipfile
from pathlib import Path
MAGIC=b'PULSEDECK-PAYLOAD\0'
def extract(exe,dest):
 data=Path(exe).read_bytes();start=0
 while True:
  pos=data.find(MAGIC,start)
  if pos<0:raise ValueError('No valid PulseDeck payload found')
  start=pos+len(MAGIC)
  if start+8>len(data):continue
  length=struct.unpack('<Q',data[start:start+8])[0]
  if length>len(data)-start-8:continue
  try:z=zipfile.ZipFile(io.BytesIO(data[start+8:start+8+length]));manifest=json.loads(z.read('manifest.json'))
  except (ValueError,KeyError,zipfile.BadZipFile):continue
  break
 if manifest['product']!='com.pulsedeck.music':raise ValueError('Wrong product')
 dest=Path(dest);dest.mkdir(parents=True,exist_ok=True)
 for record in manifest['files']:
  rel=record['path'];path=Path(rel)
  if path.is_absolute() or '..' in path.parts or ':' in rel or '\\' in rel:raise ValueError('Unsafe path')
  b=z.read(rel)
  if len(b)!=record['size'] or hashlib.sha256(b).hexdigest()!=record['sha256']:raise ValueError('Payload mismatch: '+rel)
  target=dest/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
 return {'version':manifest['version'],'files':len(manifest['files']),'verified':True}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('installer');p.add_argument('destination');a=p.parse_args();print(json.dumps(extract(a.installer,a.destination),indent=2))
