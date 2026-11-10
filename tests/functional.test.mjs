import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../tools/core.mjs';
const admin='rocio@example.invalid',teacher='docente@example.invalid',other='sin-grupos@example.invalid',direction='direccion@example.invalid';
const fixture=()=>{const db=G.seed();return {db,run:(email,action,p={})=>G.execute(db,email,action,{version:db.version,...p})};};
const row={nie:'00000001',values:[8,9,10],source:{file:'ficticio.xlsx',sheet:'Notas',block:'source',range:'A2:E2',cell:'A2'}};
const preview={schema:'GENESIS_PREVIEW_V1',hash:'a'.repeat(64),blocks:[{id:'source'}]};
const save=(run,values=[8,9,10],periodId='1',studentId='s1')=>run(teacher,'saveGrades',{assignmentId:'a1',periodId,rows:[{studentId,values}]});

test('un decimal compartido sin redondear cálculos ni convertir pendientes a cero',()=>{
  for(const [value,expected]of [[8.95,'9.0'],[7,'7.0'],[0,'0.0'],[9.25,'9.3'],[null,'Pendiente']])assert.equal(G.formatGrade(value),expected);
  const {run}=fixture();for(const p of ['1','2','3','4'])save(run,[5.99,5.99,5.99],p);
  const s=run(teacher,'roster',{assignmentId:'a1',periodId:'1'}).students[0];assert.equal(G.formatGrade(s.final.value),'6.0');assert.equal(s.final.status,'REPROBADO');assert.equal(s.values[0],5.99);
});
test('configura una a cinco notas por ámbito y conserva cero, pendientes y pesos explícitos',()=>{
  for(let count=1;count<=5;count++){
    const {run}=fixture(),weights=Array(count).fill(1/count);
    run(admin,'evaluationPolicy',{assignmentId:'a1',periodId:'2',count,weights,reason:'Regla ficticia aprobada para la prueba'});
    const rows=[{studentId:'s1',values:Array(count).fill(0)},{studentId:'s2',values:Array(count).fill(null)}];run(teacher,'saveGrades',{assignmentId:'a1',periodId:'2',rows});
    const result=run(teacher,'roster',{assignmentId:'a1',periodId:'2'});assert.equal(result.students[0].result.value,0);assert.equal(result.students[1].result.value,null);assert.equal(result.evaluation.labels.at(-1),'Nota '+count);
    assert.equal(run(teacher,'roster',{assignmentId:'a1',periodId:'1'}).evaluation.count,3);
    assert.throws(()=>run(admin,'evaluationPolicy',{assignmentId:'a1',periodId:'2',count:1,weights:[1],reason:'No alterar las notas históricas'}),/histórica/);
  }
});
test('un esquema de módulo nuevo admite cinco notas sin reinterpretar las nueve históricas',()=>{
  const {db,run}=fixture();run(teacher,'saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:[6,8,10,9,9,9,6,6,6]}]});
  run(admin,'evaluationPolicy',{assignmentId:'a2',periodId:'2',count:5,weights:[.1,.2,.3,.2,.2],reason:'Ponderación sintética de cinco notas'});
  run(teacher,'saveGrades',{assignmentId:'a2',periodId:'2',rows:[{studentId:'s3',values:[5,6,7,8,9]}]});
  const first=run(teacher,'roster',{assignmentId:'a2',periodId:'1'}),second=run(teacher,'roster',{assignmentId:'a2',periodId:'2'});
  assert.equal(first.students[0].result.value,8);assert.equal(first.evaluation.count,9);assert.equal(second.students[0].result.value,7.2);assert.equal(second.students[0].final.status,'SIN_CRITERIO');assert.equal(db.grades[0].values.length,9);
});
test('no admite políticas fuera de rango, pesos incompletos, acceso docente o períodos cerrados',()=>{
  const {db,run}=fixture(),p={assignmentId:'a1',periodId:'1',count:2,weights:[.4,.6],reason:'Regla sintética para validar permisos'};
  assert.throws(()=>run(teacher,'evaluationPolicy',p));assert.throws(()=>run(admin,'evaluationPolicy',{...p,count:0}));assert.throws(()=>run(admin,'evaluationPolicy',{...p,count:6}));assert.throws(()=>run(admin,'evaluationPolicy',{...p,weights:[.5,.4]}));
  db.periodStates.push({year:'2026',periodId:'1',closed:true});assert.throws(()=>run(admin,'evaluationPolicy',p),/cerrado/);
});
test('consulta, consolidado, boleta y exportación usan la misma nota y no escriben',()=>{
  const {db,run}=fixture();for(const p of ['1','2','3','4'])save(run,[8,9,10],p);
  const before=JSON.stringify(db),roster=run(teacher,'export',{assignmentId:'a1',periodId:'1'}),consolidated=run(admin,'consolidated',{year:'2026',sectionId:'1A'}),report=run(direction,'reportCard',{year:'2026',sectionId:'1A',studentId:'s1'});
  assert.equal(roster.students[0].result.value,consolidated.students[0].entries[0].periods[0].value);assert.equal(report.students[0].entries[0].periods[0].value,8.95);assert.equal(report.students[0].entries[0].final.value,8.95);
  roster.students[0].values[0]=null;report.students[0].entries[0].periods[0].values[0]=null;assert.equal(JSON.stringify(db),before);
});
test('consolidados y boletas conservan historia tras revocación y respetan la asignación nueva',()=>{
  const {db,run}=fixture();save(run);run(admin,'assign',{assignmentId:'a1',teacherId:'other',year:'2026',sectionId:'1A',subjectId:'math'});
  assert.throws(()=>run(teacher,'consolidated',{year:'2026',sectionId:'1A'}),/denegado/);assert.equal(run(other,'reportCard',{year:'2026',sectionId:'1A',studentId:'s1'}).students[0].entries[0].periods[0].value,8.95);
  run(admin,'revoke',{assignmentId:db.assignments.at(-1).id});assert.equal(run(admin,'consolidated',{year:'2026',sectionId:'1A'}).students[0].entries[0].periods[0].value,8.95);assert.equal(db.grades.length,1);
});
test('el docente solo recibe columnas propias y no boletas de estudiantes de otra sección',()=>{
  const {run}=fixture();run(admin,'assign',{teacherId:'other',year:'2026',sectionId:'1A',subjectId:'module'});
  const doc=run(teacher,'consolidated',{year:'2026',sectionId:'1A'});assert.equal(doc.scope,'PARTIAL');assert.equal(doc.columns.length,1);assert.equal(doc.columns[0].subject.id,'math');
  assert.throws(()=>run(other,'reportCard',{year:'2026',sectionId:'2B',studentId:'s3'}));assert.throws(()=>run(teacher,'reportCard',{year:'2026',sectionId:'1A',studentId:'s3'}));
});
test('bloqueo individual protege solo alumno, materia, sección y período y audita el motivo',()=>{
  const {db,run}=fixture();save(run);run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:true,reason:'Revisión académica individual autorizada'});
  assert.throws(()=>save(run,[9,9,9]),/bloqueadas/);save(run,[0,0,0],'1','s2');save(run,[7,7,7],'2');run(teacher,'saveGrades',{assignmentId:'a2',periodId:'1',rows:[{studentId:'s3',values:Array(9).fill(7)}]});
  const snapshot=JSON.stringify(db);assert.throws(()=>run(teacher,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:false,reason:'Un docente no puede desbloquear'}));assert.throws(()=>run(direction,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:false,reason:'Dirección no tiene este permiso'}));assert.equal(JSON.stringify(db),snapshot);
  assert.equal(run(teacher,'roster',{assignmentId:'a1',periodId:'1'}).students[0].locked,true);run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:false,reason:'Corrección aprobada tras revisión'});save(run,[9,9,9]);assert.deepEqual(Array.from(db.audit.filter(e=>e.kind.startsWith('GRADE_')),e=>e.kind),['GRADE_LOCK','GRADE_UNLOCK']);
});
test('no se borran notas por un guardado vacío sin confirmación explícita',()=>{
  const {db,run}=fixture();save(run);const before=JSON.stringify(db);assert.throws(()=>save(run,[null,null,null]),/confirmación/);assert.equal(JSON.stringify(db),before);
  run(teacher,'saveGrades',{assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,null,10]}],confirmClear:true,reason:'Corrección explícita de una nota errónea'});assert.equal(db.grades[0].values[1],null);assert.equal(db.audit.at(-1).detail.confirmedClear,true);
});
test('bloqueos se aplican al revisar, aprobar y revertir importaciones, con validación atómica',()=>{
  const {db,run}=fixture();run(teacher,'importPreview',{assignmentId:'a1',periodId:'1',preview,rows:[row]});const batchId=db.batches[0].id;
  run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:true,reason:'Bloqueo previo a aprobar importación'});
  assert.ok(run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:[row]}).rows[0].issues.includes('Calificaciones bloqueadas'));
  assert.throws(()=>run(admin,'approveImport',{batchId,rows:[row]}),/bloqueadas/);assert.equal(db.grades.length,0);
  run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:false,reason:'Revisión completada para importar notas'});run(admin,'approveImport',{batchId,rows:[row]});
  run(admin,'gradeLock',{assignmentId:'a1',periodId:'1',studentId:'s1',active:true,reason:'Bloqueo posterior a la carga autorizada'});assert.throws(()=>run(admin,'revertImport',{batchId}),/bloqueadas/);assert.equal(db.grades.length,1);
});
test('cinco cuadros por especialidad agrupan referencias sin crear períodos ni duplicar notas',()=>{
  const {db,run}=fixture();save(run);run(admin,'specialty',{name:'Especialidad ficticia'});const specialty=db.specialties[0];assert.equal(db.academicFrames.length,5);assert.equal(db.periods.length,4);
  run(admin,'sectionSpecialty',{sectionId:'1A',specialtyId:specialty.id});const frame=db.academicFrames[4];run(admin,'frameConfig',{frameId:frame.id,name:'Cuadro técnico de consulta',links:[{assignmentId:'a1',periodId:'1'}]});
  const doc=run(teacher,'frame',{frameId:frame.id,year:'2026',sectionId:'1A'});assert.equal(doc.columns[0].periods.length,1);assert.equal(doc.students[0].entries[0].periods[0].value,8.95);assert.equal(db.grades.length,1);
  assert.throws(()=>run(teacher,'frameConfig',{frameId:frame.id,name:'No autorizado',links:[]}));
  run(admin,'assign',{assignmentId:'a1',teacherId:'other',year:'2026',sectionId:'1A',subjectId:'math'});assert.equal(run(other,'frame',{frameId:frame.id,year:'2026',sectionId:'1A'}).students[0].entries[0].periods[0].value,8.95);
});
test('clasificación conceptual y número de módulo no alteran la historia ni inventan aprobación modular',()=>{
  const {db,run}=fixture();save(run);const grades=JSON.stringify(db.grades);run(admin,'updateCatalog',{entity:'subjects',recordId:'math',name:'Precálculo',type:'GENERAL_4_PERIODOS',category:'CONCEPTUAL'});
  run(admin,'updateCatalog',{entity:'subjects',recordId:'module',name:'Operaciones comerciales',type:'MODULO_FASES',category:'TECHNICAL',moduleNumber:'1.2'});
  assert.equal(JSON.stringify(db.grades),grades);assert.equal(run(teacher,'roster',{assignmentId:'a1',periodId:'1'}).subject.category,'CONCEPTUAL');assert.equal(run(teacher,'roster',{assignmentId:'a2',periodId:'1'}).subject.moduleNumber,'1.2');
});
test('identificadores de períodos no numéricos y conflictos duplicados se muestran sin ocultar o escribir notas',()=>{
  const {db,run}=fixture();for(let i=0;i<4;i++)db.periods[i].id='period-'+i;for(let i=0;i<4;i++)save(run,[8,8,8],'period-'+i);
  assert.equal(run(teacher,'roster',{assignmentId:'a1',periodId:'period-0'}).students[0].final.value,8);
  db.grades.push({...db.grades[0],id:'duplicate',values:[1,1,1]});const before=JSON.stringify(db),result=run(admin,'reportCard',{year:'2026',sectionId:'1A',studentId:'s1'});assert.equal(result.students[0].entries[0].periods[0].conflict,true);assert.equal(result.students[0].entries[0].periods[0].value,null);assert.equal(JSON.stringify(db),before);assert.throws(()=>save(run,[7,7,7],'period-0'),/revisión/);
});
test('bases antiguas sin tablas nuevas se consultan sin migrar ni escribir',()=>{
  const {db,run}=fixture();for(const key of G.optionalTables)delete db[key];const before=JSON.stringify(db);assert.equal(run(admin,'bootstrap').specialties.length,0);run(admin,'consolidated',{year:'2026',sectionId:'1A'});assert.equal(JSON.stringify(db),before);save(run);assert.ok(Array.isArray(db.gradeLocks));
});
test('la plantilla valida docente, materia, sección, período y configuración en el servidor',()=>{
  const {db,run}=fixture(),roster=run(teacher,'export',{assignmentId:'a1',periodId:'1'}),template={schema:'GENESIS_TEMPLATE_V1',assignmentId:'a1',teacherId:'teacher',year:'2026',sectionId:'1A',subjectId:'math',periodId:'1',evaluation:{mode:roster.evaluation.mode,count:3,weights:roster.weights}};
  for(const key of ['assignmentId','teacherId','year','sectionId','subjectId','periodId'])assert.throws(()=>run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:[row],template:{...template,[key]:'other'}}),/plantilla/);
  assert.throws(()=>run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:[row],template:{...template,evaluation:{...template.evaluation,count:5}}}),/configuración/);assert.equal(db.grades.length,0);
  assert.equal(run(teacher,'checkImport',{assignmentId:'a1',periodId:'1',rows:[row],template}).rows[0].issues.length,0);
});
