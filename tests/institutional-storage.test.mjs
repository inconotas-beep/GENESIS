import test from 'node:test';
import assert from 'node:assert/strict';
import {googlePlatform} from './helpers/google-platform.mjs';

function storageFixture(){
 const env=googlePlatform(),{c,props}=env,owner='storage@school.example.invalid',admin='admin@gmail.example.invalid';let executor=owner;
 Object.entries({AUTH_MODE:'GOOGLE_OAUTH',AUTH_DOMAIN:'',ADMIN_EMAIL:admin,STORAGE_MODE:'INSTITUTIONAL_SHARED',STORAGE_OWNER_EMAIL:owner,ROOT_FOLDER_ID:'root',BACKUPS_FOLDER_ID:'backups'}).forEach(([k,v])=>props.set(k,v));
 const access=()=>[{type:'user',role:'owner',emailAddress:owner},{type:'user',role:'writer',emailAddress:admin}];
 const nodes=new Map([['root',{id:'root',mimeType:'application/vnd.google-apps.folder',owners:[{emailAddress:owner}],capabilities:{canEdit:true},permissions:access()}],['backups',{id:'backups',mimeType:'application/vnd.google-apps.folder',parents:['root'],owners:[{emailAddress:owner}],capabilities:{canEdit:true},permissions:access()}],['gradefile',{id:'gradefile',mimeType:'application/vnd.google-apps.spreadsheet',parents:['root'],owners:[{emailAddress:owner}],capabilities:{canEdit:true},permissions:access()}]]);
 const requests=[],writes=[];c.ScriptApp={getOAuthToken:()=> 'synthetic-storage-oauth-token'};
 c.Session.getEffectiveUser=()=>({getEmail:()=>executor});
 c.UrlFetchApp={fetch:(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer synthetic-storage-oauth-token');requests.push(url);
  const match=new URL(url).pathname.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]+)(\/permissions)?$/);assert.ok(match);
  const node=nodes.get(match[1]);return {getResponseCode:()=>node?200:404,getContentText:()=>JSON.stringify(match[2]?{permissions:node?.permissions,nextPageToken:node?.permissionNextPage}:node)};
 }};
 c.DriveApp.getFolderById=id=>({getId:()=>id,createFile:blob=>{writes.push(blob);nodes.set('created',{id:'created',mimeType:'application/json',parents:[id],owners:[{emailAddress:executor}],capabilities:{canEdit:true},permissions:access()});return {getId:()=> 'created'};}});
 return {...env,owner,admin,nodes,requests,writes,asExecutor(email){executor=email;},item:id=>({getId:()=>id})};
}

test('Storage: approved institutional folder and Gmail editor are accepted without granting teacher access',()=>{
 const e=storageFixture(),before=e.props.size,item=e.item('gradefile');assert.equal(e.c.GoogleDrive.privateItem(item),item);assert.equal(e.requests.length,4);assert.equal(e.props.size,before);assert.equal(e.writes.length,0);
 e.nodes.get('root').permissions.push({type:'user',role:'reader',emailAddress:'teacher@school.example.invalid'});assert.throws(()=>e.c.GoogleDrive.privateItem(item),/solo puede compartirse/);
});

test('Storage: public links, domain access, groups, unknown users and pending ownership are rejected',()=>{
 for(const permission of [{type:'anyone',role:'reader'},{type:'domain',role:'reader',domain:'school.example.invalid'},{type:'group',role:'writer',emailAddress:'storage@school.example.invalid'},{type:'user',role:'writer',emailAddress:'other@example.invalid'},{type:'user',role:'writer',emailAddress:'admin@gmail.example.invalid',pendingOwner:true}]){
  const e=storageFixture();e.nodes.get('root').permissions.push(permission);assert.throws(()=>e.c.GoogleDrive.privateItem(e.item('gradefile')),/solo puede compartirse/);assert.equal(e.writes.length,0);
 }
});

test('Storage: Gmail-created files, wrong owner, removed permission and trashed resources fail closed',()=>{
 for(const update of [{owners:[{emailAddress:'admin@gmail.example.invalid'}]},{owners:[]},{trashed:true},{capabilities:{canEdit:false}},{driveId:'unexpected-shared-drive'}]){
  const e=storageFixture();Object.assign(e.nodes.get('gradefile'),update);assert.throws(()=>e.c.GoogleDrive.privateItem(e.item('gradefile')),/cuenta institucional/);
 }
});

test('Storage: files outside the configured folder, cycles and incomplete permission listings are denied',()=>{
 for(const change of [e=>e.nodes.get('gradefile').parents=[],e=>e.nodes.get('gradefile').parents=['gradefile'],e=>e.nodes.get('root').permissionNextPage='uninspected',e=>e.nodes.get('root').permissions=[],e=>e.props.set('ROOT_FOLDER_ID','missing-root')]){const e=storageFixture();change(e);assert.throws(()=>e.c.GoogleDrive.privateItem(e.item('gradefile')));}
});

test('Storage: the execution identity must own storage before creating any file or provisioning any resource',()=>{
 const e=storageFixture();e.asExecutor(e.admin);assert.throws(()=>e.c.GoogleDrive.json('BACKUPS_FOLDER_ID','GENESIS-backup.json',{data:'synthetic'}),/cuenta institucional propietaria/);assert.throws(()=>e.c.GoogleProvisioning.ensure(),/cuenta institucional propietaria/);assert.equal(e.requests.length,0);assert.equal(e.writes.length,0);
 e.asExecutor(e.owner);assert.equal(e.c.GoogleDrive.json('BACKUPS_FOLDER_ID','GENESIS-backup.json',{data:'synthetic'}).getId(),'created');assert.equal(e.nodes.get('created').owners[0].emailAddress,e.owner);assert.equal(e.writes.length,1);
});

test('Storage: technical editor operations admit only the two responsible accounts, without changing academic roles',()=>{
 const e=storageFixture();for(const email of [e.owner,e.admin]){e.as(email);assert.equal(e.c.requireResponsibleAccount_(),email);}
 e.as('teacher@school.example.invalid');assert.throws(()=>e.c.requireResponsibleAccount_(),/Solo la cuenta responsable/);
 assert.equal(e.c.GoogleDrive.storageOwner(),e.owner);e.props.set('STORAGE_MODE','UNREVIEWED');assert.throws(()=>e.c.GoogleDrive.mode(),/inválido/);
});

test('Storage: metadata outages expose no response bodies or tokens and do not create files',()=>{
 const e=storageFixture();e.c.UrlFetchApp.fetch=()=>{throw Error('PRIVATE_OAUTH_TOKEN');};assert.throws(()=>e.c.GoogleDrive.privateItem(e.item('root')),error=>!error.message.includes('PRIVATE_')&&/permisos/.test(error.message));assert.equal(e.writes.length,0);
});

test('Storage: editor readiness verifies the folder without creating resources or approving accounts',()=>{
 const e=storageFixture();e.as(e.admin);e.asExecutor(e.admin);assert.equal(e.c.storageReadiness_().status,'INSTITUTIONAL_EXECUTION_REQUIRED');e.asExecutor(e.owner);assert.equal(e.c.storageReadiness_().status,'FOLDER_VERIFIED');assert.equal(e.writes.length,0);assert.equal(e.props.get('ACCESS_ENABLED'),'YES');
});
