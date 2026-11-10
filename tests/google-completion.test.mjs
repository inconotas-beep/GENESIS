import test from 'node:test';
import assert from 'node:assert/strict';
import {googlePlatform} from './helpers/google-platform.mjs';
import G from '../tools/core.mjs';
import X from '../tools/gradebook-xlsx.mjs';
import {prepareAccounts} from '../src/account-migration.mjs';
const admin='rocio@clases.edu.sv',teacher='docente@clases.edu.sv';
const fixture=options=>{const env=googlePlatform(options);return {...env,run(email,action,params={}){env.as(email);return env.c.api(action,{version:env.database().version,...params});}};};
const save={assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[0,8,9]}]};
const asJson=value=>JSON.parse(JSON.stringify(value));

test('migración parcial de identidades conserva todos los registros sin inventar correos ni activar accesos',()=>{
 const db=G.seed(),before=structuredClone(db),prepared=prepareAccounts(db,{admin:'responsable@clases.edu.sv',teacher:''},'responsable@clases.edu.sv','2099-01-01T00:00:00Z');
 assert.deepEqual(asJson(db),before);assert.deepEqual(prepared.grades,asJson(db.grades));assert.deepEqual(prepared.assignments,asJson(db.assignments));
 for(const user of prepared.users){const original=db.users.find(u=>u.id===user.id);assert.equal(user.id,original.id);assert.equal(user.role,original.role);assert.equal(user.active,original.active);if(user.id!=='admin'){assert.equal(user.email,original.email);assert.equal(user.googleIdentity.status,'PENDING');}}
 assert.equal(prepared.users[0].googleIdentity.originalEmail,db.users[0].email);assert.equal(prepared.users[0].googleIdentity.status,'CONFIRMED');
});
test('la correspondencia exige administradora confirmada, usuarios reales y correos institucionales únicos',()=>{
 const db=G.seed();for(const [mapping,responsible]of [[{},'a@clases.edu.sv'],[{admin:'a@gmail.com'},'a@gmail.com'],[{admin:'a@clases.edu.sv',inexistente:'b@clases.edu.sv'},'a@clases.edu.sv'],[{admin:'a@clases.edu.sv',teacher:'a@clases.edu.sv'},'a@clases.edu.sv']])assert.throws(()=>prepareAccounts(db,mapping,responsible));
});
test('Google niega incluso un correo institucional correcto hasta confirmarlo explícitamente',()=>{
 const env=googlePlatform({confirmAccounts:false});assert.throws(()=>env.c.api('bootstrap',{googleIdentity:{status:'CONFIRMED'},email:admin,role:'ADMIN'}),/no confirmada/);assert.equal(env.stats.writes,0);
});
test('administración confirma y retira acceso sin cambiar ID, asignaciones ni notas',()=>{
 const db=G.seed();db.users[1].googleIdentity={status:'PENDING',email:''};const env=fixture({db});const before=env.database();
 assert.throws(()=>env.run(teacher,'bootstrap'),/no confirmada/);
 env.run(admin,'googleAccount',{userId:'teacher',email:teacher,role:'TEACHER',active:true,confirmed:true});env.run(teacher,'saveGrades',save);
 env.run(admin,'googleAccount',{userId:'teacher',email:teacher,role:'TEACHER',active:true,confirmed:false});assert.throws(()=>env.run(teacher,'bootstrap'),/no confirmada/);
 const after=env.database();assert.deepEqual(after.assignments,before.assignments);assert.equal(after.grades.length,1);assert.equal(after.grades[0].values[0],0);assert.equal(after.audit.at(-1).kind,'GOOGLE_ACCOUNT');
});
test('no se puede retirar la última administradora confirmada por otro endpoint de roles',()=>{
 const db=G.seed();db.users[2].role='ADMIN';db.users[2].googleIdentity={status:'PENDING',email:''};const env=fixture({db}),before=env.database();
 assert.throws(()=>env.run(admin,'userRole',{userId:'admin',role:'TEACHER',active:true}),/confirmada/);assert.deepEqual(env.database(),before);
 assert.throws(()=>env.run(admin,'googleAccount',{userId:'admin',email:admin,role:'ADMIN',active:true,confirmed:false}),/confirmada/);assert.deepEqual(env.database(),before);
});
test('producción permanece cerrada sin autorización y rechaza bases sintéticas de piloto',()=>{
 const env=googlePlatform();env.props.delete('ACCESS_ENABLED');assert.throws(()=>env.c.api('bootstrap'),/todavía no está habilitado/);assert.equal(env.stats.loads,0);
 env.props.set('ACCESS_ENABLED','YES');env.rows._meta[1][4]='pilot-synthetic';assert.throws(()=>env.c.api('bootstrap'),/sintética/);assert.equal(env.stats.writes,0);
});
test('Sheets antiguo se consulta sin crear tablas y las cinco nuevas aparecen con el primer commit atómico',()=>{
 const env=fixture();for(const table of G.optionalTables)delete env.rows[table];const before=structuredClone(env.rows);
 env.run(admin,'consolidated',{year:'2026',sectionId:'1A'});assert.deepEqual(env.rows,before);assert.equal(env.stats.writes,0);
 env.run(teacher,'saveGrades',save);assert.equal(env.stats.writes,1);for(const table of G.optionalTables)assert.ok(env.rows[table]);assert.equal(env.database().grades[0].values[0],0);
});
test('un fallo del lote que añade tablas no deja tablas ni calificaciones parcialmente creadas',()=>{
 const env=googlePlatform({failure:'reject'});for(const table of G.optionalTables)delete env.rows[table];const before=structuredClone(env.rows);
 assert.throws(()=>env.c.api('saveGrades',{version:0,...save}),/bloqueado/);assert.deepEqual(env.rows,before);assert.equal(env.stats.writes,0);assert.equal(env.stats.backups,1);
});
test('cinco evaluaciones llegan de Sheets a documentos con sus valores exactos y consultas sin escrituras',()=>{
 const env=fixture();env.run(admin,'evaluationPolicy',{assignmentId:'a1',periodId:'1',count:5,weights:[.1,.2,.3,.2,.2],reason:'Ponderación sintética para aceptación local'});
 env.run(teacher,'saveGrades',{...save,rows:[{studentId:'s1',values:[0,8.95,7,9,10]}]});const before=env.database(),writes=env.stats.writes,backups=env.stats.backups;
 for(const kind of ['consolidated','reportCard']){const document=env.run(admin,kind,{year:'2026',sectionId:'1A',studentId:'s1'}),period=document.students[0].entries[0].periods[0];assert.deepEqual(asJson(period.values),[0,8.95,7,9,10]);assert.deepEqual(asJson(period.evaluation.weights),[.1,.2,.3,.2,.2]);assert.equal(period.value,7.69);}
 assert.deepEqual(env.database(),before);assert.equal(env.stats.writes,writes);assert.equal(env.stats.backups,backups);
});
test('cuadros y opción de formato pendiente persisten sin duplicar notas ni crear reglas académicas',()=>{
 const env=fixture();env.run(teacher,'saveGrades',save);env.run(admin,'specialty',{name:'Especialidad sintética'});const specialty=env.database().specialties[0],frame=env.database().academicFrames[4];
 env.run(admin,'sectionSpecialty',{sectionId:'1A',specialtyId:specialty.id});env.run(admin,'frameConfig',{frameId:frame.id,name:'Cuadro de consulta',formatSlot:5,links:[{assignmentId:'a1',periodId:'1'}]});
 const before=env.database(),document=env.run(teacher,'frame',{frameId:frame.id,year:'2026',sectionId:'1A'});assert.equal(document.frame.formatStatus,'PENDING_TEMPLATE');assert.equal(before.academicFrames.length,5);assert.equal(before.grades.length,1);assert.equal(before.periods.length,4);assert.deepEqual(env.database(),before);
 env.c.GoogleSchema.validate(before);
});
test('bloqueos de Sheets se aplican al docente, revisión, aprobación y reversión de importaciones',()=>{
 const env=fixture(),row={nie:'00000001',values:[0,8,9],source:{file:'ficticio.xlsx',sheet:'Notas',block:'source',range:'A2:E2',cell:'A2'}},preview={schema:'GENESIS_PREVIEW_V1',hash:'b'.repeat(64),blocks:[{id:'source'}]};
 env.run(teacher,'importPreview',{assignmentId:'a1',periodId:'1',preview,rows:[row]});const batchId=env.database().batches[0].id;
 const lock=active=>env.run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active,reason:'Revisión sintética autorizada de importación'});
 lock(true);assert.ok(env.run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:[row]}).rows[0].issues.includes('Calificaciones bloqueadas'));
 assert.throws(()=>env.run(teacher,'saveGrades',save),/bloqueadas/);assert.throws(()=>env.run(admin,'approveImport',{batchId,rows:[row]}),/bloqueadas/);assert.equal(env.database().grades.length,0);
 lock(false);env.run(admin,'approveImport',{batchId,rows:[row]});lock(true);const before=env.database();assert.throws(()=>env.run(admin,'revertImport',{batchId}),/bloqueadas/);assert.deepEqual(env.database(),before);
});
test('XLSX de cinco notas se valida, importa y exporta mediante el backend Google sin perder ceros',async()=>{
 const env=fixture();env.run(admin,'evaluationPolicy',{assignmentId:'a1',periodId:'1',count:5,weights:[.1,.2,.3,.2,.2],reason:'Prueba sintética del intercambio con Google'});
 const group=env.run(teacher,'export',{assignmentId:'a1',periodId:'1'}),sheets=X.groupSheets(group,group.assignment,true);sheets[0].rows[1].splice(2,5,0,6,7,8,9);
 const parsed=X.template(await X.read(X.write(sheets)),'plantilla.xlsx');env.run(teacher,'importPreview',{assignmentId:'a1',periodId:'1',template:parsed.metadata,preview:{schema:'GENESIS_PREVIEW_V1',hash:'c'.repeat(64),blocks:[{id:'GENESIS_TEMPLATE_V1'}]},rows:parsed.rows});env.run(admin,'approveImport',{batchId:env.database().batches[0].id,rows:parsed.rows});
 assert.deepEqual(env.database().grades[0].values,[0,6,7,8,9]);const document=env.run(admin,'reportCard',{year:'2026',sectionId:'1A',studentId:'s1'});assert.equal(document.students[0].entries[0].periods[0].value,6.7);assert.ok(X.write(X.documentSheets(document)).length>1000);
 const tampered=asJson(parsed.metadata);tampered.teacherId='another-teacher';assert.throws(()=>env.run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:parsed.rows,template:tampered}),/no corresponde/);
});
test('básicas, conceptuales y módulos mantienen su clasificación, número y ponderación en Google',()=>{
 const env=fixture();env.run(admin,'updateCatalog',{entity:'subjects',recordId:'math',name:'Materia conceptual sintética',type:'GENERAL_4_PERIODOS',category:'CONCEPTUAL'});
 env.run(admin,'updateCatalog',{entity:'subjects',recordId:'module',name:'2.1 Módulo técnico sintético',type:'MODULO_FASES',category:'TECHNICAL'});
 env.run(teacher,'saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:[6,8,10,9,9,9,6,6,6]}]});
 assert.equal(env.run(teacher,'roster',{assignmentId:'a1',periodId:'1'}).subject.category,'CONCEPTUAL');const module=env.run(teacher,'roster',{assignmentId:'a2',periodId:'1'});assert.equal(module.subject.moduleNumber,'2.1');assert.equal(module.students[0].result.value,8);assert.equal(module.students[0].final.status,'SIN_CRITERIO');
});
test('una fila con datos y clave ausente bloquea la lectura sin ocultar ni sobrescribir su nota',()=>{
 const env=fixture();env.run(teacher,'saveGrades',save);env.rows.grades[1][0]='';const before=structuredClone(env.rows);assert.throws(()=>env.c.api('bootstrap'),/sin clave/);assert.deepEqual(env.rows,before);
});
test('registrar o editar el correo de un docente no habilita su identidad de Google automáticamente',()=>{
 const env=fixture();env.run(admin,'teacher',{name:'Persona sintética nueva',email:'new@clases.edu.sv'});const user=env.database().users.find(u=>u.email==='new@clases.edu.sv');assert.equal(user.googleIdentity.status,'PENDING');assert.throws(()=>env.run('new@clases.edu.sv','bootstrap'),/no confirmada/);
 env.run(admin,'teacher',{teacherId:'teacher',name:'Docente sintético renombrado',email:'contacto@example.invalid'});assert.equal(env.database().users.find(u=>u.id==='teacher').googleIdentity.status,'PENDING');assert.throws(()=>env.run(teacher,'bootstrap'),/no confirmada/);
});
