// Read-only source inventory; the snapshot is written exclusively in this migration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(root,'../GENESIS');
const baseline=path.join(root,'migration/source-baseline.json');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(directory,prefix=''){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const relative=prefix+entry.name,absolute=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('No se recorren enlaces del proyecto original');
    if(entry.isDirectory())return ['.git','node_modules','dist','data/local'].includes(relative)?[]:inventory(absolute,relative+'/');
    return [{path:relative,sha256:digest(absolute)}];
  }).sort((a,b)=>a.path.localeCompare(b.path));
}
const files=inventory(source);
if(process.argv.includes('--capture')){
  if(fs.existsSync(baseline))throw Error('Ya existe una referencia; no se reemplaza automáticamente');
  fs.writeFileSync(baseline,JSON.stringify({source,capturedAt:new Date().toISOString(),excluded:['.git','node_modules','dist','data/local'],files},null,2));
  console.log(JSON.stringify({referenceCaptured:true,files:files.length,sourceWritten:false}));
}else{
  const before=JSON.parse(fs.readFileSync(baseline,'utf8'));
  const old=new Map(before.files.map(file=>[file.path,file.sha256])),current=new Map(files.map(file=>[file.path,file.sha256])),changed=[...new Set([...old.keys(),...current.keys()])].filter(file=>old.get(file)!==current.get(file));
  if(before.source!==source||changed.length&&(!process.argv.includes('--allow-current-data')||changed.some(file=>file!=='data/privado/institucional/database.json')))throw Error('El original difiere de la referencia de esta revisión');
  console.log(JSON.stringify({originalUnchanged:changed.length===0,originalCodeUnchanged:true,sourceDatabaseChangedSinceReference:changed.length>0,filesVerified:files.length,sourceWritten:false}));
}
