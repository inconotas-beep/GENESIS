import test from 'node:test';import assert from 'node:assert/strict';import {pilotPlatform} from './helpers/pilot-platform.mjs';import G from '../tools/core.mjs';
test('Pilot: primera ejecución crea las tablas sintéticas; segunda reutiliza recursos y conserva notas',()=>{
 const env=pilotPlatform();assert.equal(env.c.preparePilot_().status,'INITIALIZED');assert.equal(env.books.get(env.props.get('SPREADSHEET_ID')).sheets.size,G.tables.length+1);assert.equal(env.current().students.length,4);
 env.as('a@clases.edu.sv');env.c.api('saveGrades',{version:0,assignmentId:'pilot-assignment-1',periodId:'1',rows:[{studentId:'pilot-student-1',values:[8,0,null]}]});env.as('owner@clases.edu.sv');const result=env.c.preparePilot_();assert.equal(result.status,'ALREADY_INITIALIZED');assert.equal(result.version,1);assert.deepEqual(env.current().grades[0].values,[8,0,null]);assert.equal(env.pilotStats.spreadsheets,1);assert.equal(env.pilotStats.folders,3);
});
for(const failure of ['folder-after-create','sheet-after-create','table:grades'])test('Pilot: retoma sin duplicados después de '+failure,()=>{
 const env=pilotPlatform({failure});assert.throws(()=>env.c.preparePilot_());env.c.preparePilot_();env.c.preparePilot_();assert.equal(env.pilotStats.spreadsheets,1);assert.equal(env.pilotStats.folders,3);assert.equal(env.current().students.length,4);
});
test('Pilot: creación incierta sin recurso visible exige revisión, sin reintentar a ciegas',()=>{
 const env=pilotPlatform({failure:'folder-before-create'});assert.throws(()=>env.c.preparePilot_());assert.throws(()=>env.c.preparePilot_(),/incierta/);assert.equal(env.pilotStats.folders,0);assert.equal(env.pilotStats.spreadsheets,0);
});
test('Pilot: configuración distinta o datos sin marcador no se sobrescriben',()=>{
 const env=pilotPlatform();env.c.preparePilot_();env.props.set('PILOT_TEACHER_A_EMAIL','changed@clases.edu.sv');assert.throws(()=>env.c.preparePilot_(),/otra inicialización/);assert.equal(env.current().users[1].email,'a@clases.edu.sv');
 const unrelated=pilotPlatform();unrelated.c.prepareGoogleResources_();unrelated.books.get(unrelated.props.get('SPREADSHEET_ID')).insertSheet('students').getRange(1,1,1,1).setValues([['dato ajeno']]);assert.throws(()=>unrelated.c.preparePilot_(),/datos ajenos/);assert.equal(unrelated.pilotStats.writes,0);
});
test('Pilot: niega cuentas no incluidas y acciones que importan datos reales',()=>{
 const env=pilotPlatform();env.c.preparePilot_();env.as('stranger@clases.edu.sv');assert.throws(()=>env.c.api('bootstrap'),/no autorizada/);env.as('a@clases.edu.sv');assert.throws(()=>env.c.api('xlsxPreview',{}),/deshabilitada/);assert.throws(()=>env.c.importInstitution_(),/No se importan/);assert.equal(env.current().students.length,4);
});
test('Pilot: identidad comprueba la cuenta activa sin necesitar Sheets inicializado',()=>{
 const env=pilotPlatform();env.as('a@clases.edu.sv');const result=env.c.api('pilotIdentity');assert.equal(result.email,'a@clases.edu.sv');assert.equal(result.role,'TEACHER');assert.equal(env.pilotStats.spreadsheets,0);env.as('');assert.throws(()=>env.c.api('pilotIdentity'),/identidad/);
});
test('Pilot: dos cuentas guardan sin notas ajenas; conflicto conserva versión y datos anteriores',()=>{
 const env=pilotPlatform();env.c.preparePilot_();const save=(assignment,student,version,value)=>env.c.api('saveGrades',{version,assignmentId:assignment,periodId:'1',rows:[{studentId:student,values:[value,0,null]}]});
 env.as('a@clases.edu.sv');save('pilot-assignment-1','pilot-student-1',0,8);env.as('b@clases.edu.sv');assert.throws(()=>save('pilot-assignment-2','pilot-student-3',0,7),/datos cambiaron/);assert.equal(env.current().version,1);assert.throws(()=>env.c.api('roster',{assignmentId:'pilot-assignment-1',periodId:'1'}),/denegado/);save('pilot-assignment-2','pilot-student-3',1,7);assert.equal(env.current().grades.length,2);assert.deepEqual(env.current().grades[0].values,[8,0,null]);assert.equal(env.c.api('bootstrap').environment,'PILOT');
});
test('Pilot: respaldo y recuperación verifican datos en otra hoja sin cambiar el destino activo',()=>{
 const env=pilotPlatform();env.c.preparePilot_();env.as('a@clases.edu.sv');env.c.api('saveGrades',{version:0,assignmentId:'pilot-assignment-1',periodId:'1',rows:[{studentId:'pilot-student-1',values:[8,9,10]}]});env.as('owner@clases.edu.sv');
 const before=env.current(),active=env.props.get('SPREADSHEET_ID'),backup=env.c.backupPilot_();env.props.set('PILOT_RESTORE_BACKUP_ID',backup.backupId);env.props.set('PILOT_RESTORE_SHA256',backup.sha256);
 const result=env.c.restorePilotBackup_();assert.equal(result.status,'RESTORED_COPY_VERIFIED');assert.notEqual(result.spreadsheetId,active);assert.equal(env.props.get('SPREADSHEET_ID'),active);assert.deepEqual(JSON.parse(JSON.stringify(env.c.GoogleStorage.read(result.spreadsheetId))),before);assert.equal(env.c.restorePilotBackup_().status,'ALREADY_INITIALIZED');assert.equal(env.pilotStats.spreadsheets,2);
});
test('Pilot: autorización ausente, correos repetidos o respaldo alterado no crean datos',()=>{
 const env=pilotPlatform();env.props.set('PROVISIONING_APPROVED','NO');assert.throws(()=>env.c.preparePilot_(),/autorización/);assert.equal(env.pilotStats.spreadsheets,0);env.props.set('PROVISIONING_APPROVED','YES');env.props.set('PILOT_TEACHER_B_EMAIL','a@clases.edu.sv');assert.throws(()=>env.c.preparePilot_(),/distintas/);assert.equal(env.pilotStats.folders,0);
 const corrupted=pilotPlatform();corrupted.c.preparePilot_();const backup=corrupted.c.backupPilot_();corrupted.props.set('PILOT_RESTORE_BACKUP_ID',backup.backupId);corrupted.props.set('PILOT_RESTORE_SHA256','0'.repeat(64));assert.throws(()=>corrupted.c.restorePilotBackup_(),/hash/);assert.equal(corrupted.pilotStats.spreadsheets,1);
});
test('Pilot: Dirección opcional consulta documentos y no modifica notas',()=>{
 const env=pilotPlatform();env.props.set('PILOT_DIRECTION_EMAIL','direction@clases.edu.sv');env.c.preparePilot_();env.as('direction@clases.edu.sv');assert.equal(env.c.api('pilotIdentity').role,'DIRECTION');assert.equal(env.c.api('consolidated',{year:'2099',sectionId:'pilot-section-1'}).students.length,2);assert.throws(()=>env.c.api('saveGrades',{version:0,assignmentId:'pilot-assignment-1',periodId:'1',rows:[{studentId:'pilot-student-1',values:[8,8,8]}]}),/consulta/);
});
test('Pilot: repetir preparación y restaurar conserva las cinco notas importadas y sus cuadros',()=>{
 const env=pilotPlatform();env.c.preparePilot_();const call=(action,params)=>env.c.api(action,{version:env.current().version,...params});
 call('evaluationPolicy',{assignmentId:'pilot-assignment-1',periodId:'1',count:5,weights:[.1,.2,.3,.2,.2],reason:'Regla sintética explícita del piloto'});
 call('specialty',{name:'Especialidad del piloto'});const specialty=env.current().specialties[0];call('sectionSpecialty',{sectionId:'pilot-section-1',specialtyId:specialty.id});
 env.as('a@clases.edu.sv');const row={nie:'99000001',values:[0,6,7,8,9],source:{file:'piloto.xlsx',sheet:'Notas',block:'source',range:'A2:G2',cell:'A2'}};
 call('importPreview',{assignmentId:'pilot-assignment-1',periodId:'1',preview:{schema:'GENESIS_PREVIEW_V1',hash:'d'.repeat(64),blocks:[{id:'source'}]},rows:[row]});env.as('owner@clases.edu.sv');call('approveImport',{batchId:env.current().batches[0].id,rows:[row]});
 const before=env.current();assert.equal(env.c.preparePilot_().status,'ALREADY_INITIALIZED');assert.deepEqual(env.current(),before);const backup=env.c.backupPilot_();env.props.set('PILOT_RESTORE_BACKUP_ID',backup.backupId);env.props.set('PILOT_RESTORE_SHA256',backup.sha256);const restored=env.c.restorePilotBackup_();assert.equal(restored.status,'RESTORED_COPY_VERIFIED');assert.deepEqual(JSON.parse(JSON.stringify(env.c.GoogleStorage.read(restored.spreadsheetId))),before);
});
