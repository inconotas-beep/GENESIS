// In-memory Google service doubles. They never contact Google or create cloud resources.
import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';
import G from '../../tools/core.mjs';import {unzip} from '../../tools/xlsx.mjs';
export function googlePlatform({failure,db=G.seed(),confirmAccounts=true}={}){
 const source=structuredClone(db);source.users.forEach(u=>u.email=u.email.replace('@example.invalid','@clases.edu.sv'));
 if(confirmAccounts)source.users.forEach(user=>user.googleIdentity||=({status:'CONFIRMED',email:user.email,confirmedBy:'synthetic-test-admin',confirmedAt:'2099-01-01T00:00:00Z'}));
 const c={console,Map,Set,testEmail:'docente@clases.edu.sv'},props=new Map([['AUTH_DOMAIN','clases.edu.sv'],['ENVIRONMENT','PRODUCTION'],['ACCESS_ENABLED','YES'],['SPREADSHEET_ID','test-sheet'],['BACKUPS_FOLDER_ID','backups'],['EXPORTS_FOLDER_ID','exports'],['DOCUMENTS_FOLDER_ID','documents']]);
 vm.createContext(c);vm.runInContext(fs.readFileSync('src/core.js','utf8')+'\n'+fs.readFileSync('src/sheets-schema.js','utf8'),c);
 const rows=Object.fromEntries(G.tables.map(t=>[t,JSON.parse(JSON.stringify(c.GoogleSchema.encode(t,source[t])))]));rows._meta=[['version','state','schema','commit'],[source.version,'READY',2,'initial']];
 const files=[],stats={writes:0,locks:0,releases:0,backups:0,loads:0};let locked=false;
 const ids=Object.fromEntries(Object.keys(rows).map((name,i)=>[name,i+1]));
 const sheet=name=>({getName:()=>name,getSheetId:()=>ids[name],getMaxRows:()=>50000,getMaxColumns:()=>100,getDataRange:()=>({getValues:()=>structuredClone(rows[name])})});
 const blob=(bytes,type,name)=>({getBytes:()=>Array.from(typeof bytes==='string'?Buffer.from(bytes):bytes),getDataAsString:()=>typeof bytes==='string'?bytes:Buffer.from(bytes.map(x=>(x+256)%256)).toString('utf8'),getName:()=>name});
 const folder=name=>({getSharingAccess:()=>failure==='shared'?'ANYONE':'PRIVATE',getEditors:()=>[],getViewers:()=>[],createFile:b=>{
  if(failure==='backup'&&name==='backups')throw Error('Quota');if(name==='backups')stats.backups++;
  const file={id:'file-'+files.length,folder:name,blob:b};files.push(file);return {getId:()=>file.id};
 }});
 c.PropertiesService={getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),setProperties:values=>Object.entries(values).forEach(([k,v])=>props.set(k,v))})};
 c.Session={getActiveUser:()=>({getEmail:()=>c.testEmail})};
 c.LockService={getScriptLock:()=>({waitLock:()=>{if(locked||failure==='lock')throw Error('Busy');locked=true;stats.locks++;},releaseLock:()=>{locked=false;stats.releases++;}})};
 c.Utilities={getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},newBlob:blob,base64Decode:s=>Array.from(Buffer.from(s,'base64')),computeDigest:(algorithm,data)=>Array.from(crypto.createHash('sha256').update(typeof data==='string'?data:Buffer.from(data.map(b=>(b+256)%256))).digest()).map(b=>b>127?b-256:b),unzip:b=>[...unzip(Buffer.from(b.getBytes()))].map(([name,bytes])=>blob(Array.from(bytes),null,name))};
 c.SpreadsheetApp={openById:()=>({getId:()=> 'test-sheet',getSheets:()=>Object.keys(rows).map(sheet),getSheetByName:name=>rows[name]?sheet(name):null})};
 c.DriveApp={Access:{PRIVATE:'PRIVATE'},getFolderById:folder,getFileById:()=>({getSharingAccess:()=>failure==='shared-sheet'?'ANYONE':'PRIVATE',getEditors:()=>[],getViewers:()=>[],getBlob:()=>blob(JSON.stringify({pending:[]}),null,'review')})};
 c.Sheets={Spreadsheets:{get:()=>({sheets:Object.keys(rows).map(title=>({properties:{title}}))}),Values:{batchGet:(_id,{ranges})=>{stats.loads++;return {valueRanges:ranges.map(range=>({values:structuredClone(rows[range.match(/'([^']+)'/)[1]])}))};},get:()=>({values:[structuredClone(rows._meta[1])]})},batchUpdate:payload=>{
  if(failure==='reject')throw Error('Invalid request');const staged=structuredClone(rows),stagedIds={...ids};
  for(const request of payload.requests){if(request.addSheet){const {sheetId,title}=request.addSheet.properties;if(staged[title])throw Error('Duplicate sheet');staged[title]=[];stagedIds[title]=sheetId;continue;}if(request.updateSheetProperties)continue;const {range,rows:updates}=request.updateCells;const name=Object.keys(stagedIds).find(name=>stagedIds[name]===range.sheetId);
   if(!name)throw Error('Invalid sheet');for(let r=range.startRowIndex;r<range.endRowIndex;r++){
    staged[name][r]||=[];for(let col=range.startColumnIndex;col<range.endColumnIndex;col++)staged[name][r][col]='';
    const values=updates[r-range.startRowIndex]?.values||[];values.forEach((cell,i)=>{staged[name][r][range.startColumnIndex+i]=cell.userEnteredValue.stringValue;});
   }
  }
  Object.assign(rows,staged);Object.assign(ids,stagedIds);stats.writes++;if(failure==='lost-response')throw Error('Network after commit');return {};
 }}};
 for(const file of ['Config.gs','Accounts.gs','OAuth.gs','Drive.gs','Storage.gs','Code.gs','Administration.gs','Provisioning.gs','Pilot.gs','Verification.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),c,{filename:file});
 vm.runInContext(fs.readFileSync('dist/apps-script/Xlsx.gs','utf8'),c);
 return {c,props,rows,files,stats,as(email){c.testEmail=email;},database(){return JSON.parse(JSON.stringify(c.GoogleStorage.load()));}};
}
