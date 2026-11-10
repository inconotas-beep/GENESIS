import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import G from '../tools/core.mjs';
function platform(failure){
  const seed=G.seed(),rows=Object.fromEntries(G.tables.map(t=>[t,[['id','record_json'],...seed[t].map((r,i)=>[String(r.id||i),JSON.stringify(r)])]]));rows._meta=[['version'],[0]];
  const props=new Map([['SPREADSHEET_ID','institution']]);let backups=0,writes=0,releases=0,backup;
  const sheet=name=>({getDataRange:()=>({getValues:()=>structuredClone(rows[name])}),getMaxRows:()=>1000,getLastRow:()=>rows[name].length,insertRowsAfter:()=>{},getRange:(r,c=1)=>{
    if(typeof r==='string'){const m=r.match(/([A-Z])(\d+)/);c=m[1].charCodeAt(0)-64;r=Number(m[2]);}
    return {getValue:()=>rows[name][r-1]?.[c-1],setValues:values=>{if(failure==='grades'&&name==='grades')throw Error('Fallo simulado');writes++;for(let i=0;i<values.length;i++)rows[name][r-1+i]=values[i].slice();},setValue:value=>{rows[name][r-1][c-1]=value;},clearContent:()=>{rows[name]=rows[name].slice(0,r-1);}};
  }});
  const ss={getId:()=> 'institution',getSheetByName:name=>rows[name]?sheet(name):null};
  const context={Session:{getActiveUser:()=>({getEmail:()=> 'docente@example.invalid'})},Utilities:{getUuid:()=>crypto.randomUUID()},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>releases++})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value),deleteProperty:key=>props.delete(key)})},SpreadsheetApp:{openById:()=>ss,flush:()=>{if(failure==='flush')throw Error('Interrupción simulada');}},DriveApp:{getFileById:()=>({makeCopy:()=>{if(failure==='backup')throw Error('Cuota simulada');backups++;backup=structuredClone(rows);return {getId:()=> 'backup'};}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8')+'\n'+fs.readFileSync('migration/legacy-Code.gs.txt','utf8'),context);
  return {context,props,rows,stats:()=>({backups,writes,releases,backup})};
}
const params={version:0,assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[8,9,10]}]};
test('escritura parcial de Sheets bloquea accesos posteriores y conserva respaldo previo',()=>{const {context,props,stats}=platform('grades');assert.throws(()=>context.api('saveGrades',params));assert.equal(props.get('WRITE_FAILED'),'WRITE_IN_PROGRESS');assert.equal(props.get('LAST_BACKUP_ID'),'backup');assert.equal(stats().backup.grades.length,1);assert.equal(stats().releases,1);assert.throws(()=>context.api('bootstrap',{}),/bloqueado/);assert.equal(stats().releases,2);});
test('interrupción al confirmar la escritura no vuelve a habilitar accesos',()=>{const {context,props}=platform('flush');assert.throws(()=>context.api('saveGrades',params));assert.ok(props.get('WRITE_FAILED'));assert.throws(()=>context.api('bootstrap',{}),/bloqueado/);});
test('fallo al respaldar no inicia escrituras ni modifica la versión',()=>{const {context,props,rows,stats}=platform('backup');assert.throws(()=>context.api('saveGrades',params));assert.equal(stats().writes,0);assert.equal(rows._meta[1][0],0);assert.equal(props.has('WRITE_FAILED'),false);});
test('escritura completa conserva versión y auditoría y retira la marca de interrupción',()=>{const {context,props,rows,stats}=platform();context.api('saveGrades',params);assert.equal(rows._meta[1][0],1);assert.equal(rows.grades.length,2);assert.ok(rows.audit.length>1);assert.equal(props.has('WRITE_FAILED'),false);assert.equal(stats().backups,1);assert.equal(context.api('roster',{assignmentId:'a1',periodId:'1'}).students[0].result.value,8.95);});
