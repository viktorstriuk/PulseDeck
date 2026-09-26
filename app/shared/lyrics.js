'use strict';
// The same bounded parser and media-clock model run in Node and the renderer.
// Never eval an import. No executable HTML, implicit word timing or destructive repairs.
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseLyrics=value;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const I18n = typeof module === 'object' && module.exports ? require('../i18n') : globalThis.PulseI18n;

  const FORMAT='pulsedeck-lyrics',VERSION=1,MAX_TEXT=2*1024*1024,MAX_LINES=5000,MAX_SEGMENTS=50000;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const number=(x,f,min,max)=>typeof x==='number'&&Number.isFinite(x)?Math.max(min,Math.min(max,x)):f;
  const hex=(v,f)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v.toLowerCase():f;
  function theme(raw={}){
    if(!raw||typeof raw!=='object')raw={};
    const background=hex(raw.background||raw.bgcolor,'#302036');
    const colors=Array.isArray(raw.gradientColors)?raw.gradientColors.filter(c=>hex(c,null)).slice(0,4):[];
    return {mode:['solid','gradient','cover'].includes(raw.mode)?raw.mode:'gradient',background,
      gradientColors:colors.length>1?colors:[background,'#141b30'],gradientAngle:number(raw.gradientAngle,135,0,360),
      text:hex(raw.text||raw.textcolor,null),activeText:hex(raw.activeText,null),autoContrast:raw.autoContrast!==false,
      fontScale:number(raw.fontScale,100,65,150),paletteSource:raw.paletteSource==='manual'?'manual':'cover'};
  }
  function time(value){
    if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return Math.round(value);
    const s=String(value||'').trim(),m=/^(\d{1,4}):([0-5]\d)(?:([.:])(\d{1,3}))?$/.exec(s);
    if(!m)throw I18n.error("LyricsUnclearTimestampExample",{value1:(s.slice(0,45))});
    return Number(m[1])*60000+Number(m[2])*1000+Number((m[4]||'').padEnd(3,'0'));
  }
  function stamp(ms){ms=Math.max(0,Math.round(ms));return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
  const noteOnly=s=>/^[\s♪♫♬♩♭♮♯🎵🎶\uFE0F]+$/u.test(s)&&/[♪♫♬♩🎵🎶]/u.test(s);
  function boundedText(value,where){if(typeof value!=='string')throw I18n.error("LyricsTextExpected",{value1:(where)});if(value.length>20000)throw I18n.error("LyricsLineIsTooLong",{value1:(where)});return value.replace(/\u0000/g,'');}
  function ms(value,where){if(value==null)return null;if(!Number.isSafeInteger(value)||value<0||value>24*60*60*1000)throw I18n.error("LyricsTimeMustBeAnIntegerNumberOfMilliseconds",{value1:(where)});return value;}
  function safeSource(s){if(!s||typeof s!=='object')return undefined;const out={};for(const key of ['name','artist','title','album'])if(typeof s[key]==='string')out[key]=s[key].slice(0,400);try{const u=new URL(s.url);if(u.protocol==='https:'&&!u.username&&!u.password)out.url=u.href.slice(0,2000);}catch{}return Object.keys(out).length?out:undefined;}
  function normalize(value,{durationMs=0}={}){
    if(!value||typeof value!=='object'||Array.isArray(value))throw I18n.error("LyricsSingleJSONObjectWithALinesArrayIs");
    if(value.format&&value.format!==FORMAT)throw I18n.error("LyricsUnknownLyricsFormat");
    if(value.version!=null&&value.version!==VERSION)throw I18n.error("LyricsThisFormatVersionIsNotSupportedYet");
    if(!Array.isArray(value.lines)||!value.lines.length)throw I18n.error("LyricsAddAtLeastOneTextOrInstrumentalLine");
    if(value.lines.length>MAX_LINES)throw I18n.error("LyricsNoMoreThanLinesPerSong",{value1:(MAX_LINES)});
    const warnings=[];let total=0,segmentCount=0,previous=-1;
    const lines=value.lines.map((row,i)=>{
      const where=I18n.msg("LyricsLine", {value1:(i+1)});if(!row||typeof row!=='object'||Array.isArray(row))throw I18n.error("LyricsObjectExpected",{value1:(where)});
      const result={startMs:ms(row.startMs,where),endMs:ms(row.endMs,where),kind:row.kind==='interlude'?'interlude':'lyric',suppressGapAfter:!!row.suppressGapAfter};
      if(Array.isArray(row.segments)&&row.segments.length){
        if(typeof row.text==='string'&&row.text.length)throw I18n.error("LyricsUseTextORSegmentsNotBoth",{value1:(where)});
        if((segmentCount+=row.segments.length)>MAX_SEGMENTS)throw I18n.error("LyricsTooManySegments");
        result.segments=row.segments.map((part,j)=>{if(!part||typeof part!=='object')throw I18n.error("LyricsInvalidSegment",{value1:(where)});return {startMs:ms(part.startMs,I18n.msg("LyricsSegment", {value1:(where),value2:(j+1)})),text:boundedText(part.text,where)};});
        if(result.startMs===null)result.startMs=result.segments.find(s=>s.startMs!==null)?.startMs??null;
        let last=result.startMs;
        for(const part of result.segments){
          if(part.startMs===null)part.startMs=last; // Missing marker continues the previous segment, never guesses a future time.
          if(part.startMs!==null&&last!==null&&part.startMs<last)throw I18n.error("LyricsSegmentTimeIsBeforeThePreviousSegmentOr",{value1:(where)});
          if(part.startMs!==null)last=part.startMs;
        }
        if(result.endMs!==null&&last!==null&&result.endMs<last)throw I18n.error("LyricsEndingIsBeforeTheLastSegment",{value1:(where)});
        total+=result.segments.reduce((n,s)=>n+s.text.length,0);
      }else{result.text=boundedText(row.text??'',where);total+=result.text.length;}
      const text=plainLine(result);
      if(noteOnly(text)||(!text.trim()&&result.startMs!==null)){result.kind='interlude';result.text='';delete result.segments;}
      if(result.startMs!==null){if(result.startMs<previous)throw I18n.error("LyricsLineTimestampsMustIncreaseEqualTimesAreAllowed",{value1:(where)});previous=result.startMs;}
      if(result.endMs!==null&&(result.startMs===null||result.endMs<result.startMs))throw I18n.error("LyricsInvalidLineEnding",{value1:(where)});
      if(durationMs>0&&((result.startMs??0)>durationMs+1000||(result.endMs??0)>durationMs+1000))warnings.push(I18n.t("LyricsTimeExceedsTheRecordingDuration", {value1:(where)}));
      return result;
    });
    if(total>MAX_TEXT)throw I18n.error("LyricsLyricsExceedMB");
    const doc={format:FORMAT,version:VERSION,offsetMs:Math.round(number(value.offsetMs,0,-86400000,86400000)),theme:theme(value.theme),
      gapThresholdMs:Math.round(number(value.gapThresholdMs,2500,1000,15000)),lines};
    if(typeof value.recordingId==='string'&&/^[a-f0-9]{64}$/.test(value.recordingId))doc.recordingId=value.recordingId;
    if(Number.isFinite(value.durationMs)&&value.durationMs>0)doc.durationMs=Math.round(value.durationMs);
    if(safeSource(value.source))doc.source=safeSource(value.source);
    if(Array.isArray(value.systemNotes))doc.systemNotes=[...new Set(value.systemNotes.filter(k=>k==='AcousticDraftNote'))];
    if(Array.isArray(value.notes)){doc.notes=value.notes.filter(n=>typeof n==='string').slice(0,12).map(n=>n.replace(/\u0000/g,'').slice(0,1200));}
    if(!lines.some(l=>plainLine(l).trim())&&!lines.some(l=>l.kind==='interlude'))throw I18n.error("LyricsLyricsAreEmpty");
    return {doc,warnings:[...new Set(warnings)]};
  }
  function notes(doc){return [...(doc?.notes||[]),...(doc?.systemNotes||[]).map(key=>I18n.t(key))];}
  function plainLine(row){return row.segments?row.segments.map(p=>p.text).join(''):(row.text||'');}
  function segments(text,startMs,warnings){
    // Marker belongs to following text. Enhanced LRC <mm:ss.xxx> is also accepted.
    const re=/😀(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)😀|<(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)>/gu;
    let match,last=0,current=startMs,parts=[];
    while((match=re.exec(text))){
      if(match.index>last)parts.push({startMs:current,text:text.slice(last,match.index)});
      const token=match[1]||match[2];if((token.match(/:/g)||[]).length>1)warnings.push(I18n.t("LyricsExtraColonWasInterpretedAsADecimalFraction"));
      current=time(token);last=re.lastIndex;
    }
    if(!parts.length&&last===0)return {text};
    if(last<text.length)parts.push({startMs:current,text:text.slice(last)});
    return parts.length?{segments:parts}:{text:''};
  }
  function parseText(text,options={}){
    const warnings=[],out=[],isLrc=options.kind==='lrc';let offset=0,multiple=false;
    const lines=text.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
    for(let i=0;i<lines.length;i++){
      let s=lines[i];if(!s.trim()){if(out.length&&out.at(-1).text!=='')out.push({text:''});continue;}
      const off=/^\[offset:([+-]?\d+)\]\s*$/i.exec(s);if(off){offset=-Number(off[1]);continue;}
      if(/^\[(ar|ti|al|by|length|re|ve):.*\]\s*$/i.test(s))continue;
      let starts=[],suppress=false,m;
      // Repeated LRC line stamps duplicate a chorus and are explicitly sorted below.
      while((m=/^\s*\[(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)\]/.exec(s))){starts.push(time(m[1]));s=s.slice(m[0].length);}
      if(starts.length>1)multiple=true;
      if(!starts.length&&(m=/^\s*([({])(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)[)}]\s*:\s*(.*)$/.exec(s))){
        starts=[time(m[2])];suppress=m[1]==='{';s=m[3];
        if((m[2].match(/:/g)||[]).length>1)warnings.push(I18n.t("LyricsExtraColonWasInterpretedAsADecimalFraction"));
        if(/^"/.test(s)){try{s=JSON.parse(s.replace(/,\s*$/,''));}catch{throw I18n.error("LyricsLineUnclosedStringOrInvalidQuotationMarks",{value1:(i+1)});}}
      }
      if(!starts.length&&/^[\[({]\d+:/.test(s))throw I18n.error("LyricsLineCheckTheTimestampExampleText",{value1:(i+1)});
      if(!starts.length)out.push({...segments(s,null,warnings),suppressGapAfter:false});
      else for(const startMs of starts)out.push({startMs,...segments(s.trimStart(),startMs,warnings),suppressGapAfter:suppress});
    }
    while(out.length&&out.at(-1).text===''&&out.at(-1).startMs==null)out.pop();
    if(multiple){
      if(out.some(r=>r.startMs==null&&plainLine(r).trim()))throw I18n.error("LyricsRepeatedLRCTimestampsMixedWithUntimedLinesAre");
      out.sort((a,b)=>(a.startMs??Infinity)-(b.startMs??Infinity));
    }
    const result=normalize({lines:out,offsetMs:offset},options);result.warnings.unshift(...warnings);
    if(isLrc&&out.some(r=>r.startMs==null&&plainLine(r).trim()))result.warnings.push(I18n.t("LyricsSomeLinesHaveNoTimestampsTheyWillRemain"));
    return result;
  }
  function parse(input,options={}){
    if(typeof input!=='string')return normalize(input,options);
    let text=input.replace(/^\uFEFF/,'').trim();
    if(text.startsWith('```'))text=text.replace(/^```(?:json|lrc|text)?\s*\n?/i,'').replace(/\n?```\s*$/,'');
    if(text.length>64*1024*1024)throw I18n.error("LyricsImportIsTooLarge");
    if(/^<!doctype|^<html|<script\s[^>]*id=["']lyric-data["']/i.test(text)){
      const block=/<script\b[^>]*\bid=["']lyric-data["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(text);
      if(!block||block[1].length>MAX_TEXT)throw I18n.error("LyricsHTMLContainsNoValidLyricDataBlockNo");
      const data=JSON.parse(block[1]);if(!Array.isArray(data))throw I18n.error("LyricsInvalidLyricData");
      let prefs={};const p=/<script\b[^>]*\bid=["']initial-prefs["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(text);
      if(p&&p[1].length<10000){try{prefs=JSON.parse(p[1]);}catch{}}
      return normalize({lines:data.map(r=>({startMs:Math.round(r.t*1000),endMs:Number.isFinite(r.end)?Math.round(r.end*1000):null,text:r.text||'',kind:r.kind==='lyric'?'lyric':'interlude'})),offsetMs:Math.round((prefs.offset||0)*1000),theme:{background:prefs.bg,fontScale:prefs.scale}},options);
    }
    if(text.length>MAX_TEXT)throw I18n.error("LyricsLyricsExceedMB");
    if(/^[\[{]/.test(text)&&!/^\[\d+:|^\[(ar|ti|al|by|length|offset):|^\{\d+:/i.test(text)){
      let obj;try{obj=JSON.parse(text);}catch{
        // A deliberately narrow adapter for the user's compact color block + timed lines.
        if(!/^\s*[({]\d+:/m.test(text))throw I18n.error("LyricsCouldNotParseJSONCheckQuotationMarksCommas");
        const adapted=text.split('\n').filter(l=>/^\s*[({]\d+:/.test(l)).join('\n');
        const result=parseText(adapted,options);const bg=/bgcolor\s*["']?\s*:\s*["']?(#[\da-f]{6})/i.exec(text),fg=/textcolor\s*["']?\s*:\s*["']?(#[\da-f]{6})/i.exec(text);
        if(bg)result.doc.theme.background=bg[1];if(fg)result.doc.theme.text=fg[1];result.warnings.push(I18n.t("LyricsShorthandWasConvertedToPulseDeckJSONCheckThe"));return result;
      }
      return normalize(obj,options);
    }
    return parseText(text,options);
  }
  function compile(doc,durationMs=0){
    const rows=doc.lines.map((r,i)=>({...clone(r),sourceIndex:i}));
    const timed=rows.filter(r=>r.startMs!==null);
    const lastVocal=rows.findLastIndex(r=>r.kind==='lyric'&&r.startMs!==null);
    // A previous vocal end can overlap a later row; never invent a gap in overlapping singing.
    let endCoverage=0,unknownEnd=false;
    const result=[];
    const first=timed[0];
    if(first&&first.kind==='lyric'&&first.startMs>=doc.gapThresholdMs&&!rows.slice(0,rows.indexOf(first)).some(r=>r.kind==='interlude'||plainLine(r).trim()))result.push({startMs:0,endMs:first.startMs,text:'',kind:'interlude',auto:true,sourceIndex:-1});
    rows.forEach((row,i)=>{
      result.push(row);
      if(row.kind==='lyric'&&row.startMs!==null){
        // Unknown lines are active until the next timed start. They never imply a measured vocal end.
        endCoverage=Math.max(endCoverage,row.endMs??row.startMs);unknownEnd=row.endMs===null;
        const next=rows.slice(i+1).find(r=>r.startMs!==null);
        const untimedBetween=rows.slice(i+1,next?rows.indexOf(next):rows.length).some(r=>plainLine(r).trim()||r.kind==='interlude');
        const nextStart=next?.startMs??(i===lastVocal&&durationMs>0?durationMs:null);
        if(!unknownEnd&&!row.suppressGapAfter&&!untimedBetween&&next?.kind!=='interlude'&&nextStart!==null&&nextStart-endCoverage>=doc.gapThresholdMs){result.push({startMs:endCoverage,endMs:nextStart,kind:'interlude',text:'',auto:true,sourceIndex:-1});}
      }
    });
    // Adjacent explicit/automatic music markers are one continuous visual interval.
    const merged=[];for(const row of result){const prev=merged.at(-1);if(prev?.kind==='interlude'&&row.kind==='interlude'&&row.startMs!==null&&prev.startMs!==null&&(prev.endMs===null||prev.endMs>=row.startMs)){prev.endMs=row.endMs;continue;}merged.push(row);}
    const unique=[...new Set(merged.filter(r=>r.startMs!==null).map(r=>r.startMs))].sort((a,b)=>a-b);
    for(const row of merged){row.effectiveEnd=row.endMs??unique.find(t=>t>row.startMs)??(durationMs>0?durationMs:Infinity);}
    return merged;
  }
  function activeAt(rows,milliseconds){const result=[];for(let i=0;i<rows.length;i++){const r=rows[i];if(r.startMs!==null&&r.startMs<=milliseconds&&milliseconds<r.effectiveEnd)result.push(i);}return result;}
  function toLrc(doc){return `[offset:${-doc.offsetMs}]
`+doc.lines.map(r=>(r.startMs===null?'':`[${stamp(r.startMs)}]`)+(r.kind==='interlude'?'':plainLine(r))).join('\n');}
  function toPlain(doc){return doc.lines.map(r=>r.kind==='interlude'?'♪':plainLine(r)).join('\n');}
  function searchIdentity(track){const S=typeof module==='object'&&module.exports?require('./lyrics-search'):globalThis.PulseLyricsSearch;return S.identity(track);}

  return {notes,FORMAT,VERSION,MAX_TEXT,MAX_LINES,theme,time,stamp,noteOnly,normalize,parse,plainLine,compile,activeAt,toLrc,toPlain,searchIdentity};
});
