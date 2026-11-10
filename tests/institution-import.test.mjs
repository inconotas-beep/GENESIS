// Local Google doubles, synthetic students only. No cloud writes or source database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotPlatform} from './helpers/pilot-platform.mjs';
import {prepareAccounts} from '../src/account-migration.mjs';
import G from '../tools/core.mjs';
function fixture(failure,envelopeOverrides={},prepareSource=()=>{}){
 const env=pilotPlatform({failure});env.props.set('ENVIRONMENT','PRODUCTION');env.props.set('ACCESS_ENABLED','NO');env.c.prepareGoogleResources_();
 const source=G.seed();source.grades.push({id:'test-grade',year:'2026',sectionId:'1A',subjectId:'math',periodId:'1',studentId:'s1',values:[0,8.95,null]});
 prepareSource(source);
 const db=prepareAccounts(source,{admin:'owner@clases.edu.sv'},'owner@clases.edu.sv','2099-01-01T00:00:00Z'),text=JSON.stringify({schema:'GENESIS_MIGRATION_V2',sourceSha256:'synthetic-local-test-only',database:db,...envelopeOverrides});
 const file=env.c.DriveApp.getFolderById('root').createFile(env.c.Utilities.newBlob(text,'application/json','synthetic-migration.json'));
 env.props.set('IMPORT_FILE_ID',file.getId());env.props.set('CONFIRM_IMPORT_FILE_ID',file.getId());env.props.set('IMPORT_SHA256',env.c.GooglePilot.hash(text));
 return {...env,expected:db};
}
test('importación institucional verifica 24 tablas, conserva cero y precisión, y admite identidades pendientes sin habilitarlas',()=>{
 const env=fixture();assert.equal(env.c.importInstitution_().status,'IMPORTED');const stored=env.current();assert.equal(stored.grades[0].values[1],8.95);assert.deepEqual(stored.grades[0].values,[0,8.95,null]);assert.equal(stored.students[0].nie,'00000001');assert.equal(stored.users[1].googleIdentity.status,'PENDING');assert.equal(stored.users[1].active,true);
 const result=env.c.verifyInstitutionImport_();assert.equal(result.status,'IMPORTED_TABLES_VERIFIED');assert.equal(result.counts.grades,1);assert.equal(result.pendingAccounts,3);assert.equal(result.accessEnabled,false);
 assert.throws(()=>env.c.api('bootstrap'),/todavía no está habilitado/);env.props.set('ACCESS_ENABLED','YES');env.as('docente@example.invalid');assert.throws(()=>env.c.api('bootstrap'),/Acceso denegado/);env.as('owner@clases.edu.sv');assert.equal(env.c.api('bootstrap').user.id,'admin');
});
test('segunda importación no sobrescribe ni elimina tablas, auditoría o notas existentes',()=>{
 const env=fixture();env.c.importInstitution_();const before=env.current(),writes=env.pilotStats.writes;assert.throws(()=>env.c.importInstitution_(),/ya contiene/);assert.deepEqual(env.current(),before);assert.equal(env.pilotStats.writes,writes);
});
test('destino con información ajena se rechaza antes de crear _meta o alterar celdas',()=>{
 const env=fixture(),book=env.books.get(env.props.get('SPREADSHEET_ID'));book.insertSheet('Documento existente').getRange(1,1,1,1).setValues([['Conservar']]);assert.throws(()=>env.c.importInstitution_(),/ya contiene/);assert.equal(book.getSheetByName('_meta'),null);assert.equal(book.getSheetByName('Documento existente').values[0][0],'Conservar');assert.equal(env.pilotStats.writes,0);
});
test('hash o confirmación del archivo incorrectos no inician escrituras',()=>{
 for(const key of ['IMPORT_SHA256','CONFIRM_IMPORT_FILE_ID']){const env=fixture();env.props.set(key,'incorrecto');assert.throws(()=>env.c.importInstitution_());assert.equal(env.pilotStats.writes,0);assert.equal(env.books.get(env.props.get('SPREADSHEET_ID')).getSheetByName('_meta'),null);}
});
test('importación interrumpida queda inaccesible y no se repite encima de datos parciales',()=>{
 const env=fixture('table:grades');assert.throws(()=>env.c.importInstitution_());assert.equal(env.books.get(env.props.get('SPREADSHEET_ID')).getSheetByName('_meta').values[1][1],'PREPARING');assert.throws(()=>env.c.GoogleStorage.load(),/Faltan tablas obligatorias/);assert.throws(()=>env.c.importInstitution_(),/ya contiene/);
});
test('verificación real preparada detecta diferencias y no habilita el acceso automáticamente',()=>{
 const env=fixture();env.c.importInstitution_();const before=env.c.migrationStatus_();assert.equal(before.accessEnabled,false);assert.equal(before.pendingAccounts,3);
 const gradeSheet=env.books.get(env.props.get('SPREADSHEET_ID')).getSheetByName('grades'),index=gradeSheet.values[0].indexOf('_json0'),changed=JSON.parse(gradeSheet.values[1][index]);changed.values[0]=1;gradeSheet.values[1][index]=JSON.stringify(changed);
 assert.throws(()=>env.c.verifyInstitutionImport_(),/difieren/);assert.equal(env.props.get('ACCESS_ENABLED'),'NO');
});
test('un respaldo marcado como piloto se rechaza antes de crear tablas de producción',()=>{
 const env=fixture(undefined,{schema:'GENESIS_SNAPSHOT_V2',environment:'PILOT'});assert.throws(()=>env.c.importInstitution_(),/sintético de piloto/);assert.equal(env.pilotStats.writes,0);
});

