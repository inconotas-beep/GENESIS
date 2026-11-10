// Read-only inspection of the folder explicitly provided by the user.
import fs from 'node:fs';
import {google} from 'googleapis';
import {initAuth} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const folderId=process.env.GENESIS_CHECK_FOLDER_ID;
const storageOwner=process.env.GENESIS_CHECK_STORAGE_OWNER_EMAIL?.trim().toLowerCase();
if(!/^[A-Za-z0-9_-]{3,256}$/.test(folderId||'')||!storageOwner)throw Error('Configurá GENESIS_CHECK_FOLDER_ID y GENESIS_CHECK_STORAGE_OWNER_EMAIL');
const timer=setTimeout(()=>{console.error('La consulta de Drive excedió 60 segundos; no se realizaron cambios.');process.exit(1);},60000);
try{
 google.options({timeout:20000,retry:false});
 const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});if(!credentials)throw Error('NO_AUTH');
 const account=(await google.oauth2({version:'v2',auth:credentials}).userinfo.get()).data.email;
 if(account!=='inconotas@gmail.com')throw Error('WRONG_ACCOUNT');
 const drive=google.drive({version:'v3',auth:credentials});
 const folder=(await drive.files.get({fileId:folderId,supportsAllDrives:true,fields:'id,name,mimeType,trashed,driveId,parents,owners(emailAddress),capabilities(canEdit,canAddChildren,canListChildren,canShare)'})).data;
 if(folder.mimeType!=='application/vnd.google-apps.folder'||folder.trashed)throw Error('NOT_AN_ACTIVE_FOLDER');
 let permissions=null,permissionInspectionAvailable=false;
 try{permissions=(await drive.permissions.list({fileId:folderId,supportsAllDrives:true,fields:'permissions(id,type,role,emailAddress,domain,allowFileDiscovery,deleted),nextPageToken',pageSize:100})).data;permissionInspectionAvailable=!permissions.nextPageToken;}catch{}
 const contents=(await drive.files.list({q:"'"+folderId+"' in parents and trashed = false",pageSize:100,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'files(id,name,mimeType,owners(emailAddress)),nextPageToken'})).data;
 const trusted=new Set(['inconotas@gmail.com',storageOwner]);
 const unapprovedPermissionPresent=permissionInspectionAvailable?permissions.permissions.some(p=>!p.deleted&&(p.type!=='user'||!trusted.has(String(p.emailAddress||'').toLowerCase()))):null;
 const report={checkedAt:new Date().toISOString(),account,folderId,folderName:folder.name,owners:folder.owners?.map(o=>o.emailAddress)||[],sharedDrive:!!folder.driveId,capabilities:folder.capabilities,permissionInspectionAvailable,unapprovedPermissionPresent,permissionSummary:permissions?.permissions.map(p=>({type:p.type,role:p.role,knownAccount:trusted.has(String(p.emailAddress||'').toLowerCase())})),empty:(contents.files||[]).length===0&&!contents.nextPageToken,directChildrenCount:(contents.files||[]).length,additionalChildren:!!contents.nextPageToken,googleWritePerformed:false,storageConfigured:false};
 fs.writeFileSync('migration/private/storage-folder-check.json',JSON.stringify({...report,permissions:permissions?.permissions,children:contents.files},null,2));
 console.log(JSON.stringify(report,null,2));
}catch(error){console.error('No se pudo verificar la carpeta. Código: '+String(error.code||error.status||(/^[A-Z_]+$/.test(error.message)?error.message:'DRIVE_QUERY_FAILED')));process.exitCode=1;}finally{clearTimeout(timer);}
