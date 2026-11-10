// Idempotent Drive provisioning. No record mutation, sharing changes or implicit retries.
export const RESOURCE_TYPES={ROOT_FOLDER_ID:'application/vnd.google-apps.folder',BACKUPS_FOLDER_ID:'application/vnd.google-apps.folder',EXPORTS_FOLDER_ID:'application/vnd.google-apps.folder',DOCUMENTS_FOLDER_ID:'application/vnd.google-apps.folder',SPREADSHEET_ID:'application/vnd.google-apps.spreadsheet',IMPORT_FILE_ID:'application/json'};
export function requirePrivateMetadata(file,permissions,owner,parentId){
 if(!file||!file.id||file.trashed||file.driveId||file.owners?.length!==1||file.owners[0].emailAddress?.toLowerCase()!==owner||file.capabilities?.canEdit!==true)throw Error('El recurso no es privado de la cuenta autorizada');
 if(parentId&&(!Array.isArray(file.parents)||file.parents.length!==1||file.parents[0]!==parentId))throw Error('El recurso no está en la carpeta de GENESIS');
 if(permissions.nextPageToken||!Array.isArray(permissions.permissions)||permissions.permissions.length!==1||permissions.permissions[0].type!=='user'||permissions.permissions[0].role!=='owner'||permissions.permissions[0].emailAddress?.toLowerCase()!==owner||permissions.permissions[0].pendingOwner)throw Error('El recurso tiene permisos adicionales o no comprobados');
}
export async function preparePersonalStorage({api,account,journal,persist,importBytes,importSha256,importMd5}){
 if(account!=='inconotas@gmail.com'||journal.owner!==account||journal.mode!=='OWNER_PRIVATE'||!/^[a-f0-9-]{36}$/.test(journal.token))throw Error('Cuenta o plan de almacenamiento incorrecto');
 if(!importBytes||!/^[a-f0-9]{64}$/.test(importSha256)||!/^[a-f0-9]{32}$/.test(importMd5))throw Error('Falta verificar el paquete de importación');
 if(journal.importSha256&&journal.importSha256!==importSha256)throw Error('El paquete cambió respecto de esta preparación; no se reemplaza');
 journal.importSha256=importSha256;journal.resources||={};journal.pending||={};await persist(journal);
 const labels={ROOT_FOLDER_ID:'GENESIS',BACKUPS_FOLDER_ID:'Respaldos',EXPORTS_FOLDER_ID:'Exportaciones',DOCUMENTS_FOLDER_ID:'Documentos',SPREADSHEET_ID:'Datos',IMPORT_FILE_ID:'Migracion.json'};
 for(const [key,mimeType]of Object.entries(RESOURCE_TYPES)){
  const root=journal.resources.ROOT_FOLDER_ID,parent=key==='ROOT_FOLDER_ID'?null:root;
  const name=key==='ROOT_FOLDER_ID'?'GENESIS':'GENESIS '+journal.token+' '+labels[key];
  let id=journal.resources[key],file;
  if(id)file=await api.metadata(id);
  else{
   const matches=await api.find({token:journal.token,key,parent});
   if(matches.length>1)throw Error('Hay recursos duplicados; revisarlos antes de continuar');
   if(matches.length===1)file=matches[0];
   else{
    if(journal.pending[key])throw Error('Creación anterior incierta; no se repite automáticamente');
    journal.pending[key]=true;await persist(journal);
    file=await api.create({name,mimeType,parent,token:journal.token,key,...(key==='IMPORT_FILE_ID'?{bytes:importBytes,sha256:importSha256}:{})});
   }
   id=file.id;
  }
  requirePrivateMetadata(file,await api.permissions(id),account,parent);
  if(file.name!==name||file.mimeType!==mimeType||file.appProperties?.genesisSetup!==journal.token||file.appProperties?.genesisResource!==key)throw Error('El recurso no coincide con su registro de creación');
  if(key==='IMPORT_FILE_ID'&&(file.md5Checksum!==importMd5||file.appProperties.genesisSha256!==importSha256))throw Error('El paquete en Drive no coincide con el original verificado');
  journal.resources[key]=id;delete journal.pending[key];await persist(journal);
 }
 return {mode:'OWNER_PRIVATE',owner:account,token:journal.token,resources:{...journal.resources},importSha256};
}
