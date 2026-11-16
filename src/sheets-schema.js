/* Lossless storage codec. Indexed columns are projections, not an editable second database. */
var GoogleSchema=(()=>{
 const fields={years:['id','label'],students:['id','nie','name'],enrollments:['id','studentId','year','sectionId'],sections:['id','name','grade'],teachers:['id','userId','name'],users:['id','email','name','role','active'],roles:['id'],assignments:['id','teacherId','year','sectionId','subjectId','active'],subjects:['id','name','type','decimals'],periods:['id','year','name'],blocks:['id','type'],activities:['id','blockId','index'],weights:['id','status'],grades:['id','studentId','year','sectionId','subjectId','periodId'],recoveries:['id','studentId','year','sectionId','subjectId','periodId'],periodStates:['year','periodId','closed'],audit:['id','at','userId','kind'],batches:['id','hash','status','owner'],incidents:['id','kind','status','year','sectionId','subjectId','studentId']};
 Object.assign(fields,{specialties:['id','name'],academicFrames:['id','specialtyId','number','name'],frameLinks:['id','frameId','year','sectionId','subjectId','periodId'],evaluationPolicies:['id','year','sectionId','subjectId','periodId','count','mode'],gradeLocks:['id','studentId','year','sectionId','subjectId','periodId','active']});
 fields.moduleFinals=['id','studentId','year','sectionId','subjectId'];
 const optionalTables=['specialties','academicFrames','frameLinks','evaluationPolicies','gradeLocks','moduleFinals'];
 const fail=message=>{const error=Error(message);error.genesisPublic=true;throw error;};
 function normalize(db){const result=JSON.parse(JSON.stringify(db));for(const table of optionalTables)if(result[table]===undefined)result[table]=[];return result;}
 const project=(record,field)=>record[field]===undefined||record[field]===null?'':String(record[field]);
 const key=(table,record,index)=>table==='periods'?JSON.stringify([record.year,record.id]):table==='periodStates'?JSON.stringify([record.year,record.periodId]):record.id!==undefined?String(record.id):'legacy-'+index;
 function encode(table,records){
  if(!fields[table]||!Array.isArray(records))fail('Tabla inválida');
  const serialized=records.map(record=>JSON.stringify(record)),chunks=serialized.reduce((max,text)=>Math.max(max,Math.ceil(text.length/40000)),1);
  const header=['_key',...fields[table],...Array.from({length:chunks},(_,i)=>'_json'+i)];
  const rows=records.map((record,i)=>[key(table,record,i),...fields[table].map(field=>project(record,field)),...Array.from({length:chunks},(_,n)=>serialized[i].slice(n*40000,(n+1)*40000))]);
  if(new Set(rows.map(row=>row[0])).size!==rows.length)fail('Identificadores repetidos en '+table);
  return [header,...rows];
 }
 function decode(table,values){
  if(!values.length)fail('Falta la tabla '+table);
  const header=values[0],start=1+fields[table].length;
  if(JSON.stringify(header.slice(0,start))!==JSON.stringify(['_key',...fields[table]])||header[start]!=='_json0'||header.slice(start).some((name,i)=>name!=='_json'+i))fail('Estructura inválida en '+table);
  if(values.slice(1).some(row=>(row[0]===''||row[0]===undefined)&&row.some(value=>value!==''&&value!==undefined&&value!==null)))fail('Registro sin clave en '+table+'; se conserva para revisión');
  const records=values.slice(1).filter(row=>row[0]!==''&&row[0]!==undefined).map(row=>{
   let record;try{record=JSON.parse(row.slice(start).join(''));}catch{fail('Registro incompleto en '+table);}
   if(fields[table].some((field,i)=>project(record,field)!==String(row[i+1]??'')))fail('Edición externa detectada en '+table);
   return record;
  });
  const encoded=encode(table,records);if(values.slice(1).filter(row=>row[0]!==''&&row[0]!==undefined).some((row,i)=>String(row[0])!==encoded[i+1][0]))fail('Clave inválida en '+table);
  return records;
 }
 function validate(db){
  db=normalize(db);
  if(!Number.isSafeInteger(db.version)||db.version<0)fail('Versión inválida');
  for(const table of Object.keys(fields))encode(table,db[table]);
  const has=(table,id)=>db[table].some(record=>record.id===id);
  const check=(ok,table)=>{if(!ok)fail('Relación inválida en '+table);};
  db.users.forEach(user=>check(['ADMIN','TEACHER','DIRECTION'].includes(user.role)&&typeof user.active==='boolean','users'));
  db.teachers.forEach(record=>check(has('users',record.userId)&&record.id===record.userId,'teachers'));
  db.enrollments.forEach(record=>check(has('students',record.studentId)&&has('years',record.year)&&has('sections',record.sectionId),'enrollments'));
  db.assignments.forEach(record=>check(has('teachers',record.teacherId)&&has('sections',record.sectionId)&&has('subjects',record.subjectId)&&has('years',record.year),'assignments'));
  db.periods.forEach(record=>check(has('years',record.year),'periods'));
  db.periodStates.forEach(record=>check(db.periods.some(p=>p.year===record.year&&p.id===record.periodId),'periodStates'));
  db.grades.forEach(record=>check(has('students',record.studentId)&&has('subjects',record.subjectId)&&db.enrollments.some(e=>e.studentId===record.studentId&&e.year===record.year&&e.sectionId===record.sectionId)&&db.periods.some(p=>p.year===record.year&&p.id===record.periodId),'grades'));
  const moduleKeys=new Set();
  db.moduleFinals.forEach(record=>{
   const key=JSON.stringify([record.year,record.sectionId,record.subjectId,record.studentId]);
   check(!moduleKeys.has(key)&&db.subjects.some(s=>s.id===record.subjectId&&s.type==='MODULO_FASES')&&
     db.enrollments.some(e=>e.studentId===record.studentId&&e.year===record.year&&e.sectionId===record.sectionId)&&
     Array.isArray(record.values)&&record.values.length===9&&record.values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10)&&
     Array.isArray(record.weights)&&record.weights.length===3&&record.weights.every(w=>typeof w==='number'&&Number.isFinite(w)&&w>=0)&&
     Math.abs(record.weights.reduce((sum,w)=>sum+w,0)-1)<1e-10,'moduleFinals');
   moduleKeys.add(key);
  });
  db.sections.forEach(record=>check(!record.specialtyId||has('specialties',record.specialtyId),'sections.specialtyId'));
  for(const section of db.sections){
   const rules=section.reportSubjects;if(rules===undefined)continue;
   check(Array.isArray(rules),'sections.reportSubjects');
   const keys=new Set();
   for(const rule of rules){
    const key=JSON.stringify([rule?.year,rule?.periodId]);
    check(rule&&db.periods.some(p=>p.year===rule.year&&p.id===rule.periodId)&&!keys.has(key)&&Array.isArray(rule.subjectIds)&&new Set(rule.subjectIds).size===rule.subjectIds.length&&rule.subjectIds.every(id=>has('subjects',id)),'sections.reportSubjects');
    keys.add(key);
   }
  }
  db.academicFrames.forEach(record=>check(has('specialties',record.specialtyId)&&Number.isInteger(record.number)&&record.number>=1&&record.number<=5,'academicFrames'));
  const scoped=record=>has('years',record.year)&&has('sections',record.sectionId)&&has('subjects',record.subjectId)&&db.periods.some(p=>p.year===record.year&&p.id===record.periodId);
  db.frameLinks.forEach(record=>{const frame=db.academicFrames.find(f=>f.id===record.frameId);check(scoped(record)&&!!frame&&db.sections.some(s=>s.id===record.sectionId&&s.specialtyId===frame.specialtyId),'frameLinks');});
  db.evaluationPolicies.forEach(record=>check(scoped(record)&&record.mode==='WEIGHTED'&&Number.isInteger(record.count)&&record.count>=1&&record.count<=5&&Array.isArray(record.weights)&&record.weights.length===record.count&&record.weights.every(w=>typeof w==='number'&&Number.isFinite(w)&&w>=0)&&Math.abs(record.weights.reduce((a,b)=>a+b,0)-1)<1e-10,'evaluationPolicies'));
  db.gradeLocks.forEach(record=>check(scoped(record)&&typeof record.active==='boolean'&&db.enrollments.some(e=>e.studentId===record.studentId&&e.year===record.year&&e.sectionId===record.sectionId),'gradeLocks'));
  for(const table of ['frameLinks','evaluationPolicies','gradeLocks']){const keys=db[table].filter(record=>table!=='gradeLocks'||record.active).map(record=>JSON.stringify([...(table==='frameLinks'?[record.frameId]:[]),record.year,record.sectionId,record.subjectId,record.periodId,...(table==='gradeLocks'?[record.studentId]:[])]));check(new Set(keys).size===keys.length,table);}
  if(new Set(db.users.map(user=>String(user.email).toLowerCase())).size!==db.users.length)fail('Correos duplicados');
  return db;
 }
 return {fields,optionalTables,key,encode,decode,validate,normalize};
})();
