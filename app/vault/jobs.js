'use strict';
const I18n=require('../i18n');
const {Worker}=require('node:worker_threads');
const path=require('node:path');
// Serialize memory-hard KDF/file work; even a hundred linked playlists cannot
// spawn a hundred 128-MiB derivations or full-song buffers at once.
let tail=Promise.resolve();
module.exports=function run(op,...args){
  const task=tail.then(()=>new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'worker.js'),{workerData:{op,args,language:I18n.language}});let replied=false;
    worker.once('message',m=>{replied=true;m.ok?resolve(m.result):reject(m.errorInfo?I18n.fromErrorPacket(m.errorInfo):Error(m.error));});
    worker.once('error',reject);worker.once('exit',code=>{if(!replied)reject(I18n.error("CryptoWorkerExited",{code}));});
  }));
  tail=task.catch(()=>{});return task;
};
