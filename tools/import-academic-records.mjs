// Authorized, private import from original workbooks. No personal data in console or Git.
import fs from 'node:fs';import crypto from 'node:crypto';
import {unzip,workbook,normalize} from './xlsx.mjs';import {weightedComponents,periodForComponent,moduleMetadata} from './grade-mapping.mjs';import G from './core.mjs';
const dir='data/privado/institucional',file=dir+'/database.json',initial=fs.readFileSync(file,'utf8'),db=JSON.parse(initial),source=fs.readFileSync('NOTAS PROFESORES.zip'),hash=crypto.createHash('sha256').update(source).digest('hex'),apply=process.argv.includes('--apply');
const baseBatchKey='academic-'+hash,batchKey=db.batches.some(b=>b.id===baseBatchKey)?baseBatchKey+'-v'+db.version:baseBatchKey;if(db.batches.some(b=>b.bulk&&b.hash===hash&&b.status==='IMPORTED')){console.log(JSON.stringify({alreadyImported:true}));process.exit(0);}
const actor=db.users.find(u=>u.active&&u.role==='ADMIN');if(!actor)throw Error('No hay administración autorizada');const originalVersion=db.version,pending=[],proposals=[],teachers=new Map();
const norm=s=>normalize(s).replace(/\s+/g,' ').trim(),idFor=(prefix,s)=>prefix+'-'+crypto.createHash('sha256').update(s).digest('hex').slice(0,20);
const aliases={'1ACienciasNaturales':['1A','Ciencias Naturales'],'1KCienciayTecnología':['1K','Ciencia y Tecnología'],'Costos 3B':['3B','Costos'],'1KLenguayLiteratura':['1K','Lengua y Literatura']};
for(const [book,bytes]of unzip(source))if(/\.xlsx$/i.test(book)){
 const basename=book.split('/').at(-1).replace(/\.xlsx$/i,''),name=basename.replace(/^.*?\bProf(?:esor)?\.?\s*/i,'').replace(/^NOTAS\s*(?:Inga?\.?\s*)?/i,'').replace(/[_]+$/,'').trim();
 if(!name){pending.push({book,reason:'TEACHER_REVIEW'});continue;}const teacherId=idFor('teacher',norm(name));teachers.set(teacherId,{id:teacherId,userId:teacherId,name});
 for(const sheet of workbook(bytes)){
  if(/RESPUESTAS DE FORMULARIO/.test(normalize(sheet.name)))continue;
  if(/CONDUCT|COMP[EO]T|REMED|SOCIAL(?!ES)/.test(normalize(sheet.name))){pending.push({book,sheet:sheet.name,reason:'ACADEMIC_RULES_REVIEW'});continue;}
  const alias=aliases[sheet.name],match=alias?['',alias[0][0],alias[0][1]]:normalize(sheet.name).match(/^\s*([123])\s*[°º.ª]?\s*([A-Z])(?=\s|-|$)/),headers=sheet.cells.filter(c=>normalize(c.value)==='NIE');
  if(!headers.length)continue;if(!match){pending.push({book,sheet:sheet.name,reason:'SECTION_REVIEW'});continue;}const sectionId=match[1]+match[2];if(!db.sections.some(s=>s.id===sectionId))continue;
  const rawSubject=alias?alias[1]:sheet.name.slice(match[0].length).replace(/^[-\s]+/,'').trim();if(!rawSubject){pending.push({book,sheet:sheet.name,reason:'SUBJECT_REVIEW'});continue;}
  const issues=[],results=weightedComponents(sheet,issues);for(const issue of issues)pending.push({book,sheet:sheet.name,...issue});for(const c of sheet.cells.filter(c=>c.error))pending.push({book,sheet:sheet.name,cell:c.cell,reason:'FORMULA_ERROR'});
  for(const [index,h]of headers.entries()){
   const right=headers.filter(c=>c.row===h.row&&c.col>h.col).sort((a,b)=>a.col-b.col)[0]?.col||Infinity,end=headers.filter(c=>c.row>h.row&&c.col>=h.col&&c.col<right).sort((a,b)=>a.row-b.row)[0]?.row||Infinity;
   const labels=sheet.cells.filter(c=>c.row>=h.row-6&&c.row<=h.row&&c.col>=h.col&&c.col<right&&typeof c.value==='string'),block=`${hash.slice(0,12)}:${idFor('book',book)}:${sheet.name}:${h.cell}`;
   const modular=/MODULO/.test(normalize(rawSubject))||results.some(c=>c.type==='MODULO_FASES'&&c.row>h.row&&c.row<end);
   let subjectName=rawSubject,type=modular?'MODULO_FASES':'GENERAL_4_PERIODOS',modulePeriod;
   if(!results.some(r=>r.row>h.row&&r.row<end&&r.col<right))pending.push({book,sheet:sheet.name,block,reason:'SCHEME_REVIEW'});
   if(modular){const metadata=moduleMetadata(labels,sheet.cells);if(!metadata.title){pending.push({book,sheet:sheet.name,block,reason:'MODULE_TITLE_REVIEW'});continue;}subjectName=metadata.title;modulePeriod=metadata.period;if(!modulePeriod)pending.push({book,sheet:sheet.name,block,reason:'MODULE_PERIOD_REVIEW'});
   }
   const subjectId=idFor('sub',norm(subjectName)),rows=[];
   for(const c of (!modular||modulePeriod?sheet.cells.filter(c=>c.col===h.col&&c.row>h.row&&c.row<end&&c.value!==null&&/^\d+$/.test(String(c.value))):[])){
    const nie=String(c.value),student=db.students.find(s=>s.nie===nie);if(!student||!db.enrollments.some(e=>e.studentId===student.id&&e.year==='2026'&&e.sectionId===sectionId)){pending.push({book,sheet:sheet.name,block,cell:c.cell,reason:'ENROLLMENT_REVIEW'});continue;}
    const evaluations=results.filter(r=>r.row===c.row&&r.col<right&&r.firstCol>h.col&&r.type===type),periods=new Map();let ambiguous=false;
    for(const evaluation of evaluations){const periodId=modular?modulePeriod:periodForComponent(evaluation,labels);if(!periodId){if(evaluation.values.some(v=>v!==null))pending.push({book,sheet:sheet.name,block,cell:evaluation.cell,reason:'PERIOD_REVIEW'});continue;}if(periods.has(periodId)){ambiguous=true;break;}periods.set(periodId,evaluation);}
    if(ambiguous){pending.push({book,sheet:sheet.name,block,cell:c.cell,reason:'MULTIPLE_EVALUATIONS_SAME_PERIOD'});continue;}
    for(const [periodId,r]of periods)if(r.values.some(v=>v!==null)){
     G.calculate(type,r.values);rows.push({studentId:student.id,periodId,values:r.values,source:{file:book,sheet:sheet.name,block,range:r.refs.join(','),cell:r.cell,activityCells:r.refs,formula:r.formula,batch:batchKey}});
    }
   }
   proposals.push({teacherId,subjectId,subjectName,type,year:'2026',sectionId,book,sheet:sheet.name,block,rows});
  }
 }
}
// Never choose between two teachers or conflicting source grades implicitly.
const scopes=new Map();for(const p of proposals){const key=[p.year,p.sectionId,p.subjectId].join('|');if(!scopes.has(key))scopes.set(key,[]);scopes.get(key).push(p);}
const stats={teachersCreated:0,assignmentsCreated:0,gradesImported:0,blankActivities:0,duplicates:0,existingPreserved:0,closedSkipped:0,assignmentConflicts:0,moduleAssignments:0,pending:0};
for(const teacher of teachers.values()){
 const same=db.teachers.find(t=>norm(t.name)===norm(teacher.name));if(same){for(const p of proposals)if(p.teacherId===teacher.id)p.teacherId=same.id;continue;}
 db.teachers.push(teacher);db.users.push({id:teacher.id,name:teacher.name,email:teacher.id+'@local.invalid',role:'TEACHER',active:true});stats.teachersCreated++;
}
for(const [scope,items]of scopes){
 const owners=new Set(items.map(p=>p.teacherId));if(owners.size!==1){stats.assignmentConflicts++;pending.push({scope,reason:'MULTIPLE_TEACHERS',sources:items.map(({book,sheet,teacherId})=>({book,sheet,teacherId}))});continue;}
 const p=items[0];let subject=db.subjects.find(s=>norm(s.name)===norm(p.subjectName));if(subject&&subject.type!==p.type){pending.push({scope,reason:'EVALUATION_TYPE_CONFLICT'});continue;}
 if(!subject){subject={id:p.subjectId,name:p.subjectName,type:p.type};db.subjects.push(subject);db.blocks.push({id:subject.id,type:p.type});const n=p.type==='MODULO_FASES'?9:3;for(let i=0;i<n;i++)db.activities.push({id:subject.id+'-'+i,blockId:subject.id,index:i});db.weights.push({id:subject.id,values:p.type==='MODULO_FASES'?[.25,.5,.25]:[.35,.35,.3],status:'OBSERVADO_EN_ORIGEN'});}
 let assignment=db.assignments.find(a=>a.active&&a.year===p.year&&a.sectionId===p.sectionId&&a.subjectId===subject.id);
 if(assignment&&assignment.teacherId!==p.teacherId){stats.assignmentConflicts++;pending.push({scope,reason:'EXISTING_ASSIGNMENT_PRESERVED'});continue;}
 if(!assignment){assignment={id:crypto.randomUUID(),teacherId:p.teacherId,sectionId:p.sectionId,subjectId:subject.id,year:p.year,active:true,source:{batch:batchKey,files:[...new Set(items.map(p=>p.book))]}};db.assignments.push(assignment);stats.assignmentsCreated++;if(p.type==='MODULO_FASES')stats.moduleAssignments++;db.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),userId:actor.id,kind:'ASSIGN',detail:{...assignment,reason:'Carga de libros originales solicitada por administración'}});}
 const section=db.sections.find(s=>s.id===p.sectionId);section.subjectIds||=[];if(!section.subjectIds.includes(subject.id))section.subjectIds.push(subject.id);
 const unique=new Map();for(const item of items)for(const row of item.rows){const key=[row.studentId,row.periodId].join('|');if(!unique.has(key))unique.set(key,[]);unique.get(key).push(row);}
 for(const [key,candidates]of unique){const variants=new Set(candidates.map(r=>JSON.stringify(r.values)));if(variants.size!==1){pending.push({scope,key,reason:'SOURCE_GRADES_CONFLICT',candidates});continue;}stats.duplicates+=candidates.length-1;const row=candidates[0];
  if(db.periodStates.some(s=>s.year===p.year&&s.periodId===row.periodId&&s.closed)){stats.closedSkipped++;continue;}
  if(db.grades.some(g=>g.year===p.year&&g.sectionId===p.sectionId&&g.subjectId===subject.id&&g.periodId===row.periodId&&g.studentId===row.studentId)){stats.existingPreserved++;continue;}
  db.grades.push({id:crypto.randomUUID(),studentId:row.studentId,year:p.year,sectionId:p.sectionId,subjectId:subject.id,periodId:row.periodId,values:row.values,source:{...row.source,assignmentId:assignment.id}});stats.gradesImported++;stats.blankActivities+=row.values.filter(v=>v===null).length;
 }
}
stats.pending=pending.length;const plan={sourceHash:hash,version:originalVersion,stats,pending,proposals};fs.writeFileSync(dir+'/plan-notas-privado.json',JSON.stringify(plan,null,2));
if(apply){
 if(fs.readFileSync(file,'utf8')!==initial)throw Error('La base cambió durante la preparación; repetí la importación');
 fs.copyFileSync(file,dir+'/respaldo-antes-notas-'+Date.now()+'.json');db.version++;
 db.batches.push({id:batchKey,hash,bulk:true,status:'IMPORTED',summary:{blocks:proposals.length,...stats},owner:actor.id});
 db.audit.push({id:crypto.randomUUID(),at:new Date().toISOString(),userId:actor.id,kind:'IMPORT_APPROVED',detail:{batchId:batchKey,...stats,authorization:'Solicitud de importar notas y asignar docentes desde los libros originales'}});
 for(const [i,p]of pending.entries())db.incidents.push({id:batchKey+'-'+i,batchId:batchKey,kind:p.reason,file:p.book||p.sources?.map(s=>s.book).join(' / ')||'',sheet:p.sheet||p.sources?.[0]?.sheet||'',cell:p.cell||'',status:'REQUIRES_REVIEW'});
 fs.writeFileSync(file+'.tmp',JSON.stringify(db,null,2));fs.renameSync(file+'.tmp',file);
}
fs.writeFileSync(dir+'/resumen-notas.json',JSON.stringify({...stats,applied:apply},null,2));console.log(JSON.stringify({...stats,applied:apply}));
