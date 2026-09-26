'use strict';
const https=require('node:https'), fs=require('node:fs'), crypto=require('node:crypto');
const {fail,allowedURL,MAX_ENVELOPE,repository}=require('./security');
// Redirects are validated hop-by-hop. Credentials and cookies are never sent.
function response(url,{signal,headers={},validate=u=>u,timeout=30000,redirects=0,fetchImpl}={}) {
  if(fetchImpl)return fetchResponse(url,{signal,headers,validate,timeout,redirects,fetchImpl});
  return new Promise((resolve,reject)=>{
    if(redirects>5)return reject(fail('UPDATE_TOO_MANY_REDIRECTS'));
    try{validate(url);}catch(e){return reject(e);}
    const req=https.get(url,{headers:{'User-Agent':'PulseDeck updater','Accept':'application/octet-stream',...headers},signal},res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {
        const location=res.headers.location;res.resume();if(!location)return reject(fail('UPDATE_HTTP_ERROR'));
        let next;try{next=new URL(location,url).href;}catch{return reject(fail('UPDATE_UNTRUSTED_URL'));}
        response(next,{signal,headers,validate,timeout,redirects:redirects+1}).then(resolve,reject);return;
      }
      if(res.statusCode!==200){res.resume();return reject(fail(res.statusCode===403||res.statusCode===429?'UPDATE_RATE_LIMITED':'UPDATE_HTTP_ERROR'));}
      // A body stall also closes the request; a hung socket must not keep UI busy forever.
      res.setTimeout(timeout,()=>res.destroy(fail('UPDATE_TIMEOUT')));
      resolve(res);
    });
    req.setTimeout(timeout,()=>req.destroy(fail('UPDATE_TIMEOUT')));req.on('error',reject);
  });
}
async function jsonBytes(url,options={}) {
  const res=await response(url,options), chunks=[];let size=0;
  for await(const chunk of res){size+=chunk.length;if(size>(options.maxBytes||MAX_ENVELOPE)){res.destroy();throw fail('UPDATE_MANIFEST_TOO_LARGE');}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function download(file,destination,{config,signal,onProgress=()=>{},component=false,fetchImpl}={}) {
  const part=destination+'.part';await fs.promises.unlink(part).catch(()=>{});
  let handle;
  try{
    const res=await response(file.url,{signal,fetchImpl,validate:u=>allowedURL(u,config,{redirect:true,component})});
    const length=Number(res.headers['content-length']);if(length && (file.size>0 ? length!==file.size : length>(file.maxSize||1024**3))){res.destroy();throw fail('UPDATE_SIZE_MISMATCH');}
    handle=await fs.promises.open(part,'wx',0o600);let size=0,last=0;const hash=crypto.createHash('sha256');
    for await(const chunk of res){if(signal?.aborted)throw fail('UPDATE_CANCELLED');size+=chunk.length;if(size>(file.size||file.maxSize||1024**3)){res.destroy();throw fail('UPDATE_SIZE_MISMATCH');}hash.update(chunk);
      let offset=0;while(offset<chunk.length){const n=await handle.write(chunk,offset,chunk.length-offset);if(!n.bytesWritten)throw fail('UPDATE_WRITE_FAILED');offset+=n.bytesWritten;}
      if(Date.now()-last>100){onProgress({received:size,total:file.size||length||0,percent:file.size||length?Math.min(99,Math.floor(size/(file.size||length)*100)):0});last=Date.now();}
    }
    if((file.size>0 && size!==file.size) || hash.digest('hex')!==file.sha256)throw fail('UPDATE_HASH_MISMATCH');
    await handle.sync();await handle.close();handle=null;await fs.promises.rename(part,destination);onProgress({received:size,total:size,percent:100});return destination;
  }catch(e){await handle?.close().catch(()=>{});await fs.promises.unlink(part).catch(()=>{});throw e;}
}
async function sha256(file){const h=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))h.update(part);return h.digest('hex');}
async function fetchFeed(config,channel,kind='application',{signal,fetchImpl}={}) {
  const r=repository(config);if(!r)throw fail('UPDATE_NOT_CONFIGURED');
  const api=`https://api.github.com/repos/${r.owner}/${r.name}/releases?per_page=30`;
  const bytes=await jsonBytes(api,{signal,fetchImpl,maxBytes:2*1024*1024,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},validate:u=>{const p=new URL(u);if(p.origin!=='https://api.github.com'||p.pathname!==`/repos/${r.owner}/${r.name}/releases`)throw fail('UPDATE_UNTRUSTED_URL');}});
  let releases;try{releases=JSON.parse(bytes);}catch{throw fail('UPDATE_BAD_MANIFEST');}if(!Array.isArray(releases))throw fail('UPDATE_BAD_MANIFEST');
  const name=(kind==='components'?config.componentsAsset:config.releaseAsset).replace('{channel}',channel);
  const release=releases.filter(r=>!r.draft && (channel==='beta'||!r.prerelease)).find(r=>Array.isArray(r.assets)&&r.assets.some(a=>a.name===name));
  if(!release)throw fail('UPDATE_NO_RELEASE');
  const asset=release.assets.find(a=>a.name===name);allowedURL(asset.browser_download_url,config);
  return jsonBytes(asset.browser_download_url,{signal,fetchImpl,validate:u=>allowedURL(u,config,{redirect:true})});
}

