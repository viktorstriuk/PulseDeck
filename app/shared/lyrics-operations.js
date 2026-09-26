'use strict';
// Pure, atomic edits. Never mutate the saved document during a preview or undo.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./lyrics-editor'):root.PulseLyricsEditor);if(typeof module==='object'&&module.exports)module.exports=api;else root.PulseLyricsOps=api;})(globalThis,E=>{
  const I18n = typeof module === 'object' && module.exports ? require('../i18n') : globalThis.PulseI18n;

  const copy=x=>JSON.parse(JSON.stringify(x));
  const text=row=>row.segments?row.segments.map(s=>s.text).join(''):row.text||'';
  function indices(doc,rows){return [...new Set(rows)].filter(i=>Number.isInteger(i)&&i>=0&&i<doc.lines.length).sort((a,b)=>a-b);}
  function checkTime(v,duration){if(!Number.isSafeInteger(v)||v<0||v>(duration>0?duration:86400000))throw I18n.error("LyricsShiftExceedsTheSongBoundariesNoTimestampsWere");return v;}
  function shift(doc,delta,{rows=[],words=[],all=false,durationMs=0}={}){
    if(!Number.isFinite(delta))throw I18n.error("LyricsEnterTheAmountToShift");delta=Math.round(delta);const result=copy(doc);
    const selected=new Set(all?doc.lines.map((_,i)=>i):indices(doc,rows));
    for(const i of selected){const row=result.lines[i];for(const key of ['startMs','endMs'])if(row[key]!=null)row[key]=checkTime(row[key]+delta,durationMs);for(const s of row.segments||[])if(s.startMs!=null)s.startMs=checkTime(s.startMs+delta,durationMs);}
    const groups=new Map();for(const [r,w]of words)if(!selected.has(r)&&result.lines[r]){if(!groups.has(r))groups.set(r,new Set());groups.get(r).add(w);}
    for(const [r,set]of groups){const row=result.lines[r],parts=E.tokens(row);
      for(const j of set){if(!parts[j])continue;if(parts[j].startMs!=null){parts[j].startMs=checkTime(parts[j].startMs+delta,durationMs);parts[j].explicit=true;}}
      // Unselected words keep their original effective time, even if they used
      // to inherit a timestamp from a selected predecessor.
      for(let j=0;j<parts.length;j++)if(!set.has(j)&&parts[j].startMs!=null)parts[j].explicit=true;
      row.segments=parts.map(p=>({text:p.text,startMs:p.startMs}));delete row.text;
      const first=row.segments.find(p=>p.startMs!=null)?.startMs;
      if(first!=null&&first<(row.startMs??Infinity))row.startMs=first;
    }return result;
  }
  function moveRows(doc,rows,direction){const result=copy(doc),chosen=new Set(indices(doc,rows));if(!chosen.size)return {doc:result,rows:[]};
    const order=doc.lines.map((_,i)=>i),scan=[...order];if(direction>0)scan.reverse();
    for(const old of scan){if(!chosen.has(old))continue;const at=order.indexOf(old),to=at+(direction>0?1:-1);if(to>=0&&to<order.length&&!chosen.has(order[to]))[order[at],order[to]]=[order[to],order[at]];}
    // Text moves between existing timing slots. Internal word offsets travel
    // with each phrase, so reordering never simply corrupts chronological order.
    result.lines=order.map((old,i)=>{const row=copy(doc.lines[old]),slot=doc.lines[i],delta=slot.startMs!=null&&row.startMs!=null?slot.startMs-row.startMs:null;
      row.startMs=slot.startMs;row.endMs=slot.endMs;
      if(row.segments)for(const p of row.segments)p.startMs=delta===null?null:p.startMs==null?null:Math.max(0,p.startMs+delta);
      if(row.endMs!=null&&row.segments?.some(p=>p.startMs>row.endMs))row.endMs=null;
      return row;});return {doc:result,rows:order.map((old,i)=>chosen.has(old)?i:-1).filter(i=>i>=0)};
  }
  function moveWords(doc,words,direction){const result=copy(doc),groups=new Map(),selection=[];
    for(const [r,w]of words){if(!groups.has(r))groups.set(r,new Set());groups.get(r).add(w);}
    for(const [r,set]of groups){if(!result.lines[r])continue;const row=result.lines[r],parts=E.tokens(row),order=parts.map((_,i)=>i),scan=[...order];if(direction>0)scan.reverse();
      for(const old of scan){if(!set.has(old))continue;const at=order.indexOf(old),to=at+(direction>0?1:-1);if(to>=0&&to<order.length&&!set.has(order[to]))[order[at],order[to]]=[order[to],order[at]];}
      row.segments=order.map((old,i)=>{if(set.has(old))selection.push([r,i]);const source=parts[old].text.trim(),slot=parts[i].text;return {text:(slot.match(/^\s*/)?.[0]||'')+source+(slot.match(/\s*$/)?.[0]||''),startMs:parts[i].startMs};});delete row.text;
    }return {doc:result,words:selection};
  }
  function clearTimes(doc,{rows=[],words=[],all=false}={}){const result=copy(doc),chosen=new Set(all?doc.lines.map((_,i)=>i):indices(doc,rows));
    for(const i of chosen){const row=result.lines[i];row.startMs=row.endMs=null;row.text=text(row);delete row.segments;}
    const groups=new Map();for(const [r,w]of words)if(!chosen.has(r)){if(!groups.has(r))groups.set(r,[]);groups.get(r).push(w);}
    for(const [r,ws]of groups){if(!result.lines[r])continue;let row=result.lines[r],parts=E.tokens(row);for(const w of ws){const next=E.wordRow(row,parts,w,null);row=next.row;parts=next.words;}result.lines[r]=row;}return result;
  }
  function sortByTime(doc){const result=copy(doc);const slots=[];for(let i=0;i<result.lines.length;i++)if(result.lines[i].startMs!=null)slots.push(i);const timed=slots.map(i=>result.lines[i]).sort((a,b)=>a.startMs-b.startMs);slots.forEach((s,i)=>result.lines[s]=timed[i]);return result;}
  function splitLine(doc,index,wordIndex){const result=copy(doc),row=result.lines[index];if(!row)throw I18n.error("LyricsSelectALine");const parts=E.tokens(row);if(wordIndex<1||wordIndex>=parts.length)throw I18n.error("LyricsSelectTheWordBeforeWhichTheNewLine");
    const first={...copy(row),segments:parts.slice(0,wordIndex).map(p=>({text:p.text,startMs:p.startMs})),endMs:null,suppressGapAfter:true};delete first.text;
    const second={...copy(row),segments:parts.slice(wordIndex).map(p=>({text:p.text,startMs:p.startMs})),startMs:parts[wordIndex].startMs??null};delete second.text;
    result.lines.splice(index,1,first,second);return result;
  }
  class History{
    constructor(limit=80,maxBytes=8*1024*1024){this.limit=limit;this.maxBytes=maxBytes;this.undoStack=[];this.redoStack=[];}
    trim(){let bytes=0;for(const stack of [this.undoStack,this.redoStack])for(const value of stack)bytes+=JSON.stringify(value).length*2;while((bytes>this.maxBytes||this.undoStack.length>this.limit)&&this.undoStack.length>1){bytes-=JSON.stringify(this.undoStack.shift()).length*2;}while((bytes>this.maxBytes||this.redoStack.length>this.limit)&&this.redoStack.length>1){bytes-=JSON.stringify(this.redoStack.shift()).length*2;}}
    push(before,after){if(JSON.stringify(before)===JSON.stringify(after))return false;this.undoStack.push(copy(before));this.redoStack=[];this.trim();return true;}
    undo(now){if(!this.undoStack.length)return null;this.redoStack.push(copy(now));const value=this.undoStack.pop();this.trim();return value;}
    redo(now){if(!this.redoStack.length)return null;this.undoStack.push(copy(now));const value=this.redoStack.pop();this.trim();return value;}
    clear(){this.undoStack=[];this.redoStack=[];}
  }
  return {shift,moveRows,moveWords,clearTimes,sortByTime,splitLine,History};
});
