'use strict';
const I18n=require('../i18n');
// PCM arrives in bounded batches. The decoder is owned and cancelled by main.
const {parentPort,workerData}=require('node:worker_threads');
I18n.setLanguage(workerData?.language || 'ru');
const {Extractor}=require('../shared/lyrics-rhythm');
const extractor=new Extractor();let failed=false;
parentPort.on('message',message=>{
  if(failed)return;
  try{if(message.bytes){extractor.feed(message.bytes);parentPort.postMessage({ack:true,at:extractor.samples/16});}
    else if(message.end)parentPort.postMessage({result:extractor.finish()});}
  catch(error){failed=true;parentPort.postMessage({error:error.message,errorInfo:I18n.errorPacket(error)});}
});
