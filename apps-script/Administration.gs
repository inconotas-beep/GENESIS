/* Private operations end in _. The visible setup entry verifies the actual administrator. */
function configurarDriveInconotas(){
 if(arguments.length||GoogleConfig.editorIdentity()!=='inconotas@gmail.com')throw publicError_('Ejecutá la configuración desde el editor con inconotas@gmail.com, sin parámetros');
 return configurarDriveInconotas_();
}
function recuperarImportacionInconotas(){
 if(arguments.length||GoogleConfig.editorIdentity()!=='inconotas@gmail.com')throw publicError_('Ejecutá la recuperación desde el editor con inconotas@gmail.com, sin parámetros');
 return recuperarImportacionInconotas_();
}
function requireProvisioningApproval_(){
 const email=requireResponsibleAccount_();GoogleDrive.requireStorageExecutor();if(GoogleConfig.property('PROVISIONING_APPROVED')!=='YES')throw publicError_('Falta autorización explícita de administración para preparar recursos');return email;
}
function requireResponsibleAccount_(){const email=GoogleConfig.editorIdentity(),allowed=[GoogleConfig.property('ADMIN_EMAIL').trim().toLowerCase()];if(GoogleDrive.mode()==='INSTITUTIONAL_SHARED')allowed.push(GoogleDrive.storageOwner());if(!allowed.includes(email))throw publicError_('Solo la cuenta responsable puede realizar esta operación');return email;}
function prepareGoogleResources_(){
 requireProvisioningApproval_();return GoogleConfig.lock(()=>GoogleProvisioning.ensure());
}
function connectPersonalStorage_(plan){
 const email=GoogleConfig.editorIdentity();
 if(email!=='inconotas@gmail.com'||plan?.owner!==email)throw publicError_('Ejecutá la conexión desde el editor con inconotas@gmail.com');
 const props=PropertiesService.getScriptProperties();if(props.getProperty('ACCESS_ENABLED')==='YES')throw publicError_('Deshabilitá el acceso académico antes de conectar el almacenamiento');
 const keys=['ROOT_FOLDER_ID','BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID','SPREADSHEET_ID','IMPORT_FILE_ID'];
 if(!/^[a-f0-9-]{36}$/.test(plan.token)||!/^[a-f0-9]{64}$/.test(plan.importSha256)||!plan.resources||keys.some(k=>!/^[-A-Za-z0-9_]{3,256}$/.test(plan.resources[k]||''))||new Set(keys.map(k=>plan.resources[k])).size!==keys.length)throw publicError_('Plan de conexión inválido');
 for(const key of ['SPREADSHEET_ID','BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID','IMPORT_FILE_ID'])if(props.getProperty(key)&&props.getProperty(key)!==plan.resources[key])throw publicError_('Ya hay recursos distintos configurados. Se requiere revisión; no se reemplazan');
 if(props.getProperty('PROVISIONING_TOKEN')&&props.getProperty('PROVISIONING_TOKEN')!==plan.token)throw publicError_('Hay otra preparación registrada; no se reemplaza');
 const root=plan.resources.ROOT_FOLDER_ID;
 for(const key of keys){
  const item=DriveApp[key==='SPREADSHEET_ID'||key==='IMPORT_FILE_ID'?'getFileById':'getFolderById'](plan.resources[key]);
  if(item.getId()!==plan.resources[key]||item.getOwner()?.getEmail().toLowerCase()!==email||item.getSharingAccess()!==DriveApp.Access.PRIVATE||item.getEditors().length||item.getViewers().length)throw publicError_('Los recursos deben ser privados y propiedad de inconotas@gmail.com');
  if(key!=='ROOT_FOLDER_ID'){const parents=item.getParents();if(!parents.hasNext()||parents.next().getId()!==root||parents.hasNext())throw publicError_('El recurso no está dentro de la carpeta privada de GENESIS');}
  if(key==='SPREADSHEET_ID'&&item.getMimeType()!=='application/vnd.google-apps.spreadsheet')throw publicError_('El destino de datos no es una hoja de cálculo');
 }
 const text=DriveApp.getFileById(plan.resources.IMPORT_FILE_ID).getBlob().getDataAsString('UTF-8');
 const sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
 if(sha!==plan.importSha256)throw publicError_('El paquete de Drive no coincide con el archivo confirmado');
 const envelope=JSON.parse(text);if(envelope.schema!=='GENESIS_MIGRATION_V2'||envelope.environment==='PILOT'||envelope.database?.audit?.some(e=>e.kind==='PILOT_INITIALIZED'))throw publicError_('No se conecta un paquete de demostración o de formato desconocido');
 GoogleSchema.validate(GoogleSchema.normalize(envelope.database));
 if(!envelope.database.users.some(u=>u.active&&u.role==='ADMIN'&&u.email===email&&GoogleAccounts.confirmed(u)))throw publicError_('El paquete no contiene a la administradora confirmada');
 props.setProperties({...plan.resources,AUTH_MODE:'GOOGLE_OAUTH',AUTH_DOMAIN:'',ADMIN_EMAIL:email,STORAGE_MODE:'OWNER_PRIVATE',STORAGE_OWNER_EMAIL:email,ENVIRONMENT:'PRODUCTION',ACCESS_ENABLED:'NO',PROVISIONING_APPROVED:'YES',PROVISIONING_TOKEN:plan.token,PROVISIONING_ROOT_ID:root,CONFIRM_IMPORT_FILE_ID:plan.resources.IMPORT_FILE_ID,IMPORT_SHA256:sha});
 GoogleConfig.lock(()=>GoogleProvisioning.ensure());
 const result={status:'PERSONAL_DRIVE_CONNECTED',owner:email,accessEnabled:false,sourceVersion:envelope.database.version,gradeRecords:envelope.database.grades.length,studentRecords:envelope.database.students.length,accountsApprovedAutomatically:false,oauthCredentialsPreserved:true};console.log(JSON.stringify(result));return result;
}
function importInstitution_(){
 if(GoogleConfig.property('ENVIRONMENT',false)==='PILOT')throw publicError_('No se importan expedientes institucionales en un piloto sintético');
 requireProvisioningApproval_();return GoogleConfig.lock(()=>{
  const props=PropertiesService.getScriptProperties(),fileId=GoogleConfig.property('IMPORT_FILE_ID');
  if(GoogleConfig.property('CONFIRM_IMPORT_FILE_ID')!==fileId)throw publicError_('Confirmá el archivo de importación');
  const text=GoogleDrive.privateItem(DriveApp.getFileById(fileId)).getBlob().getDataAsString('UTF-8');
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(digest!==GoogleConfig.property('IMPORT_SHA256'))throw publicError_('El archivo no coincide con el hash revisado');
  const envelope=JSON.parse(text),db=GoogleSchema.normalize(envelope.database);
  if(!['GENESIS_MIGRATION_V2','GENESIS_SNAPSHOT_V2'].includes(envelope.schema))throw publicError_('Formato de migración o respaldo inválido');GoogleSchema.validate(db);
  if(envelope.environment==='PILOT'||db.audit.some(event=>event.kind==='PILOT_INITIALIZED'))throw publicError_('Un respaldo sintético de piloto no puede importarse a producción');
  if(db.users.some(u=>u.googleIdentity?.status==='CONFIRMED'&&!GoogleAccounts.confirmed(u)))throw publicError_('Hay confirmaciones de identidad inconsistentes');
  if(!db.users.some(u=>u.active&&u.role==='ADMIN'&&GoogleAccounts.confirmed(u)&&u.email.toLowerCase()===GoogleConfig.property('ADMIN_EMAIL').toLowerCase()))throw publicError_('La cuenta administradora no coincide o no fue confirmada');
  if(GoogleConfig.property('ACCESS_ENABLED',false)==='YES')throw publicError_('Deshabilitá el acceso durante la importación inicial');
  const ss=GoogleStorage.spreadsheet();GoogleDrive.privateItem(DriveApp.getFileById(ss.getId()));if(ss.getSheetByName('_meta')||ss.getSheets().some(sheet=>sheet.getLastRow()>0))throw publicError_('La base ya contiene información. No se sobrescribe ni se reanuda automáticamente');
  // Incomplete imports stay unreadable. Only the final READY marker enables the app.
  ss.insertSheet('_meta').getRange(1,1,2,4).setValues([['version','state','schema','commit'],[db.version,'PREPARING',2,'']]);
  writeInstitutionRows_(ss,db,{});
  verifyInstitutionTables_(ss,db);
  GoogleDrive.backup(db);
  Sheets.Spreadsheets.batchUpdate({requests:[{updateCells:{range:{sheetId:ss.getSheetByName('_meta').getSheetId(),startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:4},rows:[{values:[db.version,'READY',2,Utilities.getUuid()].map(GoogleStorage.cell)}],fields:'userEnteredValue'}}]},ss.getId());
  return {status:'IMPORTED',version:db.version,tables:Genesis.tables.length};
 });
}
// Group subrequests, including sheet creation, into bounded API calls. Each batch
// counts as one write; no retry is made after an uncertain transport result.
function writeInstitutionRows_(ss,db,prefixes){
 let pending=[],size=0,writes=0,nextId=Math.max(0,...ss.getSheets().map(sh=>sh.getSheetId()))+1;
 const flush=()=>{if(pending.length){Sheets.Spreadsheets.batchUpdate({requests:pending},ss.getId());writes++;pending=[];size=0;}};
 const add=request=>{const length=JSON.stringify(request).length;if(length>450000)throw publicError_('Una fila excede el tamaño permitido de importación');if(size+length>450000)flush();pending.push(request);size+=length;};
 for(const table of Genesis.tables){
  const rows=GoogleSchema.encode(table,db[table]),sheet=ss.getSheetByName(table),sheetId=sheet?sheet.getSheetId():nextId++;
  if(!sheet)add({addSheet:{properties:{sheetId,title:table,gridProperties:{rowCount:Math.max(1000,rows.length),columnCount:Math.max(26,rows[0].length)}}}});
  else if(rows.length>sheet.getMaxRows()||rows[0].length>sheet.getMaxColumns())add({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(sheet.getMaxRows(),rows.length),columnCount:Math.max(sheet.getMaxColumns(),rows[0].length)}},fields:'gridProperties'}});
  // Keep chunks small enough to group across tables. Prefixes are verified
  // complete rows; recovery never sends their cells back to Google.
  for(let offset=prefixes[table]||0;offset<rows.length;){
   let end=Math.min(offset+200,rows.length),request;
   do{const slice=rows.slice(offset,end);request={updateCells:{range:{sheetId,startRowIndex:offset,endRowIndex:end,startColumnIndex:0,endColumnIndex:rows[0].length},rows:slice.map(row=>({values:row.map(GoogleStorage.cell)})),fields:'userEnteredValue'}};if(JSON.stringify(request).length<=450000)break;end=offset+Math.floor((end-offset)/2);}while(end>offset);
   if(end<=offset)throw publicError_('Una fila excede el tamaño permitido de importación');add(request);offset=end;
  }
 }
 flush();console.log(JSON.stringify({status:'IMPORT_BATCHES_WRITTEN',writeRequests:writes}));return writes;
}
function verifyInstitutionTables_(ss,db){
 const ranges=Sheets.Spreadsheets.Values.batchGet(ss.getId(),{ranges:Genesis.tables.map(t=>"'"+t+"'"),valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 Genesis.tables.forEach((table,i)=>{if(JSON.stringify(GoogleSchema.decode(table,ranges[i].values||[]))!==JSON.stringify(db[table]))throw publicError_('No se pudo verificar '+table);});
}
// Explicit editor recovery only. Verify the entire partial database before any
// mutation, back it up, and append missing complete rows under the script lock.
function recoverInstitutionImport_(){
 requireProvisioningApproval_();const recovered=GoogleConfig.lock(()=>{
  if(GoogleConfig.property('ENVIRONMENT')!=='PRODUCTION'||GoogleConfig.property('ACCESS_ENABLED',false)==='YES'||GoogleConfig.property('WRITE_FAILED',false))throw publicError_('La recuperación requiere producción con acceso deshabilitado y sin escrituras pendientes');
  const fileId=GoogleConfig.property('IMPORT_FILE_ID');if(GoogleConfig.property('CONFIRM_IMPORT_FILE_ID')!==fileId)throw publicError_('Confirmá el archivo de importación');
  const text=GoogleDrive.privateItem(DriveApp.getFileById(fileId)).getBlob().getDataAsString('UTF-8'),sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(sha!==GoogleConfig.property('IMPORT_SHA256'))throw publicError_('El archivo no coincide con el hash revisado');
  const envelope=JSON.parse(text),db=GoogleSchema.normalize(envelope.database);GoogleSchema.validate(db);
  if(envelope.schema!=='GENESIS_MIGRATION_V2'||envelope.environment==='PILOT'||db.audit.some(e=>e.kind==='PILOT_INITIALIZED')||!db.users.some(u=>u.active&&u.role==='ADMIN'&&GoogleAccounts.confirmed(u)&&u.email===GoogleConfig.property('ADMIN_EMAIL')))throw publicError_('Paquete de recuperación inválido');
  const ss=GoogleStorage.spreadsheet();GoogleDrive.privateItem(DriveApp.getFileById(ss.getId()));
  const snapshot=ss.getSheets().map(sheet=>{const range=sheet.getDataRange();if(range.getFormulas().some(row=>row.some(Boolean)))throw publicError_('Hay fórmulas inesperadas; no se recupera automáticamente');return {table:sheet.getName(),rows:sheet.getLastRow()?range.getValues():[]};});
  const meta=snapshot.find(s=>s.table==='_meta')?.rows;
  if(!meta||meta.length!==2||JSON.stringify(meta[0])!==JSON.stringify(['version','state','schema','commit'])||String(meta[1][0])!==String(db.version)||meta[1][1]!=='PREPARING'||String(meta[1][2])!=='2'||meta[1].slice(3).some(v=>v!==''))throw publicError_('La base no es una importación parcial compatible; no se modifica');
  const prefixes={};for(const saved of snapshot){
   if(saved.table==='_meta')continue;
   if(!Genesis.tables.includes(saved.table)){if(saved.rows.length)throw publicError_('Hay una hoja ajena con información; no se modifica');continue;}
   const expected=GoogleSchema.encode(saved.table,db[saved.table]);if(saved.rows.length>expected.length)throw publicError_('La tabla '+saved.table+' contiene filas distintas; no se modifica');
   for(let r=0;r<saved.rows.length;r++){
    const actual=saved.rows[r];for(let col=0;col<Math.max(actual.length,expected[r].length);col++)if((actual[col]??'')!==(expected[r][col]??''))throw publicError_('La tabla '+saved.table+' difiere del paquete; no se modifica');
   }
   prefixes[saved.table]=saved.rows.length;
  }
  const partialBackup=GoogleDrive.json('BACKUPS_FOLDER_ID','GENESIS-importacion-parcial-'+Utilities.getUuid()+'.json',{schema:'GENESIS_PARTIAL_IMPORT_V1',spreadsheetId:ss.getId(),packageSha256:sha,createdAt:new Date().toISOString(),sheets:snapshot}).getId();
  const writes=writeInstitutionRows_(ss,db,prefixes);verifyInstitutionTables_(ss,db);GoogleDrive.backup(db);
  Sheets.Spreadsheets.batchUpdate({requests:[{updateCells:{range:{sheetId:ss.getSheetByName('_meta').getSheetId(),startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:4},rows:[{values:[db.version,'READY',2,Utilities.getUuid()].map(GoogleStorage.cell)}],fields:'userEnteredValue'}}]},ss.getId());
  return {status:'PERSONAL_DRIVE_RECOVERED_AND_VERIFIED',preservedRows:Object.values(prefixes).reduce((a,b)=>a+b,0),writeRequests:writes+1,partialBackupId:partialBackup,academicAccessEnabled:false,teacherAccessEnabled:false};
 });
 const result={...verifyInstitutionImport_(),...recovered};console.log(JSON.stringify(result));return result;
}
function verifyPendingWrite_(){
 requireProvisioningApproval_();return GoogleConfig.lock(()=>{
  const props=PropertiesService.getScriptProperties(),pending=props.getProperty('WRITE_FAILED');if(!pending)throw publicError_('No hay escritura pendiente');
  const row=Sheets.Spreadsheets.Values.get(GoogleConfig.property('SPREADSHEET_ID'),"'_meta'!A2:D2",{valueRenderOption:'UNFORMATTED_VALUE'}).values?.[0];
  // An uncommitted/unknown request requires an administrator to inspect its backup, not retry it.
  if(!row||row[3]!==pending)throw publicError_('Resultado incierto. Conservá el bloqueo y revisá el respaldo');
  props.deleteProperty('WRITE_FAILED');return {status:'COMMIT_VERIFIED',version:Number(row[0])};
 });
}

// Personal storage editor operations
function personalStoragePlan_(){
 const serialized=GoogleConfig.property('PERSONAL_STORAGE_CONNECTION_JSON',false);
 if(!serialized)throw publicError_('Configurá el plan privado de almacenamiento en las propiedades del script');
 try{return JSON.parse(serialized);}catch{throw publicError_('El plan privado de almacenamiento no es válido');}
}
function configurarDriveInconotas_(){
 connectPersonalStorage_(personalStoragePlan_());
 const spreadsheet=GoogleStorage.spreadsheet(),meta=spreadsheet.getSheetByName('_meta');
 if(!meta)importInstitution_();
 const verified=verifyInstitutionImport_();
 const result={...verified,status:'PERSONAL_DRIVE_IMPORTED_AND_VERIFIED',owner:'inconotas@gmail.com',academicAccessEnabled:false,teacherAccessEnabled:false};
 console.log(JSON.stringify(result));return result;
}
function recuperarImportacionInconotas_(){connectPersonalStorage_(personalStoragePlan_());return recoverInstitutionImport_();}
// Personal storage editor operations
