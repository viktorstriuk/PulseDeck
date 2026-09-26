/* Shared, deterministic search model. No network, persistence or DOM access. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseOnlineSearch=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  const SOURCES=Object.freeze([
    {id:'ytmusic',name:'YouTube Music',icon:'music'}, {id:'youtube',name:'YouTube',icon:'youtube'},
    {id:'soundcloud',name:'SoundCloud',icon:'wave'}, {id:'bandcamp',name:'Bandcamp',icon:'disc'},
    {id:'newgrounds',name:'Newgrounds',icon:'headphones'}, {id:'archive',name:'Internet Archive',icon:'library'},
  ]);
  const IDS=SOURCES.map(s=>s.id),TEXT_LIMIT=300;
  const text=(v,max=TEXT_LIMIT)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
  const fold=v=>text(v,1200).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const translit=v=>fold(text(v,1200).toLocaleLowerCase().replace(/[а-яё]/g,c=>({'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}[c])));
  const unique=a=>[...new Set(a)];
  function preferences(raw={}) {
    if(!raw||typeof raw!=='object')raw={};
    const order=unique([...(Array.isArray(raw.order)?raw.order:[]).filter(x=>IDS.includes(x)),...IDS]);
    const enabled=Array.isArray(raw.enabled)?unique(raw.enabled.filter(x=>IDS.includes(x))):[...IDS];
    return {order,enabled,autoSearch:raw.autoSearch!==false,hideUnavailable:raw.hideUnavailable!==false};
  }
  function parseQuery(raw='',filters={}) {
    const q=text(raw),fields={artist:text(filters?.artist),track:text(filters?.track),album:text(filters?.album)};
    const free=q.replace(/\b(artist|track|title|album):\s*(?:"([^"]*)"|([^\s]+))/gi,(_,name,quoted,word)=>{
      const key=name.toLowerCase()==='title'?'track':name.toLowerCase();if(!fields[key])fields[key]=text(quoted??word);return ' ';
    }).trim().replace(/\s+/g,' ');
    const phrases=[...free.matchAll(/"([^"]+)"/g)].map(m=>fold(m[1])).filter(Boolean);
    const duration=['any','short','medium','long'].includes(filters?.duration)?filters.duration:'any';
    const version=['any','original','live','remix','instrumental','cover'].includes(filters?.version)?filters.version:'any';
    const effective=unique([free,...Object.values(fields)].filter(Boolean)).join(' ').slice(0,TEXT_LIMIT);
    return {raw:q,free,fields,phrases,duration,version,effective,valid:fold(effective).length>=2};
  }
  function safeURL(raw) {
    try{const u=new URL(text(raw,4096));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';return u.href;}catch{return '';}
  }
  function canonicalURL(raw) {
    const safe=safeURL(raw);if(!safe)return '';
    const u=new URL(safe),h=u.hostname.toLowerCase().replace(/^www\./,'');
    if(['youtube.com','music.youtube.com','m.youtube.com','youtu.be'].includes(h)) {
      const id=h==='youtu.be'?u.pathname.slice(1).split('/')[0]:u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1];
      if(id&&/^[A-Za-z0-9_-]{6,64}$/.test(id))return `youtube:${id}`;
    }
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid|ref$|from$|search_item_)/i.test(key))u.searchParams.delete(key);
    u.hostname=h;u.protocol='https:';u.searchParams.sort();return u.href.replace(/\/$/,'');
  }
  function providerURL(raw,provider){
    const safe=safeURL(raw);if(!safe)return false;const u=new URL(safe),h=u.hostname.toLowerCase().replace(/^www\./,'');
    if(u.port&&u.port!=='443'&&u.port!=='80')return false;
    if(['youtube','ytmusic'].includes(provider))return ['youtube.com','music.youtube.com','m.youtube.com','youtu.be'].includes(h)&&canonicalURL(raw).startsWith('youtube:');
    if(provider==='soundcloud')return h==='soundcloud.com'&&u.pathname.split('/').filter(Boolean).length>=2;
    if(provider==='bandcamp')return h.endsWith('.bandcamp.com')&&u.pathname.startsWith('/track/');
    if(provider==='newgrounds')return h==='newgrounds.com'&&/^\/audio\/listen\/\d+/.test(u.pathname);
    if(provider==='archive')return h==='archive.org'&&/^\/details\/[^/]+/.test(u.pathname);
    return false;
  }
  function normalizeItem(raw,provider,index=0) {
    if(!raw||!IDS.includes(provider))return null;
    const url=safeURL(raw.url||raw.webpage_url),key=canonicalURL(url);if(!key)return null;
    if(!providerURL(url,provider))return null;
    const title=text(raw.title||raw.track,500);if(!title)return null;
    const d=Number(raw.duration);
    return {id:key,key,provider,url,title,artist:text(raw.artist||raw.uploader||raw.channel||raw.creator,300),album:text(raw.album,300),
      duration:Number.isFinite(d)&&d>0?Math.min(7*86400,d):0,thumbnail:safeURL(raw.thumbnail),
      sourceRank:Number.isFinite(raw.sourceRank)?Math.max(0,raw.sourceRank):index,
      isLive:raw.isLive===true||raw.is_live===true,official:raw.official===true,
      availability:normalizeAvailability(raw.availability),license:text(raw.license,300)};
  }
  function normalizeAvailability(raw){
    const states=['unknown','available','blocked','preview'];
    if(!raw||!states.includes(raw.state))return {state:'unknown',reason:''};
    return {state:raw.state,reason:text(raw.reason,80),checkedAt:Number(raw.checkedAt)||0};
  }
  function words(value){return fold(value).split(' ').filter(Boolean);}
  function coverage(needle,haystack) {
    const n=words(needle),h=fold(haystack);if(!n.length)return 1;
    return n.reduce((s,w)=>s+(h.includes(w)?1:0),0)/n.length;
  }
  function similarity(a,b) {
    a=fold(a);b=fold(b);if(!a||!b)return 0;if(a===b)return 1;
    const grams=s=>new Set(Array.from({length:Math.max(0,s.length-2)},(_,i)=>s.slice(i,i+3)));
    const x=grams(a),y=grams(b);if(!x.size||!y.size)return (b.includes(a)||a.includes(b))?.5:0;
    let common=0;for(const g of x)if(y.has(g))common++;return 2*common/(x.size+y.size);
  }
  function variant(item){const v=fold(item.title);if(/(?:^| )(remix|ремикс|rework|mashup)(?: |$)/.test(v))return 'remix';if(/(?:^| )(live|concert|концерт|acoustic live)(?: |$)/.test(v)||item.isLive)return 'live';if(/(?:^| )(instrumental|инструментал|karaoke|караоке)(?: |$)/.test(v))return 'instrumental';if(/(?:^| )(cover|кавер)(?: |$)/.test(v))return 'cover';return 'original';}
  function matches(item,query) {
    const q=typeof query==='string'?parseQuery(query):query;
    // Unknown duration/metadata are not evidence of a mismatch. Keep such hits.
    if(q.duration!=='any'&&item.duration) {
      if(q.duration==='short'&&item.duration>=240||q.duration==='medium'&&(item.duration<240||item.duration>600)||q.duration==='long'&&item.duration<=600)return false;
    }
    if(q.version!=='any'&&variant(item)!==q.version)return false;
    const combined=`${item.title} ${item.artist} ${item.album}`;
    if(q.phrases.some(p=>!fold(combined).includes(p)))return false;
    for(const [key,value] of Object.entries(q.fields)) {
      if(!value)continue;
      if(key==='artist'&&!item.artist)continue;
      const field=key==='track'?item.title:key==='artist'?`${item.artist} ${item.title}`:item.album;
      if(field&&coverage(value,field)<1&&coverage(translit(value),translit(field))<1&&similarity(value,field)<.6&&similarity(translit(value),translit(field))<.6)return false;
    }
    return true;
  }
  function score(item,q,order=IDS) {
    const title=fold(item.title),creator=fold(item.artist),free=fold(q.free||q.effective),joined=`${title} ${creator}`;
    let value=70*coverage(free,joined)+24*similarity(free,title)+12*similarity(free,joined);
    if(free&&free===title)value+=65;else if(free&&title.includes(free))value+=24;
    if(free&&joined.includes(free))value+=15;
    if(free&&coverage(translit(free),translit(joined))===1)value+=10;
    if(q.fields.track)value+=40*similarity(q.fields.track,title)+20*coverage(q.fields.track,title);
    if(q.fields.artist)value+=40*similarity(q.fields.artist,creator)+15*coverage(q.fields.artist,creator);
    const v=variant(item);if(q.version==='any'&&v!=='original'&&!fold(q.effective).includes(v))value-=8;
    if(item.official)value+=3;
    // Source priority breaks close matches, never buries an exact hit below noise.
    value+=12/(1+Math.max(0,order.indexOf(item.provider)))+8/(1+Math.max(0,item.sourceRank)/8);
    return value;
  }
  const scores=new WeakMap();
  function cachedScore(item,q,order,queryKey){
    const key=JSON.stringify([queryKey,item.title,item.artist,item.sourceRank,item.official,item.isLive]);
    const previous=scores.get(item);if(previous?.key===key)return previous.value;
    const value=score(item,q,order);scores.set(item,{key,value});return value;
  }
  function rank(items,query,prefs={}) {
    const p=preferences(prefs),q=typeof query==='string'?parseQuery(query):query,byKey=new Map(),queryKey=JSON.stringify([q.free,q.effective,q.fields,q.version,p.order]);
    for(const item of items||[]) {
      if(!p.enabled.includes(item.provider)||!matches(item,q)||p.hideUnavailable&&item.availability?.state==='blocked')continue;
      const old=byKey.get(item.key||canonicalURL(item.url));
      if(!old||p.order.indexOf(item.provider)<p.order.indexOf(old.provider))byKey.set(item.key||canonicalURL(item.url),item);
    }
    return [...byKey.values()].map(item=>({item,value:cachedScore(item,q,p.order,queryKey)})).sort((a,b)=>b.value-a.value||a.item.sourceRank-b.item.sourceRank||a.item.key.localeCompare(b.item.key)).map(x=>x.item);
  }
  function availabilityFromMetadata(meta={}) {
    const formats=(Array.isArray(meta.formats)?meta.formats:[]).filter(f=>f&&(f.acodec&&f.acodec!=='none'||f.vcodec==='none'));
    const clear=formats.filter(f=>f.has_drm!==true&&safeURL(f.url));
    if(clear.length) {
      const full=clear.filter(f=>!/(?:^|[_ -])preview(?:$|[_ -])/i.test(`${f.format_id||''} ${f.format_note||''}`));
      return {state:full.length?'available':'preview',reason:full.length?'SEARCH_STREAM_FOUND':'SEARCH_PREVIEW_ONLY'};
    }
    if(meta.has_drm===true||formats.length>0&&formats.every(f=>f.has_drm===true))return {state:'blocked',reason:'SEARCH_DRM'};
    if(meta.availability==='private')return {state:'unknown',reason:'SEARCH_SIGN_IN'};
    if(meta.is_unavailable===true&&meta.reason==='deleted')return {state:'blocked',reason:'SEARCH_REMOVED'};
    return {state:'unknown',reason:''};
  }
  function classifyError(error) {
    const msg=String(error?.message||error||''),c=String(error?.code||''),status=Number(error?.status)||0;
    if(error?.name==='AbortError'||c==='SEARCH_CANCELLED')return {code:'SEARCH_CANCELLED',retryable:false};
    if(/^SEARCH_[A-Z_]+$/.test(c))return {code:c,status,retryable:!['SEARCH_DRM','SEARCH_REMOVED','SEARCH_BAD_QUERY','SEARCH_BAD_CURSOR'].includes(c),retryAfter:Number(error.retryAfter)||0};
    if(!/\b(?:not|no|without|isn't)\b.{0,35}\bDRM/i.test(msg)&&/(?:video|track|audio|content|media|formats?) (?:is|are|appears to be) (?:DRM[- ]protected|protected (?:by|with) DRM)|(?:video|track|audio|content) has DRM protection|(?:only|all) (?:available )?(?:formats?|streams?) (?:are|is) DRM[- ]protected|DRM[- ]protected (?:video|track|audio|content|media)/i.test(msg))return {code:'SEARCH_DRM',retryable:false};
    if(/(?:video|track|submission|item) (?:has been |was )?(?:deleted|removed)|removed by (?:the uploader|uploader)|does not exist anymore/i.test(msg))return {code:'SEARCH_REMOVED',retryable:false};
    if(status===429||/\b429\b|too many requests|rate.limit/i.test(msg))return {code:'SEARCH_RATE_LIMIT',status:429,retryable:true,retryAfter:60};
    if(/Sign in|log.?in|confirm you|not a bot|cookies|captcha|private video/i.test(msg))return {code:'SEARCH_SIGN_IN',status,retryable:true};
    if(/not available in your country|geo.restrict|blocked in your country/i.test(msg))return {code:'SEARCH_REGION',retryable:true};
    if(status===403||/\b403\b|forbidden/i.test(msg))return {code:'SEARCH_ACCESS',status:403,retryable:true};
    if(/certificate|CERT_|TLS|SSL/i.test(msg))return {code:'SEARCH_TLS',retryable:true};
    if(/ENOENT|COMPONENT_|UPDATE_|yt-dlp.*not found/i.test(`${c} ${msg}`))return {code:'SEARCH_TOOL',retryable:true};
    if(/no such option|Unsupported URL|extract.*(?:failed|unable)|unable to extract|unexpected response/i.test(msg))return {code:'SEARCH_ADAPTER',retryable:true};
    if(/timed? ?out|timeout|ETIMEDOUT|no progress/i.test(`${c} ${msg}`))return {code:'SEARCH_TIMEOUT',retryable:true};
    return {code:'SEARCH_NETWORK',status,retryable:true};
  }
  return {SOURCES,IDS,text,fold,translit,preferences,parseQuery,safeURL,canonicalURL,providerURL,normalizeItem,normalizeAvailability,coverage,similarity,variant,matches,score,rank,availabilityFromMetadata,classifyError};
});
