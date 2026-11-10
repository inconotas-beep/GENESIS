var GoogleStorage=(()=>{
 function spreadsheet(){return SpreadsheetApp.openById(GoogleConfig.property('SPREADSHEET_ID'));}
 function load(){
  if(GoogleConfig.property('WRITE_FAILED',false))throw publicError_('Acceso bloqueado: hay una escritura pendiente de verificar');
  return read(GoogleConfig.property('SPREADSHEET_ID'));
 }
 function read(spreadsheetId){
  GoogleDrive.privateItem(DriveApp.getFileById(spreadsheetId));
  // SpreadsheetApp can retain its sheet list after a Sheets API batch adds tabs in this execution.
  const metadata=Sheets.Spreadsheets.get(spreadsheetId,{fields:'sheets(properties(title))'});
  const available=new Set(metadata.sheets.map(sheet=>sheet.properties.title));
  if(!available.has('_meta')||Genesis.tables.some(table=>!available.has(table)&&!GoogleSchema.optionalTables.includes(table)))throw publicError_('Faltan tablas obligatorias de la base');
  const names=['_meta',...Genesis.tables.filter(table=>available.has(table))];
  const ranges=Sheets.Spreadsheets.Values.batchGet(spreadsheetId,{ranges:names.map(name=>"'"+name+"'"),valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
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
   const sheet=byName.get(table),rows=GoogleSchema.encode(table,db[table]);
   if(!sheet&&!GoogleSchema.optionalTables.includes(table))throw publicError_('Falta una tabla obligatoria; no se guarda');
   if(sheet&&JSON.stringify(before[table])===JSON.stringify(db[table]))return;
   const old=sheet?GoogleSchema.encode(table,before[table]):[],sheetId=sheet?sheet.getSheetId():nextId++;
   const rowCount=Math.max(rows.length,old.length),columnCount=Math.max(rows[0].length,old[0]?.length||0);
   if(!sheet)requests.push({addSheet:{properties:{sheetId,title:table,gridProperties:{rowCount:Math.max(1000,rowCount),columnCount:Math.max(26,columnCount)}}}});
   else if(rowCount>sheet.getMaxRows()||columnCount>sheet.getMaxColumns())requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(rowCount,sheet.getMaxRows()),columnCount:Math.max(columnCount,sheet.getMaxColumns())}},fields:'gridProperties'}});
   // Only changed rows are sent. Trailing cells/rows are explicitly cleared in the same atomic batch.
   for(let i=0;i<rowCount;i++)if(JSON.stringify(old[i])!==JSON.stringify(rows[i]))requests.push({updateCells:{range:{sheetId,startRowIndex:i,endRowIndex:i+1,startColumnIndex:0,endColumnIndex:columnCount},rows:rows[i]?[{values:rows[i].map(cell)}]:[],fields:'userEnteredValue'}});
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
 return {spreadsheet,load,read,save,cell};
})();
