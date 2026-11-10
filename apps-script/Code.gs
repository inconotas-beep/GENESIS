function doGet(event){
 const params=event?.parameter||{};
 if(params.code||params.state||params.error){
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
 return HtmlService.createHtmlOutputFromFile('Index').setTitle('GENESIS · INCO');
}
function publicError_(message){const error=Error(message);error.genesisPublic=true;return error;}
function loadDatabase_(){return GoogleStorage.load();}
function saveDatabase_(db,before){return GoogleStorage.save(db,before);}
function api(action,params,authToken){
 if(action==='authConfig')return GoogleOAuth.settings();
 if(action==='authStart')return GoogleOAuth.start();
 if(action==='authPoll')return GoogleOAuth.poll(params||{});
 if(action==='authLogout')return GoogleOAuth.logout(authToken);
 const email=GoogleConfig.identity(authToken);
 GoogleConfig.access();
 if(typeof GooglePilot!=='undefined'){GooglePilot.authorize(email,action);if(action==='pilotIdentity')return GooglePilot.identity(email);}
 return GoogleConfig.lock(()=>{
  try{
   const db=loadDatabase_(),p=params||{};
   // The same core authenticates the account, even for supplemental Google operations.
   const actor=GoogleAccounts.authenticate(db,email);
   if(action==='credentials')throw publicError_('En Google se utilizan cuentas institucionales, no contraseñas locales');
   if(action==='rosterReview'){GoogleConfig.admin(db,email);return GoogleDrive.rosterReview();}
   if(action==='xlsxPreview')return xlsxPreview_(db,email,p);
   if(action==='googleAccount')return googleAccount_(db,email,p);
   const before=JSON.parse(JSON.stringify(db));
   const result=Genesis.execute(db,email,action,p,{id:()=>Utilities.getUuid()});
   if(action==='teacher')for(const user of db.users){const previous=before.users.find(u=>u.id===user.id);if(!previous||previous.email!==user.email){GoogleAccounts.mark(user,user.email,actor.id,false);db.audit.push({id:Utilities.getUuid(),at:new Date().toISOString(),userId:actor.id,kind:'GOOGLE_IDENTITY_PENDING',detail:{userId:user.id,reason:previous?'CONTACT_EMAIL_CHANGED':'NEW_ACCOUNT'}});}}
   if(action==='bootstrap'&&GoogleConfig.property('ENVIRONMENT',false)==='PILOT'){result.environment='PILOT';result.pilotId=GoogleConfig.property('PILOT_ID');}
   if(action==='export')GoogleDrive.exportGroup(result,actor,p);
   if(!Genesis.readActions.includes(action)){
    if(!db.users.some(u=>u.active&&u.role==='ADMIN'&&GoogleAccounts.confirmed(u)))throw publicError_('Debe conservarse una administradora activa con cuenta institucional confirmada');
    saveDatabase_(db,before);
   }
   return JSON.parse(JSON.stringify(result));
  }catch(error){if(error.genesisPublic)throw error;throw publicError_('No se pudo completar la operación. Contactá con administración');}
 });
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
