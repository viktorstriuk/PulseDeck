#!/usr/bin/env node
'use strict';
// Offline, repeatable AST/HTML catalog audit. Acorn is vendored with MIT licenses.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const acorn=require('./vendor/acorn'),walk=require('./vendor/acorn-walk');
const root=path.resolve(__dirname,'..'),app=path.join(root,'app');
const catalogs=Object.fromEntries(['ru','en'].map(c=>[c,JSON.parse(fs.readFileSync(path.join(app,'languages',c+'.json'),'utf8'))]));
const failures=[],review=[],references={};let jsFiles=0,htmlFiles=0,staticCalls=0;
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
const add=(key,file,line)=>{if(!references[key])references[key]=[];references[key].push({file:path.relative(root,file).replaceAll('\\','/'),line});};
const requireKey=(key,file,line)=>{add(key,file,line);for(const code of ['ru','en'])if(!Object.hasOwn(catalogs[code].messages,key))failures.push(`${path.relative(root,file)}:${line}: ${code} missing ${key}`);};
const params=v=>[...new Set(Object.values(typeof v==='string'?{text:v}:v).flatMap(x=>[...x.matchAll(/\{([A-Za-z][\w]*)\}/g)].map(m=>m[1])))].sort();
if(JSON.stringify(Object.keys(catalogs.ru.messages).sort())!==JSON.stringify(Object.keys(catalogs.en.messages).sort()))failures.push('Catalog key sets differ');
for(const [key,value]of Object.entries(catalogs.ru.messages)){
 if(JSON.stringify(params(value))!==JSON.stringify(params(catalogs.en.messages[key]||'')))failures.push('Placeholder mismatch: '+key);
 for(const code of ['ru','en'])for(const text of Object.values(typeof catalogs[code].messages[key]==='string'?{text:catalogs[code].messages[key]}:catalogs[code].messages[key]||{}))if(!text.trim())failures.push('Empty translation: '+code+'/'+key);
}
for(const file of [...files(app),...files(path.join(root,'installer','ui'))]){
 const ext=path.extname(file);if(ext==='.css'){const css=fs.readFileSync(file,'utf8');for(const m of css.matchAll(/content\s*:\s*(["'])(.*?)\1/g))if(/[A-Za-zА-Яа-яЁё]{2}/.test(m[2]))failures.push(`${path.relative(root,file)}: hardcoded CSS content ${m[2]}`);continue;}if(!['.js','.html'].includes(ext))continue;const source=fs.readFileSync(file,'utf8');
 if(ext==='.js'){
  jsFiles++;let ast;try{new vm.Script(source,{filename:file});ast=acorn.parse(source,{ecmaVersion:'latest',locations:true});}catch(e){failures.push(e.message);continue;}
  walk.fullAncestor(ast,(n,_,parents)=>{
   if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['t','h','error','msg'].includes(n.callee.property?.name)&&['I18n','engine','this'].includes(n.callee.object?.name||n.callee.object?.type==='ThisExpression'&&'this')){
    const key=n.arguments[0];if(key?.type==='Literal'&&typeof key.value==='string'){staticCalls++;requireKey(key.value,file,n.loc.start.line);}
   }
   if(n.type==='Literal'&&typeof n.value==='string'&&!n.regex){
    if(Object.hasOwn(catalogs.en.messages,n.value))add(n.value,file,n.loc.start.line);
    if(/[А-Яа-яЁё]/.test(n.value)){
     // This byte-to-Unicode decoding table is not interface prose.
     const parent=parents.at(-2);if(path.basename(file)==='metadata.js'&&parent?.type==='VariableDeclarator'&&parent.id?.name==='CP1251_HIGH')return;
     failures.push(`${path.relative(root,file)}:${n.loc.start.line}: hardcoded Cyrillic literal ${n.value.slice(0,80)}`);
    }
    const parent=parents.at(-2);
    if(n.value!=='use strict'&&/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(n.value)&&!/[<>]/.test(n.value)&&!file.endsWith('/icons.js')&&!file.endsWith('/playlist-icons.js'))review.push({file:path.relative(root,file),line:n.loc.start.line,text:n.value.slice(0,150),parent:parent?.type});
   }
   if(n.type==='TemplateElement'&&/[А-Яа-яЁё]/.test(n.value.cooked||''))failures.push(`${path.relative(root,file)}:${n.loc.start.line}: hardcoded Cyrillic template`);
  });
 }else{
  htmlFiles++;
  const stripped=source.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
  for(const m of stripped.matchAll(/>\s*([^<]+?)\s*</g))if(/[A-Za-zА-Яа-яЁё]/.test(m[1])&&!/^&[a-z]+;$/.test(m[1].trim()))failures.push(`${path.relative(root,file)}: hardcoded HTML text ${m[1].trim()}`);
 }
 for(const m of source.matchAll(/\bdata-i18n(?:-(title|aria-label|placeholder|alt|data-tooltip))?=["']([^"']+)["']/g))if(!m[2].includes('${'))requireKey(m[2],file,source.slice(0,m.index).split('\n').length);
}
for(const file of files(path.join(root,'installer','engine')).filter(f=>f.endsWith('.go')&&!f.endsWith('_test.go')))for(const m of fs.readFileSync(file,'utf8').matchAll(/"(Setup[A-Za-z0-9]+)"/g))requireKey(m[1],file,1);
for(const file of files(path.join(root,'native')).filter(f=>f.endsWith('.go')&&!f.endsWith('_test.go')))for(const m of fs.readFileSync(file,'utf8').matchAll(/\breason\s*(?::=|=)\s*"(Game[^"]+)"/g))requireKey(m[1],file,1);
const dedup=Object.fromEntries(Object.entries(references).sort().map(([key,locations])=>[key,[...new Map(locations.map(v=>[v.file+':'+v.line,v])).values()]]));
const report={version:JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).version,catalogs:['ru','en'],keys:Object.keys(catalogs.en.messages).length,jsFiles,htmlFiles,staticCalls,referencedKeys:Object.keys(dedup).length,failures:[...new Set(failures)],asciiReviewCandidates:review};
const out=path.join(root,'test-results',report.version);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'i18n-audit.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(out,'i18n-key-locations.json'),JSON.stringify(dedup,null,2)+'\n');
console.log(JSON.stringify({...report,asciiReviewCandidates:review.length},null,2));process.exitCode=failures.length?1:0;
