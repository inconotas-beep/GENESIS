import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {prepareAccounts} from '../src/account-migration.mjs';
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('src/sheets-schema.js','utf8'),context);const schema=context.GoogleSchema;
const manifest=JSON.parse(fs.readFileSync(fs.existsSync('migration/source-baseline.json')?'migration/source-baseline.json':'migration/original-manifest.json','utf8'));
const changed=manifest.files.filter(file=>!fs.existsSync(path.join(manifest.source,file.path))||crypto.createHash('sha256').update(fs.readFileSync(path.join(manifest.source,file.path))).digest('hex')!==file.sha256);
const captureCurrent=process.argv.includes('--capture-current-data');
if(changed.some(file=>file.path!=='data/privado/institucional/database.json')||changed.length&&!captureCurrent)throw Error('El proyecto original cambió desde la referencia: '+changed.map(file=>file.path).join(', ')+'. Para capturar solo los datos actuales, usar --capture-current-data');
const databaseFile=path.join(manifest.source,'data/privado/institucional/database.json'),bytes=fs.readFileSync(databaseFile),db=schema.normalize(JSON.parse(bytes)),errors=[];
try{schema.validate(db);}catch(error){errors.push(error.message);}
let largestCell=0;const tables={};for(const [table,fields]of Object.entries(schema.fields)){
 const encoded=schema.encode(table,db[table]);const decoded=schema.decode(table,encoded);
 if(JSON.stringify(decoded)!==JSON.stringify(db[table]))throw Error('No coincide la tabla '+table);
 for(const row of encoded)for(const cell of row)largestCell=Math.max(largestCell,String(cell).length);
 tables[table]={rows:db[table].length,columns:fields,losslessRoundTrip:true};
}
const invalidEmails=db.users.filter(user=>!new RegExp('^[^\\s@]+@clases\\.edu\\.sv$','i').test(user.email));
const sourceHash=crypto.createHash('sha256').update(bytes).digest('hex');
if(captureCurrent){const directory='migration/private/source-captures/'+sourceHash;fs.mkdirSync(directory,{recursive:true});const snapshot=directory+'/database.json';if(fs.existsSync(snapshot)){if(!fs.readFileSync(snapshot).equals(bytes))throw Error('La captura existente no coincide; no se sobrescribe');}else fs.writeFileSync(snapshot,bytes,{flag:'wx'});}
if(crypto.createHash('sha256').update(fs.readFileSync(databaseFile)).digest('hex')!==sourceHash)throw Error('La base cambió durante la lectura. Volvé a capturar antes de preparar el paquete');
const report={originalUnchanged:changed.length===0,originalCodeUnchanged:true,sourceDatabaseChangedSinceReference:changed.length>0,sourceWritesPerformed:false,originalFilesVerified:manifest.files.length,sourceDatabaseSha256:sourceHash,sourceVersion:db.version,tables,largestCell,structuralErrors:errors,accountsNeedingInstitutionalEmail:invalidEmails.length,sourceDataUploaded:false};
fs.writeFileSync('migration/audit-data-summary.json',JSON.stringify(report,null,2));
if(process.argv.includes('--prepare-private')){
 const mappingArg=process.argv.indexOf('--email-map'),mapping=mappingArg<0?{}:JSON.parse(fs.readFileSync(process.argv[mappingArg+1],'utf8'));
 if(errors.length)throw Error('Hay relaciones pendientes de revisión; no se genera el paquete');
 const adminArg=process.argv.indexOf('--admin-email'),modeArg=process.argv.indexOf('--auth-mode'),mode=modeArg<0?JSON.parse(fs.readFileSync('migration/config/auth-profile.json','utf8')).mode:process.argv[modeArg+1],prepared=prepareAccounts(db,mapping,adminArg<0?'':process.argv[adminArg+1],new Date().toISOString(),mode);
 schema.validate(prepared);fs.mkdirSync('migration/private',{recursive:true});
 const directory='migration/private/packages/'+new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync(directory,{recursive:true});
 const envelope={schema:'GENESIS_MIGRATION_V2',sourceSha256:report.sourceDatabaseSha256,database:prepared};const target=directory+'/institution.json';fs.writeFileSync(target,JSON.stringify(envelope),{flag:'wx'});
 const packageHash=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');fs.writeFileSync(directory+'/import-sha256.txt',packageHash,{flag:'wx'});
 fs.writeFileSync('migration/private/latest-package.json',JSON.stringify({file:target,sha256:packageHash,sourceSha256:sourceHash,sourceVersion:db.version,confirmedAccounts:prepared.users.filter(user=>user.googleIdentity.status==='CONFIRMED').length,pendingAccounts:prepared.users.filter(user=>user.googleIdentity.status!=='CONFIRMED').length},null,2));
 console.log('Paquete privado generado localmente. No se subió a Google.');
}
if(process.argv.includes('--accounts-template')){
 fs.mkdirSync('migration/private',{recursive:true});const file='migration/private/email-map.pending.json';
 fs.writeFileSync(file,JSON.stringify(Object.fromEntries(db.users.map(user=>[user.id,''])),null,2),{flag:'wx'});
 console.log('Correspondencia privada vacía creada. Completar únicamente los correos verificados; los demás pueden quedar pendientes.');
}
console.log(JSON.stringify({originalCodeUnchanged:true,sourceDatabaseChangedSinceReference:changed.length>0,sourceWritesPerformed:false,sourceVersion:db.version,tableCount:Object.keys(tables).length,losslessRoundTrip:true,structuralErrors:errors,accountsNeedingInstitutionalEmail:invalidEmails.length,largestCell},null,2));
