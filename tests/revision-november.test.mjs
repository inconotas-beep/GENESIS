import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../tools/core.mjs';
import X from '../tools/gradebook-xlsx.mjs';
import {workbook} from '../tools/xlsx.mjs';
const admin='rocio@example.invalid',teacher='docente@example.invalid';
const fixture=()=>{const db=G.seed(),run=(action,p={})=>G.execute(db,admin,action,{version:db.version,...p});return {db,run};};
test('el número explícito en el nombre de un módulo se muestra sin modificar registros',()=>{
  const {db,run}=fixture();db.subjects.find(s=>s.id==='module').name='1.2 Gestión comercial ficticia';
  run('saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:[0,8,9,8,9,10,6,7,8]}]});
  const before=JSON.stringify(db),roster=run('export',{assignmentId:'a2',periodId:'1'}),report=run('reportCard',{year:'2026',sectionId:'2B',studentId:'s3'});
  assert.equal(roster.subject.moduleNumber,'1.2');assert.equal(roster.subject.displayName,'Módulo 1.2 · Gestión comercial ficticia');assert.equal(report.columns[0].subject.moduleNumber,'1.2');assert.equal(report.students[0].entries[0].periods[0].values[0],0);assert.equal(JSON.stringify(db),before);
  assert.equal(G.moduleIdentity({name:'Módulo 2.3 Operaciones',type:'MODULO_FASES'}).number,'2.3');assert.equal(G.moduleIdentity({name:'Operaciones',type:'MODULO_FASES',moduleNumber:'3.4'}).number,'3.4');assert.equal(G.moduleIdentity({name:'1.2 Taller',type:'GENERAL_4_PERIODOS'}).number,'');
});
test('cinco opciones de formato quedan reservadas sin alterar notas ni declarar plantillas oficiales',()=>{
  const {db,run}=fixture();run('saveGrades',{assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,9,10]}]});const grades=JSON.stringify(db.grades);
  run('specialty',{name:'Especialidad ficticia'});const frames=db.academicFrames.slice();
  for(const frame of frames)run('frameConfig',{frameId:frame.id,name:frame.name,links:[],formatSlot:frame.number});
  assert.equal(new Set(db.academicFrames.map(f=>f.formatSlot)).size,5);assert.ok(db.academicFrames.every(f=>f.formatStatus==='PENDING_TEMPLATE'));assert.equal(JSON.stringify(db.grades),grades);assert.equal(db.periods.length,4);
  const before=JSON.stringify(db);assert.throws(()=>run('frameConfig',{frameId:frames[1].id,name:frames[1].name,links:[],formatSlot:1}),/reservado/);assert.equal(JSON.stringify(db),before);
  for(const formatSlot of [0,6,-1,1.5,'1'])assert.throws(()=>run('frameConfig',{frameId:frames[0].id,name:frames[0].name,links:[],formatSlot}));
  assert.throws(()=>G.execute(db,teacher,'frameConfig',{version:db.version,frameId:frames[0].id,name:'No autorizado',links:[],formatSlot:1}),/administración/);
  run('frameConfig',{frameId:frames[0].id,name:'Nombre actualizado',links:[]});assert.equal(db.academicFrames[0].formatSlot,1);
  run('frameConfig',{frameId:frames[0].id,name:'Nombre actualizado',links:[],formatSlot:null});assert.equal(db.academicFrames[0].formatSlot,null);assert.equal(JSON.stringify(db.grades),grades);
});
test('un conflicto duplicado no permite cerrar el período ni ocultar los valores originales',()=>{
  const {db,run}=fixture();run('moduleSchedule',{assignmentId:'a2',periodIds:['1']});
  run('saveGrades',{assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,8,8]},{studentId:'s2',values:[8,8,8]}]});run('saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:Array(9).fill(8)}]});
  db.grades.push({...db.grades[0],id:'duplicado-ficticio',values:[1,1,1]});const before=JSON.stringify(db);
  assert.ok(G.completion(db,db.assignments).some(n=>n.assignmentId==='a1'&&n.periodId==='1'));
  assert.throws(()=>run('period',{year:'2026',periodId:'1',closed:true}),/pendientes/);assert.equal(JSON.stringify(db),before);
  const row=run('reportCard',{year:'2026',sectionId:'1A',studentId:'s1'}).students[0].entries[0].periods[0];assert.equal(row.conflict,true);assert.equal(row.value,null);assert.equal(JSON.stringify(row.values),'[8,8,8]');assert.equal(JSON.stringify(db),before);
});
test('XLSX de boleta y consolidado conserva todas las notas, pesos, ceros y vacíos como datos tipados',()=>{
  const {db,run}=fixture();run('evaluationPolicy',{assignmentId:'a1',periodId:'1',count:5,weights:[.1,.2,.3,.2,.2],reason:'Ponderaciones ficticias de cinco notas'});
  run('saveGrades',{assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[0,8.95,null,9,10]}]});
  const before=JSON.stringify(db);
  for(const kind of ['consolidated','reportCard']){
    const document=run(kind,{year:'2026',sectionId:'1A',studentId:'s1'}),sheets=workbook(Buffer.from(X.write(X.documentSheets(document)))),details=sheets.find(s=>s.name==='Calificaciones');assert.ok(details);
    assert.equal(details.cells.find(c=>c.cell==='A2').value,'00000001');assert.equal(details.cells.find(c=>c.cell==='G2').value,0);assert.equal(details.cells.find(c=>c.cell==='G2').numberFormat,'0.0');assert.equal(details.cells.find(c=>c.cell==='G3').value,8.95);assert.equal(details.cells.find(c=>c.cell==='G4').value,null);assert.equal(details.cells.find(c=>c.cell==='I2').value,10);assert.equal(details.cells.find(c=>c.cell==='F6').value,'Nota 5');
    assert.equal(details.cells.filter(c=>/^G\d+$/.test(c.cell)).length,15);
  }
  assert.equal(JSON.stringify(db),before);
});
test('la exportación modular identifica cada evaluación de fase y su número sin reinterpretar el cálculo',()=>{
  const {run}=fixture();run('updateCatalog',{entity:'subjects',recordId:'module',name:'2.1 Operaciones técnicas',type:'MODULO_FASES'});run('saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:[6,8,10,9,9,9,6,6,6]}]});
  const document=run('reportCard',{year:'2026',sectionId:'2B',studentId:'s3'}),details=workbook(Buffer.from(X.write(X.documentSheets(document)))).find(s=>s.name==='Calificaciones');
  assert.equal(details.cells.find(c=>c.cell==='D2').value,'2.1');assert.equal(details.cells.find(c=>c.cell==='F2').value,'Preparación · evaluación');assert.equal(details.cells.find(c=>c.cell==='I2').value,25);assert.equal(details.cells.find(c=>c.cell==='I5').value,50);assert.equal(details.cells.find(c=>c.cell==='J2').value,8);
});
