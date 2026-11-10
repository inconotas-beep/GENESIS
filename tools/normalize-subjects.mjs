import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';
const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('src/subject-names.js','utf8'),sandbox);const N=sandbox.SubjectNames;
const dir='data/privado/institucional',file=dir+'/database.json',initial=fs.readFileSync(file,'utf8'),db=JSON.parse(initial),apply=process.argv.includes('--apply'),groups=new Map(),mapping={},retired=[],changes=[];
for(const s of db.subjects){const canonical=N.canonical(s.name),key=s.type+'|'+N.key(canonical);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...s,canonical});}
const subjects=[];for(const group of groups.values()){
 const target=group.find(s=>N.key(s.name)===N.key(s.canonical))||group[0],canonical=target.canonical;
 if(canonical==='Módulo'&&!db.assignments.some(a=>group.some(s=>s.id===a.subjectId))&&!db.grades.some(g=>group.some(s=>s.id===g.subjectId))){retired.push(...group.map(s=>s.id));continue;}
 const keep={...target,name:canonical,aliases:[...new Set(group.flatMap(s=>[s.name,...s.aliases||[]]))]};delete keep.canonical;subjects.push(keep);
 for(const s of group){mapping[s.id]=keep.id;if(s.id!==keep.id||s.name!==canonical)changes.push({from:s.name,to:canonical});}
}
const gradeScopes=new Map(),assignmentScopes=new Map();
for(const g of db.grades){const key=[g.year,g.sectionId,mapping[g.subjectId],g.studentId,g.periodId].join('|');if(!gradeScopes.has(key))gradeScopes.set(key,[]);gradeScopes.get(key).push(g);}
for(const a of db.assignments.filter(a=>a.active)){const key=[a.year,a.sectionId,mapping[a.subjectId]].join('|');if(!assignmentScopes.has(key))assignmentScopes.set(key,[]);assignmentScopes.get(key).push(a);}
const gradeConflicts=[...gradeScopes].filter(([k,rows])=>new Set(rows.map(g=>JSON.stringify(g.values))).size>1),teacherConflicts=[...assignmentScopes].filter(([k,rows])=>new Set(rows.map(a=>a.teacherId)).size>1);
const summary={before:db.subjects.length,after:subjects.length,general:subjects.filter(s=>s.type==='GENERAL_4_PERIODOS').length,modules:subjects.filter(s=>s.type==='MODULO_FASES').length,retired:retired.length,changed:changes.length,gradeConflicts:gradeConflicts.length,teacherConflicts:teacherConflicts.length};
if(!changes.length&&!retired.length){console.log(JSON.stringify({alreadyNormalized:true,...summary}));process.exit(0);}
fs.writeFileSync(dir+'/plan-unificacion.json',JSON.stringify({summary,mapping,changes,retired,gradeConflicts,teacherConflicts},null,2));
if(apply){
 if(fs.readFileSync(file,'utf8')!==initial)throw Error('Los datos cambiaron');
 // Different academic policies cannot be silently unified.
 for(const group of groups.values()){const policies=group.map(s=>({values:db.weights.find(w=>w.id===s.id)?.values||(s.type==='MODULO_FASES'?[.25,.5,.25]:[.35,.35,.3]),decimals:s.decimals??2}));if(new Set(policies.map(p=>JSON.stringify(p))).size>1)throw Error('Políticas distintas: requiere revisión antes de unificar');}
 fs.copyFileSync(file,dir+'/respaldo-antes-unificar-'+Date.now()+'.json');
 const migrationId=crypto.randomUUID(),at=new Date().toISOString();
 for(const table of ['assignments','grades','recoveries'])for(const r of db[table])if(mapping[r.subjectId]){if(mapping[r.subjectId]!==r.subjectId)r.originalSubjectId||=r.subjectId;r.subjectId=mapping[r.subjectId];}
 for(const section of db.sections)section.subjectIds=[...new Set((section.subjectIds||[]).map(id=>mapping[id]).filter(Boolean))];
 const assignmentMap={};for(const [scope,rows]of assignmentScopes){
  if(new Set(rows.map(a=>a.teacherId)).size>1){for(const r of rows){r.active=false;r.reviewReason='SUBJECT_MERGE_TEACHER_CONFLICT';}db.incidents.push({id:crypto.randomUUID(),kind:'SUBJECT_MERGE_TEACHER_CONFLICT',subjectId:rows[0].subjectId,sectionId:rows[0].sectionId,year:rows[0].year,assignmentIds:rows.map(a=>a.id),teacherIds:[...new Set(rows.map(a=>a.teacherId))],status:'REQUIRES_REVIEW',migrationId});continue;}
  const first=rows[0];for(const r of rows.slice(1)){r.active=false;r.mergedInto=first.id;assignmentMap[r.id]=first.id;}}
 for(const g of db.grades)if(assignmentMap[g.source?.assignmentId]){g.source.originalAssignmentId=g.source.assignmentId;g.source.assignmentId=assignmentMap[g.source.assignmentId];}
 const duplicateIds=new Set();for(const rows of gradeScopes.values())if(rows.length>1){
  if(new Set(rows.map(g=>JSON.stringify(g.values))).size>1){db.incidents.push({id:crypto.randomUUID(),kind:'SUBJECT_MERGE_GRADE_CONFLICT',subjectId:rows[0].subjectId,sectionId:rows[0].sectionId,year:rows[0].year,periodId:rows[0].periodId,studentId:rows[0].studentId,gradeRecords:JSON.parse(JSON.stringify(rows)),status:'REQUIRES_REVIEW',migrationId});for(const r of rows)duplicateIds.add(r.id);}
  else{rows[0].mergedSources=rows.map(r=>({id:r.id,source:r.source}));for(const r of rows.slice(1))duplicateIds.add(r.id);}}
 if(duplicateIds.size){fs.writeFileSync(dir+'/notas-duplicadas-unificadas.json',JSON.stringify(db.grades.filter(g=>duplicateIds.has(g.id)),null,2));db.grades=db.grades.filter(g=>!duplicateIds.has(g.id));}
 for(const b of db.batches)if(b.reviewRows&&b.status==='REVIEW'){b.reviewRows=[];b.status='REVIEW_REMAP_REQUIRED';}
 db.subjects=subjects;db.blocks=db.blocks.filter(b=>mapping[b.id]===b.id);db.activities=db.activities.filter(a=>mapping[a.blockId]===a.blockId);db.weights=db.weights.filter(w=>mapping[w.id]===w.id);
 db.version++;db.audit.push({id:migrationId,at,userId:db.users.find(u=>u.active&&u.role==='ADMIN').id,kind:'SUBJECTS_NORMALIZED',detail:{summary,mapping,changes,retired,authorization:'Unificar variantes ortográficas y materias afines; Matemática pasa a Precálculo por solicitud del usuario'}});
 fs.writeFileSync(file+'.tmp',JSON.stringify(db,null,2));fs.renameSync(file+'.tmp',file);
}
const list=['# Catálogo depurado de GENESIS','','Nombres unificados. Se conservan los códigos de módulos distintos y las materias que no son equivalentes.',''];for(const [type,label]of [['GENERAL_4_PERIODOS','Materias generales'],['MODULO_FASES','Módulos']]){const rows=subjects.filter(s=>s.type===type).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));list.push('## '+label+' ('+rows.length+')','',...rows.map((s,i)=>`${i+1}. ${s.name}`),'');}fs.writeFileSync('docs/CATALOGO_DEPURADO.md',list.join('\n'));console.log(JSON.stringify({...summary,applied:apply}));
