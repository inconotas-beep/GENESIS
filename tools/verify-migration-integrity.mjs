// Reads the institutional source only. The output contains aggregate counts, never records.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=JSON.parse(fs.readFileSync('migration/source-baseline.json','utf8')).source,database=path.join(source,'data/privado/institucional/database.json');
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(database)).digest('hex'),before=hash(),raw=JSON.parse(fs.readFileSync(database,'utf8'));
const c={};vm.createContext(c);for(const file of ['SubjectNames.gs','Core.gs','Schema.gs'])vm.runInContext(fs.readFileSync('dist/apps-script/'+file,'utf8'),c);
const G=c.Genesis,S=c.GoogleSchema,normalized=S.normalize(raw),stored={version:normalized.version};S.validate(normalized);
for(const table of G.tables){stored[table]=S.decode(table,S.encode(table,normalized[table]));assert.equal(JSON.stringify(stored[table]),JSON.stringify(normalized[table]),'La conversión alteró '+table);}
const original=JSON.stringify(stored),actor=stored.users.find(u=>u.active&&u.role==='ADMIN'),indexes=new Map(),reports=new Map();assert.ok(actor);
const index=document=>new Map(document.students.flatMap(student=>student.entries.flatMap(entry=>entry.periods.map(period=>[[student.id,entry.subject.id,period.id].join('|'),period]))));
let checked=0,reportRecords=0,historical=0;
for(const grade of stored.grades){
 const scope=grade.year+'|'+grade.sectionId,key=[grade.studentId,grade.subjectId,grade.periodId].join('|');
 if(!indexes.has(scope)){indexes.set(scope,index(G.execute(stored,actor.email,'consolidated',{year:grade.year,sectionId:grade.sectionId})));reports.set(scope,{studentId:grade.studentId,entries:index(G.execute(stored,actor.email,'reportCard',{year:grade.year,sectionId:grade.sectionId,studentId:grade.studentId}))});}
 const record=indexes.get(scope).get(key);assert.ok(record,'Falta un registro en el consolidado');assert.equal(JSON.stringify(record.values),JSON.stringify(grade.values),'Cambió una nota original');checked++;
 if(!stored.assignments.some(a=>a.active&&a.year===grade.year&&a.sectionId===grade.sectionId&&a.subjectId===grade.subjectId))historical++;
 const report=reports.get(scope);if(report.studentId===grade.studentId){assert.equal(JSON.stringify(report.entries.get(key)),JSON.stringify(record),'La boleta difiere del consolidado');reportRecords++;}
}
assert.equal(JSON.stringify(stored),original,'Una consulta modificó el modelo');assert.equal(hash(),before,'La base original cambió');
let packageVerified=false,confirmedAccounts=null,pendingAccounts=null;
if(fs.existsSync('migration/private/latest-package.json')){
 const pointer=JSON.parse(fs.readFileSync('migration/private/latest-package.json','utf8')),bytes=fs.readFileSync(pointer.file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),pointer.sha256,'El paquete privado no coincide con su hash');assert.equal(pointer.sourceSha256,before,'Los datos locales cambiaron después del paquete: volvé a ejecutar genesis.cmd prepare-data');
 const prepared=JSON.parse(bytes).database;
 for(const table of G.tables)if(table!=='users')assert.equal(JSON.stringify(prepared[table]),JSON.stringify(stored[table]),'El paquete alteró '+table);
 assert.equal(prepared.users.length,stored.users.length);for(const user of prepared.users){const sourceUser=stored.users.find(u=>u.id===user.id);assert.ok(sourceUser);assert.equal(user.role,sourceUser.role);assert.equal(user.active,sourceUser.active);assert.equal(user.name,sourceUser.name);assert.equal(user.googleIdentity.originalEmail,sourceUser.email);}
 confirmedAccounts=prepared.users.filter(user=>user.googleIdentity.status==='CONFIRMED').length;pendingAccounts=prepared.users.length-confirmedAccounts;packageVerified=true;
}
const result={success:true,sourceDatabaseVersion:stored.version,sourceDatabaseSha256:before,tablesVerified:G.tables.length,losslessRoundTrip:true,gradeRecordsVerified:checked,sectionConsolidatedDocuments:indexes.size,representativeReportCards:reports.size,reportCardRecordsVerified:reportRecords,historicalWithoutActiveAssignment:historical,sourceUnchangedDuringVerification:true,packageVerified,confirmedAccounts,pendingAccounts,googleDataUploaded:false};
fs.writeFileSync('migration/INTEGRIDAD.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
