/* Conservative metadata helpers shared by main, renderer and tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PulseTrackEnrichment=api;})(globalThis,()=>{
  'use strict';
  const clean=value=>String(value??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const unknown=value=>!clean(value)||/^(?:unknown(?:\s+(?:artist|creator|author))?|неизвестн(?:ый|ая|ое)(?:\s+(?:исполнитель|автор|артист))?|неизвестно|без исполнителя|n\/?a|<unknown>|не указан)$/iu.test(clean(value));
  function splitName(track={}){
    if(!unknown(track.artist))return null;
    const values=[track.title,String(track.rel||'').split(/[\\/]/).pop()?.replace(/\.[^.]+$/,'')];
    for(const raw of values){const s=clean(raw),m=/^(.{1,160}?)\s+[-–—]\s+(.{1,300})$/u.exec(s);if(!m)continue;
      const artist=clean(m[1]),title=clean(m[2]);
      if(unknown(artist)||!title||/^\d{1,4}$/.test(artist)||!/[\p{L}]/u.test(artist)||!/[\p{L}\p{N}]/u.test(title))continue;
      return {artist,title};
    }return null;
  }
  function hasSynced(doc){return !!doc?.lines?.some(line=>Number.isFinite(line.startMs)&&line.startMs>=0&&String(line.text||(line.segments||[]).map(s=>s.text).join('')).trim());}
  function needs(track={},lyrics){return {covers:!track.coverUrl,artists:!!splitName(track),lyrics:lyrics===undefined?false:!hasSynced(lyrics?.doc)&&!lyrics?.suppressed};}
  const ACTIONS=['artists','covers','lyrics'];
  function actions(counts={}){return ACTIONS.filter(k=>Number(counts[k])>0);}
  function validatePatch(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('TRACK_BAD_EDIT');const out={};
    for(const field of ['artist','title'])if(Object.hasOwn(patch,field)){if(typeof patch[field]!=='string')throw Error('TRACK_BAD_EDIT');const value=clean(patch[field]);if(!value||value.length>(field==='title'?300:160))throw Error('TRACK_BAD_EDIT');out[field]=value;}
    if(!Object.keys(out).length)throw Error('TRACK_BAD_EDIT');return out;
  }
  function directURL(raw){const text=String(raw||'').trim();if(!/^https?:\/\//i.test(text))return '';try{const u=new URL(text);if(u.username||u.password||u.port&&!['80','443'].includes(u.port))return '';return u.href;}catch{return '';}}
  return {ACTIONS,clean,unknown,splitName,hasSynced,needs,actions,validatePatch,directURL};
});
