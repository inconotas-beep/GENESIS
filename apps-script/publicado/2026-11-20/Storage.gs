var GoogleStorage=(()=>{
 function spreadsheet(){return SpreadsheetApp.openById(GoogleConfig.property('SPREADSHEET_ID'));}
 function checkWriteState(){
  if(!GoogleConfig.property('WRITE_FAILED',false))return;
  const error=publicError_('Acceso bloqueado: hay una escritura pendiente de verificar');
  error.genesisSnapshotChanged=true;
  throw error;
 }
 function load(){
  checkWriteState();
  return read(GoogleConfig.property('SPREADSHEET_ID'));
 }
 function loadSubset(tables,scope){
  checkWriteState();
  return read(GoogleConfig.property('SPREADSHEET_ID'),tables,scope);
 }
 function readSheetsRequest(request){
  const delays=[0,500,1250];
  for(const [attempt,delay] of delays.entries()){
   if(delay)Utilities.sleep(delay);
   try{return request();}
   catch(error){
    const status=error.details?.code??error.code;
    const transient=[429,500,502,503,504].includes(Number(status))||
     /internal error(?: encountered)?|internal server error|backend error|service (?:temporarily )?unavailable|deadline[ _-]+exceeded|timed? out|rate limit exceeded/i.test(String(error.message||error));
    if(!transient)throw error;
    if(attempt===delays.length-1){
     throw publicError_('Google Sheets no respondió al cargar la base de notas. Esperá unos segundos y volvé a intentar.');
    }
   }
  }
 }
 function readSheetNames(spreadsheetId,force=false){
  const key='genesis-sheet-names-v1:'+spreadsheetId;
  const cache=typeof CacheService!=='undefined'?CacheService.getScriptCache():null;
  if(!force){
   try{const saved=cache?.get(key);if(saved)return new Set(JSON.parse(saved));}catch{}
  }
  const metadata=readSheetsRequest(()=>Sheets.Spreadsheets.get(spreadsheetId,{fields:'sheets(properties(title))'}));
  const names=metadata.sheets.map(sheet=>sheet.properties.title);
  // Avoid hiding newly created optional tables behind a cached inventory.
  if(Genesis.tables.every(name=>names.includes(name))){
   try{cache?.put(key,JSON.stringify(names),300);}catch{}
  }
  return new Set(names);
 }
 function scopedGradeTables(spreadsheetId,names,ranges,columns,scope){
  const groups=[];
  for(const [table,col] of Object.entries(columns)){
   const nameIndex=names.indexOf(table);
   if(nameIndex<0)continue;
   const projection=ranges[nameIndex].values||[];
   const allowed=new Set(scope.sectionIds);
   const wanted=new Set();
   for(let i=1;i<projection.length;i++){
    const row=projection[i]||[];
    if(String(row[0]??'')===String(scope.year)&&allowed.has(String(row[1]??'')))wanted.add(i+1);
   }
   const windows=new Map();
   for(const row of wanted){
    const window=Math.floor((row-2)/80);
    const interval=windows.get(window)||[row,row];
    interval[1]=row;windows.set(window,interval);
   }
   const span=[{from:1,to:1},...[...windows.values()].map(([from,to])=>({from,to}))];
   groups.push({table,nameIndex,wanted,span,values:[]});
  }
  const pending=groups.flatMap(group=>group.span.map(span=>({group,...span})));
  // Limit each response to a few hundred grade rows and keep the revision lock.
  for(let start=0;start<pending.length;start+=5){
   const requests=pending.slice(start,start+5);
   const response=readSheetsRequest(()=>Sheets.Spreadsheets.Values.batchGet(spreadsheetId,{
    ranges:requests.map(item=>"'"+item.group.table+"'!"+item.from+':'+item.to),
    valueRenderOption:'UNFORMATTED_VALUE'
   }));
   requests.forEach(({group,from},i)=>{
    (response.valueRanges[i].values||[]).forEach((row,index)=>{
     if(from===1||group.wanted.has(from+index))group.values.push(row);
    });
   });
  }
  // Older databases can contain positional keys. Decode them in their original table.
  for(const group of groups){
   if(group.values.some(row=>String(row[0]??'').startsWith('legacy-'))){
    const response=readSheetsRequest(()=>Sheets.Spreadsheets.Values.batchGet(spreadsheetId,{
     ranges:["'"+group.table+"'"],valueRenderOption:'UNFORMATTED_VALUE'
    }));
    ranges[group.nameIndex]=response.valueRanges[0];
   }else ranges[group.nameIndex]={values:group.values};
  }
 }
 function read(spreadsheetId,subset,scope){
  readSheetsRequest(()=>GoogleDrive.privateItem(DriveApp.getFileById(spreadsheetId)));
  // SpreadsheetApp can retain its sheet list after a Sheets API batch adds tabs in this execution.
  const requested=subset||Genesis.tables;
  const accessesOptional=!subset||requested.some(table=>GoogleSchema.optionalTables.includes(table));
  const getNames=force=>{
   if(!accessesOptional)return ['_meta',...requested];
   const available=readSheetNames(spreadsheetId,force);
   if(!available.has('_meta')||requested.some(table=>!available.has(table)&&!GoogleSchema.optionalTables.includes(table)))throw publicError_('Faltan tablas obligatorias de la base');
   return ['_meta',...requested.filter(table=>available.has(table))];
  };
  let names=getNames(false);
  const columns=scope?{grades:'D:E',moduleFinals:'D:E',sectionResults:'C:D'}:{};
  const batch=()=>readSheetsRequest(()=>Sheets.Spreadsheets.Values.batchGet(spreadsheetId,{
   ranges:names.map(name=>"'"+name+"'"+(columns[name]?'!'+columns[name]:'')),valueRenderOption:'UNFORMATTED_VALUE'
  }));
  let ranges;
  try{({valueRanges:ranges}=batch());}
  catch(error){
   if(!accessesOptional||!(/unable to parse range|range not found|invalid range/i.test(String(error.message||''))))throw error;
   const fresh=getNames(true);
   if(JSON.stringify(fresh)===JSON.stringify(names))throw error;
   names=fresh;
   ({valueRanges:ranges}=batch());
  }
  if(scope){
   const start=(ranges[0].values||[])[1]||[];
   scopedGradeTables(spreadsheetId,names,ranges,columns,scope);
   const confirmed=readSheetsRequest(()=>Sheets.Spreadsheets.Values.batchGet(spreadsheetId,{
    ranges:["'_meta'"],valueRenderOption:'UNFORMATTED_VALUE'
   })).valueRanges[0]?.values?.[1]||[];
   checkWriteState();
   if(start.slice(0,5).join('|')!==confirmed.slice(0,5).join('|')){
    const error=publicError_('Las notas cambiaron mientras se cargaba la sección. Volvé a consultar.');
    error.genesisSnapshotChanged=true;
    throw error;
   }
  }
  checkWriteState();
  const info=ranges[0].values||[];if(info[1]?.[1]!=='READY'||Number(info[1]?.[2])!==2)throw publicError_('La base todavía no está lista');
  const environment=GoogleConfig.property('ENVIRONMENT',false);
  if(environment==='PRODUCTION'&&info[1]?.[4])throw publicError_('Una base sintética de piloto no puede utilizarse en producción');
  if(environment==='PILOT'&&info[1]?.[4]!==GoogleConfig.property('PILOT_ID'))throw publicError_('La base no corresponde al piloto autorizado');
  const db={version:Number(info[1][0])};if(!Number.isSafeInteger(db.version)||db.version<0||String(info[1][0]).trim()==='')throw publicError_('Versión de base inválida');Genesis.tables.forEach(table=>{const index=names.indexOf(table);db[table]=index<0?[]:GoogleSchema.decode(table,ranges[index].values||[]);});
  return db;
 }
 function cell(value){return {userEnteredValue:{stringValue:String(value??'')}};}
 function save(db,before){
  if(!before||db.version!==before.version+1)throw publicError_('Versión de escritura inválida');
  const ss=spreadsheet(),props=PropertiesService.getScriptProperties(),requests=[],sheets=ss.getSheets(),byName=new Map(sheets.map(sheet=>[sheet.getName(),sheet]));
  let nextId=Math.max(0,...sheets.map(sheet=>sheet.getSheetId()))+1;
  Genesis.tables.forEach(table=>{
   const sheet=byName.get(table);
   if(!sheet&&!GoogleSchema.optionalTables.includes(table))throw publicError_('Falta una tabla obligatoria; no se guarda');
   if(sheet&&(before[table]===db[table]||JSON.stringify(before[table])===JSON.stringify(db[table])))return;
   const rows=GoogleSchema.encode(table,db[table]);
   const old=sheet?GoogleSchema.encode(table,before[table]):[],sheetId=sheet?sheet.getSheetId():nextId++;
   const rowCount=Math.max(rows.length,old.length),columnCount=Math.max(rows[0].length,old[0]?.length||0);
   if(!sheet)requests.push({addSheet:{properties:{sheetId,title:table,gridProperties:{rowCount:Math.max(1000,rowCount),columnCount:Math.max(26,columnCount)}}}});
   else if(rowCount>sheet.getMaxRows()||columnCount>sheet.getMaxColumns())requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(rowCount,sheet.getMaxRows()),columnCount:Math.max(columnCount,sheet.getMaxColumns())}},fields:'gridProperties'}});
   // Only changed rows are sent. Trailing cells/rows are explicitly cleared in the same atomic batch.
   let start=-1,changed=[];
   for(let i=0;i<=rowCount;i++){
    if(i<rowCount&&JSON.stringify(old[i])!==JSON.stringify(rows[i])){
     if(start<0)start=i;
     if(rows[i])changed.push({values:rows[i].map(cell)});
     continue;
    }
    if(start<0)continue;
    requests.push({updateCells:{range:{sheetId,startRowIndex:start,endRowIndex:i,
     startColumnIndex:0,endColumnIndex:columnCount},rows:changed,fields:'userEnteredValue'}});
    start=-1;changed=[];
   }
  });
  const commit=Utilities.getUuid(),meta=ss.getSheetByName('_meta');
  requests.push({updateCells:{range:{sheetId:meta.getSheetId(),startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:4},rows:[{values:[db.version,'READY',2,commit].map(cell)}],fields:'userEnteredValue'}});
  const payload={requests};if(JSON.stringify(payload).length>1800000)throw publicError_('El lote es demasiado grande. Guardá menos estudiantes por vez');
  GoogleDrive.backup(before);
  props.setProperty('WRITE_FAILED',commit);
  try{Sheets.Spreadsheets.batchUpdate(payload,ss.getId());}
  catch(error){
   // A transport failure can occur after a committed request. Verify, never blindly retry.
   let found;try{found=Sheets.Spreadsheets.Values.get(ss.getId(),"'_meta'!A2:D2",{valueRenderOption:'UNFORMATTED_VALUE'}).values?.[0];}catch{}
   if(found&&String(found[3])===commit&&Number(found[0])===db.version){props.deleteProperty('WRITE_FAILED');return;}
   throw publicError_('No se confirmó el guardado. El acceso quedó bloqueado para proteger las notas; contactá con administración');
  }
  props.deleteProperty('WRITE_FAILED');
 }
 return {spreadsheet,load,loadSubset,read,save,cell};
})();
