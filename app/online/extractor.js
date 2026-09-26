'use strict';
const M=require('../shared/online-search');
const {fail}=require('./http');
function proxyArgument(value){
  for(const part of String(value||'').split(';')){
    const p=part.trim();if(p==='DIRECT')return '';
    const match=p.match(/^(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([A-Za-z0-9.\-\[\]:]+)$/i);if(!match)continue;
    return `${/^SOCKS/i.test(match[1])?(match[1].toUpperCase()==='SOCKS4'?'socks4':'socks5'):match[1].toUpperCase()==='HTTPS'?'https':'http'}://${match[2]}`;
  }
  return '';
}
/** Uses only an existing local JS runtime and yt-dlp's bundled EJS scripts.
 * No remote-code component, cookies, login automation, DRM bypass or TLS override.
 */
function createExtractor({run,resolve,provision,runtimePath,env=process.env,resolveProxy,parse=JSON.parse}){
  let runtime;
  async function environment(url){
    const childEnv={...env,ELECTRON_RUN_AS_NODE:'1'},args=['--ignore-config','--no-js-runtimes'];
    if(!runtime)runtime=(async()=>{try{
      const options={env:childEnv,stallTimeoutMs:5000,totalTimeoutMs:6000},script=['-e','process.stdout.write(process.versions.node)'];
      const version=(await run(runtimePath,script,options)).stdout.trim(),[major,minor]=version.split('.').map(Number);if(major<22||!Number.isFinite(major))return false;
      const flags=major>23||major===23&&minor>=5?['--permission']:['--experimental-permission','--no-warnings=ExperimentalWarning'];
      return (await run(runtimePath,[...flags,...script],options)).stdout.trim()===version;
    }catch{return false;}})();
    if(await runtime)args.push('--js-runtimes',`node:${runtimePath}`);
    try{const proxy=proxyArgument(await resolveProxy?.(url));if(proxy)args.push('--proxy',proxy);}catch{/* Chromium may not yet have a proxy result. Leave yt-dlp's environment intact. */}
    return {args,env:childEnv};
  }
  async function inspect(url,{signal,probe=false}={}){
    const exe=resolve()||(!probe&&await provision());if(!exe)return null;
    const opts=await environment(url);
    const r=await run(exe,[...opts.args,'-f','bestaudio/best','--dump-single-json','--skip-download','--no-playlist','--no-warnings','--socket-timeout',probe?'8':'15','--retries',probe?'0':'2',url],{env:opts.env,signal,stallTimeoutMs:probe?12000:30000,totalTimeoutMs:probe?16000:55000});
    return parse(r.stdout);
  }
  async function fallback({provider,query,cursor,signal}){
    const exe=resolve();if(!exe)return null;
    // Flat search performs no media downloads; playlist range avoids re-returning page one.
    const page=Math.max(1,Number(cursor?.extractorPage)||1),start=(page-1)*25+1,end=page*25;
    const target=provider==='ytmusic'?`https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`:`${provider==='soundcloud'?'scsearch':'ytsearch'}${end}:${query}`;
    const o=await environment(provider==='soundcloud'?'https://soundcloud.com/':'https://www.youtube.com/');
    const r=await run(exe,[...o.args,'--flat-playlist','--dump-single-json','--skip-download','--no-warnings','--socket-timeout','10','--retries','1','--playlist-start',String(start),'--playlist-end',String(end),target],{env:o.env,signal,stallTimeoutMs:18000,totalTimeoutMs:30000});
    const data=parse(r.stdout),items=(data.entries||[]).filter(Boolean).map(x=>({...x,url:x.webpage_url||(/^https?:/.test(x.url)?x.url:provider==='soundcloud'?x.original_url:`https://www.youtube.com/watch?v=${x.id}`),thumbnail:x.thumbnail||x.thumbnails?.[0]?.url}));
    if(!Array.isArray(data.entries))throw fail('SEARCH_ADAPTER');
    return {items,cursor:items.length>=25?{extractorPage:page+1}:null};
  }
  return {inspect,fallback,environment};
}
module.exports={createExtractor,proxyArgument};
