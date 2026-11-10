// Inspect only the authenticated account and the selected script's metadata.
import fs from 'node:fs';
import {google} from 'googleapis';
import {initAuth,getUserInfo} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const project=JSON.parse(fs.readFileSync('.clasp.json','utf8')),{credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});
if(!credentials)throw Error('No hay sesión de clasp');
const account=await getUserInfo(credentials);if(account?.email!=='inconotas@gmail.com')throw Error('La cuenta conectada no es la autorizada');
const response=await google.script({version:'v1',auth:credentials}).projects.get({scriptId:project.scriptId}),metadata=response.data;
let drive;
try{drive=(await google.drive({version:'v3',auth:credentials}).files.get({fileId:project.scriptId,fields:'id,name,owners(emailAddress,me),capabilities(canEdit)'})).data;}catch{}
const report={account:account.email,scriptId:project.scriptId,title:metadata.title,creatorMatchesAccount:metadata.creator?.email===account.email,lastModifierMatchesAccount:metadata.lastModifyUser?.email===account.email,driveOwnershipAvailable:!!drive,ownedByCurrentAccount:drive?.owners?.some(owner=>owner.me)||false,canEdit:drive?.capabilities?.canEdit??null,googleWritePerformed:false};
fs.writeFileSync('migration/private/cloud-code-target-check.json',JSON.stringify({...report,creatorEmail:metadata.creator?.email,owners:drive?.owners?.map(owner=>owner.emailAddress)},null,2));
console.log(JSON.stringify(report,null,2));
