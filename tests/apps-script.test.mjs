import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function platform(email){
 let stored,released=0,saved=0;
 const config={AUTH_DOMAIN:'example.invalid',ENVIRONMENT:'PRODUCTION',ACCESS_ENABLED:'YES'};
 const c={PropertiesService:{getScriptProperties:()=>({getProperty:name=>config[name]||null})},Session:{getActiveUser:()=>({getEmail:()=>email})},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>released++})},Utilities:{getUuid:()=>crypto.randomUUID()}};
 vm.createContext(c);for(const file of ['src/core.js','apps-script/Config.gs','apps-script/Accounts.gs','apps-script/Code.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 stored=JSON.parse(JSON.stringify(c.Genesis.seed()));stored.users.forEach(user=>user.googleIdentity={status:'CONFIRMED',email:user.email});
 c.loadDatabase_=()=>structuredClone(stored);c.saveDatabase_=db=>{stored=JSON.parse(JSON.stringify(db));saved++;};return {c,counts:()=>({released,saved}),db:()=>stored};
}
test('Apps Script deniega identidad Google vacía sin leer la base',()=>{const {c,counts}=platform('');assert.throws(()=>c.api('bootstrap',{}),/identidad/);assert.equal(counts().saved,0);});
test('Apps Script ignora identidad enviada por cliente y libera bloqueo al fallar',()=>{const {c,counts}=platform('sin-grupos@example.invalid');assert.throws(()=>c.api('roster',{email:'rocio@example.invalid',assignmentId:'a1',periodId:'1'}),/denegado/);assert.equal(counts().released,1);assert.equal(counts().saved,0);});
test('Apps Script persiste operaciones autorizadas a través del mismo motor',()=>{const {c,counts,db}=platform('docente@example.invalid');c.api('saveGrades',{version:0,assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,9,10]}]});assert.equal(db().grades.length,1);assert.equal(db().version,1);assert.equal(counts().saved,1);assert.equal(counts().released,1);});