/** Chromium transport preserves system proxy/PAC while retaining the same
 * host allowlist, signed manifests, byte bounds and SHA-256 verification. */
async function fetchResponse(url,{signal,headers={},validate=u=>u,timeout=30000,redirects=0,fetchImpl}){
  const {Readable}=require('node:stream'),controller=new AbortController();let timer,expired=false;
  const abort=()=>controller.abort(),kick=()=>{clearTimeout(timer);timer=setTimeout(()=>{expired=true;controller.abort();},timeout);};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  if(signal?.aborted)throw fail('UPDATE_CANCELLED');signal?.addEventListener('abort',abort,{once:true});kick();
  try{
    let result;
    for(let hop=redirects;;hop++){
      if(hop>5)throw fail('UPDATE_TOO_MANY_REDIRECTS');validate(url);
      result=await fetchImpl(url,{headers:{'User-Agent':'PulseDeck updater','Accept':'application/octet-stream',...headers},signal:controller.signal,credentials:'omit',redirect:'manual'});
      if(![301,302,303,307,308].includes(result.status))break;
      const location=result.headers.get('location');await result.body?.cancel();if(!location)throw fail('UPDATE_HTTP_ERROR');url=new URL(location,url).href;
    }
    if(result.status!==200){await result.body?.cancel();throw fail([403,429].includes(result.status)?'UPDATE_RATE_LIMITED':'UPDATE_HTTP_ERROR');}
    kick();const stream=Readable.from((async function*(){try{for await(const chunk of result.body){kick();yield Buffer.from(chunk);}}catch(e){throw expired?fail('UPDATE_TIMEOUT'):signal?.aborted?fail('UPDATE_CANCELLED'):e;}finally{cleanup();}})());
    stream.headers=Object.fromEntries(result.headers.entries());stream.statusCode=result.status;
    stream.once('close',()=>{cleanup();controller.abort();});return stream;
  }catch(e){cleanup();controller.abort();throw expired?fail('UPDATE_TIMEOUT'):signal?.aborted?fail('UPDATE_CANCELLED'):e;}
}
function forFetch(fetchImpl){return {response:(url,o={})=>response(url,{...o,fetchImpl}),jsonBytes:(url,o={})=>jsonBytes(url,{...o,fetchImpl}),download:(file,dest,o={})=>download(file,dest,{...o,fetchImpl}),sha256,fetchFeed:(config,channel,kind,o={})=>fetchFeed(config,channel,kind,{...o,fetchImpl})};}
module.exports={response,jsonBytes,download,sha256,fetchFeed,forFetch};
