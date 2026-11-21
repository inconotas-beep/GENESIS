function doGet(event){
 const params=event?.parameter||{};
 const native=typeof NativeLogin!=='undefined'&&NativeLogin.enabled();
 if((params.code||params.state||params.error)&&!native){
  try{GoogleOAuth.callback(params);}
  catch(error){
   const detail=GoogleOAuth.failureDetail(error);
   return HtmlService.createHtmlOutput('<!doctype html><html lang="es"><meta name="referrer" content="no-referrer"><title>GENESIS · Google</title><body><h1>GENESIS</h1><p>'+detail.message+'</p><p>Diagnóstico: '+detail.code+'</p></body></html>');
  }
  const resumeUrl=GoogleConfig.property('GOOGLE_OAUTH_REDIRECT_URI').trim()+'?resume='+encodeURIComponent(params.state);
  return HtmlService.createHtmlOutput(`<!doctype html>
<html lang="es">
<head>
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <meta name="referrer" content="no-referrer">
 <title>GENESIS · Google</title>
 <style>
  body{margin:0;background:#f3f6fb;color:#152642;font:1rem/1.5 system-ui,sans-serif}
  main{max-width:28rem;margin:clamp(1rem,8vh,5rem) auto;padding:clamp(1.25rem,5vw,2rem);background:#fff;border:1px solid #d6e0ef;border-radius:1rem}
  h1{margin:0;font-size:1.75rem}
  .continue{display:inline-block;padding:.8rem 1.2rem;border-radius:.6rem;background:#174b9e;color:#fff;font-weight:650;text-decoration:none}
  .continue:focus-visible{outline:3px solid #152642;outline-offset:3px}
 </style>
</head>
<body>
 <main>
  <h1>GENESIS</h1>
  <p>Google verificó tu identidad. Continuá para completar el ingreso.</p>
  <a class="continue" id="continue" href="${resumeUrl}" target="_top" role="button">Has accedido a GENESIS</a>
  <p id="return-hint" role="status" hidden>Volvé a la pestaña de GENESIS donde iniciaste sesión para continuar.</p>
 </main>
 <script>
  document.getElementById('continue').addEventListener('click',event=>{
   try{
    const pending=JSON.parse(localStorage.getItem('genesis-google-pending'));
    if(pending?.flowId===${JSON.stringify(params.state)}&&pending.expiresAt>Date.now())return;
   }catch{}
   event.preventDefault();
   document.getElementById('return-hint').hidden=false;
   try{window.top.close();}catch{}
  });
  document.getElementById('continue').addEventListener('keydown',event=>{
   if(event.key===' '){event.preventDefault();event.currentTarget.click();}
  });
 </script>
</body>
</html>`);
 }
 const page=HtmlService.createHtmlOutputFromFile('Index');
 if(native)page.setContent(page.getContent().replace(/<body(?=[\s>])/i,'<body data-genesis-login="password"'));
 return page.setTitle('GENESIS · INCO');
}
function publicError_(message){const error=Error(message);error.genesisPublic=true;return error;}
function loadDatabase_(){return GoogleStorage.load();}
function saveDatabase_(db,before){return GoogleStorage.save(db,before);}
const nativeMenuTables_={
 overview:[],tools:[],admin:[],subjectTeachers:[],sectionTeachers:[],teacherSubjects:[],
 catalog:['students','enrollments'],documents:['specialties','academicFrames','frameLinks'],
 frames:['specialties','academicFrames','frameLinks'],periods:['weights','enrollments','grades','moduleFinals','incidents','evaluationPolicies'],
 imports:['batches','specialties'],settings:['weights','evaluationPolicies','grades','moduleFinals','audit','incidents'],
 subjects:['grades','moduleFinals','audit','incidents'],audit:['audit','incidents','batches','students']
};
const nativeCommonTables_=['users','teachers','years','sections','subjects','assignments','periods','periodStates'];
const nativeResultTables_=['students','enrollments','weights','grades','incidents','gradeLocks','evaluationPolicies','moduleFinals','sectionResults','specialties','academicFrames','frameLinks'];
const nativeResultActions_=['teacherWorkbook','roster','consolidated','reportCard','sectionReportCards','frame','reportOptions',
 'sectionResultBackup','checkSectionResult','teacherExportFiles','teacherExportSection','sectionWorkbook','teacherImportWorkbook'];
