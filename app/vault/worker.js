'use strict';
const I18n = require("../i18n");
const {parentPort,workerData}=require('node:worker_threads');
I18n.setLanguage(workerData?.language || 'ru');
const C=require('./crypto');
(async()=>{
  try{
    const {op,args}=workerData;
    if(!['verifySource','verifyFile','wrap','unwrap','encryptFile','decryptFile','seal','open'].includes(op))throw I18n.error("VaultUnknownWorkerOperation");
    const result=await C[op](...args);parentPort.postMessage({ok:true,result});
  }catch(error){parentPort.postMessage({ok:false,error:error.message,errorInfo:I18n.errorPacket(error)});}
})();
