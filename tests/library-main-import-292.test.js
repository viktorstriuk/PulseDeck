'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {harness}=require('./main-harness');
// Actual main IPC -> importer -> publisher -> enrichment -> metadata scanner.
// Only Electron/Windows integration is shimmed by the shared harness; no search
// service or library command is replaced and this local-only test makes no HTTP.
test('292 real main IPC imports a folder only after confirmation and enriches names without rewriting audio',async()=>{
  const h=harness();
  try {
    const source=path.join(h.temp,'incoming');fs.mkdirSync(source);
    const file=path.join(source,'Маяк — Тихий свет.wav'),bytes=Buffer.from('RIFF0123456789WAVE original audio bytes');
    fs.writeFileSync(file,bytes);
    fs.writeFileSync(file+'.pulse.json',JSON.stringify({artist:'Неизвестный исполнитель',title:'Маяк — Тихий свет',duration:123}));
    fs.writeFileSync(path.join(source,'Маяк — Тихий свет.lrc'),'[00:00.00]Тихий свет\n[00:05.00]Продолжение');
    const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
    const plan=await h.invoke('library:prepare-drop',[source],'real-import-292');
    assert.equal(plan.count,1);assert.equal(plan.counts.artists,1);assert.equal(plan.counts.lyrics,0);
    assert.equal((await h.api.scanLibrary(true)).length,0,'preflight must not publish audio');
    const started=await h.invoke('library:command',{type:'batch-start',token:plan.token,actions:['artists'],consent:false});
    let job;
    for(let n=0;n<200;n++){
      job=(await h.invoke('library:command',{type:'job-status'})).job;
      if(job?.id===started.id&&['complete','error'].includes(job.phase))break;
      await new Promise(r=>setTimeout(r,15));
    }
    assert.equal(job?.phase,'complete');assert.equal(job.added,1);assert.equal(job.changed,1);assert.equal(job.failed,0);
    const tracks=await h.api.scanLibrary(true);assert.equal(tracks.length,1);
    assert.equal(tracks[0].artist,'Маяк');assert.equal(tracks[0].title,'Тихий свет');
    const copied=path.join(h.api.paths.music,tracks[0].rel);
    assert.equal(hash(fs.readFileSync(copied)),hash(bytes));assert.equal(hash(fs.readFileSync(file)),hash(bytes));
    assert.ok(fs.existsSync(copied+'.lyrics.json'));assert.ok(fs.existsSync(file+'.pulse.json'));
    const edited=JSON.parse(fs.readFileSync(copied+'.pulse.json','utf8'));
    assert.equal(edited.artist,'Маяк');assert.equal(edited.title,'Тихий свет');
  } finally {h.close();}
});
