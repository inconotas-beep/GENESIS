var GoogleDrive=(()=>{
 function mode(){const value=GoogleConfig.property('STORAGE_MODE',false)||'OWNER_PRIVATE';if(!['OWNER_PRIVATE','INSTITUTIONAL_SHARED'].includes(value))throw publicError_('Modo de almacenamiento inválido');return value;}
 function storageOwner(){const email=GoogleConfig.property(mode()==='INSTITUTIONAL_SHARED'?'STORAGE_OWNER_EMAIL':'ADMIN_EMAIL').trim().toLowerCase();if(!GoogleConfig.domainEmail(email))throw publicError_('Cuenta propietaria del almacenamiento inválida');return email;}
 function requireStorageExecutor(){
  if(mode()!=='INSTITUTIONAL_SHARED')return;
  let email;try{email=Session.getEffectiveUser().getEmail().trim().toLowerCase();}catch{throw publicError_('No se pudo verificar la cuenta técnica del almacenamiento');}
  if(email!==storageOwner())throw publicError_('El almacenamiento debe ejecutarse con la cuenta institucional propietaria. No se crean archivos con la cuenta Gmail');
 }
 function driveRead(path,query){
  let response;try{response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+path+'?'+Object.entries(query).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&'),{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false});}catch{throw publicError_('No se pudieron comprobar los permisos del almacenamiento');}
  if(response.getResponseCode()!==200)throw publicError_('No se pudieron comprobar los permisos del almacenamiento');
  try{return JSON.parse(response.getContentText());}catch{throw publicError_('Respuesta de permisos de almacenamiento inválida');}
 }
 function institutionalItem(item){
  const rootId=GoogleConfig.property('ROOT_FOLDER_ID'),owner=storageOwner(),admin=GoogleConfig.property('ADMIN_EMAIL').trim().toLowerCase(),allowed=new Set([owner,admin]),visited=new Set();
  let id=item.getId();
  for(let depth=0;depth<32;depth++){
   if(!/^[A-Za-z0-9_-]{3,256}$/.test(id)||visited.has(id))throw publicError_('Ubicación del almacenamiento inválida');visited.add(id);
   const metadata=driveRead(encodeURIComponent(id),{fields:'id,mimeType,trashed,driveId,owners(emailAddress),parents,capabilities(canEdit)',supportsAllDrives:'true'});
   if(metadata.id!==id||metadata.trashed||metadata.driveId||metadata.owners?.length!==1||metadata.owners[0].emailAddress?.toLowerCase()!==owner||metadata.capabilities?.canEdit!==true)throw publicError_('El recurso debe pertenecer a la cuenta institucional y permitir edición a la cuenta técnica');
   const access=driveRead(encodeURIComponent(id)+'/permissions',{fields:'permissions(type,role,emailAddress,deleted,pendingOwner),nextPageToken',pageSize:'100',supportsAllDrives:'true'});
   if(!Array.isArray(access.permissions)||!access.permissions.some(p=>!p.deleted&&p.type==='user'&&p.role==='owner'&&String(p.emailAddress||'').toLowerCase()===owner)||access.nextPageToken||access.permissions.some(p=>!p.deleted&&(p.type!=='user'||!allowed.has(String(p.emailAddress||'').toLowerCase())||p.pendingOwner||!['owner','writer','reader'].includes(p.role)||p.role==='owner'&&String(p.emailAddress).toLowerCase()!==owner)))throw publicError_('El almacenamiento solo puede compartirse con la cuenta institucional y la administradora autorizadas');
   if(id===rootId){if(metadata.mimeType!=='application/vnd.google-apps.folder')throw publicError_('La raíz del almacenamiento debe ser una carpeta');return item;}
   if(metadata.parents?.length!==1)throw publicError_('El recurso no pertenece a la carpeta de GENESIS');id=metadata.parents[0];
  }
  throw publicError_('No se pudo comprobar la ubicación del recurso en GENESIS');
 }
 function privateItem(item){if(mode()==='INSTITUTIONAL_SHARED')return institutionalItem(item);if(item.getSharingAccess()!==DriveApp.Access.PRIVATE||item.getEditors().length||item.getViewers().length)throw publicError_('El recurso institucional debe ser privado');return item;}
 function folder(property){return privateItem(DriveApp.getFolderById(GoogleConfig.property(property)));}
 function createFile(property,blob){requireStorageExecutor();const file=folder(property).createFile(blob);return mode()==='INSTITUTIONAL_SHARED'?privateItem(file):file;}
 function json(property,name,value){return createFile(property,Utilities.newBlob(JSON.stringify(value),'application/json',name));}
 function backup(db){const file=json('BACKUPS_FOLDER_ID','GENESIS-v'+db.version+'-'+Utilities.getUuid()+'.json',{schema:'GENESIS_SNAPSHOT_V2',environment:GoogleConfig.property('ENVIRONMENT',false),createdAt:new Date().toISOString(),database:db});PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_ID',file.getId());return file.getId();}
 function exportGroup(data,actor,params){const file=json('EXPORTS_FOLDER_ID','GENESIS-grupo-'+Utilities.getUuid()+'.json',{createdAt:new Date().toISOString(),actorId:actor.id,assignmentId:params.assignmentId,periodId:params.periodId,data});return file.getId();}
 function rosterReview(){const id=GoogleConfig.property('ROSTER_REVIEW_FILE_ID');const rows=JSON.parse(privateItem(DriveApp.getFileById(id)).getBlob().getDataAsString('UTF-8')).pending;if(!Array.isArray(rows))throw publicError_('El archivo de revisión de matrículas no es válido');return {rows:rows.filter(r=>r.nie).map(r=>({nie:r.nie,choices:[...new Map(r.rows.map(c=>[c.name+'|'+c.sectionId,{name:c.name,section:c.sectionId}])).values()]}))};}
 return {mode,storageOwner,requireStorageExecutor,privateItem,folder,createFile,json,backup,exportGroup,rosterReview};
})();
