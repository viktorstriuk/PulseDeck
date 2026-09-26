'use strict';
const I18n = require("../i18n");
// Versioned, authenticated storage; no passwords, plaintext audio or filenames
// in the blob format. Crypto primitives: node:crypto; format is documented in SECURITY.md.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const CHUNK=1024*1024;
const KDF=Object.freeze({N:131072,r:8,p:1});
const b64=b=>Buffer.from(b).toString('base64');
function keyBuffer(value){const b=Buffer.isBuffer(value)?value:Buffer.from(value,'base64');if(b.length!==32)throw I18n.error("VaultInvalidKey");return b;}
function password(value){if(typeof value!=='string'||[...value].length<3||[...value].length>48)throw I18n.error("VaultPasswordMustContainToCharacters");return value;}
function seal(data,key,aad){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyBuffer(key),iv);
  cipher.setAAD(Buffer.from(aad));
  const body=Buffer.concat([cipher.update(Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data))),cipher.final()]);
  return {v:1,iv:b64(iv),tag:b64(cipher.getAuthTag()),body:b64(body)};
}
function open(box,key,aad,json=true){
  if(box?.v!==1)throw I18n.error("VaultUnsupportedVaultFormat");
  const iv=Buffer.from(box.iv,'base64'),tag=Buffer.from(box.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw I18n.error("VaultCorruptedHeader");
  const d=crypto.createDecipheriv('aes-256-gcm',keyBuffer(key),iv);d.setAAD(Buffer.from(aad));d.setAuthTag(tag);
  const clear=Buffer.concat([d.update(Buffer.from(box.body,'base64')),d.final()]);
  if(!json)return clear;
  try{return JSON.parse(clear.toString('utf8'));}finally{clear.fill(0);}
}
async function wrap(value,secret,aad){
  const salt=crypto.randomBytes(16),key=await scrypt(password(secret),salt,32,{...KDF,maxmem:256*1024*1024});
  try{return {v:1,kdf:{...KDF,salt:b64(salt)},box:seal(value,key,aad)};}finally{key.fill(0);}
}
async function unwrap(wrapper,secret,aad){
  password(secret);
  if(wrapper?.v!==1||wrapper.kdf?.N!==KDF.N||wrapper.kdf.r!==8||wrapper.kdf.p!==1)throw I18n.error("VaultUnsupportedKeyParameters");
  const salt=Buffer.from(wrapper.kdf.salt,'base64');if(salt.length!==16)throw I18n.error("VaultCorruptedKey");
  const key=await scrypt(secret,salt,32,{...KDF,maxmem:256*1024*1024});
  try{return open(wrapper.box,key,aad);}catch{throw I18n.error("VaultIncorrectPasswordOrCorruptedVault");}finally{key.fill(0);}
}
async function durableJson(file,value){
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
  try{handle=await fs.promises.open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;
    await fs.promises.rename(tmp,file);
    try{const dir=await fs.promises.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}catch{}
  }finally{await handle?.close().catch(()=>{});await fs.promises.unlink(tmp).catch(()=>{});}
}
async function exact(handle,length,offset){
  const buf=Buffer.alloc(length);let read=0;
  while(read<length){const n=await handle.read(buf,read,length-read,offset+read);if(!n.bytesRead)throw I18n.error("VaultFileIsTruncated");read+=n.bytesRead;}
  return buf;
}
function nonce(prefix,i){const iv=Buffer.alloc(12);Buffer.from(prefix,'base64').copy(iv,0);iv.writeUInt32BE(i,8);return iv;}
async function* chunks(file,desc,key,start=0,end=desc.size-1){
  if(!/^[a-f0-9]{32}$/.test(desc.id)||!Number.isSafeInteger(desc.size)||desc.size<0||desc.chunk!==CHUNK||desc.size>CHUNK*0xffffffff)throw I18n.error("VaultCorruptedFileDescriptor");
  if(desc.size===0)return;
  const first=Math.floor(start/CHUNK),last=Math.floor(end/CHUNK),f=await fs.promises.open(file,'r');
  try{
    const st=await f.stat();if(st.size!==desc.size+Math.ceil(desc.size/CHUNK)*16)throw I18n.error("VaultEncryptedFileSizeDoesNotMatch");
    for(let i=first;i<=last;i++){
      const size=Math.min(CHUNK,desc.size-i*CHUNK),body=await exact(f,size+16,i*(CHUNK+16));
      const d=crypto.createDecipheriv('aes-256-gcm',keyBuffer(key),nonce(desc.prefix,i));d.setAAD(Buffer.from(`${desc.id}:${desc.size}:${i}`));d.setAuthTag(body.subarray(size));
      // Never return unauthenticated plaintext, including a partial read/range.
      const clear=Buffer.concat([d.update(body.subarray(0,size)),d.final()]);
      yield clear.subarray(Math.max(0,start-i*CHUNK),Math.min(size,end-i*CHUNK+1));
    }
  }finally{await f.close();}
}
async function encryptFile(source,destination,id=crypto.randomBytes(16).toString('hex')){
  const key=crypto.randomBytes(32),prefix=b64(crypto.randomBytes(8));
  const input=await fs.promises.open(source,'r'),stat=await input.stat();
  if(!stat.isFile()||stat.size>CHUNK*0xffffffff){await input.close();key.fill(0);throw I18n.error("VaultUnsupportedFileSize");}
  const desc={id,key:b64(key),prefix,chunk:CHUNK,size:stat.size};
  const tmp=destination+'.pending';await fs.promises.mkdir(path.dirname(destination),{recursive:true});
  const output=await fs.promises.open(tmp,'wx',0o600),hash=crypto.createHash('sha256');
  try{
    for(let i=0,offset=0;offset<stat.size;i++,offset+=CHUNK){
      const clear=await exact(input,Math.min(CHUNK,stat.size-offset),offset);hash.update(clear);
      const c=crypto.createCipheriv('aes-256-gcm',key,nonce(prefix,i));c.setAAD(Buffer.from(`${id}:${stat.size}:${i}`));
      await output.writeFile(Buffer.concat([c.update(clear),c.final(),c.getAuthTag()]));clear.fill(0);
    }
    await output.sync();const after=await input.stat();
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw I18n.error("VaultSourceFileChangedDuringEncryption");
    await output.close();await input.close();
    const verified=crypto.createHash('sha256');for await(const part of chunks(tmp,desc,key))verified.update(part);
    desc.sha256=hash.digest('hex');
    if(verified.digest('hex')!==desc.sha256)throw I18n.error("VaultEncryptedCopyVerificationFailed");
    await fs.promises.rename(tmp,destination);return desc;
  }catch(error){await output.close().catch(()=>{});await input.close().catch(()=>{});await fs.promises.unlink(tmp).catch(()=>{});throw error;}
  finally{key.fill(0);}
}
async function decryptFile(source,destination,desc){
  // Export only: playback never uses this path and never writes clear temp audio.
  const tmp=destination+'.decrypting-'+crypto.randomUUID();const out=await fs.promises.open(tmp,'wx',0o600);
  try{for await(const part of chunks(source,desc,desc.key))await out.writeFile(part);await out.sync();await out.close();
    // link is exclusive: a race must never overwrite an existing song.
    await fs.promises.link(tmp,destination);await fs.promises.unlink(tmp);return destination;
  }catch(e){await out.close().catch(()=>{});await fs.promises.unlink(tmp).catch(()=>{});throw e;}
}
async function verifyFile(file,desc){const hash=crypto.createHash('sha256');for await(const part of chunks(file,desc,desc.key))hash.update(part);if(hash.digest('hex')!==desc.sha256)throw I18n.error("VaultIntegrityCheckFailed");return true;}
async function verifySource(file,desc){const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);if(hash.digest('hex')!==desc.sha256)throw I18n.error("VaultSourceFileChangedTheUnencryptedCopyWasLeft");return true;}
module.exports={verifySource,verifyFile,CHUNK,KDF,b64,password,seal,open,wrap,unwrap,durableJson,chunks,encryptFile,decryptFile};
