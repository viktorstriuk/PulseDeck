'use strict';
// Media-only archive extraction; no executables, external tools or shell commands.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),zlib=require('node:zlib');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const I=require('../i18n');
const LIMITS=Object.freeze({entries:20000,file:2*1024**3,total:20*1024**3,archive:8*1024**3});
const MEDIA=new Set(['.mp3','.m4a','.aac','.flac','.ogg','.opus','.wav','.webm','.mp4','.m4b','.mov','.mkv']);
const wanted=name=>MEDIA.has(path.extname(name).toLowerCase())||/\.(?:png|jpe?g|webp|lrc|txt|lyrics\.json|pulse\.json|info\.json)$/i.test(name);
const fail=key=>I.error(key);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b,value=0){let crc=(value^0xffffffff)>>>0;for(const byte of b)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function safeName(raw){
  if(typeof raw!=='string'||!raw||raw.length>1000||/[\x00-\x1f\x7f:]/.test(raw)||/^[\\/]/.test(raw))throw fail('ImportUnsafeArchive');
  const name=raw.replaceAll('\\','/').replace(/^(?:\.\/)+/,''),parts=name.replace(/\/$/,'').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw fail('ImportUnsafeArchive');
  return name;
}
async function readAt(fd,n,off){if(!Number.isSafeInteger(n)||n<0||n>8*1024*1024)throw fail('ImportUnsafeArchive');const b=Buffer.alloc(n);let done=0;while(done<n){const r=await fd.read(b,done,n-done,off+done);if(!r.bytesRead)throw fail('ImportBadArchive');done+=r.bytesRead;}return b;}
function zipName(bytes,flags,extra){
  let p=0;while(p+4<=extra.length){const type=extra.readUInt16LE(p),n=extra.readUInt16LE(p+2);if(p+4+n>extra.length)throw fail('ImportBadArchive');
    if(type===0x7075&&n>=5&&extra[p+4]===1&&extra.readUInt32LE(p+5)===crc32(bytes))return new TextDecoder('utf-8',{fatal:true}).decode(extra.subarray(p+9,p+4+n));p+=4+n;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{if(flags&0x800)throw fail('ImportBadArchive');return new TextDecoder('ibm866').decode(bytes);}
}
async function extractZip(archive,destination,{signal,limits=LIMITS}={}){
  const fd=await fsp.open(archive,'r');try{
    const before=await fd.stat(),size=before.size;if(size<22||size>limits.archive)throw fail('ImportArchiveLimit');
    const tail=await readAt(fd,Math.min(65557,size),Math.max(0,size-65557));let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
    if(end<0||tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6))throw fail('ImportBadArchive');
    const count=tail.readUInt16LE(end+10),bytes=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(count===65535||bytes===0xffffffff||offset===0xffffffff)throw fail('ImportZip64');
    if(count>limits.entries||bytes>8*1024*1024||offset+bytes>size-tail.length+end||tail.readUInt16LE(end+8)!==count)throw fail('ImportBadArchive');
    const directory=await readAt(fd,bytes,offset),entries=[],names=new Set();let p=0,total=0;
    for(let i=0;i<count;i++){
      if(p+46>bytes||directory.readUInt32LE(p)!==0x02014b50)throw fail('ImportBadArchive');
      const flags=directory.readUInt16LE(p+8),method=directory.readUInt16LE(p+10),crc=directory.readUInt32LE(p+16),compressed=directory.readUInt32LE(p+20),size=directory.readUInt32LE(p+24),nl=directory.readUInt16LE(p+28),el=directory.readUInt16LE(p+30),cl=directory.readUInt16LE(p+32),attr=directory.readUInt32LE(p+38),local=directory.readUInt32LE(p+42);
      if(p+46+nl+el+cl>bytes)throw fail('ImportBadArchive');const raw=directory.subarray(p+46,p+46+nl),name=safeName(zipName(raw,flags,directory.subarray(p+46+nl,p+46+nl+el))),key=name.normalize('NFC').toLowerCase();
      if(flags&1||flags&64)throw fail('ImportEncryptedArchive');if(((attr>>>16)&0xf000)===0xa000||names.has(key))throw fail('ImportUnsafeArchive');names.add(key);
      if(size===0xffffffff||compressed===0xffffffff||local===0xffffffff)throw fail('ImportZip64');
      total+=size;if(size>limits.file||total>limits.total)throw fail('ImportArchiveLimit');
      if(!name.endsWith('/')&&wanted(name)&&!name.split('/').some(x=>x.startsWith('.')||x==='__MACOSX')){if(![0,8].includes(method))throw fail('ImportArchiveMethod');entries.push({name,raw,flags,method,crc,compressed,size,local});}p+=46+nl+el+cl;
    }
    if(p!==bytes)throw fail('ImportBadArchive');
    for(const e of entries){if(signal?.aborted)throw fail('ImportCancelled');const local=await readAt(fd,30,e.local);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(6)!==e.flags||local.readUInt16LE(8)!==e.method)throw fail('ImportBadArchive');
      const nl=local.readUInt16LE(26),el=local.readUInt16LE(28),raw=await readAt(fd,nl,e.local+30),start=e.local+30+nl+el;
      if(!raw.equals(e.raw)||start+e.compressed>offset||e.method===0&&e.compressed!==e.size)throw fail('ImportBadArchive');
      const file=path.join(destination,...e.name.split('/'));await fsp.mkdir(path.dirname(file),{recursive:true});let written=0,crc=0;
      if(e.compressed===0){if(e.size||e.crc)throw fail('ImportBadArchive');await fsp.writeFile(file,Buffer.alloc(0),{flag:'wx'});continue;}
      const limit=new Transform({transform(chunk,enc,cb){written+=chunk.length;crc=crc32(chunk,crc);cb(written>e.size?fail('ImportArchiveLimit'):null,chunk);}});
      const input=fs.createReadStream(archive,{start,end:start+e.compressed-1}),output=fs.createWriteStream(file,{flags:'wx',mode:0o600});
      await pipeline(...(e.method===8?[input,zlib.createInflateRaw(),limit,output]:[input,limit,output]),{signal});
      if(written!==e.size||crc!==e.crc)throw fail('ImportBadArchive');
    }
    const after=await fd.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw fail('ImportSourceChanged');return entries.map(e=>path.join(destination,...e.name.split('/')));
  }finally{await fd.close();}
}
function tarNumber(b){const value=b.toString('ascii').replace(/\0.*$/s,'').trim();if(!/^[0-7]*$/.test(value))throw fail('ImportBadArchive');const n=parseInt(value||'0',8);if(!Number.isSafeInteger(n)||n<0)throw fail('ImportBadArchive');return n;}
function tarText(b){return b.toString('utf8').replace(/\0.*$/s,'');}
function pax(data){const values={};let p=0;while(p<data.length){const space=data.indexOf(32,p);if(space<0)throw fail('ImportBadArchive');const n=Number(data.toString('ascii',p,space));if(!Number.isSafeInteger(n)||n<5||p+n>data.length)throw fail('ImportBadArchive');const line=data.toString('utf8',space+1,p+n-1),equals=line.indexOf('=');if(equals>0)values[line.slice(0,equals)]=line.slice(equals+1);p+=n;}return values;}
async function extractTar(archive,destination,{signal,limits=LIMITS,gzip=/\.(?:tgz|gz)$/i.test(archive)}={}){
  const stat=await fsp.stat(archive);if(stat.size>limits.archive)throw fail('ImportArchiveLimit');
  const input=fs.createReadStream(archive),stream=gzip?input.pipe(zlib.createGunzip()):input;input.on('error',e=>{if(stream!==input)stream.destroy(e);});
  const iterator=stream[Symbol.asyncIterator]();let buffer=Buffer.alloc(0),consumed=0;
  const abort=()=>{input.destroy(fail('ImportCancelled'));stream.destroy(fail('ImportCancelled'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  async function take(n,allowEnd=false){const out=[];let have=0;while(have<n){if(!buffer.length){const next=await iterator.next();if(next.done){if(allowEnd&&!have)return null;throw fail('ImportBadArchive');}buffer=Buffer.from(next.value);}
    const size=Math.min(n-have,buffer.length);out.push(buffer.subarray(0,size));buffer=buffer.subarray(size);have+=size;consumed+=size;if(consumed>limits.total+limits.entries*2048)throw fail('ImportArchiveLimit');}return Buffer.concat(out,n);}
  const files=[],names=new Set();let entries=0,total=0,longName='',attributes={};
  try{for(;;){const h=await take(512,true);if(!h)throw fail('ImportBadArchive');if(h.every(v=>v===0)){const second=await take(512);if(!second.every(v=>v===0))throw fail('ImportBadArchive');while(await take(512,true)){}break;}if(++entries>limits.entries)throw fail('ImportArchiveLimit');let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];if(sum!==tarNumber(h.subarray(148,156)))throw fail('ImportBadArchive');
      const prefix=tarText(h.subarray(345,500)),name=longName||attributes.path||[prefix,tarText(h.subarray(0,100))].filter(Boolean).join('/');const type=String.fromCharCode(h[156]||48),size=attributes.size===undefined?tarNumber(h.subarray(124,136)):Number(attributes.size);longName='';attributes={};
      if(!Number.isSafeInteger(size)||size<0||size>limits.file||(total+=size)>limits.total)throw fail('ImportArchiveLimit');
      if(['L','x','g'].includes(type)){if(size>65536||type==='g')throw fail('ImportArchiveMethod');const data=await take(size);if(type==='L')longName=tarText(data).replace(/\n$/,'');else attributes=pax(data);if(size%512)await take(512-size%512);continue;}
      if(type==='5'&&/^(?:\.\/?)+$/.test(name)){if(size)throw fail('ImportUnsafeArchive');continue;}
      const safe=safeName(name),key=safe.normalize('NFC').toLowerCase();if(!['0','5'].includes(type)||names.has(key))throw fail('ImportUnsafeArchive');names.add(key);
      const write=type==='0'&&wanted(safe)&&!safe.split('/').some(x=>x.startsWith('.')||x==='__MACOSX');let file,fh;
      if(write){file=path.join(destination,...safe.split('/'));await fsp.mkdir(path.dirname(file),{recursive:true});fh=await fsp.open(file,'wx',0o600);}
      try{let left=size;while(left){const data=await take(Math.min(left,65536));if(fh)await fh.writeFile(data);left-=data.length;}}finally{await fh?.close();}
      if(size%512)await take(512-size%512);if(write)files.push(file);
    }return files;
  }finally{signal?.removeEventListener('abort',abort);input.destroy();stream.destroy();}
}
async function extract(archive,destination,options={}){if(/\.zip$/i.test(archive))return extractZip(archive,destination,options);if(/\.(?:tar|tgz|tar\.gz)$/i.test(archive))return extractTar(archive,destination,options);throw fail('ImportArchiveUnsupported');}
module.exports={extract,extractZip,extractTar,safeName,crc32,MEDIA,LIMITS};
