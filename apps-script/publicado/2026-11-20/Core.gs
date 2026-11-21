/* Shared business rules. No network or platform dependencies. */
var Genesis = (() => {
  const optionalTables = ['specialties','academicFrames','frameLinks','evaluationPolicies','gradeLocks','moduleFinals','sectionResults'];
  const tables = ['years','students','enrollments','sections','teachers','users','roles','assignments','subjects','periods','blocks','activities','weights','grades','recoveries','periodStates','audit','batches','incidents',...optionalTables];
  const readActions = ['checkDuplicateEnrollment','bootstrap','notices','roster','export','teacherWorkbook','teacherImportWorkbook','checkTeacherImport','reviewTeacherImport','checkImport','consolidated','reportCard','frame','reportOptions','sectionReportCards','sectionWorkbook','checkSectionImport','sectionResultBackup','checkSectionResult','teacherExportIndex','teacherExportFiles','teacherExportSection'];
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
  function orderedConsolidatedColumns(columns){
    const isModule=column=>column.subject.type==='MODULO_FASES';
    const byCode=new Intl.Collator('es',{numeric:true});
    const modules=columns.filter(isModule).map(column=>({column,code:moduleIdentity(column.subject).number}));
    modules.sort((a,b)=>a.code&&b.code?byCode.compare(a.code,b.code):Number(!a.code)-Number(!b.code));
    let nextModule=0;
    return columns.map(column=>isModule(column)?modules[nextModule++].column:column);
  }
  function subjectTitle(subject){const identity=moduleIdentity(subject);return (identity.number?'Módulo '+identity.number+' · ':'')+identity.name;}
  function subjectView(subject){return {...subject,category:categoryOf(subject),decimals:1,displayName:subjectTitle(subject),...(subject.type==='MODULO_FASES'?{moduleNumber:moduleIdentity(subject).number}:{})};}
  function subjectMetadata(subject,p){
    const category=p.category||(subject.type==='MODULO_FASES'?'TECHNICAL':subject.category==='CONCEPTUAL'?'CONCEPTUAL':'BASIC');
    requireThat(['BASIC','CONCEPTUAL','TECHNICAL'].includes(category)&&((category==='TECHNICAL')===(subject.type==='MODULO_FASES')),'La categoría no coincide con el tipo de evaluación');
    subject.category=category;subject.decimals=1;
    if(p.moduleNumber!==undefined){requireThat(typeof p.moduleNumber==='string'&&p.moduleNumber.length<=30&&(!p.moduleNumber||/^\d+(?:\.\d+)*$/.test(p.moduleNumber)),'Número de módulo inválido');requireThat(!p.moduleNumber||category==='TECHNICAL','El número corresponde únicamente a módulos técnicos');subject.moduleNumber=p.moduleNumber;}
  }
  function addSubjectEvaluation(db,subject){
    const {id,type}=subject;
    const phased=type==='MODULO_FASES';
    db.blocks.push({id,type});
    for(let index=0;index<(phased?9:3);index++)db.activities.push({id:id+'-'+index,blockId:id,index});
    db.weights.push({id,values:phased?[.25,.5,.25]:[.35,.35,.3],status:'OBSERVADO_PENDIENTE_VALIDACION'});
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
  const BASIC_PASS_MARK=5.5;
  const TECHNICAL_PASS_MARK=6.5;
  function reachesGrade(value,minimum){
    // Account only for floating-point error from the weighted operations.
    // Keep the value itself and the raw activities at their original precision.
    return value>=minimum || minimum-value<=4*Number.EPSILON*Math.max(1,minimum);
  }
  function officialFinal(record,technical=false){
    const result=record?.officialFinal;
    if(!result||!Number.isFinite(result.value))return null;
    if(technical&&result.scale===5&&Number.isInteger(result.value)&&result.value>=1&&result.value<=5)return result;
    return result.scale===10&&result.value>=0&&result.value<=10?result:null;
  }
  function technicalResult(value,minimum=TECHNICAL_PASS_MARK){
    if(typeof value!=='number'||!Number.isFinite(value))return {value:null,level:null,status:'PENDIENTE'};
    const approved=reachesGrade(value,minimum);
    const level=reachesGrade(value,8.5)?5:approved?4:reachesGrade(value,4.5)?3:reachesGrade(value,2.5)?2:1;
    return {value,level,approved,status:approved?'APROBADO':'REPROBADO'};
  }
  function technicalClosingResult(value,year,section,subject,minimum=TECHNICAL_PASS_MARK){
    // The 2026 1.º F summary accepts 6.45 for module 1.3, displayed as 6.5.
    const sectionCode=String(section?.id||section||'').toUpperCase();
    const code=subject.sectionResultSlot||moduleIdentity(subject).number;
    if(year==='2026'&&sectionCode==='1F'&&code==='1.3')minimum=6.45;
    return {...technicalResult(value,minimum),...(minimum!==TECHNICAL_PASS_MARK?{levelPassMark:minimum}:{})};
  }
  function formatSubjectFinal(value,_subject,pending='—'){
    return Number.isFinite(value)?String(Number(value.toPrecision(15))):formatGrade(value,pending);
  }
  function basicGrading(subject){
    const key=subject.sectionResultSlot||sectionSlotKey(subject.name);
    return subject.type==='GENERAL_4_PERIODOS'&&
      (categoryOf(subject)==='BASIC'||key==='conducta'||key==='informatica');
  }
  function subjectFinalPolicy(subject,policy){
    return basicGrading(subject)?{...policy,method:'AVERAGE_4',passMark:BASIC_PASS_MARK}:policy;
  }
  function importedSubjectStatus(subject,value){
    if(value==null)return 'PENDIENTE';
    if(!Number.isFinite(value)||!basicGrading(subject))return 'REGISTRADO';
    return reachesGrade(value,BASIC_PASS_MARK)?'APROBADO':'REPROBADO';
  }
  function finalResult(values,policy){
    const average=annual(values),sum=average===null?null:values.reduce((a,b)=>a+b,0);
    const valid=policy&&['AVERAGE_4','SUM_4'].includes(policy.method)&&typeof policy.passMark==='number'&&Number.isFinite(policy.passMark)&&policy.passMark>=0&&policy.passMark<=(policy.method==='SUM_4'?40:10);
    const value=average===null||!valid?null:policy.method==='SUM_4'?sum:average;
    return {sum,average,value,status:average===null?'PENDIENTE':!valid?'SIN_CRITERIO':reachesGrade(value,policy.passMark)?'APROBADO':'REPROBADO'};
  }
  function gradeIndex(db){
    const records=new Map(),conflicts=new Set(),locks=new Map();
    for(const g of db.grades){const key=gradeKey(g,g.studentId,g.periodId),old=records.get(key);if(old&&JSON.stringify(old.values)!==JSON.stringify(g.values))conflicts.add(key);else if(!old)records.set(key,g);}
    for(const i of db.incidents)if(i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.status==='REQUIRES_REVIEW')conflicts.add(gradeKey(i,i.studentId,i.periodId));
    for(const lock of db.gradeLocks||[])if(lock.active)locks.set(gradeKey(lock,lock.studentId,lock.periodId),lock);
    return {records,conflicts,locks};
  }
  function duplicateArchives(db) {
    return new Map(db.enrollments
      .filter(enrollment => enrollment.duplicateArchive)
      .map(({id, duplicateArchive}) => [id, duplicateArchive]));
  }
  function previousDuplicateArchive(db, enrollmentId) {
    // The first deployment wrote the archive to the audit log. Use that
    // history only to validate a retry from administration.
    const events = db.audit || [];
    for (let i = events.length - 1; i >= 0; i--) {
      const {kind, detail} = events[i];
      if (detail?.enrollmentId !== enrollmentId) continue;
      if (kind === 'DUPLICATE_ENROLLMENT_RESTORED') return null;
      if (kind === 'DUPLICATE_ENROLLMENT_ARCHIVED') return detail;
    }
    return null;
  }
  function activeEnrollments(db, archived = duplicateArchives(db)) {
    return db.enrollments.filter(enrollment => !archived.has(enrollment.id));
  }
  function readRoster(db,a,periodId,index=gradeIndex(db),rosterSelection){
    // This cache belongs to one authorized request, never to another user or revision.
    if(!index.rosterCache){
      const students=new Map(),enrollments=new Map();
      for(const s of db.students)if(!students.has(s.id))students.set(s.id,s);
      for(const e of activeEnrollments(db)){const key=e.year+'|'+e.sectionId;if(!enrollments.has(key))enrollments.set(key,[]);enrollments.get(key).push(e);}
      index.rosterCache={students,enrollments,scopes:new Map()};
    }
    const cache=index.rosterCache,scope=[a.year,a.sectionId,a.subjectId].join('|');
    let group=cache.scopes.get(scope);
    if(!group){
      const subject=db.subjects.find(s=>s.id===a.subjectId);
      requireThat(subject,'Asignatura no disponible');
      const yearPolicy=db.years.find(y=>y.id===a.year)?.finalPolicy||null;
      group={subject,periods:db.periods.filter(p=>p.year===a.year),policy:subjectFinalPolicy(subject,yearPolicy),plans:new Map(),results:new Map(),summaries:new Map()};
      cache.scopes.set(scope,group);
    }
    const planAt=id=>{if(!group.plans.has(id))group.plans.set(id,evaluationFor(db,a,id));return group.plans.get(id);};
    const {subject,periods,policy}=group,evaluation=planAt(periodId);
    const closed=!!db.periodStates.find(s=>s.year===a.year&&s.periodId===periodId)?.closed;
    const resultAt=(studentId,id)=>{
      const key=gradeKey(a,studentId,id);
      if(group.results.has(key))return group.results.get(key);
      const record=index.records.get(key),plan=planAt(id),values=record?.values?.slice()||Array(plan.count).fill(null);
      const conflict=index.conflicts.has(key)||values.length!==plan.count;
      const result={values,conflict,result:conflict?{value:null,pending:true}:evaluate(values,plan),lock:index.locks.get(key)||null};
      group.results.set(key,result);return result;
    };
    const students=(rosterSelection??cache.enrollments.get(a.year+'|'+a.sectionId)??[]).map(e=>{
      const s=cache.students.get(e.studentId);requireThat(s,'Matrícula sin estudiante: requiere revisión administrativa');
      const current=resultAt(s.id,periodId);
      if(!group.summaries.has(s.id)){
        const results=periods.map(p=>resultAt(s.id,p.id).result.value);
        const final=subject.type==='GENERAL_4_PERIODOS'&&results.length===4?finalResult(results,policy):{sum:null,average:null,value:null,status:'SIN_CRITERIO'};
        group.summaries.set(s.id,{results,final});
      }
      const {results,final}=group.summaries.get(s.id);
      return {...s,...current,recorded:index.records.has(gradeKey(a,s.id,periodId)),locked:!!current.lock,periodResults:results,final,annual:final.average};
    });
    return {students,assignment:{...a},periodId,subject:subjectView(subject),evaluation,periodIds:periods.map(p=>p.id),finalPolicy:policy,weights:evaluation.weights,closed,version:db.version};
  }
  function completion(db,assignments){
    const {records:grades,conflicts}=gradeIndex(db);
    const finalModules=new Set((db.moduleFinals||[]).map(g=>gradeKey(g,g.studentId,'')));
    const recordedPeriods=new Map();
    for(const grade of grades.values()){
      const key=gradeKey(grade,'','');
      if(!recordedPeriods.has(key))recordedPeriods.set(key,new Set());
      recordedPeriods.get(key).add(grade.periodId);
    }
    const bySection=new Map();for(const e of activeEnrollments(db)){const key=e.year+'|'+e.sectionId;if(!bySection.has(key))bySection.set(key,[]);bySection.get(key).push(e);}
    const out=[];
    for(const a of assignments){const subject=db.subjects.find(s=>s.id===a.subjectId);if(!subject)continue;const enrollments=bySection.get(a.year+'|'+a.sectionId)||[];
      const periods=subject.type==='GENERAL_4_PERIODOS'?db.periods.filter(p=>p.year===a.year).map(p=>p.id):a.requiredPeriods||[...(recordedPeriods.get(gradeKey(a,'',''))||[])];
      if(!periods.length){if(!enrollments.length||enrollments.some(e=>!finalModules.has(gradeKey(a,e.studentId,''))))out.push({assignmentId:a.id,teacherId:a.teacherId,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:null,missingActivities:0,incompleteStudents:0,reason:'CONFIRMAR_PERIODOS'});continue;}
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
    db.years=[{id:'2026',label:'2026',finalPolicy:{method:'AVERAGE_4',passMark:BASIC_PASS_MARK,reason:'Básicas y Conducta aprueban desde 5.50 en el promedio de los cuatro períodos'}}];
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
  function sectionResultKey(year,sectionId){return JSON.stringify([year,sectionId]);}
  const resultLabel=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const lifeProjectSlot='materia:proyecto-de-vida',lifeProjectSubjectId='sub-0d107350b41a';
  const sectionAliases={
    lengua:['lengua y literatura','lenguaje y literatura','lenguaje y lietratura'],
    matematica:['matematica','matematicas'],
    naturales:['ciencias naturales','ciencia naturales','ciencia y tecnologia'],
    sociales:['estudios sociales','estudios sociales y civica'],
    idioma:['ingles','idioma extranjero'],
    'ingles-tecnico':['ingles tecnico'],
    deporte:['deporte','educacion fisica'],
    informatica:['informatica','informatica educativa','ciencias de la computacion'],
    conducta:['conducta','comportamiento','conducta y convivencia'],
    moral:['moral y civica','moral urbanidad y civica','moral y urbanidad y civica'],
    emprendedurismo:['emprendedurismo'],
    [lifeProjectSlot]:['proyecto de vida','proyecto de vida y carrera'],
    'criterio-1':['evidencia actitudes favorables para la convivencia y cultura de paz'],
    'criterio-2':['toma decisiones de forma autonoma y responsable'],
    'criterio-3':['se expresa y participa con respeto'],
    'criterio-4':['muestra sentido de pertenencia y respeto por nuestra cultura']
  };
  function sectionSlotKey(name){
    const title=resultLabel(name);
    const number=String(name).trim().match(/^(\d+)\s*\.\s*(\d+)(?:\s+\S.*)?$/);
    if(number)return number[1]+'.'+number[2];
    if(!title||/^(n|no|numero|nie|apellidos|nombres|apellidos y nombres|estudiante|nombres y apellidos|nombre del estudiante|observaciones?|estado|resultado|promedio final|nota final|condicion|total|promedio|aprobacion)$/.test(title))return '';
    return Object.keys(sectionAliases).find(key=>sectionAliases[key].includes(title))||'materia:'+title.replace(/ /g,'-');
  }
  const technicalSlot=key=>/^\d+\.\d+$/.test(key);
  const firstSoftwareFinalColumns=new Set(['lengua','matematica','naturales','sociales','ingles-tecnico','emprendedurismo']);
  function missingAnnualFromPeriods(key,periods,final,{year,section}={}){
    if(technicalSlot(key)||qualitativeSlot(key)||periods.length!==4||
      !periods.every(value=>Number.isFinite(value)&&value>=0&&value<=10))return final;
    // The 2026 1M source has six columns of literal zero finals even when all
    // four verified period marks are positive. Preserve zeros in other cases.
    const knownZero=final===0&&String(year)==='2026'&&String(section).toUpperCase()==='1M'&&
      firstSoftwareFinalColumns.has(key)&&periods.every(value=>value>0);
    return final===null||knownZero?annual(periods):final;
  }
  function normalizeSectionSlots(snapshot){
    if(!snapshot)return snapshot;
    const remapped=snapshot.slots.filter(slot=>{
      const key=sectionSlotKey(slot.name);
      return slot.key.startsWith('materia:')&&
        (technicalSlot(key)||slot.key==='materia:proyecto-de-vida-y-carrera'&&key===lifeProjectSlot);
    });
    if(!remapped.length)return snapshot;
    const slots=snapshot.slots.filter(slot=>!remapped.includes(slot));
    const allKeys=new Set(slots.map(slot=>slot.key)),moves=new Map();
    for(const slot of remapped){
      const key=sectionSlotKey(slot.name);
      moves.set(slot.key,allKeys.has(key)&&key!==lifeProjectSlot?null:key);
      if(allKeys.has(key))continue;
      allKeys.add(key);
      slots.push(key===lifeProjectSlot?{...slot,key}:{key,name:slot.name.trim().replace(/^\d+\s*\.\s*\d+/,key)});
    }
    const rows=snapshot.rows.map(row=>{
      const notes={...row.notes};
      for(const [from,to] of moves){
        if(to&&Object.hasOwn(notes,from)){
          const existing=notes[to];
          notes[to]=to===lifeProjectSlot&&existing?existing.map((value,index)=>value??notes[from][index]):notes[from];
        }
        delete notes[from];
      }
      return {...row,notes};
    });
    return {...snapshot,slots,rows};
  }
  const isMoralKey=key=>key==='moral'||key==='materia:moral';
  function isMoralSubject(subject){return isMoralKey(subject?.sectionResultSlot||sectionSlotKey(subject?.name));}
  function isConductCriterion(subject){return /^criterio-[1-4]$/.test(subject?.sectionResultSlot||sectionSlotKey(subject?.name));}
  function moduleOnlySection(section){
    return [section?.id,section?.name].some(value=>/^3[bcde]$/.test(resultLabel(value).replace(/ /g,'')));
  }
  function moduleSectionSubject(subject){
    const key=subject.sectionResultSlot||sectionSlotKey(subject.name);
    return subject.type==='MODULO_FASES'||key==='conducta'||isConductCriterion(subject);
  }
  const periodOnlySubject=subject=>isMoralSubject(subject)||isConductCriterion(subject);
  const qualitativeSlot=key=>isMoralKey(key)||key.startsWith('criterio-');
  function validSectionNotes(key,notes){
    return Array.isArray(notes)&&notes.length===5&&Array.from(notes).every(value=>value===null||
      (typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10)||
      (qualitativeSlot(key)&&['E','MB','B','R'].includes(value)));
  }
  function sectionFinalMark(key,notes){
    const final=notes[4];
    if(final!==null)return final;
    const periods=notes.slice(0,4);
    if(technicalSlot(key)){
      const available=periods.filter(Number.isFinite);
      if(available.length&&available.every(value=>Math.abs(value-available[0])<1e-8))return available[0];
    }
    return missingAnnualFromPeriods(key,periods,final);
  }
  function summaryUsesMatematica(snapshot){
    return !!snapshot&&snapshot.slots.some(slot=>slot.key==='matematica')&&!snapshot.slots.some(slot=>slot.key==='materia:precalculo');
  }
  function sectionResultPreference(codes,key){
    return codes?.[key]||(key===lifeProjectSlot?codes?.proyecto||codes?.[lifeProjectSubjectId]:undefined);
  }
  function sectionResultSubject(slot,subjects,preferred,allowMathAlias=false){
    if(slot.key===lifeProjectSlot){
      const candidates=subjects.filter(subject=>subject.type!=='MODULO_FASES');
      const assigned=(preferred&&candidates.find(subject=>subject.id===preferred||subject.code===preferred))||
        candidates.find(subject=>subject.id===lifeProjectSubjectId&&sectionSlotKey(subject.name)===lifeProjectSlot);
      if(assigned)return assigned;
    }
    const registered=slot.subjectId&&subjects.find(subject=>subject.id===slot.subjectId);
    if(registered)return registered;
    const matches=subjects.filter(subject=>technicalSlot(slot.key)?
      moduleIdentity(subject).number===slot.key:
      subject.type!=='MODULO_FASES'&&(subject.id===slot.key||sectionSlotKey(subject.name)===slot.key||
        slot.key==='materia:empresa-simulada'&&subject.id==='sub-472e73d796e2'));
    if(matches.length>1){
      const configured=matches.find(subject=>subject.id===preferred||subject.code===preferred&&preferred);
      const imported=matches.find(subject=>subject.sectionResultSlot===slot.key);
      const exact=matches.filter(subject=>resultLabel(moduleIdentity(subject).name)===resultLabel(slot.name.replace(/^\d+\.\d+\s+/,'')));
      return configured||imported||(exact.length===1?exact[0]:null);
    }
    const alias=allowMathAlias&&slot.key==='matematica'?subjects.filter(subject=>subject.type!=='MODULO_FASES'&&resultLabel(subject.name)==='precalculo'):[];
    return matches[0]||(alias.length===1?alias[0]:null);
  }
  function planSectionSubjects(db,section,year,next,current){
    const previous=new Map((current?.slots||[]).map(slot=>[slot.key,slot]));
    const scopedIds=new Set(section.subjectIds||[]);
    for(const {subjectId,year:recordYear,sectionId} of [...db.assignments,...db.grades,...(db.moduleFinals||[])]){
      if(recordYear===year&&sectionId===section.id)scopedIds.add(subjectId);
    }
    const scoped=db.subjects.filter(subject=>scopedIds.has(subject.id));
    const configured=db.specialties?.find(specialty=>specialty.id===section.specialtyId)?.reportSubjectCodes||{};
    const previouslySaved=new Map((current?.slots||[]).filter(slot=>slot.subjectId).map(slot=>[slot.subjectId,slot.key]));
    const graded=new Set();
    for(const row of next.rows){
      for(const [key,notes] of Object.entries(row.notes)){
        if(notes.some(value=>value!==null)||row.moduleLevels?.[key]!=null)graded.add(key);
      }
    }
    const created=[],renamed=[],linked=new Set(),used=new Set();
    for(const slot of next.slots){
      if(/^criterio-[1-4]$/.test(slot.key))continue;
      const stored=previous.get(slot.key)?.subjectId;
      let subject=stored?db.subjects.find(item=>item.id===stored):null;
      if(!subject&&!graded.has(slot.key))continue;
      if(slot.key===lifeProjectSlot){
        subject=sectionResultSubject(slot,scoped.filter(item=>!used.has(item.id)),sectionResultPreference(configured,slot.key))||subject;
      }
      if(!subject){
        const eligible=item=>!used.has(item.id)&&(!previouslySaved.has(item.id)||previouslySaved.get(item.id)===slot.key);
        subject=sectionResultSubject(slot,scoped.filter(eligible),configured[slot.key],summaryUsesMatematica(next));
        if(!subject){
          const modular=technicalSlot(slot.key),title=resultLabel(slot.name);
          const exact=db.subjects.filter(item=>eligible(item)&&modular===(item.type==='MODULO_FASES')&&
            resultLabel(item.name)===title&&(!modular||moduleIdentity(item).number===slot.key));
          if(exact.length===1)subject=exact[0];
          if(!subject&&modular&&slot.name===slot.key)continue;
          if(!subject){
            let id='excel-subject-'+db.version+'-'+created.length;
            while(db.subjects.some(item=>item.id===id)||created.some(item=>item.id===id))id+='-x';
            subject={id,name:slot.name,type:modular?'MODULO_FASES':'GENERAL_4_PERIODOS'};
            subjectMetadata(subject,{category:modular?'TECHNICAL':isMoralKey(slot.key)||slot.key==='conducta'?'CONCEPTUAL':'BASIC',
              ...(modular?{moduleNumber:slot.key}:{})});
            created.push(subject);
          }
        }
      }
      if(slot.key==='materia:empresa-simulada'&&subject.id==='sub-472e73d796e2'&&resultLabel(subject.name)==='ac'){
        renamed.push({subject,name:'Empresa Simulada'});
      }
      slot.subjectId=subject.id;
      linked.add(subject.id);
      used.add(subject.id);
    }
    return {created,renamed,linked};
  }
  function orderSectionColumns(columns){
    const order=['lengua','matematica','naturales','sociales','moral','idioma','ingles-tecnico','informatica','deporte','conducta','criterio-1','criterio-2','criterio-3','criterio-4'];
    const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
    const key=column=>column.subject.sectionResultSlot||sectionSlotKey(column.subject.name);
    const position=column=>{const index=order.indexOf(key(column));return index<0?(column.subject.type==='MODULO_FASES'?order.length+1:order.indexOf('conducta')-.5):index;};
    return columns.slice().sort((a,b)=>position(a)-position(b)||collator.compare(subjectTitle(a.subject),subjectTitle(b.subject)));
  }
  function linkedSummarySlot(db,a,snapshot){
    if(!snapshot)return;
    const section=db.sections.find(item=>item.id===a.sectionId);
    const configured=db.specialties?.find(item=>item.id===section?.specialtyId)?.reportSubjectCodes||{};
    const scopedIds=new Set([a.subjectId,...(section?.subjectIds||[])]);
    for(const record of [...db.assignments,...db.grades,...(db.moduleFinals||[])])
      if(record.year===a.year&&record.sectionId===a.sectionId)scopedIds.add(record.subjectId);
    const scopedSubjects=db.subjects.filter(item=>scopedIds.has(item.id));
    return snapshot.slots.find(item=>sectionResultSubject(item,scopedSubjects,sectionResultPreference(configured,item.key),summaryUsesMatematica(snapshot))?.id===a.subjectId);
  }
  function rosterOfficialResults(db,a,subject){
    const snapshot=normalizeSectionSlots((db.sectionResults||[]).find(row=>row.id===sectionResultKey(a.year,a.sectionId)));
    const policy=subjectFinalPolicy(subject,db.years.find(item=>item.id===a.year)?.finalPolicy);
    const technical=subject.type==='MODULO_FASES';
    const notesByStudent=new Map();
    const slot=linkedSummarySlot(db,a,snapshot);
    if(slot)for(const row of snapshot.rows)if(Object.hasOwn(row.notes,slot.key))notesByStudent.set(row.studentId,{values:row.notes[slot.key],level:row.moduleLevels?.[slot.key]});
    const registered=new Map();
    if(technical){
      for(const record of db.moduleFinals||[]){
        if(!sameScope(record,a))continue;
        const official=officialFinal(record,true);
        if(official)registered.set(record.studentId,official);
        else if(!record.officialFinal&&Array.isArray(record.values)&&Array.isArray(record.weights))
          registered.set(record.studentId,{value:calculate('MODULO_FASES',record.values,record.weights).value,scale:10});
      }
    }else{
      for(const record of db.grades){
        if(!sameScope(record,a)||!record.officialFinal)continue;
        const existing=registered.get(record.studentId),next=officialFinal(record);
        registered.set(record.studentId,next&&(!existing||existing.value===next.value)?next:{conflict:true});
      }
    }
    function mark(value,scale,imported){
      const source=imported?'RESUMEN':'CIERRE';
      if(technical){
        if(scale===5)return {value,scale,level:value,approved:value>=4,status:value>=4?'APROBADO':'REPROBADO',source};
        const gradedSubject=slot?{...subject,sectionResultSlot:slot.key}:subject;
        return {...technicalClosingResult(value,a.year,a.sectionId,gradedSubject),scale:10,source};
      }
      const minimum=policy?.method==='SUM_4'?policy.passMark/4:policy?.passMark;
      const status=imported?importedSubjectStatus(subject,value):value===null?'PENDIENTE':
        Number.isFinite(value)&&Number.isFinite(minimum)?reachesGrade(value,minimum)?'APROBADO':'REPROBADO':'REGISTRADO';
      return {value,status,source,...(imported?{officialSection:true}:{})};
    }
    const resolve=(student,periodId,periodIds)=>{
      const saved=notesByStudent.get(student.id),notes=saved?.values;
      const previous=registered.get(student.id);
      const closure=previous?(previous.conflict?
        {value:null,status:'PENDIENTE',conflict:true,source:'CIERRE'}:mark(previous.value,previous.scale,false)):null;
      if(!notes)return closure?{final:closure}:null;
      const position=snapshot.periodIds.indexOf(periodId);
      const marks=snapshot.periodIds.map((id,index)=>{
        const raw=student.periodResults[periodIds.indexOf(id)];
        return notes[index]??(Number.isFinite(raw)?raw:null);
      });
      const periods=Object.fromEntries(snapshot.periodIds.map((id,index)=>[id,marks[index]]));
      const final=Number.isInteger(saved.level)?mark(saved.level,5,true):
        notes[4]===null&&closure?closure:
        mark(technical?notes[4]:missingAnnualFromPeriods(slot.key,marks,notes[4]),10,true);
      return {period:position<0?null:{value:marks[position],source:notes[position]===null&&marks[position]!==null?'CUADRO_DOCENTE':'RESUMEN'},periods,final};
    };
    return Object.assign(resolve,{slot:slot?.key});
  }
  function printSourceForSnapshot(snapshot){
    const source=snapshot?.sourceAudit;
    if(!source)return null;
    const corrected=new Map(snapshot.rows.filter(row=>row.correctedSlots).map(row=>[String(row.nie),row]));
    if(!corrected.size)return source;
    return {...source,hasCorrections:true,rows:source.rows.map(row=>{
      const current=corrected.get(String(row.nie));
      if(!current)return row;
      const notes={...row.notes},unavailable={...row.unavailable};
      for(const [key,indices] of Object.entries(current.correctedSlots)){
        if(!notes[key]||!current.notes[key])continue;
        notes[key]=notes[key].map((mark,index)=>indices.includes(index)?current.notes[key][index]:mark);
        if(unavailable[key])unavailable[key]=unavailable[key].filter(index=>!indices.includes(index));
      }
      return {...row,notes,unavailable};
    })};
  }

  function amendImportedGrade(saved,key,position,value,subject){
    const notes=saved.notes[key],previous=notes.slice();
    const grade=sectionFinalMark(key,notes);
    notes[position]=value;
    // An explicit closure (including a module level or a recovery mark) has its own source.
    const priorPeriods=previous.slice(0,4);
    const priorAverage=priorPeriods.every(Number.isFinite)?annual(priorPeriods):null;
    const calculatedFinal=basicGrading(subject)&&(previous[4]===null||
      priorAverage!==null&&Math.abs(previous[4]-priorAverage)<1e-8);
    const indices=[position];
    if(calculatedFinal){
      notes[4]=annual(notes.slice(0,4));
      indices.push(4);
    }
    if(!saved.correctedSlots)saved.correctedSlots={};
    saved.correctedSlots[key]=[...new Set([...(saved.correctedSlots[key]||[]),...indices])];
    return {slot:key,before:previous[position],after:value,previousFinal:grade,final:sectionFinalMark(key,notes)};
  }
  function showRosterOfficialResults(roster,resolve){
    return {...roster,students:roster.students.map(student=>{
      const official=resolve(student,roster.periodId,roster.periodIds);
      return official?{...student,official}:student;
    })};
  }
  function withSectionResults(document,snapshot,teacher,frame){
    if(!snapshot||!snapshot.rows.length)return document;
    snapshot=normalizeSectionSlots(snapshot);
    const moduleCodes=new Set(snapshot.slots.map(slot=>slot.key).filter(technicalSlot));
    const legacyModules=new Set(document.columns.filter(({subject})=>subject.type!=='MODULO_FASES'&&
      moduleCodes.has(sectionSlotKey(subject.name))).map(({subject})=>subject.id));
    if(legacyModules.size){
      document.columns=document.columns.filter(({subject})=>!legacyModules.has(subject.id));
      for(const student of document.students)student.entries=student.entries.filter(({subject})=>!legacyModules.has(subject.id));
    }
    const resultByStudent=new Map(snapshot.rows.map(row=>[row.studentId,row]));
    const periods=document.periods;
    const chosen=new Map(),used=new Set();
    const codes=document.specialty?.reportSubjectCodes;
    const subjects=document.columns.map(column=>column.subject);
    const allowMathAlias=!teacher&&!frame&&summaryUsesMatematica(snapshot);
    for(const slot of snapshot.slots){
      const existing=sectionResultSubject(slot,subjects,sectionResultPreference(codes,slot.key),allowMathAlias);
      if(!existing&&(teacher||frame))continue;
      const subject=existing||subjectView({id:'resumen-'+slot.key,name:slot.name,type:technicalSlot(slot.key)?'MODULO_FASES':'GENERAL_4_PERIODOS',...(technicalSlot(slot.key)?{moduleNumber:slot.key}:qualitativeSlot(slot.key)||slot.key==='conducta'?{category:'CONCEPTUAL'}:{})});
      if(used.has(subject.id))continue;
      used.add(subject.id);
      const displayName=slot.key==='deporte'?(resultLabel(slot.name)==='deporte'?'Deporte':'Educación Física'):
        slot.key==='materia:empresa-simulada'?slot.name:null;
      chosen.set(slot.key,{...subject,...(displayName?{name:displayName,displayName}:{}),sectionResultSlot:slot.key});
    }
    const simulatedCompany=chosen.get('materia:empresa-simulada');
    if(simulatedCompany&&[document.section.id,document.section.name].some(label=>resultLabel(label).replace(/ /g,'')==='3a')){
      const aliases=new Set(document.columns.filter(({subject})=>subject.id!==simulatedCompany.id&&subject.type!=='MODULO_FASES'&&
        ['ac','empresa simulada'].includes(resultLabel(subject.name))).map(({subject})=>subject.id));
      document.columns=document.columns.filter(({subject})=>!aliases.has(subject.id));
      document.students.forEach(student=>{student.entries=student.entries.filter(({subject})=>!aliases.has(subject.id));});
    }
    const subjectSlots=new Map([...chosen].map(([key,subject])=>[subject.id,key]));
    const applicable=existing=>frame?existing?.periods||[]:periods;
    const resultPeriod=(period,notes,key,original)=>{
      const position=snapshot.periodIds.indexOf(period.id);
      if(position<0)return original||{id:period.id,name:period.name,value:null,values:[]};
      const value=notes[position];
      if(value===null&&original?.id===period.id){
        if(original.conflict)return {...original,value:null};
        if(Number.isFinite(original.value))return {...original,confirmedBackup:true};
      }
      return {id:period.id,name:period.name,value,values:[],officialSection:true,locked:!!original?.locked,conflict:false,
        ...(key==='conducta'?{conductCriteria:[1,2,3,4].map(i=>original?.snapshotNotes?.['criterio-'+i]?.[position]??null)}:{})};
    };
    for(const student of document.students){
      const stored=resultByStudent.get(student.id),notes=stored?.notes;
      if(!notes)continue;
      const items=new Map(student.entries.map(e=>[e.subject.id,e]));
      for(const [key,subject] of chosen){
        if(!Object.hasOwn(notes,key))continue;
        const values=notes[key],old=items.get(subject.id),module=technicalSlot(key);
        const storedPeriods=applicable(old).map(period=>resultPeriod(period,values,key,{...old?.periods.find(p=>p.id===period.id),snapshotNotes:notes}));
        const priorLevel=stored.moduleLevels?.[key];
        const backup=old?.final;
        const fromClosure=values[4]===null&&priorLevel==null&&!backup?.conflict&&
          Number.isFinite(backup?.value)&&(module?backup.status==='REGISTRADO':backup.scale===10);
        const marks=snapshot.periodIds.map(id=>storedPeriods.find(result=>result.id===id));
        const derived=values[4]===null&&!backup?.conflict&&marks.every(mark=>!mark?.conflict)?
          missingAnnualFromPeriods(key,marks.map(mark=>mark?.value??null),null):null;
        const final=values[4]??derived;
        const finalResult=values[4]===null&&priorLevel==null&&backup?.conflict?{...backup,value:null}:
          fromClosure?{...backup,confirmedBackup:true}:module?(Number.isInteger(priorLevel)?
          {value:priorLevel,level:priorLevel,scale:5,approved:priorLevel>=4,status:'REGISTRADO',officialSection:true}:
          {...technicalClosingResult(final,document.year.id,document.section,subject),scale:10,officialSection:true}):
          {value:final,scale:10,officialSection:true,status:importedSubjectStatus(subject,final),
            ...(derived!==null?{confirmedBackup:true}:{})};
        items.set(subject.id,{subject,teachers:old?.teachers||[],periods:storedPeriods,final:finalResult});
      }
      student.entries=[...items.values()];
    }
    document.columns=document.columns.map(column=>{
      const key=subjectSlots.get(column.subject.id);
      return key?{...column,subject:chosen.get(key),periods:applicable(column)}:column;
    });
    const shown=new Set(document.columns.map(column=>column.subject.id));
    for(const subject of chosen.values())if(!shown.has(subject.id))document.columns.push({subject,teachers:[],periods});
    document.columns=orderSectionColumns(document.columns);
    return document;
  }
  function collapseEquivalentSubjectColumns(document){
    const groups=new Map();
    for(const column of document.columns){
      const {subject}=column;
      // "Física" can be a science subject. Only the explicit sports aliases share this key.
      const name=subject.type!=='MODULO_FASES'&&sectionSlotKey(subject.name)==='deporte'?
        'deporte':resultLabel(subject.name);
      if(!name)continue;
      const key=subject.type+'|'+moduleIdentity(subject).number+'|'+name;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(column);
    }
    const duplicates=[...groups.values()].filter(columns=>columns.length>1);
    if(!duplicates.length)return document;
    const keepById=new Map(),headings=new Map();
    const candidates=duplicates.map(columns=>{
      const preferred=columns.find(column=>column.subject.sectionResultSlot)||columns[0];
      const {subject}=preferred,ids=new Set(columns.map(column=>column.subject.id));
      const teachers=[...new Set(columns.flatMap(column=>column.teachers||[]))];
      const periodIds=new Set(columns.flatMap(column=>column.periods.map(period=>period.id)));
      const periods=document.periods.filter(period=>periodIds.has(period.id));
      const heading={...preferred,periods,teachers};
      for(const id of ids)keepById.set(id,subject.id);
      headings.set(subject.id,heading);
      return {subject,teachers,periods,ids};
    });
    const resolve=(base,records)=>{
      const available=records.filter(mark=>mark?.value!=null);
      const recorded=available.filter(mark=>mark.officialSection&&!mark.conflict);
      const marks=recorded.length?recorded:available;
      const first=marks.includes(base)?base:marks[0];
      const equal=(a,b)=>a===b||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8;
      const conflict=marks.some(item=>!equal(item.value,first.value)||(item.scale||10)!==(first.scale||10))||
        (!recorded.length&&records.some(mark=>mark?.conflict));
      if(conflict)return {...base,value:null,level:null,approved:false,status:'PENDIENTE',conflict:true};
      if(!first)return base;
      return first!==base&&base.officialSection&&base.value==null?{...first,confirmedBackup:true}:first;
    };
    for(const student of document.students){
      const entries=new Map(student.entries.map(entry=>[entry.subject.id,entry]));
      const merged=new Map();
      for(const {subject,periods,teachers,ids} of candidates){
        const equivalents=[...ids].map(id=>entries.get(id)).filter(Boolean);
        if(!equivalents.length)continue;
        const primary=entries.get(subject.id);
        const marks=periods.map(period=>{
          const base=primary?.periods.find(item=>item.id===period.id)||{...period,value:null,values:[]};
          return resolve(base,equivalents.map(entry=>entry.periods.find(item=>item.id===period.id)));
        });
        let final=resolve(primary?.final||{value:null,status:'PENDIENTE'},equivalents.map(entry=>entry.final));
        if(!final.conflict&&final.value==null&&basicGrading(subject)&&marks.length===4&&
          marks.every(mark=>!mark.conflict&&Number.isFinite(mark.value))){
          final={...finalResult(marks.map(mark=>mark.value),subjectFinalPolicy(subject,null)),confirmedBackup:true};
        }
        merged.set(subject.id,{subject,teachers,periods:marks,final});
      }
      student.entries=student.entries.filter(entry=>!keepById.has(entry.subject.id));
      student.entries.push(...merged.values());
    }
    const seen=new Set();
    document.columns=document.columns.flatMap(column=>{
      const id=keepById.get(column.subject.id);
      if(!id)return [column];
      if(seen.has(id))return [];
      seen.add(id);
      return [headings.get(id)];
    });
    return document;
  }
  const firstYearAccountingModuleLinks=[
    {module:{key:'1.3',name:'1.3 Organización de archivos electrónicos de los sistemas administrativos y financieros en la empresa'},
     subject:{key:'informatica',name:'Informática Educativa'},
     header:/archivos electronicos.*\badm(?:inistrativ\w*)?\b.*financieros/},
    {module:{key:'1.6',name:'1.6 Interpretación de información en inglés sobre contabilidad y documentación'},
     subject:{key:'ingles-tecnico',name:'Inglés Técnico'},header:/ingles sobre contabilidad/}
  ];
  const firstYearAccountingReportOmissions=new Set([
    'ciudadania','materia:ciudadania','materia:ciudadania-y-valores','materia:cuidadania-y-valores','fisica','materia:fisica'
  ]);
  const curriculumSectionCodes={
    accounting:/^(?:1[ab]|2a|3a)$/,
    software:/^(?:1[k-n]|2[kl]|3[de])$/,
    tourism:/^(?:1[f-j]|2[h-j]|3[bc])$/,
    general:/^(?:1[c-e]|2[b-g])$/
  };
  function curriculumProgram(document){
    const title=resultLabel(document.specialty?.name);
    if(/\bsoftware\b/.test(title))return 'software';
    if(/\bturistic/.test(title))return 'tourism';
    if(/\b(?:contable|contabilidad)\b/.test(title))return 'accounting';
    if(/^(?:bachillerato )?general$/.test(title))return 'general';
    if(document.year.id!=='2026'||title)return null;
    const names=[document.section.id,document.section.name].map(value=>resultLabel(value).replace(/ /g,''));
    return Object.keys(curriculumSectionCodes).find(program=>names.some(name=>curriculumSectionCodes[program].test(name)));
  }

  const linkedModuleTitles={
    accounting:{
      '1.7':'Emprendedurismo Colaborativo',
      '2.6':'Interpretación de información en inglés sobre finanzas, costos, presupuestos y leyes',
      '2.7':'Diseño de planes de negocio en asociatividad cooperativa',
      '3.6':'Interpretación de información en inglés sobre mercadeo y comercialización',
      '3.7':'Puesta en marcha de la microempresa en asociatividad cooperativa'
    },
    software:{
      '1.6':'Conversación en inglés sobre sistemas informáticos y desarrollo de páginas Web',
      '1.7':'Emprendedurismo colaborativo',
      '2.6':'Conversación en inglés sobre arquitectura de software y base de datos',
      '2.7':'Diseño de planes de negocio en asociatividad cooperativa',
      '3.6':'Conversación en inglés sobre mantenimiento de sistemas informáticos',
      '3.7':'Puesta en marcha de la microempresa en asociatividad cooperativa'
    },
    tourism:{
      '1.3':'Aplicación del Inglés técnico enfocado al turismo',
      '2.6':'Aplicación del inglés técnico en los servicios de alimentos y bebidas',
      '3.2':'Manejo de software y redes sociales aplicativas en la gestión de empresas turísticas',
      '3.5':'Gestión de compras e inventario de materia prima en la empresa turística',
      '3.6':'Conversación en inglés: administración y servicios turísticos',
      '3.7':'Puesta en marcha de la microempresa en asociatividad cooperativa'
    }
  };
  function reportModuleLinks(document){
    const program=curriculumProgram(document),titles=linkedModuleTitles[program];
    const grade=String(document.section.grade||resultLabel(document.section.id).match(/^[123]/)?.[0]||'');
    if(!titles||!['1','2','3'].includes(grade))return [];
    const links=program==='accounting'&&grade==='1'?[...firstYearAccountingModuleLinks]:[];
    const add=(number,key,name)=>{
      const code=grade+'.'+number,title=titles[code];
      if(title)links.push({module:{key:code,name:code+' '+title},subject:{key,name}});
    };
    add(program==='tourism'&&grade==='1'?3:6,'ingles-tecnico','Inglés Técnico');
    add(7,'emprendedurismo','Emprendedurismo');
    if(program==='tourism'&&grade==='3'){
      add(2,'informatica','Informática');
      add(5,'materia:costos','Costos');
    }
    return links;
  }

  function completeLinkedModuleClosures(document,links,snapshot){
    if(document.frame||document.scope!=='SECTION'||!links.length)return document;
    const columns=document.columns.map(({subject})=>subject);
    const codes=document.specialty?.reportSubjectCodes,program=curriculumProgram(document);
    for(const link of links){
      const subject=columns.find(item=>item.type!=='MODULO_FASES'&&item.sectionResultSlot===link.subject.key)||
        sectionResultSubject(link.subject,columns,codes?.[link.subject.key]);
      const computing=link.subject.key==='informatica';
      if(!subject&&!computing)continue;
      const imported=columns.find(item=>item.type==='MODULO_FASES'&&item.sectionResultSlot===link.module.key);
      const foundModule=imported||sectionResultSubject(link.module,columns,codes?.[link.module.key]);
      if(!foundModule&&(!subject||columns.some(item=>moduleIdentity(item).number===link.module.key)))continue;
      const existingAccountingId=program==='accounting'&&firstYearAccountingModuleLinks.some(item=>item.module.key===link.module.key);
      const module=foundModule||subjectView({id:(existingAccountingId?'accounting-module-':'linked-module-')+link.module.key,
        name:link.module.name,type:'MODULO_FASES',moduleNumber:link.module.key,sectionResultSlot:link.module.key});
      if(!foundModule)document.columns.push({subject:module,teachers:[],periods:document.periods});
      for(const student of document.students){
        const entries=student.entries;
        const moduleEntry=entries.find(entry=>entry.subject.id===module.id);
        if(computing&&moduleEntry?.final.scale!==5&&Number.isFinite(moduleEntry?.final.value)&&!moduleEntry.final.conflict){
          Object.assign(moduleEntry.final,technicalResult(moduleEntry.final.value,BASIC_PASS_MARK),{levelPassMark:BASIC_PASS_MARK});
          continue;
        }
        if(moduleEntry?.final.conflict||!computing&&Number.isFinite(moduleEntry?.final.value)||
          !computing&&moduleEntry?.final.officialSection&&imported&&snapshot?.sourceAudit?.coverage?.[link.module.key]?.[4]!==false)continue;
        const subjectEntry=entries.find(entry=>entry.subject.id===subject?.id);
        const source=subjectEntry?.final;
        const value=source?.scale===10||source?.officialSection?source.value:source?.average??source?.value;
        if(!Number.isFinite(value)||value<0||value>10||source.conflict||subjectEntry.periods.some(period=>period.conflict))continue;
        const final={...technicalClosingResult(value,document.year.id,document.section,module,
          computing?BASIC_PASS_MARK:TECHNICAL_PASS_MARK),scale:10,officialSection:true,linkedAccountingSubject:link.subject.key};
        if(moduleEntry)moduleEntry.final=final;
        else entries.push({subject:module,teachers:[],periods:document.periods.map(period=>({id:period.id,name:period.name,value:null,values:[]})),final});
      }
    }
    document.columns=orderSectionColumns(document.columns);
    return document;
  }
  function showAccountingEntrepreneurship(document,moduleKey,snapshot){
    if(document.scope!=='SECTION'||document.frame)return;
    const slot={key:'emprendedurismo',name:'Emprendedurismo'};
    const moduleName=resultLabel(linkedModuleTitles.accounting[moduleKey]).replace(/ /g,'');
    const moduleColumns=document.columns.filter(({subject})=>{
      const identity=moduleIdentity(subject);
      if(identity.number!==moduleKey)return false;
      const name=resultLabel(identity.name).replace(/ /g,'');
      return subject.sectionResultSlot===moduleKey||name===moduleName||
        moduleKey==='1.7'&&name.includes('emprendedurismo');
    });
    const moduleIds=new Set(moduleColumns.map(({subject})=>subject.id));
    const module=moduleColumns.find(({subject})=>subject.sectionResultSlot===moduleKey)||
      (moduleColumns.length===1?moduleColumns[0]:null);
    const subjects=document.columns.map(({subject})=>subject);
    const existing=sectionResultSubject(slot,subjects,document.specialty?.reportSubjectCodes?.[slot.key]);
    const subject=existing||subjectView({id:'accounting-emprendedurismo',name:slot.name,
      type:'GENERAL_4_PERIODOS',sectionResultSlot:slot.key});
    if(!existing){
      document.columns.push({subject,teachers:module?.teachers||[],periods:document.periods});
    }
    for(const student of document.students){
      const current=student.entries.find(entry=>entry.subject.id===subject.id);
      if(current&&(current.final.officialSection&&current.subject.sectionResultSlot===slot.key&&
        snapshot?.sourceAudit?.slots.some(item=>item.key===slot.key)||
        current.final.value!=null||current.final.conflict||
        current.periods.some(period=>period.value!=null||period.conflict)))continue;
      const recordedModules=student.entries.filter(({subject,periods,final})=>moduleIds.has(subject.id)&&
        (final.value!=null||final.conflict||periods.some(period=>period.value!=null||period.conflict)));
      const source=recordedModules.find(({subject})=>subject.sectionResultSlot===moduleKey)||
        (recordedModules.length===1?recordedModules[0]:null);
      const periods=document.periods.map(period=>{
        const grade=source?.periods.find(item=>item.id===period.id);
        return {...period,value:grade?.value??null,values:[],conflict:!!grade?.conflict};
      });
      const recorded=source?.final;
      const useRecordedGrade=recorded?.officialSection||recorded?.status==='REGISTRADO'||recorded?.scale===10;
      const grade=recorded?.scale===5?null:useRecordedGrade?recorded.value:recorded?.average??recorded?.value;
      const validGrade=Number.isFinite(grade)&&grade>=0&&grade<=10?grade:null;
      const conflict=!!recorded?.conflict||periods.some(period=>period.conflict);
      const value=conflict||document.periods.length!==4?null:
        sectionFinalMark(slot.key,[...periods.map(period=>period.value),validGrade]);
      const final={value,scale:10,conflict,status:value===null?'PENDIENTE':technicalResult(value).status};
      if(current)Object.assign(current,{periods,final});
      else student.entries.push({subject,teachers:module?.teachers||[],periods,final});
    }
    document.columns=orderSectionColumns(document.columns);
  }
  function reportFromWorkbook(book,{year,section,periods,specialty}){
    requireThat(book.mode==='print'&&book.rows.length&&periods.length===4,'Elegí el Excel anual y los cuatro períodos de la sección.');
    const students=book.rows.map(({nie,name})=>({id:nie,nie,name,entries:[]}));
    const document={kind:'sectionReportCards',year,section,specialty,periods,scope:'SECTION',
      decimals:1,students,columns:[],excelSource:true};
    const snapshot={slots:book.slots,periodIds:periods.map(period=>period.id),
      rows:book.rows.map(({nie,notes,moduleLevels})=>({studentId:nie,notes,moduleLevels}))};
    withSectionResults(document,snapshot,false,null);
    const computingLinks=reportModuleLinks(document).filter(link=>link.subject.key==='informatica');
    return completeLinkedModuleClosures(document,computingLinks,snapshot);
  }
  const rosterName=value=>resultLabel(value).split(' ').sort().join(' ');
  // Revisión obligatoria antes de retirar una matrícula duplicada.
  function duplicateStudentName(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }
  // Comprobación detallada de referencias antes de eliminar fichas duplicadas.
  // El 0 es una nota real y NUNCA se considera un valor vacío.
  function duplicateEnrollmentReview(db,p){
    const removed=db.enrollments.find(x=>x.id===p.enrollmentId);
    const keeper=db.enrollments.find(x=>x.id===p.keepEnrollmentId);
    requireThat(removed&&keeper&&removed.id!==keeper.id,'Elegí dos matrículas diferentes: una para retirar y otra para conservar.');
    requireThat(removed.year===keeper.year&&removed.sectionId===keeper.sectionId,'Ambas matrículas deben ser de la misma sección y año.');
    requireThat(removed.studentId!==keeper.studentId,'No se puede retirar la misma identidad.');
    const oldStudent=db.students.find(s=>s.id===removed.studentId);
    const goodStudent=db.students.find(s=>s.id===keeper.studentId);
    requireThat(oldStudent&&goodStudent&&oldStudent.nie!==goodStudent.nie,'No hay dos fichas distintas con NIE diferentes.');
    requireThat(duplicateStudentName(oldStudent.name)&&duplicateStudentName(oldStudent.name)===duplicateStudentName(goodStudent.name),
      'Los nombres no coinciden. Debe revisarse la identidad antes de eliminar.');
    const reasons=[];
    const linkedGrades=(db.grades||[]).filter(g=>g.studentId===oldStudent.id);
    const allowedEmptyKeys=new Set(['id','studentId','year','sectionId','subjectId','periodId','values']);
    const isDisposableEmptyGrade=g=>
      typeof g.id==='string'&&g.id.length>0&&g.studentId===oldStudent.id&&
      g.year===removed.year&&g.sectionId===removed.sectionId&&
      typeof g.subjectId==='string'&&typeof g.periodId==='string'&&
      Array.isArray(g.values)&&g.values.length>0&&g.values.every(x=>x===null)&&
      Object.keys(g).every(key=>allowedEmptyKeys.has(key))&&
      (db.grades||[]).filter(other=>other.id===g.id).length===1;
    const cleanCandidates=linkedGrades.filter(isDisposableEmptyGrade);
    const cleanIds=new Set(cleanCandidates.map(g=>g.id));
    const historicalGradeAudits=(db.audit||[]).filter(a=>
      ['GRADE','GRADE_UPDATE','GRADE_CLEAR','GRADE_IMPORT','GRADE_RESTORE'].includes(a.kind)&&
      linkedGrades.some(g=>g.id&&JSON.stringify(a.detail||{}).includes(JSON.stringify(g.id))));
    const safeEmptyIds=historicalGradeAudits.length?new Set():cleanIds;
    const unsafeGrades=linkedGrades.filter(g=>!safeEmptyIds.has(g.id));
    const summaries=linkedGrades.slice(0,100).map(g=>{
      const vals=Array.isArray(g.values)?g.values:[];
      const present=vals.filter(x=>x!==null&&x!==undefined);
      const subject=db.subjects.find(s=>s.id===g.subjectId);
      return {id:String(g.id||''),year:String(g.year||''),section:String(g.sectionId||''),
        subject:subject?.name||String(g.subjectId||'Materia desconocida'),period:String(g.periodId||''),
        values:vals.slice(0,12),presentCount:present.length,hasZero:present.some(x=>x===0),
        hasSource:Object.prototype.hasOwnProperty.call(g,'source'),
        safeEmpty:safeEmptyIds.has(g.id),
        note:safeEmptyIds.has(g.id)?'Registro vacío sin origen ni historial; apto para limpieza':
          present.length?'Contiene notas o valores (incluido 0); no se elimina':
          'Vacío con procedencia, historial o metadatos; requiere revisión'};
    });
    if(db.enrollments.filter(e=>e.studentId===oldStudent.id).length!==1)
      reasons.push('La ficha que querés retirar tiene otras matrículas o años asociados.');
    const fingerprint=JSON.stringify(oldStudent.id);
    const nieReference='"nie":"'+String(oldStudent.nie).replace(/"/g,'\\"')+'"';
    const references=record=>{const value=JSON.stringify(record);return value.includes(fingerprint)||value.includes(nieReference);};
    const strayGrades=(db.grades||[]).filter(g=>g.studentId!==oldStudent.id&&references(g));
    if(unsafeGrades.length||strayGrades.length)
      reasons.push('Hay '+(unsafeGrades.length+strayGrades.length)+' registro(s) de grades que no se pueden retirar automáticamente.');
    if(historicalGradeAudits.length)
      reasons.push('Hay '+historicalGradeAudits.length+' movimiento(s) históricos de notas asociado(s) a esos registros.');
    const referencesByTable={};
    for(const table of ['recoveries','gradeLocks','moduleFinals','sectionResults','incidents','batches']){
      const count=(Array.isArray(db[table])?db[table]:[]).filter(references).length;
      if(count){referencesByTable[table]=count;reasons.push('La ficha tiene '+count+' referencia(s) en '+table+'.');}
    }
    const normalEvents=new Set(['ENROLL','STUDENT_UPDATE','ENROLLMENT_UPDATE','DUPLICATE_ENROLLMENT_REMOVED']);
    const otherAudit=(db.audit||[]).filter(a=>!normalEvents.has(a.kind)&&JSON.stringify(a.detail||{}).includes(fingerprint));
    if(otherAudit.length)reasons.push('La ficha aparece en '+otherAudit.length+' movimiento(s) académico(s) de auditoría.');
    const diagnostic={totalGrades:linkedGrades.length,gradesWithValues:linkedGrades.filter(g=>
      !Array.isArray(g.values)||g.values.some(x=>x!==null&&x!==undefined)).length,
      gradesWithZero:linkedGrades.filter(g=>Array.isArray(g.values)&&g.values.some(x=>x===0)).length,
      cleanableEmptyGrades:safeEmptyIds.size,unsafeGradeRecords:unsafeGrades.length,
      auditedGradeEvents:historicalGradeAudits.length,otherAuditEvents:otherAudit.length,
      keeperGradeRecords:(db.grades||[]).filter(g=>g.studentId===goodStudent.id&&g.year===keeper.year).length,
      referencesByTable,rows:summaries,truncated:linkedGrades.length>summaries.length};
    return {canDelete:reasons.length===0,reasons,year:removed.year,sectionId:removed.sectionId,
      diagnostic,
      // Estos identificadores se recalculan en el servidor cuando se ejecuta la eliminación.
      cleanableGradeIds:[...safeEmptyIds],
      remove:{enrollmentId:removed.id,studentId:oldStudent.id,nie:oldStudent.nie,name:oldStudent.name},
      keep:{enrollmentId:keeper.id,studentId:goodStudent.id,nie:goodStudent.nie,name:goodStudent.name}};
  }
  function duplicateArchiveReview(db, review, document) {
    const archived = duplicateArchives(db);
    const {remove, keep} = review;
    if (archived.has(remove.enrollmentId) || archived.has(keep.enrollmentId) ||
        [...archived.values()].some(item => item.keepEnrollmentId === remove.enrollmentId)) {
      return 'Alguna ficha ya está archivada o es la matrícula vigente de otro archivo.';
    }
    const previous = previousDuplicateArchive(db, remove.enrollmentId);
    if (previous && previous.keepEnrollmentId !== keep.enrollmentId) {
      return 'El movimiento de archivo anterior tiene otro NIE vigente. Revisá la auditoría.';
    }
    if (db.enrollments.filter(row => row.studentId === remove.studentId).length !== 1) {
      return 'La ficha que se quiere archivar tiene matrículas en otros grupos o años.';
    }
    const protectedData = [
      ...(db.moduleFinals || []), ...(db.recoveries || []), ...(db.gradeLocks || [])
    ];
    if (protectedData.some(row => row.studentId === remove.studentId) ||
        (db.sectionResults || []).some(section => (section.rows || []).some(row => row.studentId === remove.studentId))) {
      return 'La ficha tiene un resumen oficial, recuperación, cierre modular o bloqueo que requiere conciliación.';
    }
    const original = document.students.find(student => student.id === remove.studentId);
    const retained = document.students.find(student => student.id === keep.studentId);
    if (!original || !retained) return 'No se pudo cotejar a ambas fichas en el consolidado.';
    const isGrade = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ||
      ['E', 'MB', 'B', 'R'].includes(value);
    const officialMarks = student => student.entries.flatMap(entry => [entry.final, ...entry.periods]);
    if (!officialMarks(retained).some(mark => isGrade(mark?.value) && !mark.conflict)) {
      return 'La matrícula que se conserva necesita notas respaldadas en el consolidado.';
    }
    const aliases = new Set(['sociales', 'ciudadania', 'materia:ciudadania-y-valores']);
    const aliasesApply = resultLabel(document.section.name) === '1 l' || document.section.id === '1L';
    const subjectKey = subject => subject.sectionResultSlot || sectionSlotKey(subject.name);
    const sameSubject = (a, b) => {
      const first = subjectKey(a), second = subjectKey(b);
      if (a.id === b.id || first && first === second) return true;
      return aliasesApply && aliases.has(first) && aliases.has(second);
    };
    const gradeMatches = (a, b) => !b?.conflict && (a?.value === b?.value ||
      Number.isFinite(a?.value) && Number.isFinite(b?.value) && formatGrade(a.value) === formatGrade(b.value));
    for (const entry of original.entries) {
      const marks = [[entry.final, null], ...entry.periods.map(period => [period, period.id])];
      const matches = retained.entries.filter(candidate => sameSubject(entry.subject, candidate.subject));
      if (marks.some(([mark, id]) => mark?.conflict || isGrade(mark?.value) &&
          !matches.some(candidate => gradeMatches(mark, id === null ? candidate.final :
            candidate.periods.find(period => period.id === id))))) {
        return 'La ficha duplicada tiene una calificación diferente en ' + entry.subject.name + '.';
      }
    }
    return '';
  }
  function moveEnrollmentResults(db,enrollment,from,to,student){
    const {studentId,year}=enrollment;
    const owned=(record,sectionId)=>record.studentId===studentId&&record.year===year&&record.sectionId===sectionId;
    const source=(db.sectionResults||[]).find(item=>item.id===sectionResultKey(year,from.id));
    const destination=(db.sectionResults||[]).find(item=>item.id===sectionResultKey(year,to.id));
    const summary=source?.rows.find(row=>row.studentId===studentId);
    const tables=['grades','moduleFinals','recoveries','gradeLocks'];
    const records=tables.flatMap(table=>(db[table]||[]).filter(row=>owned(row,from.id)));
    const destinationRows=tables.flatMap(table=>(db[table]||[]).filter(row=>owned(row,to.id)));
    const hasMark=summary&&Object.values(summary.notes).some(marks=>marks.some(mark=>mark!==null));
    requireThat(!destinationRows.length&&!destination?.rows.some(row=>row.studentId===studentId||String(row.nie)===String(student.nie)),
      'Hay calificaciones previas en la sección de destino. Revisá el traslado antes de guardar.');
    const blockers=(db.incidents||[]).some(row=>owned(row,from.id)&&row.status==='REQUIRES_REVIEW');
    requireThat(!blockers,'La matrícula tiene una incidencia de notas pendiente de revisión.');
    if(records.length||hasMark||Object.keys(summary?.moduleLevels||{}).length){
      const program=section=>curriculumProgram({year:{id:year},section,
        specialty:(db.specialties||[]).find(item=>item.id===section.specialtyId)});
      const originProgram=program(from),targetProgram=program(to);
      requireThat(String(from.grade)===String(to.grade)&&
        (originProgram?originProgram===targetProgram:!!from.specialtyId&&from.specialtyId===to.specialtyId),
        'El plan de estudios de la sección de destino es distinto. Revisá las equivalencias para trasladar las notas.');
      const activeSubjects=new Set(db.assignments.filter(a=>a.active&&a.year===year&&a.sectionId===to.id).map(a=>a.subjectId));
      const signature=plan=>JSON.stringify([plan.mode,plan.count,plan.weights,plan.labels]);
      for(const record of records){
        requireThat(activeSubjects.has(record.subjectId),'La materia de una nota registrada no está asignada en la sección de destino.');
        if(record.periodId)requireThat(signature(evaluationFor(db,record,record.periodId))===
          signature(evaluationFor(db,{...record,sectionId:to.id},record.periodId)),
          'La configuración de actividades es diferente en la sección de destino. Revisá las equivalencias.');
      }
      if(summary&&(hasMark||Object.keys(summary.moduleLevels||{}).length)){
        requireThat(!destination||JSON.stringify(destination.periodIds)===JSON.stringify(source.periodIds),
          'Los períodos del cuadro de destino no coinciden.');
        const targetSlots=destination?.slots||source.slots;
        const lookup=new Map(targetSlots.map(slot=>[slot.key,slot]));
        for(const slot of source.slots){
          if(!summary.notes[slot.key]?.some(mark=>mark!==null)&&summary.moduleLevels?.[slot.key]==null)continue;
          const target=lookup.get(slot.key);
          requireThat(target&&(slot.subjectId===target.subjectId&&!!slot.subjectId||
            resultLabel(slot.name)===resultLabel(target.name)&&(!slot.subjectId||!target.subjectId)),
            'El resumen de destino usa una materia o módulo distinto para '+slot.name+'.');
          if(!destination&&slot.subjectId&&!activeSubjects.has(slot.subjectId)&&!(to.subjectIds||[]).includes(slot.subjectId))
            requireThat(!technicalSlot(slot.key)&&(slot.key==='conducta'||slot.key==='deporte'||periodOnlySubject({sectionResultSlot:slot.key})),
              'La materia de '+slot.name+' no está configurada en la sección de destino.');
        }
        const moved={...summary,notes:Object.fromEntries(targetSlots.map(slot=>[slot.key,
          summary.notes[slot.key]?.slice()||[null,null,null,null,null]]))};
        if(destination)destination.rows.push(moved);
        else db.sectionResults.push({id:sectionResultKey(year,to.id),year,sectionId:to.id,
          periodIds:source.periodIds.slice(),slots:targetSlots.map(slot=>({...slot})),rows:[moved],file:source.file});
      }
      for(const record of records)record.sectionId=to.id;
    }
    if(summary)source.rows=source.rows.filter(row=>row!==summary);
    const originalReference=source?.sourceAudit?.rows.find(row=>String(row.nie)===String(student.nie));
    const originalFile=source?.sourceAudit?.file;
    if(originalReference){
      source.sourceAudit.rows=source.sourceAudit.rows.filter(row=>row!==originalReference);
      if(!source.sourceAudit.rows.length)delete source.sourceAudit;
    }
    return {records:records.length,summary:!!hasMark||!!Object.keys(summary?.moduleLevels||{}).length,
      ...(originalReference?{originalReference,originalFile}:{})};
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
    const archived = duplicateArchives(db);
    const enrollments = activeEnrollments(db, archived);
    function readDuplicateReview() {
      const review = duplicateEnrollmentReview(db, p);
      let document;
      try {
        document = operate(db, email, 'consolidated',
          {year: review.year, sectionId: review.sectionId}, {...context, includeSupplementary: true});
      } catch (error) {
        if (!error.genesisPublic) throw error;
        return {...review, version: db.version, canArchive: false,
          archiveReason: 'Primero hay que resolver este aviso del consolidado: ' + error.message};
      }
      const archiveReason = duplicateArchiveReview(db, review, document);
      return {...review, canArchive: !archiveReason, archiveReason, version: db.version};
    }
    if(action==='checkDuplicateEnrollment'){admin();return readDuplicateReview();}
    if(action==='notices'){
      if(p.knownVersion===db.version)return {version:db.version,changed:false};
      return {version:db.version,changed:true,notifications:completion(db,db.assignments.filter(a=>a.active&&own(a)))};
    }
    let cachedIndex=context.gradeIndex;const index=()=>cachedIndex||(cachedIndex=gradeIndex(db));
    const resultFor=(subject,values,a,periodId)=>a?evaluate(values,evaluationFor(db,a,periodId)):calculate(subject.type,values,db.weights.find(w=>w.id===subject.id)?.values);
    const gradeConflict=(a,studentId,periodId)=>index().conflicts.has(gradeKey(a,studentId,periodId));
    const locked=(a,studentId,periodId)=>index().locks.get(gradeKey(a,studentId,periodId));
    const hasSubjectGrades=id=>db.subjects.some(subject=>subject.id===id&&subject.hasImportedHistory)||
      db.grades.some(g=>g.subjectId===id)||(db.moduleFinals||[]).some(g=>g.subjectId===id);
    const validateTemplate=(template,a,periodId)=>{
      if(!template)return;
      requireThat(template.schema==='GENESIS_TEMPLATE_V1'&&['year','sectionId','subjectId','teacherId'].every(key=>template[key]===a[key])&&template.assignmentId===a.id&&template.periodId===periodId,'La plantilla no corresponde al docente, grupo, asignatura o período seleccionados');
      const plan=evaluationFor(db,a,periodId);requireThat(template.evaluation?.mode===plan.mode&&template.evaluation?.count===plan.count&&JSON.stringify(template.evaluation?.weights)===JSON.stringify(plan.weights),'La configuración de la plantilla cambió; descargá una nueva');
    };
    const sectionContext=()=>{
      const year=db.years.find(y=>y.id===p.year),section=db.sections.find(s=>s.id===p.sectionId);
      requireThat(year&&section,'Seleccioná año lectivo y sección válidos');
      return {year,section};
    };
    const sectionAssignments=()=>{
      const candidates=db.assignments.filter(a=>a.year===p.year&&a.sectionId===p.sectionId&&(user.role!=='TEACHER'||a.active&&own(a))).sort((a,b)=>Number(b.active)-Number(a.active));
      const bySubject=new Map();
      for(const a of candidates)if(!bySubject.has(a.subjectId))bySubject.set(a.subjectId,a);
      if(user.role!=='TEACHER'){
        const historical=[...db.grades,...(db.moduleFinals||[])].filter(g=>g.year===p.year&&g.sectionId===p.sectionId).map(g=>g.subjectId);
        const section=db.sections.find(s=>s.id===p.sectionId);
        const snapshot=(db.sectionResults||[]).find(result=>result.id===sectionResultKey(p.year,p.sectionId));
        const imported=(snapshot?.slots||[]).map(slot=>slot.subjectId).filter(id=>id&&db.subjects.some(subject=>subject.id===id));
        for(const subjectId of [...historical,...(section.subjectIds||[]),...imported]){
          if(!bySubject.has(subjectId))bySubject.set(subjectId,{year:p.year,sectionId:p.sectionId,subjectId,teacherId:null,active:false});
        }
      }
      requireThat(user.role!=='TEACHER'||bySubject.size,'Acceso denegado: sección no asignada');
      return [...bySubject.values()];
    };
    const scheduledFor=(a,periodId)=>{
      if(db.subjects.find(s=>s.id===a.subjectId)?.type!=='MODULO_FASES')return true;
      if(db.grades.some(g=>sameScope(g,a,periodId)))return true;
      const schedules=db.assignments.filter(x=>x.active&&own(x)&&sameScope(x,a)&&x.requiredPeriods?.length);
      return !schedules.length||schedules.some(x=>x.requiredPeriods.includes(periodId));
    };
    const reportRule=(section,periodId)=>section.reportSubjects?.find(rule=>rule.year===p.year&&rule.periodId===periodId);
    const reportIncludes=(section,a,periodId)=>{
      const rule=reportRule(section,periodId);
      return rule?rule.subjectIds.includes(a.subjectId):scheduledFor(a,periodId);
    };
    function documentScope(section,{report,allSubjects}){
      const frameId=allSubjects?null:p.frameId;
      const frame=frameId?(db.academicFrames||[]).find(f=>f.id===frameId):null;
      requireThat(!frameId||frame,'Cuadro no disponible');
      const links=frame?(db.frameLinks||[]).filter(l=>l.frameId===frame.id&&l.year===p.year&&l.sectionId===p.sectionId):null;
      if(p.periodId)period({year:p.year},p.periodId);
      const assignments=sectionAssignments().filter(a=>!links||links.some(l=>l.subjectId===a.subjectId));
      requireThat(user.role!=='TEACHER'||assignments.length>0,'Acceso denegado: sección o cuadro no asignado');
      const periods=db.periods.filter(x=>x.year===p.year&&(!p.periodId||x.id===p.periodId));
      const selectedPeriods=a=>periods.filter(x=>(!links||links.some(l=>l.subjectId===a.subjectId&&l.periodId===x.id))&&
        (!report||reportIncludes(section,a,x.id)||(allSubjects&&scheduledFor(a,x.id))||
          (p.reportLayout===true&&(!p.periodId||categoryOf(db.subjects.find(s=>s.id===a.subjectId)||{})!=='TECHNICAL'))));
      return {frame,periods,assignments,selectedPeriods};
    }
    function teacherImportScope(data){
      requireThat(user.role!=='DIRECTION','Dirección tiene acceso de consulta');
      const teacher=db.users.find(u=>u.id===(data.teacherId||user.id)&&u.role==='TEACHER'&&u.active);
      requireThat(teacher&&(user.role==='ADMIN'||teacher.id===user.id),'Elegí un docente activo y autorizado');
      const year=db.years.find(y=>y.id===data.year);
      requireThat(year,'Elegí un año lectivo válido');
      const closed=period({year:data.year},data.periodId);
      return {teacher,year,closed};
    }
    function sectionImportReview(data=p,multi=false){
      let teacherId;
      if(multi){
        teacherId=teacherImportScope(data).teacher.id;
        requireThat(data.teacherId===teacherId,'Falta el docente en el contexto del libro');
      }
      else{admin();sectionContext();}
      requireThat(!period({year:data.year},data.periodId),'El período está cerrado');
      requireThat(data.schema===(multi?'GENESIS_TEACHER_V1':'GENESIS_SECTION_V1')&&typeof data.hash==='string'&&/^[a-f0-9]{64}$/.test(data.hash)&&typeof data.file==='string'&&data.file.length<=180&&/^[^/\\]+\.xlsx$/i.test(data.file)&&Array.isArray(data.groups)&&data.groups.length>0&&data.groups.length<=98,'Usá la plantilla de importación correspondiente generada en GENESIS');
      requireThat(data.groups.every(group=>Array.isArray(group?.rows)&&group.rows.length>0&&group.rows.length<=200)&&data.groups.reduce((total,group)=>total+group.rows.length,0)<=1000,'La carga admite hasta 1000 registros y 200 estudiantes por pestaña');
      const byId=new Map(db.students.map(s=>[s.id,s]));
      const bySection=new Map();
      for(const e of enrollments){
        if(e.year!==data.year)continue;
        const student=byId.get(e.studentId);
        if(!student)continue;
        if(!bySection.has(e.sectionId))bySection.set(e.sectionId,new Map());
        bySection.get(e.sectionId).set(student.nie,student);
      }
      const seenSubjects=new Set(),seenTabs=new Set(),pending=[];
      let errors=0,unchanged=0;
      const groups=data.groups.map(group=>{
        const a=access(group.template?.assignmentId);
        requireThat(a.year===data.year&&(multi?a.teacherId===teacherId:a.sectionId===data.sectionId)&&scheduledFor(a,data.periodId),
          multi?'La pestaña no pertenece a los grupos de este docente y período':'La pestaña no pertenece a esta sección y período');
        requireThat(!!group.template,'Falta el contexto de la pestaña');
        validateTemplate(group.template,a,data.periodId);
        requireThat(JSON.stringify(group.template.evaluation.labels)===JSON.stringify(evaluationFor(db,a,data.periodId).labels),'Los encabezados de la plantilla cambiaron; descargá una nueva');
        const scope=JSON.stringify([a.sectionId,a.subjectId]),source=multi?group.source:undefined;
        const block=JSON.stringify([group.tab,source?.headerRow||0]);
        requireThat(typeof group.tab==='string'&&group.tab.length>0&&group.tab.length<=31&&!seenTabs.has(block)&&!seenSubjects.has(scope),'Cuadro o asignatura repetida');
        seenTabs.add(block);seenSubjects.add(scope);
        const students=bySection.get(a.sectionId)||new Map();
        const subject=db.subjects.find(s=>s.id===a.subjectId),seen=new Set();
        if(source){
          const column=value=>typeof value==='string'&&/^[A-Z]{1,3}$/.test(value);
          requireThat(Number.isSafeInteger(source.headerRow)&&source.headerRow>0&&source.headerRow<1048576&&column(source.nieColumn)&&Array.isArray(source.columns)&&source.columns.length===group.template.evaluation.count&&
            source.columns.every(column)&&new Set(source.columns).size===source.columns.length&&!source.columns.includes(source.nieColumn),'Columnas de origen inválidas');
        }
        const rows=group.rows.map(row=>{
          const issues=[],nie=row?.nie,student=students.get(nie);
          if(typeof nie!=='string'||!/^\d{1,20}$/.test(nie))issues.push('NIE inválido');
          if(seen.has(nie))issues.push('NIE repetido');seen.add(nie);
          if(!student)issues.push('Sin matrícula en esta sección');
          if(!Number.isSafeInteger(row?.rowNumber)||row.rowNumber<2||row.rowNumber>1048576||source&&row.rowNumber<=source.headerRow)issues.push('Fila inválida');
          let values=null;
          try{resultFor(subject,row.values,a,data.periodId);values=row.values;if(values.every(v=>v===null))issues.push('Sin notas');}catch{issues.push('Revisá las notas');}
          const key=student&&gradeKey(a,student.id,data.periodId),record=key&&index().records.get(key);
          const same=!!record&&JSON.stringify(record.values)===JSON.stringify(row?.values);
          if(key&&index().conflicts.has(key))issues.push('Notas pendientes de conciliación');
          if(!same&&student&&locked(a,student.id,data.periodId))issues.push('Calificaciones bloqueadas');
          if(record&&!same)issues.push('Ya tiene notas registradas');
          if(issues.length)errors++;
          else if(same)unchanged++;
          else pending.push({a,student,values:row.values,rowNumber:row.rowNumber,tab:group.tab,source});
          return {nie,name:student?.name||'',rowNumber:row?.rowNumber,values,issues,status:issues.length?'ERROR':same?'UNCHANGED':'NEW'};
        });
        return {tab:group.tab,sectionId:a.sectionId,section:db.sections.find(s=>s.id===a.sectionId)?.name||a.sectionId,subject:subjectTitle(subject),rows,...(source?{columns:source.columns}:{})};
      });
      return {groups,errors,unchanged,additions:pending.length,pending,version:db.version};
    }
    if(['teacherExportIndex','teacherExportFiles','teacherExportSection'].includes(action)){
      admin();
      requireThat(db.years.some(year=>year.id===p.year),'Elegí un año lectivo válido');
      const assignments=db.assignments.filter(assignment=>assignment.year===p.year&&assignment.active);
      const teacherIds=new Set(assignments.map(assignment=>assignment.teacherId));
      const teachers=db.users.filter(teacher=>teacher.role==='TEACHER'&&teacherIds.has(teacher.id))
        .map(({id,name})=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'})||a.id.localeCompare(b.id));
      if(action==='teacherExportIndex'){
        const eligible=new Set(teachers.map(teacher=>teacher.id));
        const sectionIds=new Set(assignments.filter(assignment=>eligible.has(assignment.teacherId)).map(assignment=>assignment.sectionId));
        const sections=db.sections.filter(section=>sectionIds.has(section.id)).map(({id,name})=>({id,name}))
          .sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
        return {teachers,sections,version:db.version};
      }
      requireThat(p.version===db.version,'Las notas cambiaron durante la exportación. Volvé a descargar la carpeta.');
      const oneSection=action==='teacherExportSection';
      let selected=p.teacherIds;
      if(oneSection){
        requireThat(db.sections.some(section=>section.id===p.sectionId),'Seleccioná una sección válida');
        const assigned=new Set(assignments.filter(assignment=>assignment.sectionId===p.sectionId).map(assignment=>assignment.teacherId));
        selected=teachers.filter(teacher=>assigned.has(teacher.id)).map(teacher=>teacher.id);
      }else{
        requireThat(Array.isArray(selected)&&selected.length>0&&selected.length<=4&&new Set(selected).size===selected.length&&selected.every(id=>teachers.some(teacher=>teacher.id===id)),'Selección de docentes inválida');
      }
      const documents=new Map(),sharedContext={...context,gradeIndex:index()};
      return selected.map(id=>{
        const groups=new Map();
        for(const assignment of assignments)if(assignment.teacherId===id&&(!oneSection||assignment.sectionId===p.sectionId)){
          if(!groups.has(assignment.sectionId))groups.set(assignment.sectionId,new Set());
          groups.get(assignment.sectionId).add(assignment.subjectId);
        }
        const sections=[...groups].map(([sectionId,subjects])=>{
          if(!documents.has(sectionId))documents.set(sectionId,operate(db,email,'consolidated',{year:p.year,sectionId},sharedContext));
          const document=documents.get(sectionId);
          const columns=document.columns.filter(column=>subjects.has(column.subject.id));
          const ids=new Set(columns.map(column=>column.subject.id));
          return {section:document.section.name,periods:document.periods,columns,
            students:document.students.map(student=>({nie:student.nie,name:student.name,
              entries:student.entries.filter(entry=>ids.has(entry.subject.id)).map(entry=>({subject:entry.subject,
                periods:entry.periods.map(({id,value})=>({id,value})),final:{value:entry.final.value}}))}))};
        }).sort((a,b)=>a.section.localeCompare(b.section,'es',{numeric:true}));
        return {...teachers.find(teacher=>teacher.id===id),sections};
      });
    }
    if(['sectionResultBackup','checkSectionResult','saveSectionResult','restoreSectionResult'].includes(action)){
      admin();
      const {section}=sectionContext(),id=sectionResultKey(p.year,p.sectionId);
      const storedSnapshot=(db.sectionResults||[]).find(row=>row.id===id);
      if(action==='sectionResultBackup'&&p.printSelection){
        const group={year:p.year,sectionId:p.sectionId};
        const selection=p.printSelection,shared={...context,gradeIndex:index()};
        const source=printSourceForSnapshot(storedSnapshot);
        const check=!!source||p.hasWorkbookSource===true;
        const individual=selection.studentId!==undefined;
        const requested=individual?[selection.studentId]:selection.studentIds;
        const whole=!selection.periodId&&!selection.frameId;
        const roster=enrollments.filter(e=>e.year===p.year&&e.sectionId===p.sectionId);
        const rosterIds=new Set(roster.map(e=>e.studentId));
        const identities=new Map(db.students.filter(s=>rosterIds.has(s.id)).map(({id,nie,name})=>[id,{id,nie,name}]));
        let wanted,scope=shared;
        if(requested!==undefined){
          requireThat(Array.isArray(requested)&&requested.length>0&&requested.every(id=>identities.has(id)),
            'Seleccioná estudiantes matriculados en esta sección.');
          wanted=new Set(requested);
          const names=new Set([...wanted].map(id=>rosterName(identities.get(id).name)).filter(Boolean));
          // Include same-name records so printing can distinguish an empty duplicate from the official file.
          const evidenceIds=new Set([...identities.values()]
            .filter(student=>wanted.has(student.id)||names.has(rosterName(student.name))).map(student=>student.id));
          scope={...shared,documentStudentIds:evidenceIds};
        }
        const selectionIncludesPeers=!!wanted&&scope.documentStudentIds.size>wanted.size;
        const all=check||selectionIncludesPeers||whole&&requested===undefined?
          operate(db,email,'sectionReportCards',{...group,allSubjects:true,reportLayout:true},scope):null;
        let output,auditReport;
        if(all&&whole){
          output={...all,kind:individual?'reportCard':all.kind,
            students:selectionIncludesPeers?all.students.filter(student=>wanted.has(student.id)):all.students};
          if(selectionIncludesPeers)auditReport=all;
        }else{
          const {periodId,frameId}=selection;
          output=operate(db,email,'sectionReportCards',{...group,periodId,frameId,studentIds:requested,
            allSubjects:!frameId,reportLayout:true},shared);
          if(individual)output={...output,kind:'reportCard'};
          auditReport=all;
        }
        const consolidated=check?operate(db,email,'consolidated',group,scope):null;
        const evidence=scope.documentStudentIds?[...scope.documentStudentIds].map(id=>identities.get(id)):[];
        const evidenceNies=new Set(evidence.map(student=>String(student.nie).trim()));
        const evidenceNames=new Set(evidence.map(student=>rosterName(student.name)).filter(Boolean));
        const printSource=source&&wanted?{...source,rows:source.rows.filter(row=>
          evidenceNies.has(String(row.nie).trim())||evidenceNames.has(rosterName(row.name)))}:source;
        return {version:db.version,output,source:printSource,consolidated,identities:roster.map(e=>identities.get(e.studentId)).filter(Boolean),
          ...(auditReport?{auditReport}:{})};
      }
      const current=normalizeSectionSlots(storedSnapshot);
      const periodIds=db.periods.filter(period=>period.year===p.year).slice().sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true})).map(period=>period.id);
      requireThat(periodIds.length===4,'El año lectivo debe tener cuatro períodos configurados');
      if(action==='sectionResultBackup'){
        const group={year:p.year,sectionId:p.sectionId};
        const shared={...context,gradeIndex:index()};
        const document=operate(db,email,'consolidated',group,shared);
        const report=p.includeReport===true&&(storedSnapshot?.sourceAudit||p.hasWorkbookSource===true)?
          operate(db,email,'sectionReportCards',{...group,allSubjects:true,reportLayout:true},shared):null;
        return {schema:'GENESIS_RESPALDO_SECCION_V1',year:p.year,sectionId:p.sectionId,sectionName:section.name,
          snapshot:p.verificationOnly===true?(storedSnapshot?.sourceAudit?{sourceAudit:printSourceForSnapshot(storedSnapshot)}:null):storedSnapshot||null,
          document,...(report?{report}:{}),version:db.version};
      }
      const restoring=action==='restoreSectionResult'||p.mode==='restore';
      const candidate=restoring?p.snapshot:p;
      requireThat(candidate===null&&restoring||
        candidate&&Array.isArray(candidate.slots)&&candidate.slots.length>0&&candidate.slots.length<=80&&Array.isArray(candidate.rows)&&candidate.rows.length>0&&candidate.rows.length<=250,
        'El Excel no tiene una estructura de notas reconocible');
      const ids=new Set(enrollments.filter(e=>e.year===p.year&&e.sectionId===p.sectionId).map(e=>e.studentId));
      const rosterStudents=db.students.filter(student=>ids.has(student.id));
      const roster=new Map(),duplicateRosterNies=new Set();
      for(const student of rosterStudents){
        const nie=String(student.nie).trim();
        if(roster.has(nie))duplicateRosterNies.add(nie);
        roster.set(nie,student.id);
      }
      const namesById=new Map(rosterStudents.map(student=>[student.id,student.name]));
      const idsByName=new Map();
      for(const student of rosterStudents){
        const name=rosterName(student.name);
        if(!idsByName.has(name))idsByName.set(name,new Set());
        idsByName.get(name).add(student.id);
      }
      const differentNames=[];
      let previousResult;
      const priorDocument=()=>previousResult||(previousResult=operate(db,email,'consolidated',{year:p.year,sectionId:p.sectionId},{...context,includeSupplementary:true}));
      let next=null;
      if(candidate){
        if(restoring)requireThat(candidate.year===p.year&&candidate.sectionId===p.sectionId&&JSON.stringify(candidate.periodIds)===JSON.stringify(periodIds),'El respaldo pertenece a otro año, sección o configuración de períodos');
        const seen=new Set();
        const slots=candidate.slots.map(slot=>{
          const validName=typeof slot?.name==='string'&&slot.name.length<=220;
          const key=validName?sectionSlotKey(slot.name):'';
          const legacy=restoring&&(technicalSlot(key)||key===lifeProjectSlot)&&
            slot.key==='materia:'+resultLabel(slot.name).replace(/ /g,'-');
          requireThat(validName&&slot.key&&(slot.key===key||legacy)&&!seen.has(slot.key),'Columna inválida o repetida en el Excel');
          seen.add(slot.key);return {key:slot.key,name:slot.name};
        });
        const coverage=restoring?undefined:candidate.coverage;
        requireThat(coverage===undefined||(coverage&&typeof coverage==='object'&&!Array.isArray(coverage)&&Object.keys(coverage).length<=slots.length&&Object.entries(coverage).every(([key,mask])=>
          seen.has(key)&&Array.isArray(mask)&&mask.length===5&&Array.from(mask).every(value=>typeof value==='boolean'))),'Cobertura de columnas inválida');
        const firstOccurrences=new Map(),identityIssues=[],enrollmentChoices=[];
        const registeredNies=new Map(),namesInYear=new Map(),byStudent=new Map();
        for(const student of db.students){
          const nie=String(student.nie).trim();
          if(!registeredNies.has(nie))registeredNies.set(nie,[]);
          registeredNies.get(nie).push(student);
          byStudent.set(student.id,student);
        }
        const enrollmentsInYear=new Map();
        for(const enrollment of enrollments){
          if(enrollment.year!==p.year)continue;
          const student=byStudent.get(enrollment.studentId),name=rosterName(student?.name);
          if(name){
            if(!namesInYear.has(name))namesInYear.set(name,new Set());
            namesInYear.get(name).add(student.id);
          }
          if(!enrollmentsInYear.has(enrollment.studentId))enrollmentsInYear.set(enrollment.studentId,[]);
          enrollmentsInYear.get(enrollment.studentId).push(enrollment);
        }
        const describeRow=(row,index)=>{
          const source=row?.source;
          if(!restoring&&typeof source?.sheet==='string'&&source.sheet.length<=31&&/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(source.cell))
            return source.sheet.replace(/[\r\n]/g,' ')+'!'+source.cell;
          return 'registro '+(index+1)+' del archivo';
        };
        const rowIds=candidate.rows.map((row,index)=>{
          const valid=typeof row?.nie==='string'&&/^\d{1,20}$/.test(row.nie);
          const studentId=valid?roster.get(row.nie):null,location=describeRow(row,index);
          if(!valid){identityIssues.push(location+' · NIE inválido o vacío');return null;}
          const excelName=!restoring&&typeof row.name==='string'&&row.name.length<=320?row.name.replace(/\s+/g,' ').trim():'';
          const detail=reason=>identityIssues.push('NIE '+row.nie+' · '+location+(excelName?' · '+excelName:'')+' · '+reason);
          if(firstOccurrences.has(row.nie)){detail('Repetido en el archivo. Primera aparición: '+firstOccurrences.get(row.nie));return null;}
          firstOccurrences.set(row.nie,location);
          if(duplicateRosterNies.has(row.nie))detail('Más de un estudiante tiene este NIE en la matrícula de la sección.');
          else if(!studentId){
            const registered=registeredNies.get(row.nie)||[],student=registered[0];
            const matches=student&&enrollmentsInYear.get(student.id)||[];
            const name=rosterName(excelName),namesakes=namesInYear.get(name);
            const archivedInYear=student&&db.enrollments.some(item=>item.studentId===student.id&&item.year===p.year&&archived.has(item.id));
            const authorized=registered.length<=1&&matches.length<=1&&!archivedInYear&&
              (!student||!name||name===rosterName(student.name))&&
              (!namesakes||namesakes.size===1&&student&&namesakes.has(student.id));
            detail(!authorized?'La identidad o la matrícula requiere revisión manual.':student?
              'El estudiante existe en Génesis. Verificá su matrícula en esta sección y año.' :
              'El NIE no está registrado en Génesis. Comparalo con la matrícula oficial antes de corregir el Excel o registrar al estudiante.');
            if(authorized&&!restoring)enrollmentChoices.push({nie:row.nie,name:student?.name||excelName,location,
              registered:!!student,...(matches[0]?{enrollmentId:matches[0].id,fromSectionId:matches[0].sectionId}:{})});
          }
          else if(restoring&&row.studentId!==studentId)detail('El identificador del respaldo ya no corresponde a la matrícula.');
          if(!restoring&&studentId&&typeof row.name==='string'&&row.name.length<=320){
            const name=rosterName(row.name),namesakes=name&&idsByName.get(name);
            if(namesakes&&!namesakes.has(studentId))detail('El NIE y el nombre del Excel corresponden a estudiantes distintos.');
          }
          return studentId;
        });
        if(identityIssues.length){
          const shown=identityIssues.slice(0,20),more=identityIssues.length-shown.length;
          const message='No se importaron notas en '+section.name+' ('+p.year+'). Revisá los NIE indicados.\n'+
            shown.join('\n')+(more?'\nAdemás hay '+more+' registros con problemas de identificación.':'');
          if(action==='checkSectionResult'&&p.returnIdentityIssues===true&&!restoring){
            const occurrences=new Map();
            for(const row of candidate.rows)occurrences.set(row?.nie,(occurrences.get(row?.nie)||0)+1);
            return {version:db.version,identityIssues:{message,
              choices:enrollmentChoices.filter(choice=>occurrences.get(choice.nie)===1)}};
          }
          fail(message);
        }
        const oldStudents=coverage||!restoring&&candidate.rows.some(row=>row.unavailable)?
          new Map(priorDocument().students.map(student=>[student.id,student.entries])):null;
        const priorRows=new Map(!restoring&&current?current.rows.map(row=>[row.studentId,row]):[]);
        const sourceRows=!restoring&&p.recordSource===true?[]:null;
        const students=new Set(rowIds),rows=candidate.rows.map((row,index)=>{
          const studentId=rowIds[index];
          if(!restoring&&row.name!==undefined){
            requireThat(typeof row.name==='string'&&row.name.length<=320,'Nombre inválido en el Excel');
            const excelName=rosterName(row.name),registered=namesById.get(studentId);
            if(excelName&&excelName!==rosterName(registered)){
              differentNames.push({nie:row.nie,excel:row.name,registered});
            }
          }
          requireThat(row.notes&&Object.keys(row.notes).length===slots.length,'Hay columnas de notas incompletas');
          const unavailable=restoring?undefined:row.unavailable;
          requireThat(unavailable===undefined||unavailable&&typeof unavailable==='object'&&!Array.isArray(unavailable)&&
            Object.entries(unavailable).every(([key,indices])=>seen.has(key)&&Array.isArray(indices)&&indices.length<=5&&
              indices.every(i=>Number.isInteger(i)&&i>=0&&i<5&&row.notes[key]?.[i]===null)),'Hay casillas sin fuente con un formato inválido');
          const notes={},moduleLevels={};
          const rawNotes=sourceRows?{}:null;
          if(restoring&&row.moduleLevels!==undefined){
            requireThat(row.moduleLevels&&typeof row.moduleLevels==='object'&&!Array.isArray(row.moduleLevels)&&
              Object.entries(row.moduleLevels).every(([key,level])=>seen.has(key)&&technicalSlot(key)&&
                Number.isInteger(level)&&level>=1&&level<=5&&row.notes[key]?.[4]===null),'Nivel modular de respaldo inválido');
            Object.assign(moduleLevels,row.moduleLevels);
          }
          for(const {key} of slots){
            requireThat(Object.hasOwn(row.notes,key)&&validSectionNotes(key,row.notes[key]),'Nota o criterio fuera de formato');
            const grade=row.notes[key].slice(),unknown=unavailable?.[key],mask=unknown?.length?
              grade.map((_,i)=>!unknown.includes(i)&&coverage?.[key]?.[i]!==false):coverage?.[key];
            if(rawNotes)rawNotes[key]=grade.slice();
            if(mask?.includes(false)){
              const slot=slots.find(item=>item.key===key),entries=oldStudents.get(studentId)||[];
              const subject=sectionResultSubject(slot,entries.map(item=>item.subject),sectionResultPreference(priorDocument().specialty?.reportSubjectCodes,key));
              const entry=entries.find(item=>item.subject.id===subject?.id);
              const prior=[...periodIds.map(id=>entry?.periods.find(period=>period.id===id)?.value??null),entry?.final?.value??null];
              mask.forEach((present,i)=>{
                if(present)return;
                if(i===4&&technicalSlot(key)&&entry?.final?.scale===5&&Number.isInteger(prior[i])){
                  moduleLevels[key]=prior[i];grade[i]=null;
                }else if(validSectionNotes(key,[prior[i],null,null,null,null]))grade[i]=prior[i];
              });
            }
            const prior=priorRows.get(studentId);
            for(let i=0;i<grade.length;i++){
              if(grade[i]!==null||!prior?.notes[key]||sourceRows&&mask?.[i]!==false)continue;
              grade[i]=prior.notes[key][i];
              if(i===4&&grade[i]===null&&prior.moduleLevels?.[key]!==undefined)moduleLevels[key]=prior.moduleLevels[key];
            }
            if(!restoring&&!rawNotes&&grade[4]!==null){
              grade[4]=missingAnnualFromPeriods(key,grade.slice(0,4),grade[4],{year:p.year,section:p.sectionId});
            }
            notes[key]=grade;
          }
        if(sourceRows)sourceRows.push({nie:row.nie,notes:rawNotes,...(unavailable?{unavailable}:{})});
          return {studentId,nie:row.nie,notes,...(Object.keys(moduleLevels).length?{moduleLevels}:{})};
        });
        const file=typeof candidate.file==='string'?candidate.file.trim().slice(0,180):'';
        requireThat(file&&/\.xlsx$/i.test(file)&&!/[/\\]/.test(file),'Archivo XLSX inválido');
        // A workbook may supply just one subject. Keep previously imported columns it omits.
        const priorSlots=!restoring&&current?current.slots.filter(slot=>!seen.has(slot.key)):[];
        requireThat(slots.length+priorSlots.length<=80,'La sección supera el límite de 80 columnas de notas');
        for(const row of rows){
          const prior=priorRows.get(row.studentId);
          for(const [key,indices] of Object.entries(prior?.correctedSlots||{})){
            const retained=indices.filter(index=>!seen.has(key)||candidate.coverage?.[key]?.[index]===false);
            if(retained.length){
              if(!row.correctedSlots)row.correctedSlots={};
              row.correctedSlots[key]=retained;
            }
          }
          for(const {key} of priorSlots){
            row.notes[key]=prior?.notes[key]??[null,null,null,null,null];
            if(prior?.moduleLevels?.[key]!==undefined){
              if(!row.moduleLevels)row.moduleLevels={};
              row.moduleLevels[key]=prior.moduleLevels[key];
            }
          }
        }
        for(const prior of priorRows.values()){
          if(students.has(prior.studentId)||roster.get(String(prior.nie))!==prior.studentId)continue;
          rows.push({...prior,notes:{...Object.fromEntries(slots.map(({key})=>[key,[null,null,null,null,null]])),...prior.notes}});
        }
        const sourceAudit=sourceRows?{file,slots,rows:sourceRows,coverage,
          warnings:Number.isSafeInteger(p.sourceWarnings)&&p.sourceWarnings>=0?p.sourceWarnings:0}:null;
        next={id,year:p.year,sectionId:p.sectionId,periodIds,slots:[...slots,...priorSlots],rows,file,
          ...(sourceAudit?{sourceAudit}:current?.sourceAudit&&!restoring?{sourceAudit:current.sourceAudit}:{})};
        if(next.slots.some(slot=>slot.key==='materia:proyecto-de-vida-y-carrera'))next=normalizeSectionSlots(next);
      }
      const plan=next?planSectionSubjects(db,section,p.year,next,current):{created:[],renamed:[],linked:new Set()};
      const same=!plan.created.length&&!plan.renamed.length&&
        JSON.stringify(current&&[current.slots,current.rows,current.sourceAudit||null])===
          JSON.stringify(next&&[next.slots,next.rows,next.sourceAudit||null]||undefined);
      if(action==='checkSectionResult'){
        const document=priorDocument();
        const previous=new Map(document.students.map(student=>[student.id,student.entries]));
        const addedNotes=p.includeAddedNotes===true?[]:null;
        const periodNames=addedNotes?new Map(document.periods.map(period=>[period.id,period.name])):null;
        const allowMathAlias=summaryUsesMatematica(next);
        let updated=0,added=0,cleared=0;
        for(const row of next?.rows||[])for(const slot of next.slots){
          const entries=previous.get(row.studentId)||[];
          const subject=sectionResultSubject(slot,entries.map(entry=>entry.subject),sectionResultPreference(document.specialty?.reportSubjectCodes,slot.key),allowMathAlias);
          const entry=entries.find(item=>item.subject.id===subject?.id);
          const before=[...periodIds.map(periodId=>entry?.periods.find(period=>period.id===periodId)?.value??null),entry?.final?.value??null];
          [...row.notes[slot.key].slice(0,4),row.moduleLevels?.[slot.key]??row.notes[slot.key][4]].forEach((value,i)=>{
            if(value===before[i])return;
            if(value===null)cleared++;
            else if(before[i]===null){
              added++;
              if(addedNotes)addedNotes.push({nie:row.nie,student:namesById.get(row.studentId),subject:slot.name,
                period:i===4?'Final':periodNames.get(periodIds[i])||'Período '+(i+1),value});
            }
            else updated++;
          });
        }
        return {version:db.version,students:next?.rows.length||roster.size,added,updated,cleared,same,
          newSubjects:plan.created.map(({name})=>name),differentNames,...(addedNotes?{addedNotes}:{})};
      }
      requireThat(p.version===db.version,'Los datos cambiaron. Volvé a revisar el Excel antes de guardar');
      if(same)return {ok:true,unchanged:true,version:db.version};
      for(const subject of plan.created){
        addSubjectEvaluation(db,subject);
        db.subjects.push(subject);
        event('CATALOG_CREATE',{entity:'subjects',record:subject,source:'EXCEL',year:p.year,sectionId:p.sectionId});
      }
      for(const {subject,name} of plan.renamed){
        const before={...subject};
        subject.name=name;
        event('CATALOG_UPDATE',{entity:'subjects',before,after:subject,source:'EXCEL'});
      }
      for(const subject of db.subjects){
        if(plan.linked.has(subject.id))subject.hasImportedHistory=true;
      }
      db.sectionResults=db.sectionResults.filter(row=>row.id!==id);
      if(next)db.sectionResults.push(next);
      event(restoring?'SECTION_RESULTS_RESTORED':'SECTION_RESULTS_REPLACED',{year:p.year,sectionId:p.sectionId,file:next?.file||null,students:next?.rows.length||0});
      db.version++;
      return {ok:true,version:db.version};
    }
    if(action==='checkSectionImport'){
      const {pending,...review}=sectionImportReview();return review;
    }
    function pendingTeacherBatch(){
      admin();
      const batch=db.batches.find(b=>b.id===p.batchId&&b.multiTeacher===true&&b.status==='REVIEW');
      requireThat(batch,'Carga de varias secciones no disponible');
      return batch;
    }
    if(action==='teacherImportWorkbook'){
      const {teacher,year,closed}=teacherImportScope(p);
      requireThat(!closed,'El período está cerrado');
      const assignments=db.assignments.filter(a=>a.active&&a.year===year.id&&a.teacherId===teacher.id&&scheduledFor(a,p.periodId));
      requireThat(assignments.length>0,'Este docente no tiene grupos asignados para el período');
      const rosters=assignments.map(a=>readRoster(db,a,p.periodId,index()));
      return {year,teacher:{id:teacher.id,name:teacher.name},periodId:p.periodId,periodName:db.periods.find(x=>x.year===year.id&&x.id===p.periodId).name,
        rosters,sections:db.sections.filter(s=>assignments.some(a=>a.sectionId===s.id))};
    }
    if(action==='checkTeacherImport'||action==='reviewTeacherImport'){
      const batch=action==='reviewTeacherImport'?pendingTeacherBatch():null;
      const {pending,...review}=sectionImportReview(batch?.workbook||p,true);
      return review;
    }
    if(action==='sectionWorkbook'){
      const {year,section}=sectionContext();period({year:p.year},p.periodId);
      const periodName=db.periods.find(x=>x.year===p.year&&x.id===p.periodId).name;
      const rosters=sectionAssignments().filter(a=>scheduledFor(a,p.periodId)).map(a=>readRoster(db,a,p.periodId,index()));
      return {year:{id:year.id,label:year.label||year.name},section:{id:section.id,name:section.name},periodId:p.periodId,periodName,rosters,scope:user.role==='TEACHER'?'PARTIAL':'SECTION'};
    }
    if(action==='reportOptions'){
      const {section}=sectionContext();
      if(p.forOutput===true){
        const {assignments,selectedPeriods}=documentScope(section,{report:true,allSubjects:p.allSubjects===true});
        return {subjects:assignments.filter(a=>selectedPeriods(a).length).map(a=>{
          const subject=db.subjects.find(s=>s.id===a.subjectId);requireThat(subject,'Asignatura histórica sin catálogo: requiere revisión');
          return subjectView(subject);
        })};
      }
      period({year:p.year},p.periodId);
      return {configured:!!reportRule(section,p.periodId),subjects:sectionAssignments().map(a=>({
        subject:subjectView(db.subjects.find(s=>s.id===a.subjectId)),included:reportIncludes(section,a,p.periodId)
      }))};
    }
    if(action==='checkImport'){
      const a=access(p.assignmentId);requireThat(user.role!=='DIRECTION','Dirección tiene acceso de consulta');requireThat(!period(a,p.periodId),'El período está cerrado');validateTemplate(p.template,a,p.periodId);requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'La carga debe contener entre 1 y 200 estudiantes');const seen=new Set(),subject=db.subjects.find(s=>s.id===a.subjectId);
      return {rows:p.rows.map(r=>{const s=db.students.find(s=>s.nie===r.nie),enrolled=s&&enrollments.some(e=>e.studentId===s.id&&e.year===a.year&&e.sectionId===a.sectionId),issues=[];if(typeof r.nie!=='string'||!/^\d{1,20}$/.test(r.nie))issues.push('NIE inválido');if(seen.has(r.nie))issues.push('NIE repetido');seen.add(r.nie);if(!enrolled)issues.push('Sin matrícula en este grupo');if(enrolled&&gradeConflict(a,s.id,p.periodId))issues.push('Notas pendientes de conciliación');if(enrolled&&locked(a,s.id,p.periodId))issues.push('Calificaciones bloqueadas');if(enrolled&&db.grades.some(g=>g.studentId===s.id&&g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&g.periodId===p.periodId))issues.push('Ya tiene notas registradas');try{resultFor(subject,r.values,a,p.periodId);}catch{issues.push('Revisá las notas');}return {nie:r.nie,name:enrolled?s.name:'',issues};})};
    }
    if(action==='bootstrap'){const view=p.view,allowed=db.assignments.filter(a=>a.active&&own(a));return {specialties:(db.specialties||[]).filter(s=>user.role!=='TEACHER'||db.sections.some(section=>section.specialtyId===s.id&&allowed.some(a=>a.sectionId===section.id))),academicFrames:(db.academicFrames||[]).filter(f=>user.role!=='TEACHER'||(db.frameLinks||[]).some(l=>l.frameId===f.id&&allowed.some(a=>sameScope(l,a)))),frameLinks:(db.frameLinks||[]).filter(l=>user.role!=='TEACHER'||allowed.some(a=>sameScope(l,a))),evaluationPolicies:user.role==='ADMIN'?(db.evaluationPolicies||[]):[],user,version:db.version,assignments:allowed,subjectUsage:user.role==='ADMIN'&&(!view||view==='subjects'||view==='settings')?db.subjects.map(s=>({id:s.id,hasHistory:hasSubjectGrades(s.id)||db.audit.some(e=>e.kind==='GRADE'&&e.detail.subjectId===s.id)||db.incidents.some(i=>i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.subjectId===s.id)})):[],notifications:!view||view==='periods'?completion(db,allowed):[],assignmentHistory:user.role==='ADMIN'?db.assignments.filter(a=>!a.active):[],students:user.role==='ADMIN'?db.students:[],enrollments:user.role==='ADMIN'?enrollments:[],archivedDuplicates:user.role==='ADMIN'?[...archived.values()]:[],actors:user.role==='TEACHER'?[]:db.users.map(u=>({id:u.id,name:u.name})),sections:db.sections.filter(s=>user.role!=='TEACHER'||allowed.some(a=>a.sectionId===s.id)),subjects:db.subjects.filter(s=>user.role!=='TEACHER'||allowed.some(a=>a.subjectId===s.id)),periods:db.periods.filter(p=>user.role!=='TEACHER'||allowed.some(a=>a.year===p.year)),years:db.years.filter(y=>user.role!=='TEACHER'||allowed.some(a=>a.year===y.id)),periodStates:db.periodStates,weights:user.role==='ADMIN'?db.weights:[],teachers:user.role==='ADMIN'?db.teachers:[],users:user.role==='ADMIN'?db.users:[],audit:user.role==='TEACHER'?[]:db.audit,incidents:user.role==='TEACHER'?[]:db.incidents,batches:db.batches.filter(b=>user.role!=='TEACHER'||b.multiTeacher&&b.owner===user.id).map(b=>{if(!b.multiTeacher)return b;const {workbook,...summary}=b;return summary;})};}
    if(action==='roster'||action==='export') {
      const a=access(p.assignmentId);period(a,p.periodId);
      const subject=db.subjects.find(s=>s.id===a.subjectId);
      return showRosterOfficialResults(readRoster(db,a,p.periodId,index()),rosterOfficialResults(db,a,subject));
    }
    if(action==='teacherWorkbook'){
      const a=access(p.assignmentId),subject=db.subjects.find(s=>s.id===a.subjectId);
      requireThat(subject,'Asignatura sin catálogo');
      const periods=db.periods.filter(p=>p.year===a.year);
      const resolve=rosterOfficialResults(db,a,subject);
      const view={...subjectView(subject),...(resolve.slot?{sectionResultSlot:resolve.slot}:{})};
      return {assignment:{...a},subject:view,section:{...db.sections.find(s=>s.id===a.sectionId)},year:{...db.years.find(y=>y.id===a.year)},teacher:{name:db.users.find(u=>u.id===a.teacherId)?.name||''},specialty:(db.specialties||[]).find(s=>s.id===db.sections.find(s=>s.id===a.sectionId)?.specialtyId)||null,periods:periods.map(p=>({...p,roster:showRosterOfficialResults(readRoster(db,a,p.id,index()),resolve)})),version:db.version};
    }
    if(['consolidated','reportCard','sectionReportCards','frame'].includes(action)){
      const {year,section}=sectionContext(),report=action==='reportCard'||action==='sectionReportCards';
      const allSubjects=report&&p.allSubjects===true;
      const {frame,periods,assignments,selectedPeriods}=documentScope(section,{report,allSubjects});
      const sourceNames=new Map();
      const finalNotes=new Map();
      if(report||!p.periodId)for(const g of db.grades){
        if(g.year!==p.year||g.sectionId!==section.id)continue;
        const sheet=g.source?.sheet;
        if(typeof sheet==='string'){
          if(!sourceNames.has(g.subjectId))sourceNames.set(g.subjectId,new Set());
          const name=sheet.replace(/^\s*(?:\d+\s*[.°º]?\s*[a-z]\b)\s*[-_.: ]*/i,'').trim();
          if(name)sourceNames.get(g.subjectId).add(name);
        }
        if(p.periodId||!g.officialFinal)continue;
        const key=JSON.stringify([g.subjectId,g.studentId]),next=officialFinal(g);
        if(!next){finalNotes.set(key,{conflict:true});continue;}
        const existing=finalNotes.get(key);
        finalNotes.set(key,!existing||!existing.conflict&&existing.value===next.value?next:{conflict:true});
      }
      const sectionEnrollments=enrollments.filter(e=>e.year===p.year&&e.sectionId===p.sectionId);
      const studentIds=new Set(sectionEnrollments.map(e=>e.studentId));
      let selectedIds=context.documentStudentIds;
      if(action==='sectionReportCards'&&p.studentIds!==undefined){
        requireThat(Array.isArray(p.studentIds)&&p.studentIds.length>0&&p.studentIds.every(id=>studentIds.has(id)),'Seleccioná estudiantes matriculados en esta sección');
        selectedIds=new Set(p.studentIds);
      }
      const enrolled=sectionEnrollments.filter(e=>(!p.studentId||e.studentId===p.studentId)&&(!selectedIds||selectedIds.has(e.studentId)));
      if(action==='reportCard')requireThat(p.studentId&&enrolled.length===1,'Estudiante no matriculado en esta sección');
      const columns=assignments.map(a=>{
        const subject=db.subjects.find(s=>s.id===a.subjectId);requireThat(subject,'Asignatura histórica sin catálogo: requiere revisión');
        const includedPeriods=selectedPeriods(a);
        const rosters=includedPeriods.map(x=>({period:x,roster:readRoster(db,a,x.id,index(),enrolled)}));
        const teacherIds=[...new Set(db.assignments.filter(x=>x.active&&sameScope(x,a)).map(x=>x.teacherId))];
        const view=subjectView(subject);
        if(report&&a.active&&subject.type==='MODULO_FASES')view.assignedModule=true;
        if(sourceNames.has(a.subjectId))view.reportSourceNames=[...sourceNames.get(a.subjectId)];
        return {subject:view,teachers:teacherIds.map(id=>db.users.find(u=>u.id===id)?.name||'Docente'),periods:includedPeriods,
          rosters:rosters.map(({period,roster})=>({period,roster,studentsById:new Map(roster.students.map(student=>[student.id,student]))}))};
      }).filter(c=>c.periods.length);
      const filled=new Set(db.grades.filter(g=>g.year===p.year&&g.sectionId===p.sectionId&&studentIds.has(g.studentId)&&g.values?.some(v=>typeof v==='number'&&Number.isFinite(v))).map(g=>JSON.stringify([g.subjectId,g.periodId])));
      const moduleFinals=new Map((p.periodId?[]:db.moduleFinals||[]).filter(g=>g.year===p.year&&g.sectionId===p.sectionId).map(g=>[JSON.stringify([g.subjectId,g.studentId]),g]));
      const studentById=new Map(db.students.map(student=>[student.id,student]));
      const students=enrolled.map(e=>{
        const student=studentById.get(e.studentId);requireThat(student,'Matrícula sin estudiante: requiere revisión');
        return {...student,...(e.specialtyId?{specialty:(db.specialties||[]).find(s=>s.id===e.specialtyId)||null}:{}),entries:columns.map(c=>{
          const moduleFinal=moduleFinals.get(JSON.stringify([c.subject.id,student.id]));
          const registeredModule=officialFinal(moduleFinal,true);
          const annualModuleGrade=registeredModule?.value??(moduleFinal?calculate('MODULO_FASES',moduleFinal.values,moduleFinal.weights).value:null);
          const calculated=c.rosters[0].studentsById.get(student.id).final;
          const registeredBasic=finalNotes.get(JSON.stringify([c.subject.id,student.id]));
          const annualPolicy=subjectFinalPolicy(c.subject,year.finalPolicy);
          const minimum=annualPolicy?.method==='SUM_4'?annualPolicy.passMark/4:annualPolicy?.passMark;
          const final=c.subject.type!=='MODULO_FASES'&&registeredBasic?
            registeredBasic.conflict?{...calculated,value:null,status:'PENDIENTE',conflict:true}:
              {...calculated,value:registeredBasic.value,scale:10,status:Number.isFinite(minimum)?
                (reachesGrade(registeredBasic.value,minimum)?'APROBADO':'REPROBADO'):'SIN_CRITERIO'}:calculated;
          return {subject:c.subject,teachers:c.teachers,periods:c.rosters.map(({period,roster,studentsById})=>{
          const row=studentsById.get(student.id),plan=roster.evaluation;
          const source=report?index().records.get(gradeKey(roster.assignment,student.id,period.id))?.source:null;
          const criteria=source?.conductCriteria;
          const sourceModuleCode=typeof source?.sheet==='string'?source.sheet.match(/(?:^|[- ])(1\.7)(?=\s|[-.]|$)/)?.[1]:null;
          const criteriaResults=Array.isArray(criteria)&&criteria.length===4&&criteria.every(item=>['E','MB','B'].includes(item?.result))?criteria.map(item=>item.result):null;
          return {id:period.id,name:period.name,values:row.values,value:row.result.value,locked:row.locked,conflict:row.conflict,unfilledModule:c.subject.type==='MODULO_FASES'&&!filled.has(JSON.stringify([c.subject.id,period.id])),evaluation:{mode:plan.mode,count:plan.count,labels:plan.labels,weights:plan.weights},...(criteriaResults?{conductCriteria:criteriaResults}:{}),...(sourceModuleCode?{sourceModuleCode}:{})};
          }),final:annualModuleGrade===null?final:{...final,...technicalClosingResult(annualModuleGrade,p.year,section,c.subject),
            ...(registeredModule?.scale===5?{scale:5,value:registeredModule.value,level:registeredModule.value,approved:registeredModule.value>=4}:{}),status:'REGISTRADO'}};
        })};
      });
      const document={kind:action,year:{id:year.id,label:year.label||year.name},section,frame,periods,specialty:(db.specialties||[]).find(s=>s.id===(frame?.specialtyId||section.specialtyId))||null,scope:user.role==='TEACHER'?'PARTIAL':'SECTION',students,columns:columns.map(({subject,teachers,periods})=>({subject,teachers,periods})),version:db.version,decimals:1,notice:user.role==='TEACHER'?'Consulta parcial: únicamente asignaturas asignadas a este docente.':'Documento de consulta académica. Formato oficial y firmas pendientes de validación.'};
      const snapshot=(db.sectionResults||[]).find(row=>row.id===sectionResultKey(p.year,p.sectionId));
      const links=reportModuleLinks(document);
      if(!document.section.grade&&links.length)document.section={...document.section,grade:Number(links[0].module.key[0])};
      const imported=withSectionResults(document,snapshot,user.role==='TEACHER',frame);
      const result=completeLinkedModuleClosures(collapseEquivalentSubjectColumns(imported),links,snapshot);
      if(action!=='frame'&&!context.includeSupplementary&&p.year==='2026'){
        const sections=[section.id,section.name].map(label=>resultLabel(label).replace(/ /g,''));
        if(sections.some(label=>/^1[ab]$/.test(label))){
          const visible=({subject})=>!firstYearAccountingReportOmissions.has(subject.sectionResultSlot||sectionSlotKey(subject.name));
          result.columns=result.columns.filter(visible);
          for(const student of result.students)student.entries=student.entries.filter(visible);
          showAccountingEntrepreneurship(result,'1.7',snapshot);
        }else if(sections.includes('2a')){
          showAccountingEntrepreneurship(result,'2.7',snapshot);
        }
      }
      if(!moduleOnlySection(section)||context.includeSupplementary)return result;
      const importedSlots=new Set();
      for(const row of snapshot?.rows||[]){
        for(const [key,notes] of Object.entries(row.notes)){
          if(notes.some(value=>value!==null))importedSlots.add(key);
        }
      }
      const linkedSubjects=new Set(links.map(({subject})=>subject.key));
      const visible=({subject})=>moduleSectionSubject(subject)||importedSlots.has(subject.sectionResultSlot)||
        linkedSubjects.has(subject.sectionResultSlot||sectionSlotKey(subject.name));
      return {...result,columns:result.columns.filter(visible),
        students:result.students.map(student=>({...student,entries:student.entries.filter(visible)}))};
    }
    const scopedGradeSave=action==='saveGrades'&&p.baseEvaluation!==undefined;
    const scopedEnrollment=Boolean(p.enrollmentCheck)&&['enroll','updateEnrollment'].includes(action);
    const scopedStudent=action==='student'&&p.studentCheck!=null;
    let changedStudent,changedEnrollment;
    requireThat(p.version===db.version||(scopedGradeSave||scopedEnrollment||scopedStudent)&&Number.isSafeInteger(p.version)&&
      p.version>=0&&p.version<db.version,'Los datos cambiaron. Recargá antes de guardar');
    if(action==='reportSubjects'){
      admin();const {section}=sectionContext();period({year:p.year},p.periodId);
      const subjects=new Set(sectionAssignments().map(a=>a.subjectId)),before=reportRule(section,p.periodId)||null;
      requireThat(p.subjectIds===null||Array.isArray(p.subjectIds)&&p.subjectIds.length<=subjects.size&&p.subjectIds.every(id=>subjects.has(id))&&new Set(p.subjectIds).size===p.subjectIds.length,'La selección contiene asignaturas ajenas o repetidas');
      const after=p.subjectIds===null?null:{year:p.year,periodId:p.periodId,subjectIds:p.subjectIds.slice()};
      section.reportSubjects=(section.reportSubjects||[]).filter(rule=>rule!==before);
      if(after)section.reportSubjects.push(after);
      event('REPORT_SUBJECTS',{year:p.year,sectionId:p.sectionId,periodId:p.periodId,before,after});
    } else if(action==='stageTeacherImport'){
      const review=sectionImportReview(p,true);
      requireThat(!review.errors&&review.additions,'Corregí los conflictos o incluí al menos una nota nueva.');
      requireThat(!db.batches.some(b=>b.multiTeacher&&b.teacherId===p.teacherId&&b.year===p.year&&b.periodId===p.periodId&&b.hash===p.hash&&b.status!=='REVERTED'),'Este archivo ya fue enviado para revisión');
      const groups=p.groups.map(({tab,template,rows,source})=>{
        const {schema,assignmentId,teacherId,year,sectionId,subjectId,periodId,evaluation}=template;
        const {mode,count,weights,labels}=evaluation;
        return {tab,template:{schema,assignmentId,teacherId,year,sectionId,subjectId,periodId,evaluation:{mode,count,weights,labels}},
          rows:rows.map(({nie,values,rowNumber})=>({nie,values,rowNumber})),
          ...(source?{source:{headerRow:source.headerRow,nieColumn:source.nieColumn,columns:source.columns}}:{})};
      });
      const workbook={schema:p.schema,year:p.year,periodId:p.periodId,teacherId:p.teacherId,file:p.file,hash:p.hash,groups};
      const batch={id:`teacher-${db.version}`,hash:p.hash,bulk:true,multiTeacher:true,teacherId:p.teacherId,year:p.year,periodId:p.periodId,file:p.file,status:'REVIEW',owner:user.id,summary:{blocks:review.groups.length,rows:review.additions},workbook};
      db.batches.push(batch);
      event('IMPORT_PREVIEW',{batchId:batch.id,teacherId:p.teacherId,year:p.year,periodId:p.periodId,count:review.additions});
    } else if(action==='approveTeacherImport'){
      const batch=pendingTeacherBatch(),data=batch.workbook,review=sectionImportReview(data,true);
      requireThat(!review.errors&&review.additions,'La carga tiene conflictos o ya no contiene notas nuevas');
      for(const {a,student,values,rowNumber,tab,source} of review.pending){
        const range=source?source.columns[0]+rowNumber+':'+source.columns[source.columns.length-1]+rowNumber:null;
        db.grades.push({id:`ig-${db.grades.length}-${db.version}`,studentId:student.id,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:data.periodId,values:values.slice(),source:{file:data.file,sheet:tab,block:data.schema,cell:(source?.nieColumn||'A')+rowNumber,...(range?{range,columns:source.columns}:{}),assignmentId:a.id,batch:batch.id}});
      }
      batch.status='IMPORTED';
      batch.summary.rows=review.additions;
      delete batch.workbook;
      event('IMPORT_APPROVED',{batchId:batch.id,count:review.additions,teacherId:batch.teacherId,year:batch.year,periodId:batch.periodId});
    } else if(action==='importSectionWorkbook'){
      const review=sectionImportReview();
      requireThat(!review.errors,'El libro contiene filas con conflictos; revisalo antes de importar');
      requireThat(review.pending.length,'No hay notas nuevas para importar');
      const batch={id:`section-${db.version}`,hash:p.hash,bulk:true,year:p.year,sectionId:p.sectionId,periodId:p.periodId,status:'IMPORTED',owner:user.id,summary:{blocks:review.groups.length,rows:review.additions}};
      for(const {a,student,values,rowNumber,tab} of review.pending){
        db.grades.push({id:`ig-${db.grades.length}-${db.version}`,studentId:student.id,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,values:values.slice(),source:{file:p.file,sheet:tab,block:p.schema,cell:'A'+rowNumber,assignmentId:a.id,batch:batch.id}});
      }
      db.batches.push(batch);event('IMPORT_APPROVED',{batchId:batch.id,count:review.additions,sectionId:p.sectionId,year:p.year,periodId:p.periodId});
    } else if(action==='specialty'){
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
      requireThat(typeof p.active==='boolean'&&enrollments.some(e=>e.year===a.year&&e.sectionId===a.sectionId&&e.studentId===p.studentId),'Bloqueo o matrícula inválidos');
      requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10&&p.reason.length<=500,'El bloqueo o desbloqueo requiere un motivo de al menos 10 caracteres');
      let record=db.gradeLocks.find(l=>sameScope(l,a,p.periodId)&&l.studentId===p.studentId);const before=record?{...record}:null;
      requireThat(p.active||record?.active,'La calificación no está bloqueada');
      if(!record){record={id:`lock-${db.version}`,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,studentId:p.studentId};db.gradeLocks.push(record);}
      Object.assign(record,{active:p.active,reason:p.reason.trim(),userId:user.id,at:context.now?.()||new Date().toISOString()});event(p.active?'GRADE_LOCK':'GRADE_UNLOCK',{before,after:record});
    } else if(action==='saveGrades') {
      const a=access(p.assignmentId);requireThat(user.role==='TEACHER'||user.role==='ADMIN','Dirección tiene acceso de consulta');requireThat(!period(a,p.periodId),'El período está cerrado');
      requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'Lote de notas inválido');
      const plan=evaluationFor(db,a,p.periodId),seen=new Set();
      const snapshot=(db.sectionResults||[]).find(item=>item.id===sectionResultKey(a.year,a.sectionId));
      const savedById=new Map((snapshot?.rows||[]).map(row=>[row.studentId,row]));
      const subject=db.subjects.find(item=>item.id===a.subjectId);
      const keyInSnapshot=linkedSummarySlot(db,a,snapshot)?.key;
      const position=snapshot?.periodIds.indexOf(p.periodId)??-1;
      if(scopedGradeSave)requireThat(JSON.stringify([plan.mode,plan.count,plan.weights])===JSON.stringify(p.baseEvaluation),
        'La configuración de notas cambió. Volvé a abrir el grupo para revisarla.');
      const eligible=new Map(enrollments.filter(e=>e.year===a.year&&e.sectionId===a.sectionId).map(e=>[e.studentId,e]));
      const students=new Map(db.students.map(student=>[student.id,student]));
      const changes=[];
      for(const row of p.rows){
        requireThat(!seen.has(row.studentId),'Estudiante repetido');
        seen.add(row.studentId);
        const key=gradeKey(a,row.studentId,p.periodId),old=index().records.get(key),before=old?.values||null;
        requireThat(!index().conflicts.has(key),'Hay notas diferentes pendientes de revisión para este estudiante');
        requireThat(eligible.has(row.studentId)&&students.has(row.studentId),'Estudiante fuera de sección');
        const {value}=evaluate(row.values,plan);
        if(JSON.stringify(before)===JSON.stringify(row.values))continue;
        if(scopedGradeSave)requireThat(Object.hasOwn(row,'baseValues')&&JSON.stringify(row.baseValues)===JSON.stringify(before),
          'Otra persona modificó estas notas. Revisá el grupo antes de reemplazarlas.');
        requireThat(!locked(a,row.studentId,p.periodId),'Calificaciones bloqueadas para este estudiante, materia y período');
        if(before?.some((value,i)=>value!==null&&row.values[i]===null))
          requireThat(p.confirmClear===true&&typeof p.reason==='string'&&p.reason.trim().length>=10,
            'Vaciar notas guardadas requiere confirmación y motivo explícitos');
        const saved=savedById.get(row.studentId);
        const imported=position>=0&&keyInSnapshot?saved?.notes[keyInSnapshot]?.[position]:null;
        let correction;
        if(Number.isFinite(imported)&&value!==null&&Math.abs(imported-value)>1e-8){
          requireThat(p.confirmImported===true&&typeof p.reason==='string'&&p.reason.trim().length>=10,
            'El período tiene una nota importada. Confirmá la corrección y escribí el motivo.');
          requireThat(row.baseOfficial===imported,
            'La nota del resumen cambió. Volvé a abrir el cuadro antes de corregir.');
          correction={saved,key:keyInSnapshot,position,value};
        }
        changes.push({row,old,before,correction});
      }
      if(!changes.length)return {ok:true,unchanged:true,version:db.version,
        ...(p.returnWorkbook===true?{workbook:operate(db,email,'teacherWorkbook',{assignmentId:a.id},context)}:{})};
      for(const {row,old,before,correction} of changes){
        const grade=old||{id:`g-${db.grades.length}-${db.version}`,year:a.year,sectionId:a.sectionId,
          subjectId:a.subjectId,studentId:row.studentId,periodId:p.periodId};
        if(!old)db.grades.push(grade);
        grade.values=row.values.slice();
        const official=correction?amendImportedGrade(correction.saved,correction.key,correction.position,correction.value,subject):null;
        event('GRADE',{gradeId:grade.id,before,after:grade.values,assignmentId:a.id,
          studentName:students.get(row.studentId).name,sectionId:a.sectionId,subjectId:a.subjectId,periodId:p.periodId,
          ...(p.confirmClear?{reason:p.reason,confirmedClear:true}:{}),
          ...(official?{official,reason:p.reason.trim()}:{})});
      }
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
      if(!p.closed)admin();
      let status=db.periodStates.find(s=>s.year===p.year&&s.periodId===p.periodId);
      requireThat(!!status?.closed!==p.closed,p.closed?'El período ya está cerrado.':'El período ya está abierto para registrar notas.');
      if(!p.closed)requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10,'La reapertura requiere un motivo de al menos 10 caracteres');
      if(p.closed){const assignments=db.assignments.filter(a=>a.active&&a.year===p.year);requireThat(assignments.length>0,'No se puede cerrar un año sin asignaciones');const missing=completion(db,assignments).filter(n=>n.periodId===p.periodId||!n.periodId);const conflicts=db.incidents.filter(i=>i.status==='REQUIRES_REVIEW'&&i.year===p.year&&['SUBJECT_MERGE_GRADE_CONFLICT','SUBJECT_MERGE_TEACHER_CONFLICT'].includes(i.kind)&&(!i.periodId||i.periodId===p.periodId));requireThat(!missing.length&&!conflicts.length,`No se puede cerrar: hay ${missing.length} grupos pendientes y ${conflicts.length} conflictos por revisar. El docente y administración tienen avisos.`);}
      if(!status){status={year:p.year,periodId:p.periodId};db.periodStates.push(status);}
      status.closed=p.closed;event(p.closed?'CLOSE':'REOPEN',{...status,reason:p.reason||''});
    } else if(action==='finalPolicy') {
      admin();const year=db.years.find(y=>y.id===p.year);requireThat(year&&['AVERAGE_4','SUM_4'].includes(p.method)&&typeof p.passMark==='number'&&Number.isFinite(p.passMark)&&p.passMark>=0&&p.passMark<=(p.method==='SUM_4'?40:10)&&typeof p.reason==='string'&&p.reason.trim().length>=10,'Confirmá el cálculo, la nota mínima y la justificación');
      requireThat(!db.periodStates.some(s=>s.year===p.year&&s.closed),'Reabrí los períodos antes de modificar el criterio final');const before=year.finalPolicy||null;year.finalPolicy={method:p.method,passMark:p.passMark,reason:p.reason};event('FINAL_POLICY',{year:p.year,before,after:year.finalPolicy});
    } else if(action==='moduleSchedule') {
      admin();const a=access(p.assignmentId);requireThat(db.subjects.find(s=>s.id===a.subjectId)?.type==='MODULO_FASES'&&Array.isArray(p.periodIds)&&p.periodIds.length>0&&p.periodIds.every(id=>db.periods.some(x=>x.year===a.year&&x.id===id)),'Seleccioná los períodos del módulo');const unique=[...new Set(p.periodIds)],old=a.requiredPeriods||[];
      requireThat(!old.some(id=>!unique.includes(id)&&db.periodStates.some(s=>s.year===a.year&&s.periodId===id&&s.closed)),'No se puede retirar un período cerrado del calendario');
      requireThat(!db.grades.some(g=>g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&!unique.includes(g.periodId)),'El módulo tiene notas en un período que intentás retirar');a.requiredPeriods=unique;event('MODULE_SCHEDULE',{assignmentId:a.id,before:old,after:unique});
    } else if(action==='policy') {
      admin();const subject=db.subjects.find(s=>s.id===p.subjectId);requireThat(subject&&!hasSubjectGrades(p.subjectId),'Solo se configura una materia sin notas históricas');requireThat(typeof p.reason==='string'&&p.reason.trim().length>=10&&(p.decimals===undefined||p.decimals===1),'Se requiere justificación; las notas se muestran con un decimal');requireThat(Array.isArray(p.weights),'Ponderaciones inválidas');calculate(subject.type,Array(subject.type==='MODULO_FASES'?9:3).fill(0),p.weights);db.weights=db.weights.filter(w=>w.id!==subject.id);db.weights.push({id:subject.id,values:p.weights.slice(),status:'CONFIGURADO_POR_ADMINISTRACION',reason:p.reason});subject.decimals=1;event('POLICY',{subjectId:subject.id,weights:p.weights,decimals:p.decimals,reason:p.reason});
    } else if(action==='nativeUserCreate') {
      admin();
      const email=typeof p.email==='string'?p.email.trim().toLowerCase():'';
      requireThat(typeof p.name==='string'&&p.name.trim()&&p.name.length<=160&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254,'Nombre o correo inválido');
      requireThat(['ADMIN','DIRECTION','TEACHER'].includes(p.role),'Seleccioná un rol válido');
      requireThat(typeof p.userId==='string'&&p.userId.length<=80&&!db.users.some(u=>u.id===p.userId),'Identificador inválido');
      requireThat(!db.users.some(u=>u.email.toLowerCase()===email),'El correo ya está registrado. Para esa persona, usá Asignar acceso.');
      const account={id:p.userId,name:p.name.trim(),email,role:p.role,active:true};
      db.users.push(account);
      if(p.role==='TEACHER')db.teachers.push({id:account.id,userId:account.id,name:account.name});
      event('USER_CREATE',{id:account.id,role:account.role,active:true});
    } else if(action==='credentials') {
      admin();requireThat(db.users.some(u=>u.id===p.userId&&u.active)&&typeof p.username==='string'&&/^[\p{L}\p{N}._-]{3,40}$/u.test(p.username),'Usuario inválido');event('ACCESS_CHANGED',{userId:p.userId,username:p.username});
    } else if(action==='userRole') {
      admin();const target=db.users.find(u=>u.id===p.userId);requireThat(target&&['ADMIN','DIRECTION','TEACHER'].includes(p.role)&&typeof p.active==='boolean','Cuenta o rol inválidos');requireThat(!(target.role==='ADMIN'&&target.active&&(p.role!=='ADMIN'||!p.active))||db.users.some(u=>u.id!==target.id&&u.active&&u.role==='ADMIN'),'Debe conservarse una cuenta administradora activa');const before={role:target.role,active:target.active};target.role=p.role;target.active=p.active;if(p.role==='TEACHER'&&!db.teachers.some(t=>t.id===target.id))db.teachers.push({id:target.id,userId:target.id,name:target.name});event('USER_ROLE',{userId:target.id,before,role:p.role,active:p.active});
    } else if(action==='catalog') {
      if(p.entity==='subjects'&&typeof p.name==='string')p={...p,name:subjectName(p.name)};
      admin();requireThat(['sections','subjects','years'].includes(p.entity)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=(p.entity==='subjects'?240:120),'Nombre inválido');
      const id=p.id||context.id?.()||`${p.entity}-${db.version}`;requireThat(typeof id==='string'&&/^[\w-]{1,80}$/.test(id),'Registro inválido');requireThat(!db[p.entity].some(x=>x.id===id||x.name?.toLowerCase()===p.name.trim().toLowerCase()&&!(p.entity==='sections'&&x.grade&&p.grade&&x.grade!==p.grade)),'El registro ya existe');
      const record={id,name:p.name.trim()};if(p.entity==='sections'&&p.grade){requireThat(['1','2','3'].includes(p.grade),'Grado inválido');record.grade=p.grade;}
      if(p.entity==='subjects'){requireThat(['GENERAL_4_PERIODOS','MODULO_FASES'].includes(p.type),'Tipo de evaluación no disponible');record.type=p.type;addSubjectEvaluation(db,record);}
      if(p.entity==='years'){record.label=p.name;record.finalPolicy={method:'AVERAGE_4',passMark:BASIC_PASS_MARK,reason:'Básicas y Conducta aprueban desde 5.50 en el promedio de los cuatro períodos'};['1','2','3','4'].forEach(periodId=>db.periods.push({id:periodId,name:`Período ${periodId}`,year:id}));}
      if(p.entity==='subjects')subjectMetadata(record,p);db[p.entity].push(record);event('CATALOG_CREATE',{entity:p.entity,record});
    } else if(action==='updateCatalog') {
      if(p.entity==='subjects'&&typeof p.name==='string')p={...p,name:subjectName(p.name)};
      admin();requireThat(['sections','subjects','years'].includes(p.entity),'Catálogo inválido');const record=db[p.entity].find(x=>x.id===p.recordId);requireThat(record&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=(p.entity==='subjects'?240:120),'Nombre inválido');requireThat(!db[p.entity].some(x=>x.id!==record.id&&(x.name||x.label)?.toLowerCase()===p.name.trim().toLowerCase()),'El registro ya existe');const before=JSON.parse(JSON.stringify(record));
      if(p.entity==='sections'&&p.grade){requireThat(['1','2','3'].includes(p.grade),'Grado inválido');record.grade=p.grade;}
      if(p.entity==='subjects'&&p.type!==undefined){requireThat(['GENERAL_4_PERIODOS','MODULO_FASES'].includes(p.type),'Categoría inválida');if(p.type!==record.type){requireThat(!hasSubjectGrades(record.id)&&!db.audit.some(e=>e.kind==='GRADE'&&e.detail.subjectId===record.id)&&!db.incidents.some(i=>i.kind==='SUBJECT_MERGE_GRADE_CONFLICT'&&i.subjectId===record.id),'La categoría no puede cambiar porque la materia tiene historial académico');requireThat(!db.assignments.some(a=>a.subjectId===record.id&&db.periodStates.some(s=>s.year===a.year&&s.closed)),'No se puede cambiar la categoría con períodos cerrados');record.type=p.type;db.blocks=db.blocks.filter(b=>b.id!==record.id);db.activities=db.activities.filter(a=>a.blockId!==record.id);db.weights=db.weights.filter(w=>w.id!==record.id);db.blocks.push({id:record.id,type:p.type});const n=p.type==='MODULO_FASES'?9:3;for(let i=0;i<n;i++)db.activities.push({id:`${record.id}-${i}`,blockId:record.id,index:i});db.weights.push({id:record.id,values:n===9?[.25,.5,.25]:[.35,.35,.3],status:'OBSERVADO_PENDIENTE_VALIDACION'});for(const a of db.assignments.filter(a=>a.subjectId===record.id))delete a.requiredPeriods;}}
      if(p.entity==='subjects')subjectMetadata(record,p);record.name=p.name.trim();if(p.entity==='years')record.label=record.name;event('CATALOG_UPDATE',{entity:p.entity,before,after:record});
    } else if(action==='student') {
      admin();const student=db.students.find(s=>s.id===p.studentId);requireThat(student&&typeof p.nie==='string'&&/^\d{1,20}$/.test(p.nie)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=160,'Estudiante inválido');requireThat(!db.students.some(s=>s.id!==student.id&&s.nie===p.nie),'El NIE ya pertenece a otro estudiante');requireThat(!db.students.some(other=>other.id!==student.id&&duplicateStudentName(other.name)===duplicateStudentName(p.name)&&
        db.enrollments.some(a=>a.studentId===other.id&&db.enrollments.some(b=>b.studentId===student.id&&b.year===a.year))),
        'Otro estudiante matriculado ya tiene ese nombre; revisar fichas duplicadas antes de guardar');
      if(scopedStudent)requireThat(p.studentCheck.nie===student.nie&&p.studentCheck.name===student.name,
        'La ficha cambió desde que la abriste. Actualizá los datos antes de guardar.');
      const before={...student};
      if(student.nie!==p.nie)for(const snapshot of db.sectionResults||[]){
        const row=snapshot.rows.find(item=>item.studentId===student.id);
        if(!row)continue;
        requireThat(!snapshot.rows.some(item=>item!==row&&String(item.nie)===p.nie),
          'El nuevo NIE ya figura en el resumen de esta sección. Revisá antes de cambiarlo.');
        const references=snapshot.sourceAudit?.rows||[];
        const original=references.filter(item=>String(item.nie)===String(row.nie));
        requireThat(original.length<=1&&(!original.length||!references.some(item=>String(item.nie)===p.nie)),
          'El NIE del Excel de referencia es ambiguo. Revisá antes de cambiarlo.');
        for(const item of original)item.nie=p.nie;
        row.nie=p.nie;
      }
      student.name=p.name.trim();student.nie=p.nie;
      changedStudent=student;
      event('STUDENT_UPDATE',{before,after:student});
    } else if (action === 'archiveDuplicateEnrollment') {
      admin();
      const review = readDuplicateReview();
      requireThat(review.canArchive, review.archiveReason);
      requireThat(p.confirm === true && p.confirmNIE === review.remove.nie &&
        typeof p.reason === 'string' && p.reason.trim().length >= 10 && p.reason.trim().length <= 500,
        'Confirmá el NIE duplicado y registrá el motivo del archivo.');
      const enrollment = enrollments.find(row => row.id === review.remove.enrollmentId);
      enrollment.duplicateArchive = {
        enrollmentId: review.remove.enrollmentId, keepEnrollmentId: review.keep.enrollmentId,
        remove: review.remove, keep: review.keep, sectionId: review.sectionId, year: review.year,
        reason: p.reason.trim()
      };
      event('DUPLICATE_ENROLLMENT_ARCHIVED', enrollment.duplicateArchive);
    } else if (action === 'restoreDuplicateEnrollment') {
      admin();
      const enrollment = db.enrollments.find(row => row.id === p.enrollmentId);
      const archived = enrollment?.duplicateArchive;
      requireThat(archived,
        'No existe esa matrícula archivada.');
      requireThat(p.confirm === true && p.confirmNIE === archived.remove.nie,
        'Confirmá el NIE para reincorporar la matrícula.');
      delete enrollment.duplicateArchive;
      event('DUPLICATE_ENROLLMENT_RESTORED', archived);
    } else if(action==='deleteDuplicateEnrollment') {
      admin();
      requireThat(!archived.has(p.enrollmentId)&&!archived.has(p.keepEnrollmentId)&&![...archived.values()].some(item=>item.keepEnrollmentId===p.enrollmentId),'Una ficha archivada o vinculada solo se puede gestionar mediante el archivo de duplicados.');
      admin();
      const review=duplicateEnrollmentReview(db,p);
      requireThat(review.canDelete,'ELIMINACIÓN BLOQUEADA: '+review.reasons.join(' | '));
      requireThat(p.confirm===true&&typeof p.confirmNIE==='string'&&p.confirmNIE===review.remove.nie,
        'Escribí el NIE exacto de la ficha duplicada para confirmar.');
      const oldEnrollment=db.enrollments.find(e=>e.id===review.remove.enrollmentId);
      const oldStudent=db.students.find(s=>s.id===review.remove.studentId);
      const enrollmentSnapshot={...oldEnrollment},studentSnapshot={...oldStudent};
      const safeIds=new Set(review.cleanableGradeIds);
      const emptyRows=db.grades.filter(g=>safeIds.has(g.id)&&g.studentId===oldStudent.id);
      requireThat(emptyRows.length===safeIds.size,'La verificación de notas cambió. Revisá de nuevo antes de retirar.');
      // Si hay filas de grades, solo se retiran las comprobadas como TOTALMENTE vacías.
      // El cero es una nota y NO está incluido. Las filas retiradas se conservan en auditoría.
      db.grades=db.grades.filter(g=>!safeIds.has(g.id));
      db.enrollments=db.enrollments.filter(e=>e.id!==oldEnrollment.id);
      db.students=db.students.filter(s=>s.id!==oldStudent.id);
      event('DUPLICATE_ENROLLMENT_REMOVED',{removedEnrollment:enrollmentSnapshot,removedStudent:studentSnapshot,
        removedEmptyGradeRows:emptyRows.map(g=>JSON.parse(JSON.stringify(g))),
        keptEnrollmentId:review.keep.enrollmentId,keptStudentId:review.keep.studentId,keptNIE:review.keep.nie,
        reason:'Retiro verificado: solo registros de notas completamente vacíos, sin origen ni historial'});
    } else if(action==='updateEnrollment') {
      admin();
      const enrollment=enrollments.find(item=>item.id===p.enrollmentId);
      const from=db.sections.find(section=>section.id===enrollment?.sectionId),to=db.sections.find(section=>section.id===p.sectionId);
      requireThat(enrollment&&from&&to&&from.id!==to.id,'Seleccioná una matrícula y una sección de destino diferente.');
      requireThat(p.fromSectionId===undefined||p.fromSectionId===from.id,'La sección de origen cambió. Volvé a cotejar el Excel.');
      requireThat(![...archived.values()].some(item=>item.keepEnrollmentId===p.enrollmentId),
        'La matrícula está vinculada a un duplicado archivado. Revisá el vínculo antes del traslado.');
      const student=db.students.find(item=>item.id===enrollment.studentId);
      requireThat(student,'Matrícula sin estudiante.');
      if(scopedEnrollment){
        const expected=p.enrollmentCheck;
        requireThat(enrollment.year===expected.year&&student.nie===expected.nie&&rosterName(student.name)===rosterName(expected.name)&&
          enrollments.filter(item=>item.studentId===student.id&&item.year===expected.year).length===1&&
          db.students.filter(item=>item.nie===expected.nie).length===1,
          'Los datos cambiaron. Volvé a verificar el estudiante y la matrícula antes de trasladar.');
      }
      const duplicates=new Set(db.students.filter(item=>item.nie===student.nie||
        rosterName(item.name)===rosterName(student.name)).map(item=>item.id));
      requireThat(!enrollments.some(item=>item.id!==enrollment.id&&item.year===enrollment.year&&item.sectionId===to.id&&duplicates.has(item.studentId)),
        'Ya hay una matrícula con ese NIE o nombre en la sección de destino. Revisá el duplicado primero.');
      const before={...enrollment},results=moveEnrollmentResults(db,enrollment,from,to,student);
      enrollment.sectionId=to.id;
      changedEnrollment=enrollment;
      changedStudent=student;
      event('ENROLLMENT_UPDATE',{before,after:enrollment,results});
    } else if(action==='enroll') {
      admin();
      requireThat(typeof p.nie==='string'&&/^\d{1,20}$/.test(p.nie)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=320,'NIE o nombre inválido');
      requireThat(db.sections.some(s=>s.id===p.sectionId)&&db.years.some(y=>y.id===p.year),'Año o sección inválidos');
      requireThat(!db.students.some(s=>s.nie!==p.nie&&rosterName(s.name)===rosterName(p.name)&&
        db.enrollments.some(e=>e.studentId===s.id&&e.year===p.year)),
        'Ya existe el mismo nombre con otro NIE en este año: revisar matrícula duplicada');
      const matches=db.students.filter(s=>s.nie===p.nie);
      const existing=matches[0];
      requireThat(matches.length<=1&&(!existing||rosterName(existing.name)===rosterName(p.name)),
        'El NIE pertenece a una ficha con otro nombre. Revisá los datos antes de matricular.');
      let student=existing;
      if(scopedEnrollment){
        const registered=p.enrollmentCheck.registered;
        const valid=registered===true?matches.length===1&&rosterName(student.name)===rosterName(p.name):registered===false&&!matches.length;
        requireThat(valid&&!db.enrollments.some(e=>e.studentId===student?.id&&e.year===p.year),
          'Los datos cambiaron. Volvé a verificar el estudiante y la matrícula antes de registrar.');
      }
      if(!student){
        student={id:`s-${db.version}`,nie:p.nie,name:p.name.trim()};
        db.students.push(student);
      }
      requireThat(!db.enrollments.some(e=>e.studentId===student.id&&e.year===p.year),'Estudiante ya matriculado en ese año');
      changedStudent=student;
      changedEnrollment={id:`e-${db.version}`,studentId:student.id,year:p.year,sectionId:p.sectionId};
      db.enrollments.push(changedEnrollment);
      event('ENROLL',{studentId:student.id,year:p.year,sectionId:p.sectionId});
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
      admin();const b=db.batches.find(b=>b.id===p.batchId&&b.status==='REVIEW'&&!b.multiTeacher);requireThat(b,'Lote no disponible');const a=access(b.assignmentId);requireThat(!period(a,b.periodId),'El período está cerrado');validateTemplate(b.template,a,b.periodId);
      requireThat(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=200,'Confirmá el mapeo de estudiantes y actividades');
      const subject=db.subjects.find(s=>s.id===a.subjectId), seen=new Set();
      p.rows.forEach(r=>{requireThat(typeof r.nie==='string'&&db.students.some(s=>s.nie===r.nie),'NIE no matriculado: registrá la matrícula primero');const s=db.students.find(s=>s.nie===r.nie);requireThat(!seen.has(s.id),'NIE duplicado');seen.add(s.id);requireThat(enrollments.some(e=>e.studentId===s.id&&e.year===a.year&&e.sectionId===a.sectionId),'Matrícula no autorizada');resultFor(subject,r.values,a,b.periodId);requireThat(!gradeConflict(a,s.id,b.periodId),'Hay notas diferentes pendientes de revisión');requireThat(!locked(a,s.id,b.periodId),'Calificaciones bloqueadas');requireThat(!db.grades.some(g=>g.studentId===s.id&&g.year===a.year&&g.sectionId===a.sectionId&&g.subjectId===a.subjectId&&g.periodId===b.periodId),'Hay notas existentes: resolver antes de importar');requireThat(r.source&&['file','sheet','block','range','cell'].every(k=>typeof r.source[k]==='string')&&(!b.blockId||r.source.block===b.blockId),'Procedencia incompleta o cuadro distinto');});
      p.rows.forEach(r=>{const s=db.students.find(s=>s.nie===r.nie);db.grades.push({id:`ig-${db.grades.length}-${db.version}`,studentId:s.id,year:a.year,sectionId:a.sectionId,subjectId:a.subjectId,periodId:b.periodId,values:r.values.slice(),source:{...r.source,batch:b.id}});});b.status='IMPORTED';event('IMPORT_APPROVED',{batchId:b.id,count:p.rows.length});
    } else if(action==='revertImport') {
      admin();const b=db.batches.find(b=>b.id===p.batchId&&b.status==='IMPORTED');requireThat(b,'Lote no importado');
      if(b.bulk){const grades=db.grades.filter(g=>g.source?.batch===b.id);for(const g of grades){const a=access(g.source.assignmentId);requireThat(a.year===g.year&&a.sectionId===g.sectionId&&a.subjectId===g.subjectId,'La asignación de la carga cambió');requireThat(!period(a,g.periodId),'El período está cerrado');}}
      else{const a=access(b.assignmentId);requireThat(!period(a,b.periodId),'El período está cerrado');}
      requireThat(!db.grades.some(g=>g.source?.batch===b.id&&locked(g,g.studentId,g.periodId)),'La carga contiene calificaciones bloqueadas');requireThat(!db.audit.some(e=>e.kind==='GRADE'&&db.grades.some(g=>g.source?.batch===b.id&&g.id===e.detail.gradeId)),'Hay modificaciones posteriores: requiere revisión manual');db.grades=db.grades.filter(g=>g.source?.batch!==b.id);b.status='REVERTED';event('IMPORT_REVERTED',{batchId:b.id});
    } else fail('Operación desconocida');
    db.version++;
    if(action==='saveGrades'&&p.returnWorkbook===true){
      const workbook=operate(db,email,'teacherWorkbook',{assignmentId:p.assignmentId},{...context,gradeIndex:undefined});
      return {ok:true,version:db.version,workbook};
    }
    return {ok:true,version:db.version,...(changedStudent?{student:{...changedStudent}}:{}),
      ...(changedEnrollment?{enrollment:{...changedEnrollment}}:{})};
  }
  function execute(db,email,action,p={},context={}){
    if(readActions.includes(action))return JSON.parse(JSON.stringify(operate(db,email,action,p,context)));
    // The most frequent writes have a bounded set of mutable tables. Keep the previous
    // table references for the atomic storage diff and for rollback if validation fails.
    const mutable={
      saveGrades:['grades','sectionResults','audit'],
      enroll:['students','enrollments','audit'],
      student:['students','sectionResults','audit'],
      updateEnrollment:['enrollments','grades','moduleFinals','recoveries','gradeLocks','sectionResults','audit']
    }[action];
    const staged=mutable?{...db}:JSON.parse(JSON.stringify(db));
    if(mutable)for(const table of mutable){
      const records=db[table]||[];
      staged[table]=table==='audit'?records.slice():JSON.parse(JSON.stringify(records));
    }
    for(const table of optionalTables)if(!staged[table])staged[table]=[];
    const result=operate(staged,email,action,p,context);
    Object.assign(db,staged);
    return result;
  }
  return {tables,optionalTables,readActions,BASIC_PASS_MARK,TECHNICAL_PASS_MARK,firstYearAccountingModuleLinks,lifeProjectSlot,sectionSlotKey,orderSectionColumns,isMoralSubject,isConductCriterion,moduleOnlySection,moduleSectionSubject,periodOnlySubject,seed,execute,calculate,evaluate,missingAnnualFromPeriods,evaluationFor,formatGrade,formatSubjectFinal,categoryOf,moduleIdentity,orderedConsolidatedColumns,subjectTitle,annual,finalResult,technicalResult,completion,reportFromWorkbook};
})();
if(typeof module!=='undefined') module.exports=Genesis;
