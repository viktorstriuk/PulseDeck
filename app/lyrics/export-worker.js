'use strict';
const I18n = require("../i18n");
const {parentPort,workerData:w}=require('node:worker_threads');
I18n.setLanguage(w?.language || 'ru');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {writeZip}=require('./zip');const C=require('../vault/crypto');
(async()=>{try{
  const entries=[{name:'README.md',text:fs.readFileSync(path.join(__dirname,'README.md'),'utf8')},{name:'INSTRUCTIONS.md',text:fs.readFileSync(path.join(__dirname,'INSTRUCTIONS.md'),'utf8')},
    {name:'track.json',text:JSON.stringify(w.track,null,2)},
    {name:'example.lyrics.json',text:fs.readFileSync(path.join(__dirname,'example.lyrics.json'),'utf8')}];
  if(w.doc){entries.push({name:'text.txt',text:require('../shared/lyrics').toPlain(w.doc)});entries.push({name:'lyrics.json',text:JSON.stringify(w.doc,null,2)});}
  let last=-1;
  const stream=async function*(){const h=crypto.createHash('sha256');const data=w.descriptor?C.chunks(w.file,w.descriptor,w.descriptor.key):fs.createReadStream(w.file,{highWaterMark:1024*1024});for await(const b of data){h.update(b);yield b;}if(h.digest('hex')!==w.track.recordingId)throw I18n.error("LyricsAudioFileHasChangedExportItAgain");};
  entries.unshift({name:'audio.'+w.ext,size:w.size,stream});
  const result=await writeZip(w.destination,entries,{part:w.part,commit:false,onProgress:percent=>{if(percent!==last){last=percent;parentPort.postMessage({progress:percent});}}});
  parentPort.postMessage({ok:true,...result});
}catch(e){parentPort.postMessage({ok:false,error:e.message,errorInfo:I18n.errorPacket(e)});}})();
