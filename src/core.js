/* Shared business rules. No network or platform dependencies. */
var Genesis = (() => {
  const optionalTables = ['specialties','academicFrames','frameLinks','evaluationPolicies','gradeLocks'];
  const tables = ['years','students','enrollments','sections','teachers','users','roles','assignments','subjects','periods','blocks','activities','weights','grades','recoveries','periodStates','audit','batches','incidents',...optionalTables];
  const readActions = ['bootstrap','roster','export','teacherWorkbook','checkImport','consolidated','reportCard','frame'];
  function fail(message) { const error=new Error(message);error.genesisPublic=true;throw error; }
  function requireThat(ok, message) { if (!ok) fail(message); }
  function score(value) { requireThat(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10), 'Nota inválida: usá un número entre 0 y 10 o vacío'); return value; }
  // One display rule; raw values and intermediate results retain their precision.
  function formatGrade(value, pending='Pendiente') {
    if(value===null||value===undefined)return pending;
    requireThat(typeof value==='number'&&Number.isFinite(value),'Resultado inválido');
    return (Math.round((value+Number.EPSILON*Math.max(1,Math.abs(value)))*10)/10).toFixed(1);
  }
  const categoryOf = subject=>subject.category||(subject.type==='MODULO_FASES'?'TECHNICAL':'BASIC');
  function moduleIdentity(subject){
    if(subject.type!=='MODULO_FASES')return {number:'',name:subject.name};
    const match=String(subject.name||'').match(/^(?:m[oó]dulo\s*(?:n[.º°o]?\s*)?)?(\d+\.\d+(?:\.\d+)*)\b\s*[-:·.]?\s*(.*)$/i);
    return {number:subject.moduleNumber||match?.[1]||'',name:match?.[2]||subject.name};
  }
  function subjectTitle(subject){const identity=moduleIdentity(subject);return (identity.number?'Módulo '+identity.number+' · ':'')+identity.name;}
  function subjectView(subject){return {...subject,category:categoryOf(subject),decimals:1,displayName:subjectTitle(subject),...(subject.type==='MODULO_FASES'?{moduleNumber:moduleIdentity(subject).number}:{})};}
  function subjectMetadata(subject,p){
    const category=p.category||(subject.type==='MODULO_FASES'?'TECHNICAL':subject.category==='CONCEPTUAL'?'CONCEPTUAL':'BASIC');
    requireThat(['BASIC','CONCEPTUAL','TECHNICAL'].includes(category)&&((category==='TECHNICAL')===(subject.type==='MODULO_FASES')),'La categoría no coincide con el tipo de evaluación');
    subject.category=category;subject.decimals=1;
    if(p.moduleNumber!==undefined){requireThat(typeof p.moduleNumber==='string'&&p.moduleNumber.length<=30&&(!p.moduleNumber||/^\d+(?:\.\d+)*$/.test(p.moduleNumber)),'Número de módulo inválido');requireThat(!p.moduleNumber||category==='TECHNICAL','El número corresponde únicamente a módulos técnicos');subject.moduleNumber=p.moduleNumber;}
  }
  const gradeKey = (a,studentId,periodId)=>[a.year,a.sectionId,a.subjectId,studentId,periodId].join('|');
  const sameScope = (x,a,periodId)=>x.year===a.year&&x.sectionId===a.sectionId&&x.subjectId===a.subjectId&&(periodId===undefined||x.periodId===periodId);
  function evaluationFor(db,a,periodId){
    const subject=db.subjects.find(s=>s.id===a.subjectId);
    requireThat(subject,'Asignatura no disponible');
    const configured=(db.evaluationPolicies||[]).find(x=>sameScope(x,a,periodId));
    if(configured)return {...configured,labels:Array.from({length:configured.count},(_,i)=>`Nota ${i+1}`)};
    const phased=subject.type==='MODULO_FASES';
    return {mode:phased?'PHASES':'WEIGHTED',count:phased?9:3,weights:db.weights.find(w=>w.id===subject.id)?.values||(phased?[.25,.5,.25]:[.35,.35,.3]),legacy:true,labels:phased?['Preparación · evaluación','Preparación · autoevaluación','Preparación · heteroevaluación','Ejecución · evaluación','Ejecución · autoevaluación','Ejecución · heteroevaluación','Evaluación · evaluación','Evaluación · autoevaluación','Evaluación · heteroevaluación']:['Nota 1','Nota 2','Nota 3']};
  }
  function evaluate(values,plan){
    requireThat(Array.isArray(values)&&values.length===plan.count,'Cantidad de notas distinta de la configuración');
    if(plan.mode==='PHASES')return calculate('MODULO_FASES',values,plan.weights);
    Array.from(values).forEach(score);
    const w=plan.weights;
    requireThat(plan.mode==='WEIGHTED'&&Number.isInteger(plan.count)&&plan.count>=1&&plan.count<=5&&Array.isArray(w)&&w.length===plan.count&&Array.from(w).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)&&Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10,'Ponderaciones inválidas');
    if(values.includes(null))return {value:null,pending:true};
    return {value:values.reduce((sum,v,i)=>sum+v*(w[i]*100),0)/100,pending:false};
  }
  function calculate(type, values, weights) {
    const n = type === 'MODULO_FASES' ? 9 : 3;
    requireThat(['MODULO_FASES','GENERAL_4_PERIODOS'].includes(type) && Array.isArray(values) && values.length === n, 'Regla o cantidad de actividades inválida');
    Array.from(values).forEach(score);
    const w=weights || (n===3?[.35,.35,.30]:[.25,.50,.25]);
    requireThat(Array.isArray(w)&&w.length===3&&Array.from(w).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)&&Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10,'Ponderaciones inválidas');
    if (values.some(v => v === null)) return {value:null, pending:true};
    const result = n === 3 ? (values[0]*(w[0]*100) + values[1]*(w[1]*100) + values[2]*(w[2]*100))/100 : ((values[0]+values[1]+values[2])*(w[0]*100) + (values[3]+values[4]+values[5])*(w[1]*100) + (values[6]+values[7]+values[8])*(w[2]*100))/300;
    return {value:result,pending:false};
  }
  function annual(values) { requireThat(Array.isArray(values)&&values.length === 4,'Se requieren cuatro períodos');Array.from(values).forEach(score);return values.some(v => v === null) ? null : values.reduce((a,b)=>a+b,0)/4; }
  function finalResult(values,policy){
    const average=annual(values),sum=average===null?null:values.reduce((a,b)=>a+b,0);
    const valid=policy&&['AVERAGE_4','SUM_4'].includes(policy.method)&&typeof policy.passMark==='number'&&Number.isFinite(policy.passMark)&&policy.passMark>=0&&policy.passMark<=(policy.method==='SUM_4'?40:10);
    const value=average===null||!valid?null:policy.method==='SUM_4'?sum:average;
    return {sum,average,value,status:average===null?'PENDIENTE':!valid?'SIN_CRITERIO':value>=policy.passMark?'APROBADO':'REPROBADO'};
  }
  function gradeIndex(db){
    const records=new Map(),conflicts=new Set(),locks=new Map();
    for(const g of db.grades){const key=gradeKey(g,g.studentId,g.periodId),old=records.get(key);if(old&&JSON.stringify(old.values)!==JSON.stringify(g.values))conflicts.add(key);else if(!old)records.set(key,g);}
    for(const i of db.incidents)if(i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.status==='REQUIRES_REVIEW')conflicts.add(gradeKey(i,i.studentId,i.periodId));
    for(const lock of db.gradeLocks||[])if(lock.active)locks.set(gradeKey(lock,lock.studentId,lock.periodId),lock);
    return {records,conflicts,locks};
  }
  function readRoster(db,a,periodId,index=gradeIndex(db)){
    const subject=db.subjects.find(s=>s.id===a.subjectId),evaluation=evaluationFor(db,a,periodId),periods=db.periods.filter(p=>p.year===a.year),policy=db.years.find(y=>y.id===a.year)?.finalPolicy||null;
    const closed=!!db.periodStates.find(s=>s.year===a.year&&s.periodId===periodId)?.closed;
    const resultAt=(studentId,id)=>{
      const key=gradeKey(a,studentId,id),record=index.records.get(key),plan=evaluationFor(db,a,id),values=record?.values?.slice()||Array(plan.count).fill(null);
      const conflict=index.conflicts.has(key)||values.length!==plan.count;
      return {values,conflict,result:conflict?{value:null,pending:true}:evaluate(values,plan),lock:index.locks.get(key)||null};
    };
    const students=db.enrollments.filter(e=>e.year===a.year&&e.sectionId===a.sectionId).map(e=>{
      const s=db.students.find(s=>s.id===e.studentId);requireThat(s,'Matrícula sin estudiante: requiere revisión administrativa');
      const current=resultAt(s.id,periodId),results=periods.map(p=>resultAt(s.id,p.id).result.value);
      const final=subject.type==='GENERAL_4_PERIODOS'&&results.length===4?finalResult(results,policy):{sum:null,average:null,value:null,status:'SIN_CRITERIO'};
      return {...s,...current,recorded:index.records.has(gradeKey(a,s.id,periodId)),locked:!!current.lock,periodResults:results,final,annual:final.average};
    });
    return {students,assignment:{...a},periodId,subject:subjectView(subject),evaluation,periodIds:periods.map(p=>p.id),finalPolicy:policy,weights:evaluation.weights,closed,version:db.version};
  }
  function completion(db,assignments){
    const {records:grades,conflicts}=gradeIndex(db);
    const bySection=new Map();for(const e of db.enrollments){const key=e.year+'|'+e.sectionId;if(!bySection.has(key))bySection.set(key,[]);bySection.get(key).push(e);}
    const out=[];
    for(const a of assignments){const subject=db.subjects.find(s=>s.id===a.subjectId);if(!subject)continue;const enrollments=bySection.get(a.year+'|'+a.sectionId)||[];
      const periods=subject.type==='GENERAL_4_PERIODOS'?db.periods.filter(p=>p.year===a.year).map(p=>p.id):a.requiredPeriods||[...new Set(db.grades.filter(g=>g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId).map(g=>g.periodId))];
      if(!periods.length){out.push({assignmentId:a.id,teacherId:a.teacherId,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:null,missingActivities:0,incompleteStudents:0,reason:'CONFIRMAR_PERIODOS'});continue;}
      for(const periodId of periods){let missingActivities=0,incompleteStudents=0;const n=evaluationFor(db,a,periodId).count;
        for(const e of enrollments){const g=grades.get([a.year,a.sectionId,a.subjectId,e.studentId,periodId].join('|'));let missing=g?Array.from({length:n},(_,i)=>g.values?.[i]).filter(v=>v===null||v===undefined).length:n;
          if(conflicts.has(gradeKey(a,e.studentId,periodId))||g&&g.values?.length!==n)missing=n;
          if(missing){incompleteStudents++;missingActivities+=missing;}}
        if(missingActivities||!enrollments.length)out.push({assignmentId:a.id,teacherId:a.teacherId,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId,missingActivities,incompleteStudents,reason:enrollments.length?'NOTAS_PENDIENTES':'SIN_MATRICULA'});
      }
    }return out;
  }
  function seed() {
    const db = Object.fromEntries(tables.map(t=>[t,[]])); db.version=0;
    db.years=[{id:'2026',label:'2026',finalPolicy:{method:'AVERAGE_4',passMark:6,reason:'Criterio INCO confirmado: materias no modulares aprueban desde 6'}}];
    db.roles=[{id:'ADMIN'},{id:'DIRECTION'},{id:'TEACHER'}];
    db.users=[{id:'admin',email:'rocio@example.invalid',name:'Rocío · demostración',role:'ADMIN',active:true},{id:'teacher',email:'docente@example.invalid',name:'Docente de prueba',role:'TEACHER',active:true},{id:'other',email:'sin-grupos@example.invalid',name:'Docente sin asignaciones',role:'TEACHER',active:true},{id:'direction',email:'direccion@example.invalid',name:'Dirección · demostración',role:'DIRECTION',active:true}];
    db.teachers=db.users.filter(u=>u.role==='TEACHER').map(u=>({id:u.id,userId:u.id,name:u.name}));
    db.sections=[{id:'1A',name:'1.º A'},{id:'2B',name:'2.º B'}];
    db.subjects=[{id:'math',name:'Matemática',type:'GENERAL_4_PERIODOS'},{id:'module',name:'Módulo de comercio',type:'MODULO_FASES'}];
    db.periods=[1,2,3,4].map(n=>({id:String(n),name:`Período ${n}`,year:'2026'}));
    db.students=[{id:'s1',nie:'00000001',name:'Estudiante Ficticio Uno'},{id:'s2',nie:'00000002',name:'Estudiante Ficticio Dos'},{id:'s3',nie:'00000003',name:'Estudiante Ficticio Tres'}];
    db.enrollments=[{id:'e1',studentId:'s1',sectionId:'1A',year:'2026'},{id:'e2',studentId:'s2',sectionId:'1A',year:'2026'},{id:'e3',studentId:'s3',sectionId:'2B',year:'2026'}];
    db.assignments=[{id:'a1',teacherId:'teacher',year:'2026',sectionId:'1A',subjectId:'math',active:true},{id:'a2',teacherId:'teacher',year:'2026',sectionId:'2B',subjectId:'module',active:true}];
    db.subjects.forEach(s=>{db.blocks.push({id:s.id,type:s.type}); const n=s.type==='MODULO_FASES'?9:3; for(let i=0;i<n;i++) db.activities.push({id:`${s.id}-${i}`,blockId:s.id,index:i}); db.weights.push({id:s.id,values:n===3?[.35,.35,.30]:[.25,.5,.25],status:'observado; pendiente validación institucional'});});
    return db;
  }
  function operate(db, email, action, p = {}, context = {}) {
    const user=db.users.find(u=>typeof email==='string'&&u.email.toLowerCase()===email.trim().toLowerCase() && u.active);
    requireThat(user,'Acceso denegado: identidad no verificable o cuenta inactiva');
    requireThat(['ADMIN','DIRECTION','TEACHER'].includes(user.role),'Rol no autorizado');
    const admin=()=>requireThat(user.role==='ADMIN','Solo administración puede realizar esta operación');
    const subjectName=name=>typeof SubjectNames==='undefined'?name:SubjectNames.canonical(name);
    const event=(kind,detail)=>db.audit.push({id:context.id?.() || `ev-${db.version}-${db.audit.length}`,at:context.now?.() || new Date().toISOString(),userId:user.id,kind,detail:JSON.parse(JSON.stringify(detail))});
    const access=id=>{const a=db.assignments.find(a=>a.id===id && a.active);requireThat(a && (user.role==='ADMIN'||user.role==='DIRECTION'||a.teacherId===user.id),'Acceso denegado: asignación no autorizada'); return a;};
    const period=(a,id)=>{requireThat(db.periods.some(x=>x.id===id && x.year===a.year),'Período inválido');return db.periodStates.find(s=>s.year===a.year&&s.periodId===id)?.closed || false;};
    const own = a=>user.role!=='TEACHER'||a.teacherId===user.id;
    let cachedIndex;const index=()=>cachedIndex||(cachedIndex=gradeIndex(db));
    const resultFor=(subject,values,a,periodId)=>a?evaluate(values,evaluationFor(db,a,periodId)):calculate(subject.type,values,db.weights.find(w=>w.id===subject.id)?.values);
    const gradeConflict=(a,studentId,periodId)=>index().conflicts.has(gradeKey(a,studentId,periodId));
    const locked=(a,studentId,periodId)=>index().locks.get(gradeKey(a,studentId,periodId));
    const validateTemplate=(template,a,periodId)=>{
      if(!template)return;
      requireThat(template.schema==='GENESIS_TEMPLATE_V1'&&['year','sectionId','subjectId','teacherId'].every(key=>template[key]===a[key])&&template.assignmentId===a.id&&template.periodId===periodId,'La plantilla no corresponde al docente, grupo, asignatura o período seleccionados');
      const plan=evaluationFor(db,a,periodId);requireThat(template.evaluation?.mode===plan.mode&&template.evaluation?.count===plan.count&&JSON.stringify(template.evaluation?.weights)===JSON.stringify(plan.weights),'La configuración de la plantilla cambió; descargá una nueva');
    };
    if(action==='checkImport'){
      const a=access(p.assignmentId);requireThat(user.role!=='DIRECTION','Dirección tiene acceso de consulta');requireThat(!period(a,p.periodId),'El período está cerrado');validateTemplate(p.template,a,p.periodId);requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'La carga debe contener entre 1 y 200 estudiantes');const seen=new Set(),subject=db.subjects.find(s=>s.id===a.subjectId);
      return {rows:p.rows.map(r=>{const s=db.students.find(s=>s.nie===r.nie),enrolled=s&&db.enrollments.some(e=>e.studentId===s.id&&e.year===a.year&&e.sectionId===a.sectionId),issues=[];if(typeof r.nie!=='string'||!/^\d{1,20}$/.test(r.nie))issues.push('NIE inválido');if(seen.has(r.nie))issues.push('NIE repetido');seen.add(r.nie);if(!enrolled)issues.push('Sin matrícula en este grupo');if(enrolled&&gradeConflict(a,s.id,p.periodId))issues.push('Notas pendientes de conciliación');if(enrolled&&locked(a,s.id,p.periodId))issues.push('Calificaciones bloqueadas');if(enrolled&&db.grades.some(g=>g.studentId===s.id&&g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&g.periodId===p.periodId))issues.push('Ya tiene notas registradas');try{resultFor(subject,r.values,a,p.periodId);}catch{issues.push('Revisá las notas');}return {nie:r.nie,name:enrolled?s.name:'',issues};})};
    }
    if(action==='bootstrap'){const allowed=db.assignments.filter(a=>a.active&&own(a));return {specialties:(db.specialties||[]).filter(s=>user.role!=='TEACHER'||db.sections.some(section=>section.specialtyId===s.id&&allowed.some(a=>a.sectionId===section.id))),academicFrames:(db.academicFrames||[]).filter(f=>user.role!=='TEACHER'||(db.frameLinks||[]).some(l=>l.frameId===f.id&&allowed.some(a=>sameScope(l,a)))),frameLinks:(db.frameLinks||[]).filter(l=>user.role!=='TEACHER'||allowed.some(a=>sameScope(l,a))),evaluationPolicies:user.role==='ADMIN'?(db.evaluationPolicies||[]):[],user,version:db.version,assignments:allowed,subjectUsage:user.role==='ADMIN'?db.subjects.map(s=>({id:s.id,hasHistory:db.grades.some(g=>g.subjectId===s.id)||db.audit.some(e=>e.kind==='GRADE'&&e.detail.subjectId===s.id)||db.incidents.some(i=>i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.subjectId===s.id)})):[],notifications:completion(db,allowed),assignmentHistory:user.role==='ADMIN'?db.assignments.filter(a=>!a.active):[],students:user.role==='ADMIN'?db.students:[],enrollments:user.role==='ADMIN'?db.enrollments:[],actors:user.role==='TEACHER'?[]:db.users.map(u=>({id:u.id,name:u.name})),sections:db.sections.filter(s=>user.role!=='TEACHER'||allowed.some(a=>a.sectionId===s.id)),subjects:db.subjects.filter(s=>user.role!=='TEACHER'||allowed.some(a=>a.subjectId===s.id)),periods:db.periods.filter(p=>user.role!=='TEACHER'||allowed.some(a=>a.year===p.year)),years:db.years.filter(y=>user.role!=='TEACHER'||allowed.some(a=>a.year===y.id)),periodStates:db.periodStates,weights:user.role==='ADMIN'?db.weights:[],teachers:user.role==='ADMIN'?db.teachers:[],users:user.role==='ADMIN'?db.users:[],audit:user.role==='TEACHER'?[]:db.audit,incidents:user.role==='TEACHER'?[]:db.incidents,batches:user.role==='TEACHER'?[]:db.batches};}
    if(action==='roster'||action==='export') {
      const a=access(p.assignmentId);period(a,p.periodId);return readRoster(db,a,p.periodId,index());
    }
    if(action==='teacherWorkbook'){
      const a=access(p.assignmentId),subject=db.subjects.find(s=>s.id===a.subjectId);
      requireThat(subject,'Asignatura sin catálogo');
      const periods=db.periods.filter(p=>p.year===a.year);
      return {assignment:{...a},subject:subjectView(subject),section:{...db.sections.find(s=>s.id===a.sectionId)},year:{...db.years.find(y=>y.id===a.year)},teacher:{name:db.users.find(u=>u.id===a.teacherId)?.name||''},specialty:(db.specialties||[]).find(s=>s.id===db.sections.find(s=>s.id===a.sectionId)?.specialtyId)||null,periods:periods.map(p=>({...p,roster:readRoster(db,a,p.id,index())})),version:db.version};
    }
    if(['consolidated','reportCard','frame'].includes(action)){
      const year=db.years.find(y=>y.id===p.year),section=db.sections.find(s=>s.id===p.sectionId);
      requireThat(year&&section,'Seleccioná año lectivo y sección válidos');
      const frame=p.frameId?(db.academicFrames||[]).find(f=>f.id===p.frameId):null;
      requireThat(!p.frameId||frame,'Cuadro no disponible');
      const links=frame?(db.frameLinks||[]).filter(l=>l.frameId===frame.id&&l.year===p.year&&l.sectionId===p.sectionId):null;
      if(p.periodId)period({year:p.year},p.periodId);
      const candidates=db.assignments.filter(a=>a.year===p.year&&a.sectionId===p.sectionId&&(user.role!=='TEACHER'||a.active&&own(a))).sort((a,b)=>Number(b.active)-Number(a.active));
      if(user.role!=='TEACHER')for(const g of db.grades.filter(g=>g.year===p.year&&g.sectionId===p.sectionId))if(!candidates.some(a=>a.subjectId===g.subjectId))candidates.push({year:g.year,sectionId:g.sectionId,subjectId:g.subjectId,teacherId:null,active:false});
      if(user.role!=='TEACHER')for(const subjectId of section.subjectIds||[])if(!candidates.some(a=>a.subjectId===subjectId))candidates.push({year:p.year,sectionId:p.sectionId,subjectId,teacherId:null,active:false});
      const assignments=candidates.filter((a,i)=>candidates.findIndex(x=>x.subjectId===a.subjectId)===i&&(!links||links.some(l=>l.subjectId===a.subjectId)));
      requireThat(user.role!=='TEACHER'||assignments.length>0,'Acceso denegado: sección o cuadro no asignado');
      const periods=db.periods.filter(x=>x.year===p.year&&(!p.periodId||x.id===p.periodId));
      const columns=assignments.map(a=>{
        const subject=db.subjects.find(s=>s.id===a.subjectId);requireThat(subject,'Asignatura histórica sin catálogo: requiere revisión');
        const selectedPeriods=periods.filter(x=>!links||links.some(l=>l.subjectId===a.subjectId&&l.periodId===x.id));
        const rosters=selectedPeriods.map(x=>({period:x,roster:readRoster(db,a,x.id,index())}));
        const teacherIds=[...new Set(db.assignments.filter(x=>x.active&&sameScope(x,a)).map(x=>x.teacherId))];
        return {subject:subjectView(subject),teachers:teacherIds.map(id=>db.users.find(u=>u.id===id)?.name||'Docente'),periods:selectedPeriods,rosters};
      }).filter(c=>c.periods.length);
      const enrolled=db.enrollments.filter(e=>e.year===p.year&&e.sectionId===p.sectionId&&(!p.studentId||e.studentId===p.studentId));
      if(action==='reportCard')requireThat(p.studentId&&enrolled.length===1,'Estudiante no matriculado en esta sección');
      const students=enrolled.map(e=>{
        const student=db.students.find(s=>s.id===e.studentId);requireThat(student,'Matrícula sin estudiante: requiere revisión');
        return {...student,entries:columns.map(c=>({subject:c.subject,teachers:c.teachers,periods:c.rosters.map(({period,roster})=>{const row=roster.students.find(s=>s.id===student.id),plan=roster.evaluation;return {id:period.id,name:period.name,values:row.values,value:row.result.value,locked:row.locked,conflict:row.conflict,evaluation:{mode:plan.mode,count:plan.count,labels:plan.labels,weights:plan.weights}};}),final:c.rosters[0].roster.students.find(s=>s.id===student.id).final}))};
      });
      return {kind:action,year:{id:year.id,label:year.label||year.name},section,frame,specialty:(db.specialties||[]).find(s=>s.id===(frame?.specialtyId||section.specialtyId))||null,scope:user.role==='TEACHER'?'PARTIAL':'SECTION',students,columns:columns.map(({subject,teachers,periods})=>({subject,teachers,periods})),version:db.version,decimals:1,notice:user.role==='TEACHER'?'Consulta parcial: únicamente asignaturas asignadas a este docente.':'Documento de consulta académica. Formato oficial y firmas pendientes de validación.'};
    }
    requireThat(p.version===db.version,'Los datos cambiaron. Recargá antes de guardar');
    if(action==='specialty'){
      admin();requireThat(typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=160,'Nombre de especialidad inválido');
      const existing=p.specialtyId?db.specialties.find(s=>s.id===p.specialtyId):null;requireThat(!p.specialtyId||existing,'Especialidad no encontrada');
      requireThat(!db.specialties.some(s=>s.id!==existing?.id&&s.name.toLowerCase()===p.name.trim().toLowerCase()),'La especialidad ya existe');
      const specialty=existing||{id:`specialty-${db.version}`};const before=existing?{...existing}:null;specialty.name=p.name.trim();
      if(!existing){db.specialties.push(specialty);for(let number=1;number<=5;number++)db.academicFrames.push({id:`${specialty.id}-frame-${number}`,specialtyId:specialty.id,number,name:`Cuadro ${number}`,status:'PENDING_CONFIGURATION'});}
      event('SPECIALTY',{before,after:specialty});
    } else if(action==='sectionSpecialty'){
      admin();const section=db.sections.find(s=>s.id===p.sectionId),specialty=db.specialties.find(s=>s.id===p.specialtyId);
      requireThat(section&&specialty,'Sección o especialidad inválida');
      requireThat(!db.frameLinks.some(l=>l.sectionId===section.id&&db.academicFrames.some(f=>f.id===l.frameId&&f.specialtyId!==specialty.id)),'La sección tiene cuadros configurados en otra especialidad');
      const before=section.specialtyId||null;section.specialtyId=specialty.id;event('SECTION_SPECIALTY',{sectionId:section.id,before,after:specialty.id});
    } else if(action==='frameConfig'){
      admin();const frame=db.academicFrames.find(f=>f.id===p.frameId);requireThat(frame&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=160&&Array.isArray(p.links)&&p.links.length<=500,'Configuración de cuadro inválida');
      const hasFormat=Object.prototype.hasOwnProperty.call(p,'formatSlot');
      if(hasFormat){requireThat(p.formatSlot===null||Number.isInteger(p.formatSlot)&&p.formatSlot>=1&&p.formatSlot<=5,'Elegí uno de los cinco formatos pendientes o dejalo sin seleccionar');requireThat(p.formatSlot===null||!db.academicFrames.some(f=>f.id!==frame.id&&f.specialtyId===frame.specialtyId&&f.formatSlot===p.formatSlot),'Ese formato ya está reservado en otro cuadro de esta especialidad');}
      const seen=new Set();const links=p.links.map(l=>{
        const existing=!l.assignmentId&&db.frameLinks.find(x=>x.frameId===frame.id&&sameScope(x,l,l.periodId));
        const a=l.assignmentId?access(l.assignmentId):existing;requireThat(a,'El vínculo histórico no pertenece a este cuadro');const section=db.sections.find(s=>s.id===a.sectionId);period(a,l.periodId);
        requireThat(section.specialtyId===frame.specialtyId,'La sección no pertenece a la especialidad del cuadro');
        const key=[a.year,a.sectionId,a.subjectId,l.periodId].join('|');requireThat(!seen.has(key),'Materia y período repetidos en el cuadro');seen.add(key);
        return {id:`${frame.id}-${seen.size}`,frameId:frame.id,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:l.periodId};
      });
      const before={...frame,links:db.frameLinks.filter(l=>l.frameId===frame.id)};frame.name=p.name.trim();if(hasFormat){frame.formatSlot=p.formatSlot;frame.formatStatus=p.formatSlot?'PENDING_TEMPLATE':'UNSELECTED';}frame.status=links.length?'CONFIGURED':'PENDING_CONFIGURATION';db.frameLinks=db.frameLinks.filter(l=>l.frameId!==frame.id).concat(links);event('FRAME_CONFIG',{before,after:{...frame,links}});
    } else if(action==='evaluationPolicy'){
      admin();const a=access(p.assignmentId);requireThat(!period(a,p.periodId),'El período está cerrado');
      requireThat(!db.grades.some(g=>sameScope(g,a,p.periodId)),'Este grupo y período tienen notas; se conserva su configuración histórica');
      requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10&&p.reason.length<=500,'La configuración requiere una justificación de al menos 10 caracteres');
      const plan={mode:'WEIGHTED',count:p.count,weights:p.weights};evaluate(Array.from({length:Number.isInteger(p.count)&&p.count>=1&&p.count<=5?p.count:0},()=>0),plan);
      const before=db.evaluationPolicies.find(x=>sameScope(x,a,p.periodId))||null;
      db.evaluationPolicies=db.evaluationPolicies.filter(x=>!sameScope(x,a,p.periodId));
      const record={id:`evaluation-${db.version}`,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,...plan,weights:p.weights.slice(),reason:p.reason};db.evaluationPolicies.push(record);event('EVALUATION_POLICY',{before,after:record});
    } else if(action==='gradeLock'){
      admin();const a=access(p.assignmentId);period(a,p.periodId);
      requireThat(typeof p.active==='boolean'&&db.enrollments.some(e=>e.year===a.year&&e.sectionId===a.sectionId&&e.studentId===p.studentId),'Bloqueo o matrícula inválidos');
      requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10&&p.reason.length<=500,'El bloqueo o desbloqueo requiere un motivo de al menos 10 caracteres');
      let record=db.gradeLocks.find(l=>sameScope(l,a,p.periodId)&&l.studentId===p.studentId);const before=record?{...record}:null;
      requireThat(p.active||record?.active,'La calificación no está bloqueada');
      if(!record){record={id:`lock-${db.version}`,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,studentId:p.studentId};db.gradeLocks.push(record);}
      Object.assign(record,{active:p.active,reason:p.reason.trim(),userId:user.id,at:context.now?.()||new Date().toISOString()});event(p.active?'GRADE_LOCK':'GRADE_UNLOCK',{before,after:record});
    } else if(action==='saveGrades') {
      const a=access(p.assignmentId);requireThat(user.role==='TEACHER'||user.role==='ADMIN','Dirección tiene acceso de consulta');requireThat(!period(a,p.periodId),'El período está cerrado');
      requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'Lote de notas inválido');
      const subject=db.subjects.find(s=>s.id===a.subjectId),seen=new Set();
      p.rows.forEach(r=>{requireThat(!seen.has(r.studentId),'Estudiante repetido');seen.add(r.studentId);requireThat(!gradeConflict(a,r.studentId,p.periodId),'Hay notas diferentes pendientes de revisión para este estudiante');requireThat(db.enrollments.some(e=>e.studentId===r.studentId&&e.year===a.year&&e.sectionId===a.sectionId),'Estudiante fuera de sección');resultFor(subject,r.values,a,p.periodId);const old=index().records.get(gradeKey(a,r.studentId,p.periodId));const changed=JSON.stringify(old?.values)!==JSON.stringify(r.values);requireThat(!changed||!locked(a,r.studentId,p.periodId),'Calificaciones bloqueadas para este estudiante, materia y período');if(changed&&old?.values.some((v,i)=>v!==null&&r.values[i]===null))requireThat(p.confirmClear===true&&typeof p.reason==='string'&&p.reason.trim().length>=10,'Vaciar notas guardadas requiere confirmación y motivo explícitos');});
      p.rows.forEach(r=>{let g=index().records.get(gradeKey(a,r.studentId,p.periodId));const before=g?g.values.slice():null;if(g&&JSON.stringify(g.values)===JSON.stringify(r.values))return;if(!g){g={id:`g-${db.grades.length}-${db.version}`,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,studentId:r.studentId,periodId:p.periodId};db.grades.push(g);}g.values=r.values.slice();event('GRADE',{gradeId:g.id,before,after:g.values,assignmentId:a.id,studentName:db.students.find(s=>s.id===r.studentId).name,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,...(p.confirmClear?{reason:p.reason,confirmedClear:true}:{})});});
    } else if(action==='assign') {
      admin();requireThat(db.teachers.some(t=>t.id===p.teacherId)&&db.users.some(u=>u.id===p.teacherId&&u.active&&u.role==='TEACHER')&&db.sections.some(s=>s.id===p.sectionId)&&db.subjects.some(s=>s.id===p.subjectId)&&db.years.some(y=>y.id===p.year),'Asignación inválida');
      const previous=p.assignmentId?access(p.assignmentId):null;
      requireThat(!db.assignments.some(a=>a.active&&a.id!==previous?.id&&a.year===p.year&&a.sectionId===p.sectionId&&a.subjectId===p.subjectId),'La sección y materia ya tienen docente');
      if(previous){previous.active=false;event('REVOKE',{...previous,reason:'Asignación modificada'});}
      const a={id:`a-${db.version}-${db.assignments.length}`,teacherId:p.teacherId,sectionId:p.sectionId,subjectId:p.subjectId,year:p.year,active:true};db.assignments.push(a);event('ASSIGN',a);
    } else if(action==='revoke') {
      admin();const a=access(p.assignmentId);a.active=false;event('REVOKE',{...a});
    } else if(action==='period') {
      requireThat(user.role==='ADMIN'||user.role==='DIRECTION','No autorizado para cerrar períodos');requireThat(typeof p.closed==='boolean'&&db.periods.some(x=>x.id===p.periodId&&x.year===p.year),'Período inválido');
      if(!p.closed){admin();requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10,'La reapertura requiere un motivo de al menos 10 caracteres');}
      if(p.closed){const assignments=db.assignments.filter(a=>a.active&&a.year===p.year);requireThat(assignments.length>0,'No se puede cerrar un año sin asignaciones');const missing=completion(db,assignments).filter(n=>n.periodId===p.periodId||!n.periodId);const conflicts=db.incidents.filter(i=>i.status==='REQUIRES_REVIEW'&&i.year===p.year&&['SUBJECT_MERGE_GRADE_CONFLICT','SUBJECT_MERGE_TEACHER_CONFLICT'].includes(i.kind)&&(!i.periodId||i.periodId===p.periodId));requireThat(!missing.length&&!conflicts.length,`No se puede cerrar: hay ${missing.length} grupos pendientes y ${conflicts.length} conflictos por revisar. El docente y administración tienen avisos.`);}
      let s=db.periodStates.find(s=>s.year===p.year&&s.periodId===p.periodId);if(!s){s={year:p.year,periodId:p.periodId};db.periodStates.push(s);}s.closed=p.closed;event(p.closed?'CLOSE':'REOPEN',{...s,reason:p.reason||''});
    } else if(action==='finalPolicy') {
      admin();const year=db.years.find(y=>y.id===p.year);requireThat(year&&['AVERAGE_4','SUM_4'].includes(p.method)&&typeof p.passMark==='number'&&Number.isFinite(p.passMark)&&p.passMark>=0&&p.passMark<=(p.method==='SUM_4'?40:10)&&typeof p.reason==='string'&&p.reason.trim().length>=10,'Confirmá el cálculo, la nota mínima y la justificación');
      requireThat(!db.periodStates.some(s=>s.year===p.year&&s.closed),'Reabrí los períodos antes de modificar el criterio final');const before=year.finalPolicy||null;year.finalPolicy={method:p.method,passMark:p.passMark,reason:p.reason};event('FINAL_POLICY',{year:p.year,before,after:year.finalPolicy});
    } else if(action==='moduleSchedule') {
      admin();const a=access(p.assignmentId);requireThat(db.subjects.find(s=>s.id===a.subjectId)?.type==='MODULO_FASES'&&Array.isArray(p.periodIds)&&p.periodIds.length>0&&p.periodIds.every(id=>db.periods.some(x=>x.year===a.year&&x.id===id)),'Seleccioná los períodos del módulo');const unique=[...new Set(p.periodIds)],old=a.requiredPeriods||[];
      requireThat(!old.some(id=>!unique.includes(id)&&db.periodStates.some(s=>s.year===a.year&&s.periodId===id&&s.closed)),'No se puede retirar un período cerrado del calendario');
      requireThat(!db.grades.some(g=>g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&!unique.includes(g.periodId)),'El módulo tiene notas en un período que intentás retirar');a.requiredPeriods=unique;event('MODULE_SCHEDULE',{assignmentId:a.id,before:old,after:unique});
    } else if(action==='policy') {
      admin();const subject=db.subjects.find(s=>s.id===p.subjectId);requireThat(subject&&!db.grades.some(g=>g.subjectId===p.subjectId),'Solo se configura una materia sin notas históricas');requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10&&(p.decimals===undefined||p.decimals===1),'Se requiere justificación; las notas se muestran con un decimal');requireThat(Array.isArray(p.weights),'Ponderaciones inválidas');calculate(subject.type,Array(subject.type==='MODULO_FASES'?9:3).fill(0),p.weights);db.weights=db.weights.filter(w=>w.id!==subject.id);db.weights.push({id:subject.id,values:p.weights.slice(),status:'CONFIGURADO_POR_ADMINISTRACION',reason:p.reason});subject.decimals=1;event('POLICY',{subjectId:subject.id,weights:p.weights,decimals:p.decimals,reason:p.reason});
    } else if(action==='credentials') {
      admin();requireThat(db.users.some(u=>u.id===p.userId&&u.active)&&typeof p.username==='string'&&/^[\p{L}\p{N}._-]{3,40}$/u.test(p.username),'Usuario inválido');event('ACCESS_CHANGED',{userId:p.userId,username:p.username});
    } else if(action==='userRole') {
      admin();const target=db.users.find(u=>u.id===p.userId);requireThat(target&&['ADMIN','DIRECTION','TEACHER'].includes(p.role)&&typeof p.active==='boolean','Cuenta o rol inválidos');requireThat(!(target.role==='ADMIN'&&target.active&&(p.role!=='ADMIN'||!p.active))||db.users.some(u=>u.id!==target.id&&u.active&&u.role==='ADMIN'),'Debe conservarse una cuenta administradora activa');const before={role:target.role,active:target.active};target.role=p.role;target.active=p.active;if(p.role==='TEACHER'&&!db.teachers.some(t=>t.id===target.id))db.teachers.push({id:target.id,userId:target.id,name:target.name});event('USER_ROLE',{userId:target.id,before,role:p.role,active:p.active});
    } else if(action==='catalog') {
      if(p.entity==='subjects'&&typeof p.name==='string')p={...p,name:subjectName(p.name)};
      admin();requireThat(['sections','subjects','years'].includes(p.entity)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=(p.entity==='subjects'?240:120),'Nombre inválido');
      const id=p.id||context.id?.()||`${p.entity}-${db.version}`;requireThat(typeof id==='string'&&/^[\w-]{1,80}$/.test(id),'Registro inválido');requireThat(!db[p.entity].some(x=>x.id===id||x.name?.toLowerCase()===p.name.trim().toLowerCase()&&!(p.entity==='sections'&&x.grade&&p.grade&&x.grade!==p.grade)),'El registro ya existe');
      const record={id,name:p.name.trim()};if(p.entity==='sections'&&p.grade){requireThat(['1','2','3'].includes(p.grade),'Grado inválido');record.grade=p.grade;}
      if(p.entity==='subjects'){requireThat(['GENERAL_4_PERIODOS','MODULO_FASES'].includes(p.type),'Tipo de evaluación no disponible');record.type=p.type;db.blocks.push({id,type:p.type});const n=p.type==='MODULO_FASES'?9:3;for(let i=0;i<n;i++)db.activities.push({id:`${id}-${i}`,blockId:id,index:i});db.weights.push({id,values:n===9?[.25,.50,.25]:[.35,.35,.30],status:'OBSERVADO_PENDIENTE_VALIDACION'});}
      if(p.entity==='years'){record.label=p.name;record.finalPolicy={method:'AVERAGE_4',passMark:6,reason:'Criterio INCO confirmado: materias no modulares aprueban desde 6'};['1','2','3','4'].forEach(periodId=>db.periods.push({id:periodId,name:`Período ${periodId}`,year:id}));}
      if(p.entity==='subjects')subjectMetadata(record,p);db[p.entity].push(record);event('CATALOG_CREATE',{entity:p.entity,record});
    } else if(action==='updateCatalog') {
      if(p.entity==='subjects'&&typeof p.name==='string')p={...p,name:subjectName(p.name)};
      admin();requireThat(['sections','subjects','years'].includes(p.entity),'Catálogo inválido');const record=db[p.entity].find(x=>x.id===p.recordId);requireThat(record&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=(p.entity==='subjects'?240:120),'Nombre inválido');requireThat(!db[p.entity].some(x=>x.id!==record.id&&(x.name||x.label)?.toLowerCase()===p.name.trim().toLowerCase()),'El registro ya existe');const before=JSON.parse(JSON.stringify(record));
      if(p.entity==='sections'&&p.grade){requireThat(['1','2','3'].includes(p.grade),'Grado inválido');record.grade=p.grade;}
      if(p.entity==='subjects'&&p.type!==undefined){requireThat(['GENERAL_4_PERIODOS','MODULO_FASES'].includes(p.type),'Categoría inválida');if(p.type!==record.type){requireThat(!db.grades.some(g=>g.subjectId===record.id)&&!db.audit.some(e=>e.kind==='GRADE'&&e.detail.subjectId===record.id)&&!db.incidents.some(i=>i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.subjectId===record.id),'La categoría no puede cambiar porque la materia tiene historial académico');requireThat(!db.assignments.some(a=>a.subjectId===record.id&&db.periodStates.some(s=>s.year===a.year&&s.closed)),'No se puede cambiar la categoría con períodos cerrados');record.type=p.type;db.blocks=db.blocks.filter(b=>b.id!==record.id);db.activities=db.activities.filter(a=>a.blockId!==record.id);db.weights=db.weights.filter(w=>w.id!==record.id);db.blocks.push({id:record.id,type:p.type});const n=p.type==='MODULO_FASES'?9:3;for(let i=0;i<n;i++)db.activities.push({id:`${record.id}-${i}`,blockId:record.id,index:i});db.weights.push({id:record.id,values:n===9?[.25,.5,.25]:[.35,.35,.3],status:'OBSERVADO_PENDIENTE_VALIDACION'});for(const a of db.assignments.filter(a=>a.subjectId===record.id))delete a.requiredPeriods;}}
      if(p.entity==='subjects')subjectMetadata(record,p);record.name=p.name.trim();if(p.entity==='years')record.label=record.name;event('CATALOG_UPDATE',{entity:p.entity,before,after:record});
    } else if(action==='student') {
      admin();const student=db.students.find(s=>s.id===p.studentId);requireThat(student&&typeof p.nie==='string'&&/^\d{1,20}$/.test(p.nie)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=160,'Estudiante inválido');requireThat(!db.students.some(s=>s.id!==student.id&&s.nie===p.nie),'El NIE ya pertenece a otro estudiante');const before={...student};student.name=p.name.trim();student.nie=p.nie;event('STUDENT_UPDATE',{before,after:student});
    } else if(action==='updateEnrollment') {
      admin();const enrollment=db.enrollments.find(e=>e.id===p.enrollmentId);requireThat(enrollment&&db.sections.some(s=>s.id===p.sectionId),'Matrícula inválida');requireThat(!db.grades.some(g=>g.studentId===enrollment.studentId&&g.year===enrollment.year),'La matrícula tiene notas registradas; requiere un traslado académico autorizado');const before={...enrollment};enrollment.sectionId=p.sectionId;event('ENROLLMENT_UPDATE',{before,after:enrollment});
    } else if(action==='enroll') {
      admin();requireThat(typeof p.nie==='string'&&/^\d{1,20}$/.test(p.nie)&&typeof p.name==='string'&&p.name.trim(),'NIE o nombre inválido');requireThat(db.sections.some(s=>s.id===p.sectionId)&&db.years.some(y=>y.id===p.year),'Año o sección inválidos');
      let s=db.students.find(s=>s.nie===p.nie);if(!s){s={id:`s-${db.version}`,nie:p.nie,name:p.name.trim()};db.students.push(s);}requireThat(!db.enrollments.some(e=>e.studentId===s.id&&e.year===p.year),'Estudiante ya matriculado en ese año');db.enrollments.push({id:`e-${db.version}`,studentId:s.id,year:p.year,sectionId:p.sectionId});event('ENROLL',{studentId:s.id,year:p.year,sectionId:p.sectionId});
    } else if(action==='teacher') {
      admin();requireThat(typeof p.name==='string'&&p.name.trim()&&p.name.length<=160&&typeof p.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email),'Nombre o correo inválido');const email=p.email.trim().toLowerCase();requireThat(!db.users.some(u=>u.id!==p.teacherId&&u.email.toLowerCase()===email),'Correo ya registrado');
      if(p.teacherId){const teacher=db.teachers.find(t=>t.id===p.teacherId),account=db.users.find(u=>u.id===p.teacherId);requireThat(teacher&&account,'Docente no encontrado');const before={name:account.name,email:account.email};account.name=p.name.trim();account.email=email;teacher.name=account.name;event('TEACHER_UPDATE',{userId:account.id,before,after:{name:account.name,email:account.email}});}
      else{const id=`t-${db.version}`;db.users.push({id,name:p.name.trim(),email,role:'TEACHER',active:true});db.teachers.push({id,userId:id,name:p.name.trim()});event('TEACHER_CREATE',{id});}
    } else if(action==='importPreview') {
      const a=access(p.assignmentId);requireThat(user.role!=='DIRECTION','Dirección tiene acceso de consulta');requireThat(!period(a,p.periodId),'El período está cerrado');
      requireThat(p.preview?.schema==='GENESIS_PREVIEW_V1'&&typeof p.preview.hash==='string'&&/^[a-f0-9]{64}$/.test(p.preview.hash)&&Array.isArray(p.preview.blocks)&&p.preview.blocks.length>0&&p.preview.blocks.length<=2000,'Previsualización inválida');
      validateTemplate(p.template,a,p.periodId);const blockId=p.blockId||p.preview.blocks[0].id;requireThat(typeof blockId==='string'&&p.preview.blocks.some(b=>b.id===blockId),'Seleccioná un cuadro de calificaciones');
      const academicKey=[a.year,a.sectionId,a.subjectId,p.periodId,blockId].join(':');
      requireThat(!db.batches.some(b=>b.hash===p.preview.hash&&b.status!=='REVERTED'&&(b.academicKey===academicKey||(!b.academicKey&&b.assignmentId===a.id&&b.periodId===p.periodId))),'Este cuadro ya fue enviado para este grupo y período');
      requireThat(!p.preview.incidents||Array.isArray(p.preview.incidents),'Incidencias inválidas');
      const batch={id:`b-${db.version}`,hash:p.preview.hash,assignmentId:a.id,periodId:p.periodId,blockId,academicKey,status:'REVIEW',summary:{blocks:p.preview.blocks.length},owner:user.id,...(p.template?{template:JSON.parse(JSON.stringify(p.template))}:{})};db.batches.push(batch);event('IMPORT_PREVIEW',batch);
      if(p.rows){const check=execute(db,email,'checkImport',{assignmentId:a.id,periodId:p.periodId,rows:p.rows,template:p.template});requireThat(check.rows.every(r=>r.issues.length===0),'La carga tiene conflictos pendientes');requireThat(p.rows.every(r=>r.source&&r.source.block===blockId&&['file','sheet','range','cell'].every(k=>typeof r.source[k]==='string'&&r.source[k].length<=300)),'Procedencia incompleta');batch.reviewRows=p.rows.map(r=>({nie:r.nie,values:r.values.slice(),source:{file:r.source.file,sheet:r.source.sheet,block:blockId,range:r.source.range,cell:r.source.cell}}));}
      (p.preview.incidents||[]).slice(0,2000).forEach((i,index)=>db.incidents.push({id:`${batch.id}-${index}`,batchId:batch.id,kind:String(i.kind||'REVIEW').slice(0,80),file:String(i.file||'').slice(0,250),sheet:String(i.sheet||'').slice(0,100),cell:String(i.cell||'').slice(0,20),status:'REQUIRES_REVIEW'}));
      // Only reviewed mappings with explicit rows can be approved; inferred source metadata never grants access.
    } else if(action==='approveImport') {
      admin();const b=db.batches.find(b=>b.id===p.batchId&&b.status==='REVIEW');requireThat(b,'Lote no disponible');const a=access(b.assignmentId);requireThat(!period(a,b.periodId),'El período está cerrado');validateTemplate(b.template,a,b.periodId);
      requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'Confirmá el mapeo de estudiantes y actividades');
      const subject=db.subjects.find(s=>s.id===a.subjectId), seen=new Set();
      p.rows.forEach(r=>{requireThat(typeof r.nie==='string'&&db.students.some(s=>s.nie===r.nie),'NIE no matriculado: registrá la matrícula primero');const s=db.students.find(s=>s.nie===r.nie);requireThat(!seen.has(s.id),'NIE duplicado');seen.add(s.id);requireThat(db.enrollments.some(e=>e.studentId===s.id&&e.year===a.year&&e.sectionId===a.sectionId),'Matrícula no autorizada');resultFor(subject,r.values,a,b.periodId);requireThat(!gradeConflict(a,s.id,b.periodId),'Hay notas diferentes pendientes de revisión');requireThat(!locked(a,s.id,b.periodId),'Calificaciones bloqueadas');requireThat(!db.grades.some(g=>g.studentId===s.id&&g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&g.periodId===b.periodId),'Hay notas existentes: resolver antes de importar');requireThat(r.source&&['file','sheet','block','range','cell'].every(k=>typeof r.source[k]==='string')&&(!b.blockId||r.source.block===b.blockId),'Procedencia incompleta o cuadro distinto');});
      p.rows.forEach(r=>{const s=db.students.find(s=>s.nie===r.nie);db.grades.push({id:`ig-${db.grades.length}-${db.version}`,studentId:s.id,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:b.periodId,values:r.values.slice(),source:{...r.source,batch:b.id}});});b.status='IMPORTED';event('IMPORT_APPROVED',{batchId:b.id,count:p.rows.length});
    } else if(action==='revertImport') {
      admin();const b=db.batches.find(b=>b.id===p.batchId&&b.status==='IMPORTED');requireThat(b,'Lote no importado');
      if(b.bulk){const grades=db.grades.filter(g=>g.source?.batch===b.id);for(const g of grades){const a=access(g.source.assignmentId);requireThat(a.year===g.year&&a.sectionId===g.sectionId&&a.subjectId===g.subjectId,'La asignación de la carga cambió');requireThat(!period(a,g.periodId),'El período está cerrado');}}
      else{const a=access(b.assignmentId);requireThat(!period(a,b.periodId),'El período está cerrado');}
      requireThat(!db.grades.some(g=>g.source?.batch===b.id&&locked(g,g.studentId,g.periodId)),'La carga contiene calificaciones bloqueadas');requireThat(!db.audit.some(e=>e.kind==='GRADE'&&db.grades.some(g=>g.source?.batch===b.id&&g.id===e.detail.gradeId)),'Hay modificaciones posteriores: requiere revisión manual');db.grades=db.grades.filter(g=>g.source?.batch!==b.id);b.status='REVERTED';event('IMPORT_REVERTED',{batchId:b.id});
    } else fail('Operación desconocida');
    db.version++;return {ok:true,version:db.version};
  }
  function execute(db,email,action,p={},context={}){
    if(readActions.includes(action))return JSON.parse(JSON.stringify(operate(db,email,action,p,context)));
    const staged=JSON.parse(JSON.stringify(db));for(const table of optionalTables)if(!staged[table])staged[table]=[];const result=operate(staged,email,action,p,context);Object.assign(db,staged);return result;
  }
  return {tables,optionalTables,readActions,seed,execute,calculate,evaluate,evaluationFor,formatGrade,categoryOf,moduleIdentity,subjectTitle,annual,finalResult,completion};
})();
if(typeof module!=='undefined') module.exports=Genesis;
