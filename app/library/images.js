'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const I18n=require('../i18n'),Media=require('../shared/cover-media');
const invalid=()=>I18n.error('CoverInvalidImage');
/** Format checking is not a file-size or resolution policy. Keep the original
 * bytes, including animation and full resolution, after decoder validation. */
function describe(b){
  if(!Buffer.isBuffer(b)||b.length<12)throw invalid();
  let type='';
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
  else if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)type='image/jpeg';
  else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')type='image/webp';
  else if(/^GIF8[79]a$/.test(b.toString('ascii',0,6)))type='image/gif';
  else if(b.toString('ascii',0,2)==='BM')type='image/bmp';
  else if(b.toString('ascii',4,8)==='ftyp'){
    const brands=b.toString('ascii',8,Math.min(b.length,64));
    if(/avif|avis/.test(brands))type='image/avif';
    else if(/qt  /.test(brands))type='video/quicktime';
    else if(/isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash/.test(brands))type='video/mp4';
  }else if(b.readUInt32BE(0)===0x1a45dfa3&&b.subarray(0,4096).includes(Buffer.from('webm')))type='video/webm';
  else if(b.toString('ascii',0,4)==='OggS'&&b.subarray(0,4096).includes(Buffer.from('theora')))type='video/ogg';
  if(!type)throw invalid();return {type,ext:Media.extension(type),video:type.startsWith('video/')};
}
function dimensions(b){
  const {type}=describe(b);let width=0,height=0;
  if(type==='image/png'&&b.length>=24){width=b.readUInt32BE(16);height=b.readUInt32BE(20);}
  else if(type==='image/jpeg'){let p=2;while(p+4<=b.length){if(b[p++]!==0xff)continue;while(b[p]===0xff)p++;const marker=b[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;if(p+2>b.length)break;const size=b.readUInt16BE(p);if(size<2||p+size>b.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=7){height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);break;}p+=size;}}
  else if(type==='image/webp'){
    const kind=b.toString('ascii',12,16);
    if(kind==='VP8X'&&b.length>=30){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3);}
    else if(kind==='VP8 '&&b.length>=30&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a){width=b.readUInt16LE(26)&0x3fff;height=b.readUInt16LE(28)&0x3fff;}
    else if(kind==='VP8L'&&b.length>=25&&b[20]===0x2f){const bits=b.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }else if(type==='image/gif'){width=b.readUInt16LE(6);height=b.readUInt16LE(8);}
  else if(type==='image/bmp'&&b.length>=26){width=Math.abs(b.readInt32LE(18));height=Math.abs(b.readInt32LE(22));}
  if(!width||!height)throw invalid();return {width,height};
}
function sanitizeImage(buffer,nativeImage){
  const media=describe(buffer);if(media.video)throw invalid();
  const image=nativeImage.createFromBuffer(buffer);if(image.isEmpty())throw invalid();
  const actual=image.getSize();if(!actual.width||!actual.height)throw invalid();
  if(!['image/avif','image/bmp'].includes(media.type)){const size=dimensions(buffer);if(size.width!==actual.width||size.height!==actual.height)throw invalid();}
  return buffer;
}
async function inspectFile(file,nativeImage,{validateVideo,validateMedia}={}){
  if(typeof file!=='string'||!path.isAbsolute(file))throw invalid();
  const stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw invalid();
  const handle=await fsp.open(file,'r');let media;
  try{const head=Buffer.alloc(Math.min(65536,stat.size));await handle.read(head,0,head.length,0);media=describe(head);}finally{await handle.close();}
  if(validateMedia)await validateMedia(file,media);
  else if(media.video){if(!validateVideo)throw I18n.error('CoverVideoNeedsComponents');await validateVideo(file);}
  else {const image=nativeImage.createFromPath(file);if(image.isEmpty())throw invalid();}
  return {...media,path:file,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,ino:stat.ino,dev:stat.dev};
}
async function assertUnchanged(media){
  const now=await fsp.lstat(media.path);
  if(!now.isFile()||now.isSymbolicLink()||['size','mtimeMs','ctimeMs','ino','dev'].some(k=>media[k]!==undefined&&now[k]!==media[k]))throw I18n.error('TrackChanged');
  return now;
}
/** Copy through a temporary file; a large video never becomes an IPC/base64/JS
 * buffer. The source is never moved, modified or removed. */
async function storeFile(media,directory){
  await fsp.mkdir(directory,{recursive:true});const temp=path.join(directory,'.cover-'+crypto.randomUUID()+'.tmp');
  try{
    await assertUnchanged(media);await fsp.copyFile(media.path,temp,fs.constants.COPYFILE_EXCL);
    await assertUnchanged(media);const copied=await fsp.stat(temp);
    if(copied.size!==media.size)throw I18n.error('TrackChanged');
    const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(temp))hash.update(chunk);
    const target=path.join(directory,'custom-'+hash.digest('hex')+'.'+media.ext);
    try{await fsp.copyFile(temp,target,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
    return target;
  }finally{await fsp.unlink(temp).catch(()=>{});}
}
module.exports={dimensions,describe,sanitizeImage,inspectFile,assertUnchanged,storeFile};
