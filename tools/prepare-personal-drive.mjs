// Uses only the already-authorized personal account. Never prints credentials or records.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {Readable} from 'node:stream';
import {google} from 'googleapis';
import {initAuth} from '../node_modules/@google/clasp/build/src/auth/auth.js';
import {preparePersonalStorage} from '../src/personal-storage-setup.mjs';
const deadline=setTimeout(()=>{console.error('La preparación excedió 120 segundos; revisar el registro privado antes de reintentar.');process.exit(1);},120000);
try{
 if(process.env.GENESIS_PERSONAL_STORAGE_AUTHORIZED!=='YES')throw Error('Falta autorización para crear almacenamiento personal');
 const pointer=JSON.parse(fs.readFileSync('migration/private/latest-package.json','utf8')),bytes=fs.readFileSync(pointer.file),sha=crypto.createHash('sha256').update(bytes).digest('hex'),md5=crypto.createHash('md5').update(bytes).digest('hex');
 if(sha!==pointer.sha256)throw Error('El paquete privado cambió');
 const source=fs.readFileSync('../GENESIS/data/privado/institucional/database.json');
 if(crypto.createHash('sha256').update(source).digest('hex')!==pointer.sourceSha256)throw Error('La base original cambió después de preparar el paquete');
 const envelope=JSON.parse(bytes);if(envelope.schema!=='GENESIS_MIGRATION_V2'||envelope.environment==='PILOT'||envelope.database.audit.some(e=>e.kind==='PILOT_INITIALIZED'))throw Error('El paquete no es institucional');
 const owner='inconotas@gmail.com';if(!envelope.database.users.some(u=>u.active&&u.role==='ADMIN'&&u.email===owner&&u.googleIdentity?.status==='CONFIRMED'))throw Error('La administradora no está confirmada en el paquete');
 google.options({timeout:20000,retry:false});const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});if(!credentials)throw Error('Falta iniciar sesión');
 const account=(await google.oauth2({version:'v2',auth:credentials}).userinfo.get()).data.email;if(account!==owner)throw Error('La cuenta conectada no es la autorizada');
 const drive=google.drive({version:'v3',auth:credentials}),fields='id,name,mimeType,trashed,driveId,parents,owners(emailAddress),capabilities(canEdit),appProperties,md5Checksum,webViewLink';
 const api={
  metadata:async id=>(await drive.files.get({fileId:id,fields})).data,
  permissions:async id=>(await drive.permissions.list({fileId:id,fields:'permissions(type,role,emailAddress,pendingOwner),nextPageToken',pageSize:100})).data,
  find:async({token,key,parent})=>{const result=(await drive.files.list({q:"trashed = false and appProperties has { key='genesisSetup' and value='"+token+"' } and appProperties has { key='genesisResource' and value='"+key+"' }"+(parent?" and '"+parent+"' in parents":''),fields:'files('+fields+'),nextPageToken',pageSize:100})).data;if(result.nextPageToken)throw Error('Listado de recursos incompleto');return result.files||[];},
  create:async({name,mimeType,parent,token,key,bytes,sha256})=>(await drive.files.create({requestBody:{name,mimeType,...(parent?{parents:[parent]}:{}),appProperties:{genesisSetup:token,genesisResource:key,...(sha256?{genesisSha256:sha256}:{})}},...(bytes?{media:{mimeType,body:Readable.from(bytes)}}:{}),fields})).data
 };
 const journalPath='migration/private/personal-storage-journal.json',journal=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):{owner,mode:'OWNER_PRIVATE',token:crypto.randomUUID(),resources:{},pending:{}};
 const persist=async value=>{fs.writeFileSync(journalPath+'.tmp',JSON.stringify(value,null,2));fs.renameSync(journalPath+'.tmp',journalPath);};
 const result=await preparePersonalStorage({api,account,journal,persist,importBytes:bytes,importSha256:sha,importMd5:md5});
 const downloaded=Buffer.from((await drive.files.get({fileId:result.resources.IMPORT_FILE_ID,alt:'media'},{responseType:'arraybuffer'})).data);
 if(crypto.createHash('sha256').update(downloaded).digest('hex')!==sha)throw Error('La descarga de verificación del paquete no coincide');
 const root=await api.metadata(result.resources.ROOT_FOLDER_ID);
 const propsPath='migration/private/script-properties.local.json',props=JSON.parse(fs.readFileSync(propsPath,'utf8'));
 Object.assign(props,{AUTH_MODE:'GOOGLE_OAUTH',AUTH_DOMAIN:'',ADMIN_EMAIL:owner,STORAGE_MODE:'OWNER_PRIVATE',STORAGE_OWNER_EMAIL:owner,ENVIRONMENT:'PRODUCTION',ACCESS_ENABLED:'NO',PROVISIONING_APPROVED:'YES',PROVISIONING_TOKEN:result.token,PROVISIONING_ROOT_ID:result.resources.ROOT_FOLDER_ID,...result.resources,CONFIRM_IMPORT_FILE_ID:result.resources.IMPORT_FILE_ID,IMPORT_SHA256:sha});fs.writeFileSync(propsPath,JSON.stringify(props,null,2));
 const config={owner,token:result.token,resources:result.resources,importSha256:sha,sourceSha256:pointer.sourceSha256,sourceVersion:pointer.sourceVersion};fs.writeFileSync('migration/private/personal-storage-connection.json',JSON.stringify(config,null,2));
 const report={status:'RESOURCES_CREATED_PACKAGE_UPLOADED_AND_VERIFIED',owner,mode:'OWNER_PRIVATE',folderUrl:root.webViewLink||null,resources:result.resources,packageSha256:sha,sourceSha256:pointer.sourceSha256,sourceVersion:pointer.sourceVersion,packageDownloadedAndHashVerified:true,resourcePrivacyVerified:true,gradeRecords:envelope.database.grades.length,studentRecords:envelope.database.students.length,confirmedAccounts:pointer.confirmedAccounts,pendingAccounts:pointer.pendingAccounts,scriptPropertiesApplied:false,sheetsImportExecuted:false,academicAccessEnabled:false,institutionalFolderModified:false,originalProjectWritten:false};
 fs.writeFileSync('migration/ALMACENAMIENTO-PERSONAL-RESULTADOS.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.error('Preparación detenida: '+String(error.code||error.status||(error.genesisPublic?error.message:(!error.config&&!error.response?error.message:'GOOGLE_OPERATION_FAILED'))));process.exitCode=1;}finally{clearTimeout(deadline);}
