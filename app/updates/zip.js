'use strict';
// Bounded ZIP reader for signed, pinned tool bundles. No general extraction paths.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const {fail}=require('./security');
async function readAt(fd,size,offset){const b=Buffer.alloc(size);let n=0;while(n<size){const r=await fd.read(b,n,size-n,offset+n);if(!r.bytesRead)throw fail('COMPONENT_BAD_ARCHIVE');n+=r.bytesRead;}return b;}
async function extractTools(archive,destination) {
  const fd=await fs.promises.open(archive,'r');let entries=[];
  try{
    const {size}=await fd.stat();if(size<22 || size>1024**3)throw fail('COMPONENT_BAD_ARCHIVE');
    const tail=await readAt(fd,Math.min(65557,size),Math.max(0,size-65557));let e=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length){e=i;break;}
    if(e<0||tail.readUInt16LE(e+4)!==0||tail.readUInt16LE(e+6)!==0)throw fail('COMPONENT_BAD_ARCHIVE');
    const count=tail.readUInt16LE(e+10),cdSize=tail.readUInt32LE(e+12),cdOffset=tail.readUInt32LE(e+16);
    if(count>4096||cdSize>4*1024*1024||cdOffset+cdSize>size)throw fail('COMPONENT_BAD_ARCHIVE');
    const cd=await readAt(fd,cdSize,cdOffset),names=new Set();let pos=0,total=0;
    for(let n=0;n<count;n++){
      if(pos+46>cd.length||cd.readUInt32LE(pos)!==0x02014b50)throw fail('COMPONENT_BAD_ARCHIVE');
      const flags=cd.readUInt16LE(pos+8),method=cd.readUInt16LE(pos+10),compressed=cd.readUInt32LE(pos+20),uncompressed=cd.readUInt32LE(pos+24),nl=cd.readUInt16LE(pos+28),el=cd.readUInt16LE(pos+30),cl=cd.readUInt16LE(pos+32),attrs=cd.readUInt32LE(pos+38),offset=cd.readUInt32LE(pos+42);
      if(pos+46+nl+el+cl>cd.length)throw fail('COMPONENT_BAD_ARCHIVE');
      const name=cd.subarray(pos+46,pos+46+nl).toString('utf8'),parts=name.replace(/\\/g,'/').split('/');
      if(name.includes('\0')||name.includes(':')||/^[\\/]/.test(name)||parts.includes('..')||((attrs>>>16)&0xf000)===0xa000||flags&1||![0,8].includes(method)||names.has(name.toLowerCase()))throw fail('COMPONENT_BAD_ARCHIVE');
      names.add(name.toLowerCase());total+=uncompressed;if(total>1024**3||uncompressed>600*1024*1024)throw fail('COMPONENT_ARCHIVE_LIMIT');
      const basename=parts.at(-1),wanted=['ffmpeg.exe','ffprobe.exe'].includes(basename.toLowerCase());
      const notice=/^(license|licence|copying|readme|version|source)/i.test(basename)&&/\.(txt|md)$/i.test(basename)&&uncompressed<2*1024*1024;
      if(wanted||notice)entries.push({name,basename,wanted,offset,compressed,uncompressed,method});pos+=46+nl+el+cl;
    }
    if(entries.filter(e=>e.wanted).length!==2||!['ffmpeg.exe','ffprobe.exe'].every(n=>entries.some(e=>e.basename.toLowerCase()===n)))throw fail('COMPONENT_MISSING_BINARY');
    for(const e of entries){
      const local=await readAt(fd,30,e.offset);if(local.readUInt32LE(0)!==0x04034b50)throw fail('COMPONENT_BAD_ARCHIVE');
      const start=e.offset+30+local.readUInt16LE(26)+local.readUInt16LE(28);
      if(start+e.compressed>cdOffset)throw fail('COMPONENT_BAD_ARCHIVE');
      const file=e.wanted?path.join(destination,e.basename.toLowerCase()):path.join(destination,'notices',e.basename.replace(/[^a-zA-Z0-9._-]/g,'_'));
      await fs.promises.mkdir(path.dirname(file),{recursive:true});if(!e.wanted&&fs.existsSync(file))continue;
      let written=0;const limit=new Transform({transform(chunk,enc,cb){written+=chunk.length;cb(written>e.uncompressed?fail('COMPONENT_ARCHIVE_LIMIT'):null,chunk);}});
      if(e.compressed===0){await fs.promises.writeFile(file,Buffer.alloc(0),{flag:'wx'});continue;}
      const stream=fs.createReadStream(archive,{start,end:start+e.compressed-1}),output=fs.createWriteStream(file,{flags:'wx',mode:0o700});
      await pipeline(...(e.method===8?[stream,zlib.createInflateRaw(),limit,output]:[stream,limit,output]));
      if(written!==e.uncompressed)throw fail('COMPONENT_BAD_ARCHIVE');
    }
    return entries.filter(e=>e.wanted).map(e=>e.basename.toLowerCase());
  }finally{await fd.close();}
}
module.exports={extractTools};
