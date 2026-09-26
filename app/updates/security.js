'use strict';
// No network or filesystem access. The public key is bundled, never taken from a feed.
const crypto = require('node:crypto');
const MAX_ENVELOPE = 512 * 1024;
const fail = code => Object.assign(new Error(code), {code});
function version(value) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value));
  if (!m || m.slice(1,4).some(n => !Number.isSafeInteger(Number(n))) || (m[4] || '').split('.').some(n=>/^0\d+$/.test(n))) throw fail('UPDATE_INVALID_VERSION');
  return {parts:m.slice(1,4).map(Number), pre:m[4] ? m[4].split('.') : []};
}
function compare(a,b) {
  const x=version(a), y=version(b);
  for(let i=0;i<3;i++) if(x.parts[i]!==y.parts[i])return x.parts[i]>y.parts[i]?1:-1;
  if(!x.pre.length || !y.pre.length)return x.pre.length ? -1 : y.pre.length ? 1 : 0;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++) {
    if(x.pre[i]===undefined)return -1;if(y.pre[i]===undefined)return 1;
    const l=x.pre[i], r=y.pre[i];if(l===r)continue;
    const ln=/^\d+$/.test(l), rn=/^\d+$/.test(r);
    if(ln&&rn){if(l.length!==r.length)return l.length>r.length?1:-1;return l>r?1:-1;}
    if(ln!==rn)return ln?-1:1;return l>r?1:-1;
  }
  return 0;
}
function repository(config) {
  const r=config?.repository;
  if(!r || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(r.owner||'') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(r.name||'') || ['.','..'].includes(r.name))return null;
  return {owner:r.owner,name:r.name};
}
function ready(config) {return !!repository(config) && validKey(config?.publicKey);}
function validKey(pem) {try{return crypto.createPublicKey(pem).asymmetricKeyType==='ed25519';}catch{return false;}}
function repoURL(config) {const r=repository(config);return r?`https://github.com/${r.owner}/${r.name}`:'';}
function allowedURL(raw,config,{redirect=false,component=false}={}) {
  let u;try{u=new URL(raw);}catch{throw fail('UPDATE_UNTRUSTED_URL');}
  if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443') || u.hash)throw fail('UPDATE_UNTRUSTED_URL');
  if(redirect && ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))return u.href;
  const r=repository(config), prefix=r?`/${r.owner}/${r.name}/releases/download/`:'';
  if(u.hostname==='github.com' && prefix && u.pathname.startsWith(prefix) && !u.pathname.slice(prefix.length).includes('../'))return u.href;
  if(component) {
    if(u.hostname==='github.com' && ['/yt-dlp/yt-dlp/releases/download/','/GyanD/codexffmpeg/releases/download/'].some(p=>u.pathname.startsWith(p)))return u.href;
    if(u.hostname==='www.gyan.dev' && u.pathname.startsWith('/ffmpeg/builds/packages/'))return u.href;
  }
  throw fail('UPDATE_UNTRUSTED_URL');
}
function verifyEnvelope(bytes,config) {
  if(!validKey(config?.publicKey))throw fail('UPDATE_NO_TRUST_KEY');
  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  if(buffer.length>MAX_ENVELOPE)throw fail('UPDATE_MANIFEST_TOO_LARGE');
  let envelope;try{envelope=JSON.parse(buffer.toString('utf8'));}catch{throw fail('UPDATE_BAD_MANIFEST');}
  if(envelope.schema!==1 || typeof envelope.payload!=='string' || typeof envelope.signature!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature))throw fail('UPDATE_BAD_MANIFEST');
  const payload=Buffer.from(envelope.payload,'base64'),sig=Buffer.from(envelope.signature,'base64');
  if(sig.length!==64 || !crypto.verify(null,payload,config.publicKey,sig))throw fail('UPDATE_BAD_SIGNATURE');
  let m;try{m=JSON.parse(payload.toString('utf8'));}catch{throw fail('UPDATE_BAD_MANIFEST');}
  if(!m || m.schema!==1 || m.product!=='com.pulsedeck.music')throw fail('UPDATE_WRONG_PRODUCT');
  return m;
}
function fileSpec(file,config,options={}) {
  if(!file || !/^[a-f0-9]{64}$/i.test(file.sha256||'') || !Number.isSafeInteger(file.size) || file.size<1 || file.size>1024*1024*1024)throw fail('UPDATE_BAD_FILE');
  return {...file,url:allowedURL(file.url,config,options),sha256:file.sha256.toLowerCase()};
}
function applicationManifest(m,config,{current,channel='stable',platform='win32',arch='x64'}={}) {
  if(m.kind!=='application' || !['stable','beta'].includes(m.channel) || m.channel!==channel || m.platform!==platform || m.arch!==arch)throw fail('UPDATE_WRONG_TARGET');
  const v=version(m.version);if(channel==='stable' && v.pre.length)throw fail('UPDATE_WRONG_CHANNEL');
  if(m.minimumVersion && compare(current,m.minimumVersion)<0)throw fail('UPDATE_MANUAL_UPGRADE_REQUIRED');
  const newer=compare(m.version,current)>0;
  const file=fileSpec(m.file,config);if(!new URL(file.url).pathname.toLowerCase().endsWith('.exe'))throw fail('UPDATE_BAD_FILE');
  const notes={};for(const lang of ['ru','en'])if(typeof m.notes?.[lang]==='string')notes[lang]=m.notes[lang].slice(0,12000);
  return {...m,file,notes,newer};
}
module.exports={MAX_ENVELOPE,fail,version,compare,repository,ready,validKey,repoURL,allowedURL,verifyEnvelope,fileSpec,applicationManifest};