function manyGrades(source,count=17683){for(let i=1;i<count;i++)source.grades.push({...source.grades[0],id:'synthetic-grade-'+i,values:[0,8.95,null,10,7.125]});}
function partial(env,prefix=2){
 const book=env.books.get(env.props.get('SPREADSHEET_ID'));book.insertSheet('_meta').getRange(1,1,2,4).setValues([['version','state','schema','commit'],[env.expected.version,'PREPARING',2,'']]);
 for(const table of G.tables){const rows=JSON.parse(JSON.stringify(env.c.GoogleSchema.encode(table,env.expected[table]))),sheet=book.insertSheet(table);sheet.values=rows.slice(0,table==='grades'?prefix:rows.length);if(table==='grades')break;}
 return book;
}

test('17,683 notas se conservan con lotes de menos de 1.4 MB y menos de 40 escrituras, sin perder precisión ni NIE',()=>{
 const env=fixture(undefined,{},source=>{manyGrades(source);source.students[0].name='=1+1';});env.c.importInstitution_();assert.deepEqual(env.current(),env.expected);assert.ok(env.pilotStats.writes<40);
 assert.ok(env.pilotStats.batches.every(batch=>Buffer.byteLength(JSON.stringify(batch),'utf8')<1400000));assert.equal(env.current().grades.length,17683);assert.equal(env.current().students[0].name,'=1+1');
});

