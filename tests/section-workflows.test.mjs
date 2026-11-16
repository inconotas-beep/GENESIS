import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../tools/core.mjs';
import X from '../tools/gradebook-xlsx.mjs';
import {googlePlatform} from './helpers/google-platform.mjs';

const scope={year:'2026',sectionId:'1A',periodId:'2'};
const admin='rocio@example.invalid',teacher='docente@example.invalid',direction='direccion@example.invalid';
const ids=(items,select)=>Array.from(items,select);
function fixture(){
  const db=G.seed();
  Object.assign(db.assignments[1],{sectionId:'1A',teacherId:'other',requiredPeriods:['2']});
  return db;
}
function book(db,email=admin){return G.execute(db,email,'sectionWorkbook',scope);}
async function filledFile(db){
  const sheets=X.sectionSheets(book(db),true);
  sheets[1].rows[1].splice(2,3,0,8.95,10);
  sheets[2].rows[2].splice(2,9,...Array(9).fill(7));
  const workbook=X.sectionTemplate(await X.read(X.write(sheets)));
  return {...workbook,file:'notas.xlsx',hash:'a'.repeat(64)};
}

test('El Excel de sección se abre como plantilla de varias asignaturas, conserva ceros y respeta permisos',async()=>{
  const db=fixture();
  assert.equal(book(db).rosters.length,2);
  assert.equal(book(db,direction).rosters.length,2);
  assert.deepEqual(ids(book(db,teacher).rosters,r=>r.subject.id),['math']);
  assert.throws(()=>G.execute(db,teacher,'sectionWorkbook',{...scope,sectionId:'2B'}),/no asignada/);
  assert.deepEqual(ids(G.execute(db,admin,'sectionWorkbook',{...scope,periodId:'1'}).rosters,r=>r.subject.id),['math']);
  const payload=await filledFile(db);
  assert.equal(payload.groups[0].rows[0].nie,'00000001');
  assert.deepEqual(Array.from(payload.groups[0].rows[0].values),[0,8.95,10]);
  assert.equal(payload.groups[1].rows[0].values.length,9);
  const sheets=await X.read(X.write(X.sectionSheets(book(db),true)));
  const cell=sheets[1].cells.find(c=>c.cell==='C2');cell.formula=true;
  assert.throws(()=>X.sectionTemplate(sheets),/fórmulas/);
});

test('Apps Script revisa y guarda dos pestañas en una sola escritura; volver a revisar detecta las notas intactas',async()=>{
  const source=fixture(),payload=await filledFile(source),env=googlePlatform({db:source});
  env.as('rocio@clases.edu.sv');
  const review=env.c.api('checkSectionImport',payload);
  assert.equal(review.additions,2);assert.equal(env.stats.writes,0);
  env.c.api('importSectionWorkbook',{...payload,version:review.version});
  assert.equal(env.stats.writes,1);
  assert.deepEqual(env.database().grades.map(g=>g.values),[[0,8.95,10],Array(9).fill(7)]);
  const again=env.c.api('checkSectionImport',payload);
  assert.equal(again.unchanged,2);assert.equal(again.additions,0);
  assert.throws(()=>env.c.api('importSectionWorkbook',{...payload,version:review.version}),/datos cambiaron/);
  const db=env.database();
  env.c.api('revertImport',{batchId:db.batches[0].id,version:db.version});
  assert.equal(env.database().grades.length,0);
});

test('Bloqueos, cierres y cambios de notas existentes impiden toda la importación de sección',async()=>{
  const db=fixture(),payload=await filledFile(db);
  const run=(action,params,email=admin)=>G.execute(db,email,action,{version:db.version,...params});
  assert.throws(()=>run('checkSectionImport',payload,teacher),/administración/);
  assert.throws(()=>run('importSectionWorkbook',payload,direction),/administración/);
  db.gradeLocks.push({id:'lock',...scope,subjectId:'module',studentId:'s2',active:true});
  const before=JSON.stringify(db);
  assert.equal(run('checkSectionImport',payload).errors,1);
  assert.throws(()=>run('importSectionWorkbook',payload),/conflictos/);
  assert.equal(JSON.stringify(db),before);
  db.gradeLocks=[];db.periodStates.push({year:scope.year,periodId:scope.periodId,closed:true});
  assert.throws(()=>run('importSectionWorkbook',payload),/cerrado/);
  db.periodStates=[];
  db.grades.push({id:'existing',...scope,subjectId:'math',studentId:'s1',values:[5,5,5]});
  assert.equal(run('checkSectionImport',payload).errors,1);
  assert.throws(()=>run('importSectionWorkbook',payload),/conflictos/);
  assert.equal(db.grades.length,1);
  assert.throws(()=>run('checkSectionImport',{...payload,periodId:'3'}),/período|plantilla/);
});

