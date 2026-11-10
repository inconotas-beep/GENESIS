import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import vm from 'node:vm';
import {pilotPlatform} from './helpers/pilot-platform.mjs';
import {prepareAccounts} from '../src/account-migration.mjs';
import G from '../tools/core.mjs';
const owner='inconotas@gmail.com';
function connection(){
 const e=pilotPlatform({ownerEmail:owner});e.props.set('AUTH_MODE','GOOGLE_OAUTH');e.props.set('AUTH_DOMAIN','');e.props.set('ENVIRONMENT','PRODUCTION');e.props.set('ACCESS_ENABLED','NO');e.props.set('GOOGLE_OAUTH_CLIENT_SECRET','private-test-secret');e.c.prepareGoogleResources_();
 const data=prepareAccounts(G.seed(),{admin:owner},owner,'2099-01-01','GOOGLE_OAUTH');
 data.grades.push({id:'g',year:'2026',sectionId:'1A',subjectId:'math',studentId:'s1',periodId:'1',values:[0,8.95,null]});
 const text=JSON.stringify({schema:'GENESIS_MIGRATION_V2',sourceSha256:'a'.repeat(64),database:data});
 const file=e.items.get('root').createFile(e.c.Utilities.newBlob(text,'application/json','package.json'));
 const plan={owner,token:e.props.get('PROVISIONING_TOKEN'),resources:Object.fromEntries(['ROOT_FOLDER_ID','BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID','SPREADSHEET_ID'].map(k=>[k,e.props.get(k)])),importSha256:crypto.createHash('sha256').update(text).digest('hex')};plan.resources.IMPORT_FILE_ID=file.getId();
 return {...e,plan,data};
}

test('Personal connection: private resources connect, OAuth secrets survive, and imported notes verify without enabling users',()=>{
 const e=connection();const result=e.c.connectPersonalStorage_(e.plan);assert.equal(result.status,'PERSONAL_DRIVE_CONNECTED');assert.equal(e.props.get('GOOGLE_OAUTH_CLIENT_SECRET'),'private-test-secret');assert.equal(e.props.get('ACCESS_ENABLED'),'NO');assert.equal(e.props.get('STORAGE_MODE'),'OWNER_PRIVATE');
 e.c.importInstitution_();assert.equal(e.c.verifyInstitutionImport_().status,'IMPORTED_TABLES_VERIFIED');assert.deepEqual(e.current().grades[0].values,[0,8.95,null]);assert.equal(e.current().users[1].googleIdentity.status,'PENDING');assert.equal(e.props.get('ACCESS_ENABLED'),'NO');
 const writes=e.pilotStats.writes;e.c.connectPersonalStorage_(e.plan);e.c.verifyInstitutionImport_();assert.equal(e.pilotStats.writes,writes);
});

test('Personal connection: active production, a different target, wrong actor or changed package stop before property changes',()=>{
 for(const modify of [e=>e.props.set('ACCESS_ENABLED','YES'),e=>e.plan.resources.SPREADSHEET_ID='different-target',e=>e.as('teacher@gmail.com'),e=>e.plan.importSha256='f'.repeat(64)]){
  const e=connection();modify(e);const properties=[...e.props];assert.throws(()=>e.c.connectPersonalStorage_(e.plan));assert.deepEqual([...e.props],properties);assert.equal(e.pilotStats.writes,0);
 }
});

test('Personal connection: additional sharing or an unrelated parent is rejected without importing',()=>{
 for(const change of [e=>e.items.get(e.plan.resources.BACKUPS_FOLDER_ID).getEditors=()=>[{}],e=>e.items.get(e.plan.resources.SPREADSHEET_ID).parent=null]){
  const e=connection();change(e);const before=[...e.props];assert.throws(()=>e.c.connectPersonalStorage_(e.plan));assert.deepEqual([...e.props],before);assert.equal(e.pilotStats.writes,0);
 }
});

test('Personal connection: the one-step editor flow imports once and never overwrites a repeated or incomplete import',()=>{
 const e=connection();vm.runInContext('function setupFixture_(){connectPersonalStorage_('+JSON.stringify(e.plan)+');const meta=GoogleStorage.spreadsheet().getSheetByName("_meta");if(!meta)importInstitution_();return verifyInstitutionImport_();}',e.c);
 e.c.setupFixture_();const writes=e.pilotStats.writes,notes=JSON.stringify(e.current().grades);e.c.setupFixture_();assert.equal(e.pilotStats.writes,writes);assert.equal(JSON.stringify(e.current().grades),notes);
 const broken=connection();broken.c.connectPersonalStorage_(broken.plan);broken.books.get(broken.plan.resources.SPREADSHEET_ID).insertSheet('_meta').getRange(1,1,2,4).setValues([['version','state','schema','commit'],[0,'PREPARING',2,'']]);assert.throws(()=>broken.c.verifyInstitutionImport_(),/todavía no está lista|Faltan tablas obligatorias/);assert.equal(broken.pilotStats.writes,0);
});

test('Personal connection: visible editor entry rejects other accounts, missing identity and supplied parameters',()=>{
 const e=connection();let calls=0;e.c.configurarDriveInconotas_=()=>{calls++;return {status:'TEST_APPROVED_ENTRY'};};
 for(const email of ['teacher@gmail.com','otro@clases.edu.sv','']){e.as(email);assert.throws(()=>e.c.configurarDriveInconotas());}
 e.as(owner);assert.throws(()=>e.c.configurarDriveInconotas({owner}));assert.equal(calls,0);assert.equal(e.c.configurarDriveInconotas().status,'TEST_APPROVED_ENTRY');assert.equal(calls,1);assert.equal(e.pilotStats.writes,0);
});
