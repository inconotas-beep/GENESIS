/* Editor-only, read-only acceptance helpers; these do not publish or enable access. */
function storageReadiness_(){
 requireResponsibleAccount_();GoogleDrive.folder('ROOT_FOLDER_ID');
 let executorVerified=true;try{GoogleDrive.requireStorageExecutor();}catch{executorVerified=false;}
 const result={status:executorVerified?'FOLDER_VERIFIED':'INSTITUTIONAL_EXECUTION_REQUIRED',storageMode:GoogleDrive.mode(),storageOwner:GoogleDrive.storageOwner(),folderVerified:true,storageExecutorVerified:executorVerified,accessEnabled:GoogleConfig.property('ACCESS_ENABLED',false)==='YES',resourcesCreated:false,dataImported:false};
 console.log(JSON.stringify(result));return result;
}
function migrationStatus_(){
 requireResponsibleAccount_();return GoogleConfig.lock(()=>{
  const db=GoogleStorage.load();
  return {environment:GoogleConfig.property('ENVIRONMENT'),accessEnabled:GoogleConfig.property('ACCESS_ENABLED',false)==='YES',version:db.version,identityVerified:true,counts:Object.fromEntries(Genesis.tables.map(table=>[table,db[table].length])),confirmedAccounts:db.users.filter(u=>GoogleAccounts.confirmed(u)).length,pendingAccounts:db.users.filter(u=>!GoogleAccounts.confirmed(u)).length,writePending:!!GoogleConfig.property('WRITE_FAILED',false),liveAcceptance:'PENDING_MANUAL_MULTIUSER_VERIFICATION'};
 });
}
function verifyInstitutionImport_(){
 requireResponsibleAccount_();return GoogleConfig.lock(()=>{
  if(GoogleConfig.property('ENVIRONMENT')!=='PRODUCTION'||GoogleConfig.property('ACCESS_ENABLED',false)==='YES')throw publicError_('Verificá la importación con acceso de producción todavía deshabilitado');
  const file=GoogleDrive.privateItem(DriveApp.getFileById(GoogleConfig.property('IMPORT_FILE_ID'))),text=file.getBlob().getDataAsString('UTF-8');
  const sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(sha!==GoogleConfig.property('IMPORT_SHA256'))throw publicError_('El paquete de referencia no coincide con su hash confirmado');
  const envelope=JSON.parse(text);if(!['GENESIS_MIGRATION_V2','GENESIS_SNAPSHOT_V2'].includes(envelope.schema))throw publicError_('Paquete inválido');
  const expected=GoogleSchema.normalize(envelope.database),actual=GoogleStorage.load();GoogleSchema.validate(expected);GoogleSchema.validate(actual);
  if(actual.version!==expected.version||Genesis.tables.some(table=>JSON.stringify(actual[table])!==JSON.stringify(expected[table])))throw publicError_('Las tablas importadas difieren del paquete de referencia; no se habilita el acceso');
  for(const key of ['BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID'])GoogleDrive.folder(key);
  return {status:'IMPORTED_TABLES_VERIFIED',version:actual.version,sourceSha256:envelope.sourceSha256||null,packageSha256:sha,counts:Object.fromEntries(Genesis.tables.map(table=>[table,actual[table].length])),pendingAccounts:actual.users.filter(u=>!GoogleAccounts.confirmed(u)).length,accessEnabled:false,liveAcceptance:'PENDING_MANUAL_MULTIUSER_VERIFICATION'};
 });
}
