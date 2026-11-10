import test from 'node:test';import assert from 'node:assert/strict';
import {preparePersonalStorage,requirePrivateMetadata} from '../src/personal-storage-setup.mjs';
const owner='inconotas@gmail.com',token='12345678-1234-1234-1234-123456789abc',sha='a'.repeat(64),md5='b'.repeat(32);
function fixture(){
 const files=new Map(),journal={owner,mode:'OWNER_PRIVATE',token,resources:{},pending:{}},creates=[],writes=[];
 const perms={permissions:[{type:'user',role:'owner',emailAddress:owner}]};
 const api={metadata:async id=>files.get(id),permissions:async()=>perms,find:async({key})=>[...files.values()].filter(f=>f.appProperties.genesisResource===key),create:async input=>{
  creates.push(input);const id='file-'+creates.length,file={id,name:input.name,mimeType:input.mimeType,owners:[{emailAddress:owner}],capabilities:{canEdit:true},...(input.parent?{parents:[input.parent]}:{}),appProperties:{genesisSetup:token,genesisResource:input.key,...(input.sha256?{genesisSha256:input.sha256}:{})},...(input.bytes?{md5Checksum:md5}:{})};files.set(id,file);return file;
 }};
 const run=()=>preparePersonalStorage({api,account:owner,journal,persist:async j=>writes.push(structuredClone(j)),importBytes:Buffer.from('synthetic-test-only'),importSha256:sha,importMd5:md5});
 return {files,journal,creates,writes,api,perms,run};
}
test('Personal Drive: creates six private resources, one original package, then safely reuses them',async()=>{
 const e=fixture(),first=await e.run();assert.equal(e.creates.length,6);assert.equal(first.resources.ROOT_FOLDER_ID,'file-1');assert.equal(e.creates.filter(c=>c.bytes).length,1);
 for(const c of e.creates.slice(1))assert.equal(c.parent,'file-1');const second=await e.run();assert.deepEqual(second,first);assert.equal(e.creates.length,6);assert.deepEqual(e.journal.pending,{});
});
test('Personal Drive: a lost response after creation is resumed by its recorded tag without duplicates',async()=>{
 const e=fixture(),create=e.api.create;let failed=false;e.api.create=async input=>{const f=await create(input);if(!failed){failed=true;throw Error('Transport lost');}return f;};await assert.rejects(e.run());assert.equal(e.journal.pending.ROOT_FOLDER_ID,true);await e.run();assert.equal(e.creates.length,6);
});
test('Personal Drive: an uncertain creation with no visible resource is never blindly retried',async()=>{
 const e=fixture();e.api.create=async()=>{throw Error('Unavailable');};await assert.rejects(e.run());await assert.rejects(e.run(),/incierta/);assert.equal(e.creates.length,0);
});
test('Personal Drive: ownership, parent, public sharing and incomplete permissions are enforced',()=>{
 const base={id:'f',owners:[{emailAddress:owner}],capabilities:{canEdit:true},parents:['root']},perms={permissions:[{type:'user',role:'owner',emailAddress:owner}]};
 requirePrivateMetadata(base,perms,owner,'root');
 for(const file of [{...base,trashed:true},{...base,owners:[{emailAddress:'otro@clases.edu.sv'}]},{...base,parents:['other']},{...base,driveId:'external'},{...base,capabilities:{canEdit:false}}])assert.throws(()=>requirePrivateMetadata(file,perms,owner,'root'));
 for(const access of [{permissions:[...perms.permissions,{type:'anyone',role:'reader'}]},{...perms,nextPageToken:'more'},{permissions:[]},{permissions:[{...perms.permissions[0],pendingOwner:true}]}])assert.throws(()=>requirePrivateMetadata(base,access,owner,'root'));
});
test('Personal Drive: changed package or wrong account stops before creating files',async()=>{
 const e=fixture();await e.run();e.journal.importSha256='c'.repeat(64);await assert.rejects(e.run(),/paquete cambió/);assert.equal(e.creates.length,6);
 const other=fixture();other.journal.owner='wrong@example.invalid';await assert.rejects(other.run(),/Cuenta o plan/);assert.equal(other.creates.length,0);assert.equal(other.writes.length,0);
});
test('Personal Drive: an unexpected existing file or duplicate candidates are not adopted or overwritten',async()=>{
 const e=fixture();e.api.find=async()=>[{id:'x',name:'unrelated',mimeType:'application/vnd.google-apps.folder',owners:[{emailAddress:owner}],capabilities:{canEdit:true},appProperties:{}}];await assert.rejects(e.run(),/registro de creación/);assert.equal(e.creates.length,0);
 const duplicate=fixture();duplicate.api.find=async()=>[{id:'a'},{id:'b'}];await assert.rejects(duplicate.run(),/duplicados/);assert.equal(duplicate.creates.length,0);
});
test('Personal Drive: a mismatched uploaded package stays unaccepted, without replacing it',async()=>{
 const e=fixture(),create=e.api.create;e.api.create=async input=>{const f=await create(input);if(input.key==='IMPORT_FILE_ID')f.md5Checksum='d'.repeat(32);return f;};await assert.rejects(e.run(),/no coincide/);assert.equal(e.journal.resources.IMPORT_FILE_ID,undefined);assert.equal(e.journal.pending.IMPORT_FILE_ID,true);assert.equal(e.creates.length,6);
});
