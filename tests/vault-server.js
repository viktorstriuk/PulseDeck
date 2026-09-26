'use strict';
// TEST ONLY. Loopback RPC bridge into production main.js via the Electron VM harness.
// The production application never exposes an RPC server or accepts raw HTTP commands.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {harness,trackFile}=require('./main-harness');const h=harness();const root=path.resolve(__dirname,'..');
h.api.saveSettings({theme:'ocean',accent:'mint',view:'grid',sort:'recent',categoryLayout:'top',favorites:[],customCategories:[{id:'custom:secret',name:'Личная коллекция',tracks:['private-one.wav','private-two.wav']},{id:'custom:second',name:'Вторая коллекция',tracks:[]},{id:'custom:open',name:'Открытый плейлист',tracks:[]}]},{skipEffects:true});
for(const [rel,artist,title]of [['private-one.wav','PRIVATE ARTIST','Тихий океан'],['private-two.wav','PRIVATE ARTIST TWO','Ночное небо'],['public-one.wav','Открытый артист','Обычная музыка'],['public-two.wav','Ещё артист','Другая музыка']]){
 const file=trackFile(h,rel,artist,{title,sourceUrl:'https://example.test/'+rel});fs.copyFileSync(path.join(__dirname,'fixtures/silence.wav'),file);
}
const lyricsTest=process.env.PD_LYRICS_TEST==='1';
if(lyricsTest){
 // Test-only native decoder path; production remains the shipped FFmpeg.exe.
 h.api.getLyrics().ffmpeg=process.env.PD_ANALYSIS_FFMPEG||'/usr/bin/ffmpeg';
 const file=path.join(h.api.paths.music,'private-one.wav');fs.copyFileSync(path.join(__dirname,'fixtures/studio-audio.wav'),file);
 fs.writeFileSync(file+'.lrc','[00:01.000]PRIVATE LYRIC FIRST\n[00:03.000]PRIVATE LYRIC SECOND\n[00:08.000]PRIVATE LYRIC THIRD');
 h.electron.dialog.showSaveDialog=async options=>({filePath:path.join(h.temp,'lyrics-export.zip')});
 h.electron.dialog.showOpenDialog=async()=>({canceled:true});
}
let port;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.end();return;}
 try{
 if(req.url==='/__rpc'){
  let body='';for await(const part of req){body+=part;if(body.length>1024*1024)throw Error('test request too large');}
  const {channel,args=[]}=JSON.parse(body),messages=h.main.messages.length;
  if(channel==='__inspect'){
   const v=h.api.getVault();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,value:{musicFiles:fs.readdirSync(h.api.paths.music),settings:h.api.getSettings(),vaultCount:Object.keys(v.index.vaults).length,objects:Object.keys(v.index.objects).length,sessions:v.sessions.size,tokens:v.tokens.size,lyricPrivateFiles:fs.existsSync(path.join(h.api.paths.music,'.pulsedeck-lyrics'))?fs.readdirSync(path.join(h.api.paths.music,'.pulsedeck-lyrics')):[],lyricPublicFiles:fs.existsSync(path.join(h.api.paths.data,'lyrics'))?fs.readdirSync(path.join(h.api.paths.data,'lyrics')):[],exportPath:lyricsTest?path.join(h.temp,'lyrics-export.zip'):null}}));return;
  }
  if(!['library:list','library:refresh','library:organize','library:playback','settings:get','settings:set','vault:command','lyrics:command'].includes(channel))throw Error('Not a test channel');
  let value=await h.invoke(channel,...args);
  if(channel==='library:list'||channel==='library:refresh')value=value.map(t=>({...t,audioUrl:`http://127.0.0.1:${port}/tests/fixtures/silence.wav`}));
  if(channel==='library:playback'&&value&&!value.rel.startsWith('vault:'))value.audioUrl=`http://127.0.0.1:${port}/tests/fixtures/silence.wav`;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,value,events:h.main.messages.slice(messages).filter(m=>m.name.startsWith('lyrics:'))}));return;
 }
 const file=path.resolve(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''));if(!file.startsWith(root+path.sep))throw Error('invalid path');
 const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.json':'application/json','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',mime);res.end(await fs.promises.readFile(file));
 }catch(e){res.statusCode=req.url==='/__rpc'?200:404;res.end(JSON.stringify({ok:false,error:e.message}));}
});
server.listen(0,'127.0.0.1',()=>{port=server.address().port;console.log(JSON.stringify({port}));});
for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>{server.closeAllConnections();server.close();h.close();process.exit(0);});
