#!/usr/bin/env python3
"""Build the GUI Windows x64 installer entirely from local sources (Python + Go).
No network, signatures or private keys. --runtime-zip optionally embeds a pinned
Electron archive; otherwise the resulting web installer provisions it securely.
"""
from __future__ import annotations
import argparse, hashlib, io, json, os, re, shutil, struct, subprocess, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MAGIC=b'PULSEDECK-PAYLOAD\0'
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def run(args,cwd):
 subprocess.run(args,cwd=cwd,env={**os.environ,'GOOS':'windows','GOARCH':'amd64','CGO_ENABLED':'0'},check=True)
def payload(runtime_zip=None):
 version=json.loads((ROOT/'app/package.json').read_text())['version'];runtime=json.loads((ROOT/'installer/runtime.json').read_text())
 ui_version=json.loads((ROOT/'installer/ui/package.json').read_text())['version']
 native_version=re.search(r'const hostVersion = "([^"]+)"',(ROOT/'native/protocol.go').read_text())
 if ui_version!=version or not native_version or native_version.group(1)!=version:raise ValueError('App, installer UI and native helper versions must match')
 if runtime_zip and sha(runtime_zip)!=runtime['sha256']:raise ValueError('Electron archive SHA-256 does not match installer/runtime.json')
 # License files in the installed app are generated from the single source set.
 license_dir=ROOT/'app/licenses';shutil.rmtree(license_dir,ignore_errors=True);shutil.copytree(ROOT/'licenses',license_dir)
 shutil.copyfile(ROOT/'LICENSE',license_dir/'PulseDeck-MIT.txt');shutil.copyfile(ROOT/'CREDITS.md',license_dir/'CREDITS.md')
 records=[];content={}
 for folder in ['app','installer/ui']:
  for p in sorted((ROOT/folder).rglob('*')):
   if not p.is_file() or p.is_symlink() or any(n in p.parts for n in ['node_modules','__pycache__','.git']):continue
   rel=p.relative_to(ROOT).as_posix();data=p.read_bytes();content[rel]=data;records.append({'path':rel,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 manifest={'schema':1,'product':'com.pulsedeck.music','version':version,'runtime':runtime,'files':records}
 content['manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 if runtime_zip:content['runtime/electron.zip']=Path(runtime_zip).read_bytes()
 buffer=io.BytesIO()
 with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for rel,data in sorted(content.items()):
   info=zipfile.ZipInfo(rel,date_time=(2026,1,1,0,0,0));info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
   z.writestr(info,data)
 data=buffer.getvalue();(ROOT/'installer/engine/payload.bin').write_bytes(MAGIC+struct.pack('<Q',len(data))+data)
 return version,manifest

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--runtime-zip',type=Path);parser.add_argument('--payload-only',action='store_true');parser.add_argument('--rebuild-native',action='store_true',help='Compatibility flag: native helper is always rebuilt.');opts=parser.parse_args()
 go=shutil.which('go') or '/usr/local/go/bin/go';dist=ROOT/'dist';dist.mkdir(exist_ok=True)
 helper=ROOT/'app/assets/native/PulseDeck.GameOverlayHost.exe';helper.parent.mkdir(parents=True,exist_ok=True)
 run([go,'build','-trimpath','-buildvcs=false','-ldflags=-s -w -H=windowsgui','-o',str(helper),'.'],ROOT/'native')
 version,manifest=payload(opts.runtime_zip)
 if opts.payload_only:return
 installer=dist/f'PulseDeck-Setup-{version}.exe'
 run([go,'build','-trimpath','-buildvcs=false','-ldflags=-s -w -H=windowsgui','-o',str(installer),'.'],ROOT/'installer/engine')
 (dist/'payload-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 result={'version':version,'installer':str(installer),'installer_sha256':sha(installer),'native_sha256':sha(helper),'files':len(manifest['files']),'electron_embedded':bool(opts.runtime_zip),'authenticode_signed':False}
 (dist/'build.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