const nativeSectionReads_=['consolidated','reportCard','sectionReportCards','frame','reportOptions','checkSectionResult','sectionWorkbook','teacherExportSection'];
const nativeRosterActions_=['teacherWorkbook','roster','sectionWorkbook','teacherImportWorkbook'];
function api(action,params,authToken){
 const native=typeof NativeLogin!=='undefined'&&NativeLogin.enabled();
 if(native){
  if(action==='authConfig')return {mode:'PASSWORD'};
  if(action==='nativeLogin')return NativeLogin.login(params,params?.withOverview===true?nativeCommonTables_:null);
  if(action==='authLogout')return NativeLogin.logout(authToken);
  if(action==='authStart'||action==='authPoll'||action==='googleAccount')throw publicError_('Usá tu cuenta de GENESIS');
  NativeLogin.session(authToken);
 }
 if(action==='authConfig')return GoogleOAuth.settings();
 if(action==='authStart')return GoogleOAuth.start();
 if(action==='authPoll')return GoogleOAuth.poll(params||{});
 if(action==='authLogout')return GoogleOAuth.logout(authToken);
 if(action==='nativeUserCreate'&&!native)throw publicError_('El acceso con usuario de GENESIS no está habilitado en este proyecto');
 const googleEmail=native?null:GoogleConfig.identity(authToken);
 GoogleConfig.access();
 if(!native&&typeof GooglePilot!=='undefined'){GooglePilot.authorize(googleEmail,action);if(action==='pilotIdentity')return GooglePilot.identity(googleEmail);}
 const readOnly=Genesis.readActions.includes(action);
 const concurrentRead=readOnly&&action!=='export';
 const workbookAfterSave=action==='saveGrades'&&params?.returnWorkbook===true;
 let savedWorkbookContext;
 const execute=()=>{
  try{
   const p=params||{},partial=native&&action==='bootstrap'&&Object.hasOwn(nativeMenuTables_,p.view);
   let db;
   if(partial)db=GoogleStorage.loadSubset([...nativeCommonTables_,...nativeMenuTables_[p.view]]);
   else if(native&&action==='notices'){
    const current=GoogleStorage.loadSubset(['users']);
    db=p.knownVersion===current.version?current:GoogleStorage.loadSubset([...nativeCommonTables_,'enrollments','grades','moduleFinals','incidents','evaluationPolicies']);
   }
   else if(native&&action==='nativeAccount')db=GoogleStorage.loadSubset(['users']);
   else if(native&&action==='teacherExportIndex')db=GoogleStorage.loadSubset(['users','assignments','years','sections']);
   else if(native&&(action==='sectionResultBackup'||action==='teacherExportFiles')){
    const directory=GoogleStorage.loadSubset(['users','assignments','years']);
    const exporter=NativeLogin.actor(directory,authToken);
    if(exporter.role!=='ADMIN')throw publicError_('Solo administración puede realizar esta operación');
    let sectionIds;
    if(action==='sectionResultBackup'){
     if(typeof p.sectionId!=='string'||typeof p.year!=='string')throw publicError_('Elegí año y sección para descargar el Excel.');
     sectionIds=[p.sectionId];
    }else{
     if(!Array.isArray(p.teacherIds)||p.teacherIds.length<1||p.teacherIds.length>4)throw publicError_('Selección de docentes inválida');
     const selected=new Set(p.teacherIds);
     sectionIds=[...new Set(directory.assignments.filter(a=>a.active&&a.year===p.year&&selected.has(a.teacherId)).map(a=>a.sectionId))];
    }
    db=GoogleStorage.loadSubset([...nativeCommonTables_,...nativeResultTables_],{year:p.year,sectionIds});
    if(db.version!==directory.version){
     const error=publicError_('Las notas cambiaron mientras se preparaba el archivo. Volvé a exportar.');
     error.genesisSnapshotChanged=true;
     throw error;
    }
   }
   else if(native&&nativeResultActions_.includes(action)){
    const tables=nativeRosterActions_.includes(action)?nativeResultTables_.filter(table=>!['academicFrames','frameLinks'].includes(table)):nativeResultTables_;
    if(action==='teacherWorkbook'||action==='roster'){
     const directory=GoogleStorage.loadSubset(['users','assignments']);
     const actor=NativeLogin.actor(directory,authToken);
     const assignment=directory.assignments.find(item=>item.id===p.assignmentId&&item.active);
     if(!assignment||actor.role==='TEACHER'&&assignment.teacherId!==actor.id)
      throw publicError_('Acceso denegado: asignación no autorizada');
     db=GoogleStorage.loadSubset([...nativeCommonTables_,...tables],{year:assignment.year,sectionIds:[assignment.sectionId]});
     if(db.version!==directory.version){
      const error=publicError_('El cuadro cambió mientras se cargaba. Volvé a abrir el grupo.');
      error.genesisSnapshotChanged=true;
      throw error;
     }
    }else{
     const scope=nativeSectionReads_.includes(action)&&typeof p.year==='string'&&typeof p.sectionId==='string'?
       {year:p.year,sectionIds:[p.sectionId]}:undefined;
     db=GoogleStorage.loadSubset([...nativeCommonTables_,...tables],scope);
    }
   }
   else db=loadDatabase_();
   // The same core authenticates the account, even for supplemental Google operations.
   const actor=native?NativeLogin.actor(db,authToken):GoogleAccounts.authenticate(db,googleEmail);
   const email=actor.email;
   if(native&&action==='nativeAccount')return NativeLogin.set(db,actor,p);
   if(native&&action==='nativeUserCreate')return NativeLogin.create(db,actor,p,saveDatabase_);
   if(native&&action==='bootstrap')return Genesis.execute(db,email,action,partial?{view:p.view}:{});
   if(action==='credentials')throw publicError_('En Google se utilizan cuentas institucionales, no contraseñas locales');
   if(action==='rosterReview'){if(actor.role!=='ADMIN')throw publicError_('Solo administración puede realizar esta operación');return GoogleDrive.rosterReview();}
   if(action==='xlsxPreview')return xlsxPreview_(db,email,p);
   if(action==='googleAccount')return googleAccount_(db,email,p);
   // Genesis applies writes to a staged database and then replaces its tables.
   const before=readOnly?null:{...db};
   const result=Genesis.execute(db,email,action,workbookAfterSave?{...p,returnWorkbook:false}:p,{id:()=>Utilities.getUuid()});
   if(action==='teacher')for(const user of db.users){const previous=before.users.find(u=>u.id===user.id);if(!previous||previous.email!==user.email){GoogleAccounts.mark(user,user.email,actor.id,false);db.audit.push({id:Utilities.getUuid(),at:new Date().toISOString(),userId:actor.id,kind:'GOOGLE_IDENTITY_PENDING',detail:{userId:user.id,reason:previous?'CONTACT_EMAIL_CHANGED':'NEW_ACCOUNT'}});}}
   if(action==='bootstrap'&&GoogleConfig.property('ENVIRONMENT',false)==='PILOT'){result.environment='PILOT';result.pilotId=GoogleConfig.property('PILOT_ID');}
   if(action==='export')GoogleDrive.exportGroup(result,actor,p);
   if(!readOnly&&result.unchanged!==true){
    const hasAdmin=native?NativeLogin.hasActiveAdmin(db):db.users.some(u=>u.active&&u.role==='ADMIN'&&GoogleAccounts.confirmed(u));
    if(!hasAdmin)throw publicError_('Debe conservarse una cuenta administradora activa con acceso');
    saveDatabase_(db,before);
   }
   if(workbookAfterSave)savedWorkbookContext={db,email,assignmentId:p.assignmentId};
   return result;
  }catch(error){if(error.genesisPublic)throw error;throw publicError_('No se pudo completar la operación. Contactá con administración');}
 };
 if(concurrentRead){
  try{return execute();}
  catch(error){
   if(!error.genesisSnapshotChanged)throw error;
   // A scoped read that crosses a commit may retry once against a stable version.
   return GoogleConfig.lock(execute);
  }
 }
 const result=GoogleConfig.lock(execute);
 if(savedWorkbookContext){
  const {db,email,assignmentId}=savedWorkbookContext;
  try{result.workbook=Genesis.execute(db,email,'teacherWorkbook',{assignmentId});}
  catch(error){console.warn('No se pudo volver a cargar el cuadro después del guardado');}
 }
 return result;
}
function googleAccount_(db,email,p){
 const actor=GoogleConfig.admin(db,email),target=db.users.find(u=>u.id===p.userId);
 if(!target||typeof p.confirmed!=='boolean')throw publicError_('Indicá si el correo institucional fue confirmado');
 const nextEmail=typeof p.email==='string'?p.email.trim().toLowerCase():'';
 if(p.confirmed&&(!GoogleConfig.domainEmail(nextEmail)||db.users.some(u=>u.id!==target.id&&String(u.email).toLowerCase()===nextEmail)))throw publicError_('Cuenta institucional inválida o repetida');
 const before=JSON.parse(JSON.stringify(db)),previousEmail=target.email;
 const result=Genesis.execute(db,email,'userRole',{version:p.version,userId:p.userId,role:p.role,active:p.active},{id:()=>Utilities.getUuid()});
 GoogleAccounts.mark(db.users.find(u=>u.id===p.userId),nextEmail,actor.id,p.confirmed);
 if(!db.users.some(u=>u.active&&u.role==='ADMIN'&&GoogleAccounts.confirmed(u)))throw publicError_('Debe conservarse una administradora activa con cuenta institucional confirmada');
 db.audit.push({id:Utilities.getUuid(),at:new Date().toISOString(),userId:actor.id,kind:'GOOGLE_ACCOUNT',detail:{userId:p.userId,beforeEmail:previousEmail,afterEmail:db.users.find(u=>u.id===p.userId).email,confirmed:p.confirmed}});
 saveDatabase_(db,before);return result;
}
function xlsxPreview_(db,email,p){
 const bootstrap=Genesis.execute(db,email,'bootstrap');if(bootstrap.user.role==='DIRECTION')throw publicError_('Dirección tiene acceso de consulta');
 const roster=Genesis.execute(db,email,'roster',p);if(roster.closed)throw publicError_('El período está cerrado');
 if(typeof p.content!=='string'||p.content.length>8000000||typeof p.name!=='string'||!/^.+\.xlsx$/i.test(p.name))throw publicError_('Archivo inválido o demasiado grande');
 const bytes=Utilities.base64Decode(p.content);if(bytes.length>6000000)throw publicError_('El archivo supera el tamaño permitido');
 const name=p.name.split(/[\\/]/).pop().slice(0,180);let preview;
 try{preview=GoogleXlsx.inspectBook(bytes,name,{privateRows:true});}catch{throw publicError_('No se pudo leer el archivo Excel. Revisá su formato o usá la previsualización JSON institucional');}
  const document=GoogleDrive.createFile('DOCUMENTS_FOLDER_ID',Utilities.newBlob(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',Utilities.getUuid()+'-'+name));
 preview.documentId=document.getId();return preview;
}
