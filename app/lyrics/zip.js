'use strict';
const I18n = require("../i18n");
// Streamed, STORE-method ZIP: no whole-song buffer and no plaintext audio temp file.
// UTF-8 names, data descriptors and CRC-32. Bounded to classic ZIP sizes (< 4 GiB).
const fs=require('node:fs');const crypto=require('node:crypto');
const TABLE=Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i>>>1)^((i&1)?0xedb88320:0);return i>>>0;});
function crc32(buf,crc=0xffffffff){for(const b of buf)crc=(crc>>>8)^TABLE[(crc^b)&255];return crc>>>0;}
async function writeZip(destination,entries,{onProgress=()=>{},part=destination+'.partial-'+crypto.randomUUID(),commit=true}={}){
  if(entries.length>100)throw I18n.error("LyricsTooManyFilesInTheArchive");
  const output=await fs.promises.open(part,'wx',0o600);let offset=0,done=0;const central=[];
  const total=entries.reduce((n,e)=>n+(e.size||Buffer.byteLength(e.text||'')),0);
  const write=async b=>{if(offset+b.length>=0xffffffff)throw I18n.error("LyricsArchiveIsTooLargeMaximumGiB");let sent=0;while(sent<b.length){const r=await output.write(b,sent,b.length-sent);if(!r.bytesWritten)throw I18n.error("LyricsCouldNotWriteTheArchive");sent+=r.bytesWritten;}offset+=b.length;};
  try{
    for(const e of entries){
      if(!/^[\w.\-]+$/.test(e.name)||e.name==='.'||e.name==='..')throw I18n.error("LyricsUnsafeArchiveEntryName");
      const name=Buffer.from(e.name),header=Buffer.alloc(30),start=offset;
      header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0808,6);header.writeUInt16LE(0x0021,12);header.writeUInt16LE(name.length,26);
      await write(header);await write(name);let size=0,crc=0xffffffff;
      const chunks=e.stream?e.stream():[Buffer.from(e.text||'','utf8')];
      for await(const chunk of chunks){const b=Buffer.from(chunk);crc=crc32(b,crc);size+=b.length;await write(b);done+=b.length;onProgress(Math.min(99,Math.floor(done/Math.max(1,total)*100)));}
      if(e.size!=null&&size!==e.size)throw I18n.error("LyricsSourceFileChangedWhileCreatingTheArchive");
      crc=(crc^0xffffffff)>>>0;const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);await write(descriptor);
      const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0x0808,8);cd.writeUInt16LE(0x0021,14);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(size,20);cd.writeUInt32LE(size,24);cd.writeUInt16LE(name.length,28);cd.writeUInt32LE(start,42);central.push(cd,name);
    }
    const begin=offset;for(const b of central)await write(b);const centralSize=offset-begin;
    const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(begin,16);await write(end);
    await output.sync();await output.close();if(commit){await fs.promises.rename(part,destination);onProgress(100);}return {bytes:offset};
  }catch(e){await output.close().catch(()=>{});await fs.promises.unlink(part).catch(()=>{});throw e;}
}
module.exports={writeZip,crc32};
