/* Private, locked callers only. A pending creation is never blindly repeated. */
var GoogleProvisioning=(()=>{
 const labels={BACKUPS_FOLDER_ID:'Respaldos',EXPORTS_FOLDER_ID:'Exportaciones',DOCUMENTS_FOLDER_ID:'Documentos',SPREADSHEET_ID:'Datos'};
 function list(iterator){const rows=[];while(iterator.hasNext())rows.push(iterator.next());return rows;}
 function owner(item){GoogleDrive.privateItem(item);const user=item.getOwner();if(!user||user.getEmail().toLowerCase()!==GoogleDrive.storageOwner())throw publicError_('El recurso debe pertenecer a la cuenta responsable del almacenamiento');return item;}
 function ensureOne(key,name,find,create){
  const props=PropertiesService.getScriptProperties(),known=props.getProperty(key);
  if(known){const item=owner(DriveApp[key==='SPREADSHEET_ID'||key==='PILOT_RESTORE_TARGET_ID'?'getFileById':'getFolderById'](known));if(item.getName()!==name)throw publicError_('El recurso configurado no coincide con su registro de preparación');props.deleteProperty('PENDING_'+key);return item;}
  const matches=list(find());if(matches.length>1)throw publicError_('Hay recursos duplicados con el identificador de preparación. Revisalos antes de continuar');
  if(matches.length===1){const item=owner(matches[0]);props.setProperty(key,item.getId());props.deleteProperty('PENDING_'+key);return item;}
  if(props.getProperty('PENDING_'+key))throw publicError_('Creación anterior incierta para '+key+'. Verificá Drive antes de autorizar un reintento');
  props.setProperty('PENDING_'+key,name);
  const item=owner(create());props.setProperty(key,item.getId());props.deleteProperty('PENDING_'+key);return item;
 }
 function ensure(){
  GoogleDrive.requireStorageExecutor();
  const props=PropertiesService.getScriptProperties(),root=owner(GoogleDrive.folder('ROOT_FOLDER_ID'));
  if(!props.getProperty('PROVISIONING_TOKEN')){
   if(Object.keys(labels).some(key=>props.getProperty(key)))throw publicError_('Hay recursos configurados fuera de este registro; no se adoptan automáticamente');
   props.setProperties({PROVISIONING_TOKEN:Utilities.getUuid(),PROVISIONING_ROOT_ID:root.getId()});
  }
  if(props.getProperty('PROVISIONING_ROOT_ID')!==root.getId())throw publicError_('La carpeta raíz cambió. No se crean recursos adicionales');
  const token=props.getProperty('PROVISIONING_TOKEN');
  for(const [key,label]of Object.entries(labels)){
   const name='GENESIS '+token+' '+label;
   if(key==='SPREADSHEET_ID'){
    const item=ensureOne(key,name,()=>DriveApp.getFilesByName(name),()=>{const created=DriveApp.getFileById(SpreadsheetApp.create(name).getId());created.moveTo(root);return created;});
    if(item.getMimeType()!=='application/vnd.google-apps.spreadsheet')throw publicError_('El destino configurado no es una hoja de cálculo');
    if(!list(item.getParents()).some(parent=>parent.getId()===root.getId()))item.moveTo(root);
   }else ensureOne(key,name,()=>root.getFoldersByName(name),()=>root.createFolder(name));
  }
  return {spreadsheetId:props.getProperty('SPREADSHEET_ID'),status:'RESOURCES_VERIFIED'};
 }
 function restoreTarget(backupId){
  GoogleDrive.requireStorageExecutor();
  const props=PropertiesService.getScriptProperties(),root=owner(GoogleDrive.folder('ROOT_FOLDER_ID'));
  if(props.getProperty('PILOT_RESTORE_SOURCE')&&props.getProperty('PILOT_RESTORE_SOURCE')!==backupId)throw publicError_('Ya existe un destino para otro respaldo; no se reemplaza');
  props.setProperty('PILOT_RESTORE_SOURCE',backupId);
  const name='GENESIS '+GoogleConfig.property('PROVISIONING_TOKEN')+' Recuperacion '+backupId;
  const item=ensureOne('PILOT_RESTORE_TARGET_ID',name,()=>DriveApp.getFilesByName(name),()=>{const created=DriveApp.getFileById(SpreadsheetApp.create(name).getId());created.moveTo(root);return created;});
  if(!list(item.getParents()).some(parent=>parent.getId()===root.getId()))item.moveTo(root);
  return SpreadsheetApp.openById(item.getId());
 }
 return {ensure,restoreTarget};
})();
