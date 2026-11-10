// Stateful, local-only service doubles for creation, resume and restore tests.
import {googlePlatform} from './google-platform.mjs';
export function pilotPlatform({failure,ownerEmail='owner@clases.edu.sv'}={}){
 const env=googlePlatform(),{c,props}=env,items=new Map(),books=new Map(),stats={folders:0,spreadsheets:0,files:0,writes:0,batches:[]};let failed=false;
 for(const key of ['SPREADSHEET_ID','BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID'])props.delete(key);
 Object.entries({ENVIRONMENT:'PILOT',AUTH_DOMAIN:'clases.edu.sv',ADMIN_EMAIL:ownerEmail,PILOT_TEACHER_A_EMAIL:'a@clases.edu.sv',PILOT_TEACHER_B_EMAIL:'b@clases.edu.sv',PILOT_ID:'pilot-unit-test',ROOT_FOLDER_ID:'root',PROVISIONING_APPROVED:'YES'}).forEach(([key,value])=>props.set(key,value));env.as(ownerEmail);
 const iterator=rows=>{let i=0;return {hasNext:()=>i<rows.length,next:()=>rows[i++]};};
 const fault=name=>{if(failure===name&&!failed){failed=true;throw Error('Injected '+name);}};
 function item(id,name,type,parent,blob){
  const object={id,name,type,parent,blob,getId:()=>id,getName:()=>object.name,getMimeType:()=>type,getOwner:()=>({getEmail:()=>ownerEmail}),getSharingAccess:()=> 'PRIVATE',getEditors:()=>[],getViewers:()=>[],getParents:()=>iterator(object.parent?[items.get(object.parent)]:[]),moveTo:folder=>{object.parent=folder.getId();return object;},getBlob:()=>object.blob,
   getFoldersByName:name=>iterator([...items.values()].filter(i=>i.type==='folder'&&i.parent===id&&i.name===name)),
   createFolder:name=>{fault('folder-before-create');const result=item('folder-'+(++stats.folders),name,'folder',id);fault('folder-after-create');return result;},
   createFile:blob=>item('file-'+(++stats.files),blob.getName(),'file',id,blob)};
  items.set(id,object);return object;
 }
 item('root','Pilot test root','folder');
 function sheet(book,name){
  const target={name,id:book.nextId++,values:[],rows:1000,cols:26,getName:()=>name,getSheetId:()=>target.id,getLastRow:()=>target.values.reduce((last,row,i)=>row?.some(value=>value!==''&&value!==undefined)?i+1:last,0),getMaxRows:()=>target.rows,getMaxColumns:()=>target.cols,getDataRange:()=>({getValues:()=>structuredClone(target.values.slice(0,target.getLastRow())),getFormulas:()=>target.formulas||[]}),insertRowsAfter:(_n,count)=>target.rows+=count,insertColumnsAfter:(_n,count)=>target.cols+=count,getRange:(r,col,n,m)=>({setValues:values=>{for(let i=0;i<values.length;i++){target.values[r-1+i]||=[];values[i].forEach((value,j)=>target.values[r-1+i][col-1+j]=value);}}})};
  book.sheets.set(name,target);return target;
 }
 function book(id,name){const result={id,sheets:new Map(),nextId:1,getId:()=>id,getSheets:()=>[...result.sheets.values()],getSheetByName:name=>result.sheets.get(name)||null,insertSheet:name=>{if(result.sheets.has(name))throw Error('Duplicate sheet');return sheet(result,name);}};books.set(id,result);item(id,name,'application/vnd.google-apps.spreadsheet');return result;}
 c.DriveApp={Access:{PRIVATE:'PRIVATE'},getFolderById:id=>{if(!items.has(id))throw Error('Missing folder');return items.get(id);},getFileById:id=>{if(!items.has(id))throw Error('Missing file');return items.get(id);},getFilesByName:name=>iterator([...items.values()].filter(i=>i.type!=='folder'&&i.name===name))};
 c.SpreadsheetApp={create:name=>{const result=book('sheet-'+(++stats.spreadsheets),name);fault('sheet-after-create');return result;},openById:id=>{if(!books.has(id))throw Error('Missing spreadsheet');return books.get(id);}};
 c.Sheets={Spreadsheets:{get:id=>({sheets:[...books.get(id).sheets.keys()].map(title=>({properties:{title}}))}),Values:{get:(id,range)=>{const name=range.match(/'([^']+)'/)[1],values=books.get(id).sheets.get(name).getDataRange().getValues();return {values:range.includes('A2:D2')?[values[1].slice(0,4)]:values};},batchGet:(id,{ranges})=>({valueRanges:ranges.map(range=>({values:books.get(id).sheets.get(range.match(/'([^']+)'/)[1]).getDataRange().getValues()}))})},batchUpdate:(payload,id)=>{
  const current=books.get(id),staged=new Map([...current.sheets].map(([name,sh])=>[name,{values:structuredClone(sh.values),id:sh.id,rows:sh.rows,cols:sh.cols}]));
  for(const request of payload.requests){
   if(request.addSheet){const p=request.addSheet.properties;if(staged.has(p.title)||[...staged.values()].some(s=>s.id===p.sheetId))throw Error('Duplicate sheet');staged.set(p.title,{values:[],id:p.sheetId,rows:p.gridProperties.rowCount,cols:p.gridProperties.columnCount});continue;}
   if(request.updateSheetProperties){const p=request.updateSheetProperties.properties,target=[...staged.values()].find(s=>s.id===p.sheetId);target.rows=p.gridProperties.rowCount;target.cols=p.gridProperties.columnCount;continue;}
   const {range,rows}=request.updateCells;const [name,target]=[...staged].find(([,sh])=>sh.id===range.sheetId);fault('table:'+name);const values=target.values;
   for(let r=range.startRowIndex;r<range.endRowIndex;r++){values[r]||=[];for(let col=range.startColumnIndex;col<range.endColumnIndex;col++)values[r][col]='';(rows[r-range.startRowIndex]?.values||[]).forEach((cell,i)=>values[r][range.startColumnIndex+i]=cell.userEnteredValue.stringValue);}
  }
  for(const [name,data]of staged){const target=current.sheets.get(name)||sheet(current,name);Object.assign(target,{id:data.id,rows:data.rows,cols:data.cols,values:data.values});current.nextId=Math.max(current.nextId,data.id+1);}stats.writes++;stats.batches.push(structuredClone(payload));return {};
 }}};
 return {...env,items,books,pilotStats:stats,current:()=>JSON.parse(JSON.stringify(c.GoogleStorage.load()))};
}
