'use strict';
const M=require('../shared/online-search'),{fail}=require('./http');
const SONG_PARAMS='EgWKAQIIAWoKEAoQAxAEEAkQBQ==';
function decode(text){return String(text||'').replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi,(_,num,name)=>{if(num){const cp=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';}return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[name]||_;});}
const clean=s=>decode(String(s||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function duration(v){if(typeof v==='number')return v;const t=String(v||'').trim();if(!/^\d+(?::\d{1,2}){1,2}$/.test(t))return Number(t)||0;return t.split(':').reduce((n,s)=>n*60+Number(s),0);}
function rich(x){return x?.simpleText||x?.runs?.map(r=>r.text||'').join('')||'';}
function walk(root,key,max=40000){const result=[],stack=[root];let count=0;while(stack.length&&count++<max){const node=stack.pop();if(!node||typeof node!=='object')continue;if(Object.prototype.hasOwnProperty.call(node,key))result.push(node[key]);for(const child of Object.values(node).reverse())if(child&&typeof child==='object')stack.push(child);}return result;}
// Read balanced JSON embedded in script tags; never execute provider JavaScript.
function readJSONAt(input,start){let i=start;while(/\s/.test(input[i]||'')&&i<input.length)i++;if(!['{','['].includes(input[i]))return null;const begin=i,stack=[];let quoted=false,escaped=false;for(;i<input.length;i++){const c=input[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')stack.push(c);else if(c==='}'||c===']'){if(!stack.length)return null;stack.pop();if(!stack.length){try{return JSON.parse(input.slice(begin,i+1));}catch{return null;}}}}return null;}
function assigned(input,pattern){const re=new RegExp(pattern,'g');let m;while((m=re.exec(input))){const value=readJSONAt(input,re.lastIndex);if(value)return value;}return null;}
function youtubeConfig(html,music=false){
  let cfg={};const re=/ytcfg\.set\s*\(/g;let m;while((m=re.exec(html))){const v=readJSONAt(html,re.lastIndex);if(v)Object.assign(cfg,v);}
  const context=cfg.INNERTUBE_CONTEXT||assigned(html,'"INNERTUBE_CONTEXT"\\s*:\\s*');
  const version=cfg.INNERTUBE_CLIENT_VERSION||html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
  if(!context?.client&&!version)throw fail('SEARCH_ADAPTER');
  const client=context?.client||{clientName:music?'WEB_REMIX':'WEB',clientVersion:version};
  return {context:{client:{clientName:client.clientName|| (music?'WEB_REMIX':'WEB'),clientVersion:client.clientVersion||version,hl:'en',...(client.visitorData?{visitorData:client.visitorData}:{})}},key:cfg.INNERTUBE_API_KEY||''};
}
function continuation(data){return walk(data,'continuationCommand').map(v=>v?.token).find(Boolean)||walk(data,'nextContinuationData').map(v=>v?.continuation).find(Boolean)||'';}
function thumbnail(node){return walk(node,'thumbnails').flat().filter(t=>t?.url).sort((a,b)=>(Number(a.width)||300)-(Number(b.width)||300)).find(t=>!t.width||t.width>=120)?.url||'';}
function parseYouTube(data,music=false){
  const list=[];
  if(music)for(const item of walk(data,'musicResponsiveListItemRenderer')){
    const columns=(item.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text||{}),runs=columns.flatMap(c=>c.runs||[]);
    const id=item.playlistItemData?.videoId||walk(item,'watchEndpoint').find(x=>x?.videoId)?.videoId;if(!id)continue;
    const artistRuns=runs.filter(r=>/^UC/.test(r.navigationEndpoint?.browseEndpoint?.browseId||''));
    const albumRun=runs.find(r=>/^(MPRE|FEmusic_library_privately_owned_release)/.test(r.navigationEndpoint?.browseEndpoint?.browseId||''));
    const secondary=rich(columns[1]);const artist=artistRuns.map(r=>r.text).join(', ')||secondary.split(/\s*[•·]\s*/)[0]||'';
    const clock=[...runs.map(r=>r.text),...(item.fixedColumns||[]).map(c=>rich(c.musicResponsiveListItemFixedColumnRenderer?.text))].find(t=>/^\d+(?::\d{2}){1,2}$/.test(t||''));
    list.push({id,title:rich(columns[0]),artist,album:albumRun?.text||'',duration:duration(clock),thumbnail:thumbnail(item),url:`https://music.youtube.com/watch?v=${encodeURIComponent(id)}`,official:true});
  }
  else for(const v of walk(data,'videoRenderer')){
    if(!v?.videoId)continue;list.push({id:v.videoId,title:rich(v.title),artist:rich(v.ownerText||v.longBylineText||v.shortBylineText),duration:duration(rich(v.lengthText)),thumbnail:thumbnail(v),url:`https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`,isLive:!v.lengthText&&walk(v,'label').some(l=>/^(LIVE|LIVE NOW)$/.test(l)),official:walk(v,'style').includes('BADGE_STYLE_TYPE_VERIFIED_ARTIST')});
  }
  const recognized=!!(data.contents||data.continuationContents||data.onResponseReceivedCommands||data.onResponseReceivedActions);
  if(!recognized)throw fail('SEARCH_ADAPTER');
  return {items:list,next:continuation(data)};
}
function attr(tag,name){const m=String(tag).match(new RegExp('\\b'+name+'\\s*=\\s*(["\'])([\\s\\S]*?)\\1','i'));return m?decode(m[2]):'';}
function classText(block,name){return clean(block.match(new RegExp('<[^>]+class=["\'][^"\']*\\b'+name+'\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/(?:div|span|h[1-6]|p)>','i'))?.[1]||'');}
function parseBandcamp(html){
  const items=[];for(const b of html.match(/<li\b[^>]*class=["'][^"']*\bsearchresult\b[^"']*["'][\s\S]*?<\/li>/gi)||[]){
    const links=[...b.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const link=links.find(m=>/\.bandcamp\.com\/track\//i.test(decode(m[1])));if(!link)continue;
    let url;try{url=new URL(decode(link[1]));for(const key of [...url.searchParams.keys()])url.searchParams.delete(key);}catch{continue;}
    const heading=classText(b,'heading')||clean(link[2]);const sub=classText(b,'subhead');
    items.push({url:url.href,title:heading,artist:sub.replace(/^.*?\bby\s+/i,'').trim(),album:classText(b,'album'),thumbnail:attr(b.match(/<img\b[^>]*>/i)?.[0]||'','src')});
  }
  if(!items.length&&!/no (?:matching )?results|no results found|searchresult|search-results|search-results-list/i.test(html))throw fail('SEARCH_ADAPTER');
  return items;
}
function parseNewgrounds(html){
  const items=[];for(const m of html.matchAll(/<a\b([^>]*href=["'][^"']*\/audio\/listen\/\d+[^>]*?)>([\s\S]*?)<\/a>/gi)){
    const tag=m[1],b=m[2];if(!/item-audiosubmission|item-portalsubmission|audio|title=/i.test(tag+b))continue;
    let url;try{url=new URL(attr(tag,'href'),'https://www.newgrounds.com').href;}catch{continue;}
    const title=clean(b.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i)?.[1]||attr(tag,'title')||classText(b,'title')||b);
    const artist=classText(b,'author')||classText(b,'user')||clean(b.match(/\bby\s*<[^>]*>([\s\S]*?)<\//i)?.[1]||'');
    items.push({url,title,artist,duration:duration(clean(b).match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0]),thumbnail:attr(b.match(/<img\b[^>]*>/i)?.[0]||'','src')});
  }
  if(!items.length&&!/no (?:matching )?(?:results|audio)|nothing found|search-results|search_results|item-audiosubmission/i.test(html))throw fail('SEARCH_ADAPTER');
  return items;
}
function nextHTMLPage(html,current){
  for(const m of html.matchAll(/<a\b([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)){
    const href=attr(m[1],'href');let u;try{u=new URL(href,'https://placeholder.invalid');}catch{continue;}
    const page=Number(u.searchParams.get('page'));if(page===current+1)return page;
  }
  return null;
}
function soundcloudItem(t){
  const trans=t.media?.transcodings||[],drm=trans.length>0&&trans.every(x=>/^(ctr|cbc)-/.test(x.format?.protocol||''));
  const previews=trans.length>0&&trans.every(x=>x.snipped===true);
  return {title:t.title,artist:t.publisher_metadata?.artist||t.user?.username||'',album:t.publisher_metadata?.album_title||'',url:t.permalink_url,duration:(Number(t.full_duration)||Number(t.duration)||0)/1000,thumbnail:t.artwork_url||t.user?.avatar_url||'',license:t.license,
    availability:drm&&!t.downloadable?{state:'blocked',reason:'SEARCH_DRM'}:previews?{state:'preview',reason:'SEARCH_PREVIEW_ONLY'}:{state:'unknown',reason:t.policy==='BLOCK'?'SEARCH_REGION':''}};
}
function archiveFiles(data,id){
  const all=Array.isArray(data.files)?data.files:[],audio=all.filter(f=>/\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i.test(f.name||'')&&f.private!==true&&f.private!=='true');
  const byOriginal=new Map();for(const f of audio){const key=f.original||f.name,old=byOriginal.get(key);const weight=n=>/\.(mp3|m4a)$/i.test(n)?3:/\.(flac|opus)$/i.test(n)?2:1;if(!old||weight(f.name)>weight(old.name))byOriginal.set(key,f);}
  const meta=data.metadata||{},creator=Array.isArray(meta.creator)?meta.creator.join(', '):meta.creator||'';
  return [...byOriginal.values()].map(f=>({title:f.title||String(f.name).split('/').pop().replace(/\.[^.]+$/,''),artist:f.artist||creator,album:meta.title||'',duration:duration(f.length),license:meta.licenseurl||'',thumbnail:`https://archive.org/services/img/${encodeURIComponent(id)}`,url:`https://archive.org/details/${encodeURIComponent(id)}/${(f.original||f.name).split('/').map(encodeURIComponent).join('/')}`}));
}
/** Each continuation is internal state, never a URL accepted from the renderer. */
function createProviders(http){
  const bootstrap=new Map(),metadata=new Map();let scClient=null;
  async function getYTConfig(music,signal){const key=music?'music':'web',cached=bootstrap.get(key);if(cached&&cached.until>Date.now())return cached.value;const host=music?'music.youtube.com':'www.youtube.com';const html=await http.text(`https://${host}/`,{signal});const value=youtubeConfig(html,music);bootstrap.set(key,{value,until:Date.now()+3600000});return value;}
  async function youtube({query,cursor,signal},music){
    const host=music?'music.youtube.com':'www.youtube.com';let cfg,data;
    if(!music&&!cursor){
      const html=await http.text(`https://${host}/results?search_query=${encodeURIComponent(query)}&sp=${encodeURIComponent('EgIQAfABAQ==')}`,{signal});
      data=assigned(html,'(?:var\\s+)?ytInitialData\\s*=\\s*')||assigned(html,'window\\["ytInitialData"\\]\\s*=\\s*');
      if(!data)throw fail(/consent|before you continue|unusual traffic/i.test(html)?'SEARCH_SIGN_IN':'SEARCH_ADAPTER');
      cfg=youtubeConfig(html,false);
    }else{
      cfg=cursor?.cfg||await getYTConfig(music,signal);
      const body={context:cfg.context,...(cursor?.token?{continuation:cursor.token}:{query,params:music?SONG_PARAMS:'EgIQAfABAQ=='})};
      const url=`https://${host}/youtubei/v1/search?prettyPrint=false${cfg.key?'&key='+encodeURIComponent(cfg.key):''}`;
      data=await http.json(url,{signal,method:'POST',headers:{'Content-Type':'application/json','Origin':`https://${host}`,'Referer':`https://${host}/`},body:JSON.stringify(body)});
    }
    const page=parseYouTube(data,music);return {items:page.items,cursor:page.next?{token:page.next,cfg}:null};
  }
  async function clientID(signal,refresh=false){
    if(!refresh&&scClient&&scClient.until>Date.now())return scClient.value;
    const html=await http.text('https://soundcloud.com/',{signal});
    const assets=[...html.matchAll(/<script\b[^>]+src=["']([^"']+)["']/gi)].map(m=>decode(m[1])).filter(u=>/^https:\/\/a-v2\.sndcdn\.com\//.test(u)).reverse().slice(0,8);
    for(const asset of assets){const js=await http.text(asset,{signal,maxBytes:5*1024*1024});const value=js.match(/client_id\s*:\s*"([0-9a-zA-Z]{32})"/)?.[1];if(value){scClient={value,until:Date.now()+3600000};return value;}}
    throw fail('SEARCH_ADAPTER');
  }
  async function soundcloud({query,cursor,signal}){
    let data;for(let attempt=0;attempt<2;attempt++){
      const id=await clientID(signal,attempt===1),params=new URLSearchParams({q:query,client_id:id,limit:'25',offset:String(cursor?.offset||0),linked_partitioning:'1'});
      try{data=await http.json(`https://api-v2.soundcloud.com/search/tracks?${params}`,{signal});break;}catch(e){if(attempt||!['SEARCH_ACCESS','SEARCH_SIGN_IN'].includes(e.code))throw e;}
    }
    if(!Array.isArray(data.collection))throw fail('SEARCH_ADAPTER');
    let offset='';try{const u=new URL(data.next_href);if(u.origin==='https://api-v2.soundcloud.com'&&u.pathname==='/search/tracks')offset=u.searchParams.get('offset')||'';}catch{}
    return {items:data.collection.map(soundcloudItem),cursor:offset?{offset}:null};
  }
  async function bandcamp({query,cursor,signal}){const page=cursor?.page||1,html=await http.text(`https://bandcamp.com/search?${new URLSearchParams({q:query,item_type:'t',page:String(page)})}`,{signal});const items=parseBandcamp(html),next=nextHTMLPage(html,page);return {items,cursor:next?{page:next}:null};}
  async function newgrounds({query,cursor,signal}){const page=cursor?.page||1,html=await http.text(`https://www.newgrounds.com/audio/search/title/${encodeURIComponent(query)}?page=${page}`,{signal});const items=parseNewgrounds(html),next=nextHTMLPage(html,page);return {items,cursor:next?{page:next}:null};}
  async function archive({query,cursor,signal}){
    const state=cursor?{...cursor,ids:[...cursor.ids]}:{page:1,ids:[],index:0,fileOffset:0,more:true};const items=[];let visited=0;
    while(items.length<24&&visited++<8){
      if(state.index>=state.ids.length){
        if(!state.more)break;
        const words=query.replace(/[+\-!(){}\[\]^"~*?:\\/]/g,' ').trim().split(/\s+/).filter(Boolean).map(w=>'"'+w+'"').join(' AND ');
        const params=new URLSearchParams({q:`mediatype:audio AND (${words}) AND -access-restricted-item:true`,output:'json',rows:'5',page:String(state.page)});params.append('fl[]','identifier');
        const data=await http.json(`https://archive.org/advancedsearch.php?${params}`,{signal});
        if(!Array.isArray(data.response?.docs))throw fail('SEARCH_ADAPTER');
        state.ids=data.response.docs.map(d=>d.identifier).filter(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id));state.index=0;state.fileOffset=0;state.more=state.page*5<Number(data.response.numFound);state.page++;
        if(!state.ids.length)break;
      }
      const id=state.ids[state.index];let data=metadata.get(id);
      if(!data){data=await http.json(`https://archive.org/metadata/${encodeURIComponent(id)}?extended_err=1`,{signal});metadata.set(id,data);while(metadata.size>8)metadata.delete(metadata.keys().next().value);}
      const files=archiveFiles(data,id),slice=files.slice(state.fileOffset,state.fileOffset+24-items.length);items.push(...slice);state.fileOffset+=slice.length;
      if(state.fileOffset>=files.length){state.index++;state.fileOffset=0;}
    }
    return {items,cursor:state.index<state.ids.length||state.more?state:null};
  }
  return {ytmusic:args=>youtube(args,true),youtube:args=>youtube(args,false),soundcloud,bandcamp,newgrounds,archive};
}
module.exports={createProviders,parseYouTube,youtubeConfig,readJSONAt,assigned,continuation,parseBandcamp,parseNewgrounds,nextHTMLPage,soundcloudItem,archiveFiles,decode,clean,duration,SONG_PARAMS};
