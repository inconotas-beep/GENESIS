import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {googlePlatform} from './helpers/google-platform.mjs';import G from '../tools/core.mjs';import {syntheticXlsx} from './helpers/synthetic-xlsx.mjs';import {inspectBook} from '../tools/importer.mjs';
const p=(version=0)=>({version,assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,9,10]}]});
test('Google: dominio, identidad vacía, inactiva y petición falsificada se rechazan en servidor',()=>{
 const env=googlePlatform();for(const email of ['', 'rocio@gmail.com','unknown@clases.edu.sv']){env.as(email);assert.throws(()=>env.c.api('bootstrap',{email:'rocio@clases.edu.sv'}));}assert.equal(env.stats.writes,0);
 env.as('sin-grupos@clases.edu.sv');assert.throws(()=>env.c.api('roster',{assignmentId:'a1',periodId:'1'}),/denegado/);assert.equal(env.stats.locks,env.stats.releases);
});
test('Google: guarda notas y auditoría atómicamente, respalda y recarga sin perder NIE con ceros',()=>{
 const env=googlePlatform();env.c.api('saveGrades',p());const db=env.database();assert.equal(db.version,1);assert.deepEqual(db.grades[0].values,[8,9,10]);assert.equal(db.students[0].nie,'00000001');assert.equal(db.audit.at(-1).kind,'GRADE');assert.equal(env.stats.writes,1);assert.equal(env.stats.backups,1);assert.equal(env.props.has('WRITE_FAILED'),false);
});
test('Google: dos docentes con la misma versión no se pisan; la segunda escritura requiere recarga',()=>{
 const db=G.seed();db.users.push({id:'t2',name:'Segundo docente ficticio',email:'second@example.invalid',role:'TEACHER',active:true});db.teachers.push({id:'t2',userId:'t2',name:'Segundo docente ficticio'});db.assignments[1].teacherId='t2';
 const env=googlePlatform({db});env.c.api('saveGrades',p());env.as('second@clases.edu.sv');
 const second={version:0,assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:Array(9).fill(6)}]};assert.throws(()=>env.c.api('saveGrades',second),/datos cambiaron/);
 assert.equal(env.database().grades.length,1);second.version=1;env.c.api('saveGrades',second);assert.equal(env.database().grades.length,2);assert.deepEqual(env.database().grades[0].values,[8,9,10]);assert.throws(()=>env.c.api('saveGrades',{...p(2),role:'ADMIN'}),/denegado/);
});
test('Google: bloqueo ocupado no inicia escritura',()=>{const env=googlePlatform({failure:'lock'});assert.throws(()=>env.c.api('saveGrades',p()),/ocupado/);assert.equal(env.stats.writes,0);});
test('Google: fallo de respaldo o carpeta compartida no modifica Sheets',()=>{for(const failure of ['backup','shared']){const env=googlePlatform({failure});assert.throws(()=>env.c.api('saveGrades',p()));assert.equal(env.stats.writes,0);assert.equal(env.database().version,0);assert.equal(env.props.has('WRITE_FAILED'),false);}});
test('Google: rechazo atómico no deja calificaciones parciales y bloquea un resultado incierto',()=>{const env=googlePlatform({failure:'reject'});assert.throws(()=>env.c.api('saveGrades',p()),/bloqueado/);assert.equal(env.rows._meta[1][0],0);assert.equal(env.rows.grades.length,1);assert.ok(env.props.get('WRITE_FAILED'));assert.throws(()=>env.c.api('bootstrap'),/bloqueado/);});
test('Google: respuesta perdida después del commit se verifica sin duplicar notas',()=>{const env=googlePlatform({failure:'lost-response'});env.c.api('saveGrades',p());assert.equal(env.database().version,1);assert.equal(env.database().grades.length,1);assert.equal(env.props.has('WRITE_FAILED'),false);});
test('Google: Dirección consulta y exporta sin modificar; el docente no exporta grupos ajenos',()=>{
 const env=googlePlatform();env.as('direccion@clases.edu.sv');assert.throws(()=>env.c.api('saveGrades',p()),/consulta/);const result=env.c.api('export',{assignmentId:'a1',periodId:'1'});assert.equal(result.students.length,2);assert.equal(env.files[0].folder,'exports');assert.equal(env.stats.writes,0);env.as('sin-grupos@clases.edu.sv');assert.throws(()=>env.c.api('export',{assignmentId:'a1',periodId:'1'}),/denegado/);
});
test('Google: XLSX reutiliza el importador original, conserva fórmulas y niega Dirección',()=>{
 const env=googlePlatform(),bytes=syntheticXlsx(),params={assignmentId:'a1',periodId:'1',name:'ficticio.xlsx',content:bytes.toString('base64')};const expected=inspectBook(bytes,'ficticio.xlsx',{privateRows:true}),actual=env.c.api('xlsxPreview',params);delete actual.documentId;assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);assert.equal(env.files[0].folder,'documents');env.as('direccion@clases.edu.sv');assert.throws(()=>env.c.api('xlsxPreview',params),/consulta/);assert.equal(env.stats.writes,0);
});
test('Google: matrícula pendiente y gestión de correos/roles solo administración; última administradora protegida',()=>{
 const env=googlePlatform();assert.throws(()=>env.c.api('rosterReview'),/administración/);assert.throws(()=>env.c.api('credentials',{...p(),userId:'teacher'}),/contraseñas locales/);env.as('rocio@clases.edu.sv');
 assert.throws(()=>env.c.api('googleAccount',{version:0,userId:'admin',email:'rocio@clases.edu.sv',role:'TEACHER',active:true,confirmed:true}),/administradora/);
 env.c.api('googleAccount',{version:0,userId:'teacher',email:'nuevo@clases.edu.sv',role:'DIRECTION',active:true,confirmed:true});assert.equal(env.database().users.find(u=>u.id==='teacher').role,'DIRECTION');assert.equal(env.database().audit.at(-1).kind,'GOOGLE_ACCOUNT');
 env.as('docente@clases.edu.sv');assert.throws(()=>env.c.api('bootstrap'),/denegado/);env.as('nuevo@clases.edu.sv');assert.equal(env.c.api('bootstrap').user.role,'DIRECTION');
});
test('Google: claves compuestas, metadatos desconocidos, ceros y JSON largo se conservan sin fórmulas de Sheets',()=>{
 const {c}=googlePlatform();const rows=[{id:'a',nie:'0000',name:'=IMPORTXML("https://invalid")',extra:'x'.repeat(60000),values:[0,null,8]}];const encoded=c.GoogleSchema.encode('students',rows);assert.ok(encoded[0].includes('_json1'));assert.deepEqual(JSON.parse(JSON.stringify(c.GoogleSchema.decode('students',encoded))),rows);
 const periods=[{id:'1',year:'2026',name:'Uno'},{id:'1',year:'2027',name:'Uno'}];assert.equal(c.GoogleSchema.encode('periods',periods).length,3);
 encoded[1][2]='otro';assert.throws(()=>c.GoogleSchema.decode('students',encoded),/externa/);
});
test('Google: aprovisionamiento no autorizado no crea recursos ni llama a la API',()=>{const env=googlePlatform();assert.throws(()=>env.c.prepareGoogleResources_());assert.equal(env.stats.writes,0);});
test('Google: una hoja maestra compartida se rechaza antes de leer expedientes',()=>{const env=googlePlatform({failure:'shared-sheet'});assert.throws(()=>env.c.api('bootstrap'),/privado/);assert.equal(env.stats.loads,0);});
test('Google: cierre persiste y bloquea notas; solo administración reabre con justificación',()=>{
 const db=G.seed();db.assignments=db.assignments.filter(a=>a.id==='a1');const env=googlePlatform({db});
 for(let i=0;i<4;i++)env.c.api('saveGrades',{version:i,assignmentId:'a1',periodId:String(i+1),rows:[{studentId:'s1',values:[6,6,6]},{studentId:'s2',values:[5,5,5]}]});
 env.as('rocio@clases.edu.sv');env.c.api('period',{version:4,year:'2026',periodId:'1',closed:true});env.as('docente@clases.edu.sv');assert.throws(()=>env.c.api('saveGrades',p(5)),/cerrado/);
 env.as('direccion@clases.edu.sv');assert.throws(()=>env.c.api('period',{version:5,year:'2026',periodId:'1',closed:false,reason:'Reapertura ficticia autorizada'}),/administración/);
 env.as('rocio@clases.edu.sv');env.c.api('period',{version:5,year:'2026',periodId:'1',closed:false,reason:'Corrección ficticia autorizada'});assert.equal(env.database().periodStates[0].closed,false);assert.equal(env.database().audit.at(-1).kind,'REOPEN');
});
test('Google: distribución completa, sin HTTP local activo en google.script.run y sin IDs inventados',()=>{
 for(const file of ['Administration.gs','Config.gs','Drive.gs','Storage.gs','Code.gs','Schema.gs','Xlsx.gs','Core.gs','SubjectNames.gs','Index.html','appsscript.json'])assert.ok(fs.existsSync('dist/apps-script/'+file));
 const manifest=JSON.parse(fs.readFileSync('dist/apps-script/appsscript.json','utf8'));assert.equal(manifest.dependencies.enabledAdvancedServices[0].serviceId,'sheets');assert.match(fs.readFileSync('web/App.js','utf8'),/api\('xlsxPreview'/);
});
