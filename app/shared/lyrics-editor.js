'use strict';
// Inert helpers shared by the word editor, persistence and node:test.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PulseLyricsEditor=api;})(globalThis,()=>{
  const I18n = typeof module === 'object' && module.exports ? require('../i18n') : globalThis.PulseI18n;

  const copy=x=>JSON.parse(JSON.stringify(x));
  const valid=v=>Number.isSafeInteger(v)&&v>=0&&v<=86400000;
  function preferences(raw={}){return {offsetMs:Number.isFinite(raw?.offsetMs)?Math.max(-86400000,Math.min(86400000,Math.round(raw.offsetMs))):0,
    gapThresholdMs:Number.isFinite(raw?.gapThresholdMs)?Math.max(1000,Math.min(15000,Math.round(raw.gapThresholdMs))):2500};}
  function pieces(text){
    // Keep punctuation, apostrophes, emoji and whitespace byte-for-byte. For scripts
    // without spaces use native word segmentation when it is available.
    if(!text)return [];
    if(!/\s/.test(text)&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(text)&&typeof Intl.Segmenter==='function'){
      const out=[];for(const p of new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)){
        if(p.isWordLike||!out.length)out.push(p.segment);else out[out.length-1]+=p.segment;
      }return out;
    }
    const out=text.match(/\s*\S+\s*/gu)||[text];return out;
  }
  function tokens(row){
    const source=row.segments?.length?row.segments:[{text:row.text||'',startMs:row.startMs??null}];
    const out=[];for(const part of source){const words=pieces(part.text);
      words.forEach((text,i)=>out.push({text,startMs:part.startMs??null,explicit:i===0&&part.startMs!=null}));}
    return out;
  }
  function wordRow(row,words,index,value){
    if(!Number.isInteger(index)||index<0||index>=words.length)throw I18n.error("LyricsWordNoLongerExists");
    if(value!==null&&!valid(value))throw I18n.error("LyricsWordTimeMustBeBetweenAnd");
    const next=copy(words);next[index].startMs=value;next[index].explicit=value!==null;
    const result=copy(row),segments=[];let previous=result.startMs??null;
    for(const word of next){
      if(word.explicit)previous=word.startMs;
      word.startMs=previous;
      if(!word.explicit&&segments.length)segments.at(-1).text+=word.text;
      else segments.push({text:word.text,startMs:previous});
    }
    delete result.text;result.segments=segments;
    if(result.startMs==null)result.startMs=segments.find(s=>s.startMs!==null)?.startMs??null;
    return {row:result,words:next};
  }
  function shiftStart(row,value){
    if(value!==null&&!valid(value))throw I18n.error("LyricsLineTimeMustBeBetweenAnd");
    const r=copy(row),before=r.startMs;
    // Editing a phrase start shifts its existing measured timestamps, never
    // stretches them proportionally or loses the precision of an imported cue.
    if(value!==null&&before!==null&&before!==undefined){const delta=value-before;
      for(const s of r.segments||[])if(s.startMs!==null){s.startMs+=delta;if(!valid(s.startMs))throw I18n.error("LyricsShiftMovesAWordOutsideTheAllowedTime");}
      if(r.endMs!=null){r.endMs+=delta;if(!valid(r.endMs))throw I18n.error("LyricsShiftMovesALineEndingOutsideTheAllowed");}
    }r.startMs=value;return r;
  }
  function inferredEnd(lines,index,durationMs=0){const time=lines[index]?.startMs;if(time==null)return null;
    return lines.slice(index+1).find(l=>l.startMs!==null&&l.startMs>time)?.startMs||(durationMs>time?durationMs:null);}
  return {preferences,tokens,wordRow,shiftStart,inferredEnd,pieces};
});
