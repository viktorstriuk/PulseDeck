'use strict';
// Query expansion is intentionally separate from library tags and artist aliases.
// Fuzzy scoring ranks retrieved candidates; it cannot make a remote catalog exhaustive.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseLyricsSearch = api;
})(globalThis, () => {
  const cleanSpace = s => String(s || '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const map = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ї:'yi',є:'ye',ґ:'g'};
  const transliterate = s => cleanSpace(s).toLowerCase().replace(/[а-яёіїєґ]/g, c => map[c] ?? c);
  function fold(s) {
    return transliterate(s).normalize('NFD').replace(/\p{M}/gu,'').replace(/shtern/g,'stern').replace(/kh/g,'h').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }
  // Production labels can include a year or a comma. Meaningful editions stay.
  const edition = /\b(live|remix|mix|cover|acoustic|instrumental|karaoke|slowed|sped\s*up|remaster(?:ed)?|edit)\b|ремикс|концерт|акустик|кавер|ускорен|замедлен|инструментал/iu;
  const rubbish = /^(?:(?:official|music|lyric(?:s)?|video|audio|visuali[sz]er|hd|hq|4k|8k|1080p|720p|2160p|full\s*hd|clip|mv|офиц\.?|официальн(?:ый|ое|ая)|клип|видео|аудио|текст(?:\s+песни)?|премьера|[12]\d{3})[\s,.|/+:!_-]*)+$/iu;
  function cleanTitle(s) {
    return cleanSpace(s).replace(/[\[({]([^\])}]{0,150})[\])}]/g,(all,inside) => rubbish.test(inside.trim()) && !edition.test(inside) ? ' ' : all)
      .replace(/(?:\s*[|–—-]\s*|\s+)(?:official\s+(?:music\s+)?(?:video|audio)|official\s+lyric(?:s)?\s+video|\[?(?:hd|hq|4k|1080p)\]?)(?:\s*,?\s*[12]\d{3})?\s*$/gi,'').replace(/\s+/g,' ').trim();
  }
  function identity(track = {}) {
    const originalArtist = cleanSpace(track.artist).slice(0,200), originalTitle = cleanSpace(track.title).slice(0,300);
    let artist = originalArtist, title = cleanTitle(originalTitle), fromTitle = false;
    const prefixed = /^(.{1,100}?)\s+[-–—]\s+(.+)$/.exec(title);
    if (prefixed && !edition.test(prefixed[1])) {
      artist = prefixed[1].trim(); title = prefixed[2].trim(); fromTitle = fold(artist) !== fold(originalArtist);
      // Two repeated prefixes, e.g. uploader metadata and a duplicated title tag.
      if (fold(title).startsWith(fold(artist)+' ')) {
        const again = /^(.{1,100}?)\s+[-–—]\s+(.+)$/.exec(title);
        if (again && fold(again[1]) === fold(artist)) title = again[2].trim();
      }
    } else if (artist) {
      const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp('^'+escaped+'\\s*[-–—:]\\s*','i'),'');
    }
    return {artist:artist.slice(0,200),title:cleanTitle(title).slice(0,200)||originalTitle,originalArtist,originalTitle,fromTitle};
  }
  function editRatio(a,b) {
    if(a===b)return 1;if(!a||!b)return 0;
    a=a.slice(0,240);b=b.slice(0,240);let prev=Array.from({length:b.length+1},(_,i)=>i),prev2=prev;
    for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++){
      row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],prev2[j-2]+1);
    }prev2=prev;prev=row;}return 1-prev[b.length]/Math.max(a.length,b.length);
  }
  function similarity(a,b) {
    a=fold(a);b=fold(b);if(!a||!b)return 0;
    const aa=[...new Set(a.split(' '))],bb=[...new Set(b.split(' '))];
    const coverage = (one,two) => one.reduce((s,x)=>s+Math.max(...two.map(y=>editRatio(x,y))),0)/one.length;
    return Math.max(editRatio(a,b),editRatio([...aa].sort().join(' '),[...bb].sort().join(' ')),.9*Math.min(coverage(aa,bb),coverage(bb,aa)));
  }
  const editions = s => (fold(s).match(/\b(live|remix|acoustic|cover|instrumental|karaoke|slowed|sped up|remaster(?:ed)?)\b/g)||[]).sort().join(' ');
  function plan(artist,title) {
    const q=identity({artist,title}),queries=[];
    const add = params => {if(!Object.values(params).some(Boolean))return;const key=JSON.stringify(params).toLowerCase();if(!queries.some(x=>JSON.stringify(x).toLowerCase()===key))queries.push(params);};
    add({track_name:q.title,...(q.artist?{artist_name:q.artist}:{})});
    add({q:[q.artist,q.title].filter(Boolean).join(' ')});
    add({track_name:q.title});
    const latin=transliterate(q.title);if(latin!==q.title.toLowerCase())add({track_name:latin});
    // An exact surviving word lets the server retrieve candidates with a typo
    // elsewhere. Local edit distance then ranks them; no private library is sent.
    const words=q.title.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w.length>=3).sort((a,b)=>b.length-a.length);
    for(const word of [...new Set(words)].slice(0,2))add({track_name:word});
    // Reserve room for artist-only retrieval. Local fuzzy ranking cannot recover
    // a typo if the remote catalog never returned its candidate in the first place.
    if(q.artist){add({q:q.artist});const canonical=fold(q.artist);if(canonical&&canonical!==q.artist.toLowerCase())add({q:canonical});}
    return {identity:q,queries:queries.slice(0,8)};
  }
  function rank(items,artist,title,duration=0) {
    const q=identity({artist,title}),unique=new Map();
    for(const item of items) {
      if(!item||!Number.isInteger(item.id)||unique.has(item.id))continue;
      const titleMatch=similarity(cleanTitle(item.title),q.title),artistMatch=q.artist?similarity(item.artist,q.artist):1;
      const variantMismatch=editions(item.title)!==editions(q.title),delta=duration>0&&item.duration>0?Math.abs(duration-item.duration):null;
      const durationMatch=delta===null?.5:Math.exp(-delta/12);
      const score=.7*titleMatch+.22*artistMatch+.08*durationMatch-(variantMismatch?.13:0);
      const result={...item,delta,matchScore:Math.round(Math.max(0,score)*100),approximate:titleMatch<.96||artistMatch<.85,variantMismatch};
      // Keep broad candidates for a one-word typo but don't fill the list with
      // unrelated songs merely because their duration or artist happens to match.
      if(titleMatch>=.4 || (q.title.length<=5&&titleMatch>=.25)){
        if(!unique.has(item.id)||unique.get(item.id).matchScore<result.matchScore)unique.set(item.id,result);
      }
    }
    return [...unique.values()].sort((a,b)=>b.matchScore-a.matchScore||(a.delta??Infinity)-(b.delta??Infinity)||a.id-b.id).slice(0,80);
  }
  return {identity,cleanTitle,fold,transliterate,similarity,plan,rank};
});