test('recuperación explícita respalda el parcial y solo añade filas faltantes después de comprobar todos los prefijos',()=>{
 const env=fixture(undefined,{},source=>manyGrades(source,1000)),book=partial(env,201),before=structuredClone(book.getSheetByName('grades').values),source=env.items.get(env.props.get('IMPORT_FILE_ID')).blob.getDataAsString();
 const staleSheets=book.getSheets();book.getSheets=()=>staleSheets;
 const result=env.c.recoverInstitutionImport_();assert.equal(result.status,'PERSONAL_DRIVE_RECOVERED_AND_VERIFIED');assert.deepEqual(env.current(),env.expected);assert.deepEqual(book.getSheetByName('grades').values.slice(0,201),before);assert.equal(env.props.get('ACCESS_ENABLED'),'NO');
 const backup=JSON.parse(env.items.get(result.partialBackupId).blob.getDataAsString());assert.equal(backup.schema,'GENESIS_PARTIAL_IMPORT_V1');assert.deepEqual(backup.sheets.find(s=>s.table==='grades').rows,before);assert.equal(env.items.get(env.props.get('IMPORT_FILE_ID')).blob.getDataAsString(),source);
 const gradeId=book.getSheetByName('grades').getSheetId();for(const batch of env.pilotStats.batches)for(const request of batch.requests)if(request.updateCells?.range.sheetId===gradeId)assert.ok(request.updateCells.range.startRowIndex>=201);
 const writes=env.pilotStats.writes;assert.throws(()=>env.c.recoverInstitutionImport_(),/no es una importación parcial/);assert.equal(env.pilotStats.writes,writes);
});

test('datos alterados, filas incompletas, hojas ajenas, fórmulas o metadatos incompatibles impiden recuperar sin ninguna escritura',()=>{
 const changes=[
  (e,b)=>b.getSheetByName('grades').values[1][1]='otro-alumno',
  (e,b)=>b.getSheetByName('grades').values[1]=[],
  (e,b)=>b.insertSheet('Otra información').values=[['Conservar']],
  (e,b)=>b.getSheetByName('grades').formulas=[['=1+1']],
  (e,b)=>b.getSheetByName('_meta').values[1][0]=999,
  (e,b)=>b.getSheetByName('_meta').values[1][1]='READY',
  e=>e.props.set('IMPORT_SHA256','wrong'),
  e=>e.props.set('ACCESS_ENABLED','YES'),
  e=>e.as('docente@clases.edu.sv')
 ];
 for(const change of changes){
  // A blank trailing row is absent from getDataRange. Keep a later populated row to test an internal gap.
  const env=fixture(undefined,{},source=>manyGrades(source,3)),book=partial(env,3);
  change(env,book);const before=JSON.stringify([...book.sheets].map(([name,s])=>[name,s.values])),files=env.pilotStats.files;
  assert.throws(()=>env.c.recoverInstitutionImport_());assert.equal(env.pilotStats.writes,0);assert.equal(env.pilotStats.files,files);assert.equal(JSON.stringify([...book.sheets].map(([name,s])=>[name,s.values])),before);
 }
});

test('una respuesta perdida durante recuperación conserva PREPARING y una nueva revisión continúa sin duplicar notas',()=>{
 const env=fixture(undefined,{},source=>manyGrades(source,2000)),book=partial(env,201),original=env.c.Sheets.Spreadsheets.batchUpdate;let interrupted=false;
 env.c.Sheets.Spreadsheets.batchUpdate=(payload,id)=>{const result=original(payload,id);if(!interrupted){interrupted=true;throw Error('Respuesta perdida después de confirmar');}return result;};
 assert.throws(()=>env.c.recoverInstitutionImport_(),/Respuesta perdida/);assert.equal(book.getSheetByName('_meta').values[1][1],'PREPARING');assert.throws(()=>env.current(),/Faltan tablas|todavía no está lista/);
 const saved=structuredClone(book.getSheetByName('grades').values);env.c.Sheets.Spreadsheets.batchUpdate=original;env.c.recoverInstitutionImport_();assert.deepEqual(env.current(),env.expected);assert.deepEqual(book.getSheetByName('grades').values.slice(0,saved.length),saved);
});

test('recuperación rechaza ejecución concurrente o fallo del respaldo antes de escribir notas',()=>{
 for(const fail of ['lock','backup']){const env=fixture();partial(env);if(fail==='lock')env.c.LockService.getScriptLock=()=>({waitLock(){throw Error('Busy');}});else env.c.GoogleDrive.json=()=>{throw Error('Respaldo no disponible');};assert.throws(()=>env.c.recoverInstitutionImport_());assert.equal(env.pilotStats.writes,0);}
});
