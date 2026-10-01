'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage(require('./sync').synchronize(new Float32Array(workerData.a),new Float32Array(workerData.b)));}
catch{parentPort.postMessage({error:true});}
