'use strict';
// Independent component catalog. No PulseDeck repository, cookies, tokens or
// executable code from the catalog. Trust is HTTPS + publisher SHA-256, not the
// application's Ed25519 release key. Signed custom catalogs remain supported.
const S=require('./security');
const SAFE_VERSION=/^[0-9]+(?:\.[0-9]+){1,3}(?:[-_][A-Za-z0-9.-]+)?$/;
const digest=/^[a-f0-9]{64}$/i;
function checksum(bytes,name=''){
  const text=Buffer.from(bytes).toString('utf8').trim();
  if(digest.test(text))return text.toLowerCase();
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
    if(m&&m[2]===name)return m[1].toLowerCase();
  }
  throw S.fail('COMPONENT_BAD_CHECKSUM');
}
function version(value){if(typeof value!=='string'||value.length>80||!SAFE_VERSION.test(value))throw S.fail('COMPONENT_BAD_CATALOG');return value;}
function newerOrEqual(a,b){
  if(!b)return true;const x=String(a).split(/[._-]/),y=String(b).split(/[._-]/);
  for(let i=0;i<Math.max(x.length,y.length);i++){const l=Number(x[i]||0),r=Number(y[i]||0);if(!Number.isFinite(l)||!Number.isFinite(r))return a!==b;if(l!==r)return l>r;}return true;
}
function metadataURL(raw,id){
  let u;try{u=new URL(raw);}catch{throw S.fail('UPDATE_UNTRUSTED_URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw S.fail('UPDATE_UNTRUSTED_URL');
  if(id==='ytdlp'&&u.origin==='https://api.github.com'&&u.pathname==='/repos/yt-dlp/yt-dlp/releases/latest'&&!u.search)return u.href;
  if(id==='ffmpeg'&&u.origin==='https://www.gyan.dev'&&u.pathname==='/ffmpeg/builds/release-version'&&!u.search)return u.href;
  return S.allowedURL(raw,{}, {component:true,redirect:true});
}
async function fetchComponent(id,transport,{signal}={}){
  const read=(url,maxBytes=256*1024)=>transport.jsonBytes(url,{signal,maxBytes,headers:{Accept:'application/json, text/plain','X-GitHub-Api-Version':'2022-11-28'},validate:u=>metadataURL(u,id)});
  if(id==='ytdlp'){
    let release;try{release=JSON.parse(await read('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',2*1024*1024));}catch(e){if(e.code)throw e;throw S.fail('COMPONENT_BAD_CATALOG');}
    if(release.draft||release.prerelease||!Array.isArray(release.assets)||release.assets.length>100)throw S.fail('COMPONENT_BAD_CATALOG');
    const v=version(release.tag_name),file=release.assets.find(a=>a.name==='yt-dlp.exe'),sums=release.assets.find(a=>a.name==='SHA2-256SUMS');
    if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>128*1024*1024)throw S.fail('COMPONENT_BAD_CATALOG');
    const expected=`https://github.com/yt-dlp/yt-dlp/releases/download/${v}/yt-dlp.exe`;
    if(file.browser_download_url!==expected)throw S.fail('UPDATE_UNTRUSTED_URL');
    let sha256;
    if(sums){if(sums.browser_download_url!==`https://github.com/yt-dlp/yt-dlp/releases/download/${v}/SHA2-256SUMS`)throw S.fail('UPDATE_UNTRUSTED_URL');sha256=checksum(await read(sums.browser_download_url),'yt-dlp.exe');}
    else if(/^sha256:[a-f0-9]{64}$/i.test(file.digest||''))sha256=file.digest.slice(7).toLowerCase();
    else throw S.fail('COMPONENT_BAD_CHECKSUM');
    if(file.digest&&file.digest!==`sha256:${sha256}`)throw S.fail('COMPONENT_BAD_CHECKSUM');
    return {id,version:v,format:'exe',origin:'upstream',license:'GPL-3.0-or-later (Windows PyInstaller binary)',sourceURL:`https://github.com/yt-dlp/yt-dlp/releases/tag/${v}`,file:{url:expected,sha256,size:file.size}};
  }
  if(id==='ffmpeg'){
    const v=version((await read('https://www.gyan.dev/ffmpeg/builds/release-version',256)).toString('utf8').trim()),name=`ffmpeg-${v}-essentials_build.zip`,url=`https://www.gyan.dev/ffmpeg/builds/packages/${name}`;
    const sha256=checksum(await read(url+'.sha256',4096),name);
    return {id,version:v,format:'zip',origin:'upstream',license:'GPL-3.0-or-later (Gyan build)',sourceURL:`https://github.com/GyanD/codexffmpeg/releases/tag/${v}`,file:{url,sha256,size:0,maxSize:536870912}};
  }
  throw S.fail('COMPONENT_NOT_AVAILABLE');
}
module.exports={fetchComponent,checksum,metadataURL,newerOrEqual};