test('La composición de boletas se guarda por período y las notas cero cuentan en toda la sección',()=>{
  const db=fixture(),run=(action,params,email=admin)=>G.execute(db,email,action,{version:db.version,...params});
  const one={...scope,studentId:'s1'};
  const status=()=>run('reportCard',one).students[0].entries.find(e=>e.subject.id==='module').periods[0];
  assert.equal(status().unfilledModule,true);
  db.grades.push({id:'zero',...scope,subjectId:'module',studentId:'s2',values:[0,...Array(8).fill(null)]});
  assert.equal(status().unfilledModule,false);
  assert.deepEqual(ids(run('reportCard',{...one,periodId:'1'}).columns,c=>c.subject.id),['math']);
  assert.throws(()=>run('reportSubjects',{...scope,subjectIds:['module']},teacher),/administración/);
  run('reportSubjects',{...scope,subjectIds:['module']});
  assert.deepEqual(ids(run('reportCard',one).columns,c=>c.subject.id),['module']);
  assert.deepEqual(ids(run('reportCard',{...one,allSubjects:true}).columns,c=>c.subject.id),['math','module']);
  assert.deepEqual(ids(run('reportCard',{...one,allSubjects:true,periodId:'1'}).columns,c=>c.subject.id),['math']);
  assert.deepEqual(ids(run('reportCard',{...one,allSubjects:true},teacher).columns,c=>c.subject.id),['math']);
  assert.deepEqual(ids(run('consolidated',scope).columns,c=>c.subject.id),['math','module']);
  assert.deepEqual(ids(run('sectionReportCards',{...scope,studentIds:['s2']}).students,s=>s.id),['s2']);
  assert.throws(()=>run('sectionReportCards',{...scope,studentIds:['s3']}),/matriculados/);
  assert.equal(run('reportCard',one,teacher).columns.length,0);
  run('reportSubjects',{...scope,subjectIds:null});
  assert.equal(run('reportCard',one).columns.length,2);
  assert.equal(db.grades.length,1);
});

test('Las opciones temporales de boleta anual respetan el calendario, el cuadro y los permisos',()=>{
  const db=fixture(),annual={year:scope.year,sectionId:scope.sectionId,forOutput:true,allSubjects:true};
  const subjects=(params,email=admin)=>ids(G.execute(db,email,'reportOptions',{...annual,...params}).subjects,s=>s.id);
  assert.deepEqual(subjects({}),['math','module']);
  assert.deepEqual(subjects({periodId:'1'}),['math']);
  assert.deepEqual(subjects({},teacher),['math']);
  assert.throws(()=>subjects({sectionId:'2B'},teacher),/no asignada/);
  db.academicFrames=[{id:'frame',specialtyId:'sp',name:'Cuadro 1'}];
  db.frameLinks=[{frameId:'frame',...scope,subjectId:'module'}];
  assert.deepEqual(subjects({frameId:'frame',allSubjects:false}),['module']);
  assert.deepEqual(subjects({frameId:'frame'}),['math','module']);
  const columns=G.execute(db,admin,'reportCard',{...annual,studentId:'s1'}).columns;
  assert.deepEqual(subjects({}),ids(columns,c=>c.subject.id));
});

test('El resultado de módulo sin período aparece solo en el documento anual autorizado',()=>{
  const db=fixture(),year='2026',sectionId='1A',studentId='s1';
  db.moduleFinals=[{id:'final-s1',year,sectionId,subjectId:'module',studentId,values:Array(9).fill(8),weights:[.25,.5,.25]}];
  const report=(email,periodId)=>G.execute(db,email,'reportCard',{year,sectionId,studentId,allSubjects:true,...(periodId?{periodId}:{})});
  const entry=report(admin).students[0].entries.find(item=>item.subject.id==='module');
  assert.equal(entry.final.value,8);
  assert.ok(entry.periods.every(p=>p.value===null));
  assert.equal(report(admin,'2').students[0].entries.find(item=>item.subject.id==='module').final.value,null);
  assert.equal(report(teacher).students[0].entries.some(item=>item.subject.id==='module'),false);
  assert.throws(()=>G.execute(db,admin,'updateEnrollment',{version:db.version,enrollmentId:'e1',sectionId:'2B'}),/traslado académico/);
  assert.equal(db.grades.length,0);
});
