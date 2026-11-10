/* Synthetic-only pilot. No local database, files or institutional rosters are imported. */
var GooglePilot=(()=>{
 function config(){
  if(GoogleConfig.property('ENVIRONMENT',false)!=='PILOT')throw publicError_('Esta operación requiere un proyecto exclusivo de pruebas');
  const id=GoogleConfig.property('PILOT_ID');if(!/^[a-z0-9-]{4,60}$/.test(id))throw publicError_('PILOT_ID inválido');
  const emails=['ADMIN_EMAIL','PILOT_TEACHER_A_EMAIL','PILOT_TEACHER_B_EMAIL'].map(key=>GoogleConfig.property(key).trim().toLowerCase());
  const direction=GoogleConfig.property('PILOT_DIRECTION_EMAIL',false).trim().toLowerCase();if(direction)emails.push(direction);
  if(emails.some(email=>!GoogleConfig.domainEmail(email))||new Set(emails).size!==emails.length)throw publicError_('Configurá una cuenta responsable, dos cuentas docentes distintas y, opcionalmente, Dirección del dominio');
  return {id,emails,fingerprint:hash(JSON.stringify({revision:1,id,emails}))};
 }
 function hash(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
 function authorize(email,action){
  if(GoogleConfig.property('ENVIRONMENT',false)!=='PILOT')return;
  const settings=config();if(!settings.emails.includes(email))throw publicError_('Cuenta no autorizada para este piloto');
  if(!['pilotIdentity','bootstrap','roster','export','saveGrades','period','checkImport','consolidated','reportCard','frame','gradeLock','evaluationPolicy','specialty','sectionSpecialty','frameConfig','importPreview','approveImport','revertImport'].includes(action))throw publicError_('Operación deshabilitada en el piloto sintético');
 }
 function identity(email){const settings=config();authorize(email,'pilotIdentity');const index=settings.emails.indexOf(email);return {environment:'PILOT',pilotId:settings.id,email,role:index===0?'ADMIN':index===3?'DIRECTION':'TEACHER',identityAvailable:true};}
 function fixture(settings){
  const db=Object.fromEntries(Genesis.tables.map(name=>[name,[]]));db.version=0;
  db.roles=['ADMIN','TEACHER','DIRECTION'].map(id=>({id}));
  db.users=settings.emails.map((email,i)=>({id:i===0?'pilot-admin':i===3?'pilot-direction':'pilot-teacher-'+i,email,name:i===0?'Responsable del piloto':i===3?'Dirección del piloto':'Docente piloto '+i,role:i===0?'ADMIN':i===3?'DIRECTION':'TEACHER',active:true}));
  db.users.forEach(user=>{GoogleAccounts.mark(user,user.email,'pilot-admin',true);user.googleIdentity.confirmedAt=GoogleConfig.property('PILOT_INITIALIZED_AT',false);});
  db.teachers=db.users.filter(user=>user.role==='TEACHER').map(user=>({id:user.id,userId:user.id,name:user.name}));
  db.years=[{id:'2099',label:'2099 · PILOTO SINTÉTICO',finalPolicy:{method:'AVERAGE_4',passMark:6,reason:'Criterio de prueba, sin expedientes reales'}}];
  db.periods=[1,2,3,4].map(n=>({id:String(n),year:'2099',name:'Período '+n}));
  db.subjects=[{id:'pilot-subject',name:'Materia sintética del piloto',type:'GENERAL_4_PERIODOS'}];
  db.sections=[1,2].map(n=>({id:'pilot-section-'+n,name:'Sección piloto '+n,grade:'1'}));
  db.assignments=[1,2].map(n=>({id:'pilot-assignment-'+n,teacherId:'pilot-teacher-'+n,year:'2099',sectionId:'pilot-section-'+n,subjectId:'pilot-subject',active:true}));
  for(let n=1;n<=4;n++){const student={id:'pilot-student-'+n,nie:'9900000'+n,name:'Estudiante sintético '+n};db.students.push(student);db.enrollments.push({id:'pilot-enrollment-'+n,studentId:student.id,year:'2099',sectionId:'pilot-section-'+(n<3?1:2)});}
  db.blocks=[{id:'pilot-subject',type:'GENERAL_4_PERIODOS'}];db.activities=[0,1,2].map(index=>({id:'pilot-activity-'+index,blockId:'pilot-subject',index}));db.weights=[{id:'pilot-subject',values:[.35,.35,.3],status:'PILOT'}];
  db.audit=[{id:'pilot-initialization',at:GoogleConfig.property('PILOT_INITIALIZED_AT'),userId:'pilot-admin',kind:'PILOT_INITIALIZED',detail:{pilotId:settings.id,synthetic:true}}];
  return db;
 }
 function synthetic(db,settings){
  GoogleSchema.validate(db);const expected=fixture(settings);
  for(const table of ['students','enrollments','users','teachers','subjects','sections','years','roles','assignments','periods','blocks','activities','weights']){
   const actual=table==='sections'?db[table].map(({specialtyId,...record})=>record):db[table];
   if(JSON.stringify(actual)!==JSON.stringify(expected[table]))throw publicError_('El respaldo no corresponde al conjunto sintético autorizado');
  }
  const nies=new Set(expected.students.map(student=>student.nie));
  if(db.batches.some(batch=>!expected.assignments.some(a=>a.id===batch.assignmentId)||!expected.users.some(user=>user.id===batch.owner)||batch.reviewRows?.some(row=>!nies.has(row.nie)))||db.incidents.length||db.recoveries.length)throw publicError_('El piloto no admite expedientes externos al conjunto sintético');
 }
 function write(ss,db,settings,restoring=false){
  GoogleDrive.privateItem(DriveApp.getFileById(ss.getId()));const existing=ss.getSheetByName('_meta');
  const marker=existing?existing.getDataRange().getValues():null;
  const signature=settings.fingerprint+(restoring?':restore:'+GoogleConfig.property('PILOT_RESTORE_SOURCE'):'');
  if(marker){
   if(marker[1]?.[4]!==settings.id||marker[1]?.[5]!==signature)throw publicError_('La base pertenece a otra inicialización. No se modifica');
   if(marker[1][1]==='READY'){
    const current=GoogleStorage.read(ss.getId());synthetic(current,settings);
    return {status:'ALREADY_INITIALIZED',version:current.version,spreadsheetId:ss.getId(),synthetic:true};
   }
   if(marker[1][1]!=='PREPARING')throw publicError_('Estado de inicialización desconocido');
  }else{
   if(Genesis.tables.some(table=>{const sh=ss.getSheetByName(table);return sh&&sh.getLastRow()>0;}))throw publicError_('La hoja contiene datos ajenos al piloto; no se sobrescriben');
   ss.insertSheet('_meta').getRange(1,1,2,6).setValues([['version','state','schema','commit','pilotId','initialization'],[db.version,'PREPARING',2,'',settings.id,signature]]);
  }
  for(const table of Genesis.tables){
   const rows=GoogleSchema.encode(table,db[table]),sh=ss.getSheetByName(table)||ss.insertSheet(table),previous=sh.getDataRange().getValues();
   // Resume only rows already written by this exact initialization. Never reset live notes.
   if(previous.some((row,i)=>row.some((value,j)=>value!==''&&String(value)!==String(rows[i]?.[j]??''))))throw publicError_('Hay cambios inesperados en '+table+'; se conserva el estado parcial');
   if(rows.length>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),rows.length-sh.getMaxRows());
   if(rows[0].length>sh.getMaxColumns())sh.insertColumnsAfter(sh.getMaxColumns(),rows[0].length-sh.getMaxColumns());
   Sheets.Spreadsheets.batchUpdate({requests:[{updateCells:{range:{sheetId:sh.getSheetId(),startRowIndex:0,endRowIndex:rows.length,startColumnIndex:0,endColumnIndex:rows[0].length},rows:rows.map(row=>({values:row.map(GoogleStorage.cell)})),fields:'userEnteredValue'}}]},ss.getId());
   const readback=Sheets.Spreadsheets.Values.get(ss.getId(),"'"+table+"'",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
   if(JSON.stringify(GoogleSchema.decode(table,readback))!==JSON.stringify(db[table]))throw publicError_('No se verificó la tabla '+table);
  }
  Sheets.Spreadsheets.batchUpdate({requests:[{updateCells:{range:{sheetId:ss.getSheetByName('_meta').getSheetId(),startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:4},rows:[{values:[db.version,'READY',2,Utilities.getUuid()].map(GoogleStorage.cell)}],fields:'userEnteredValue'}}]},ss.getId());
  const verified=GoogleStorage.read(ss.getId());if(verified.version!==db.version||Genesis.tables.some(table=>JSON.stringify(verified[table])!==JSON.stringify(db[table])))throw publicError_('No se verificó la inicialización completa');
  return {status:restoring?'RESTORED_COPY_VERIFIED':'INITIALIZED',version:verified.version,spreadsheetId:ss.getId(),tables:Genesis.tables.length,synthetic:true};
 }
 function initialize(){
  const settings=config(),props=PropertiesService.getScriptProperties();if(!props.getProperty('PILOT_INITIALIZED_AT'))props.setProperty('PILOT_INITIALIZED_AT',new Date().toISOString());
  return write(GoogleStorage.spreadsheet(),fixture(settings),settings);
 }
 function restore(){
  const settings=config(),id=GoogleConfig.property('PILOT_RESTORE_BACKUP_ID'),file=GoogleDrive.privateItem(DriveApp.getFileById(id));
  const text=file.getBlob().getDataAsString('UTF-8');if(hash(text)!==GoogleConfig.property('PILOT_RESTORE_SHA256'))throw publicError_('El respaldo no coincide con el hash confirmado');
  const envelope=JSON.parse(text);if(envelope.schema!=='GENESIS_SNAPSHOT_V2')throw publicError_('Formato de respaldo inválido');synthetic(envelope.database,settings);
  const target=GoogleProvisioning.restoreTarget(id);if(target.getId()===GoogleConfig.property('SPREADSHEET_ID'))throw publicError_('La recuperación requiere otra hoja');
  return write(target,envelope.database,settings,true);
 }
 return {config,authorize,identity,fixture,initialize,restore,hash};
})();
function preparePilot_(){requireProvisioningApproval_();return GoogleConfig.lock(()=>{GooglePilot.config();GoogleProvisioning.ensure();return GooglePilot.initialize();});}
function pilotStatus_(){requireProvisioningApproval_();return GoogleConfig.lock(()=>{const config=GooglePilot.config(),db=GoogleStorage.load();return {environment:'PILOT',pilotId:config.id,version:db.version,tables:Genesis.tables.length,counts:Object.fromEntries(Genesis.tables.map(table=>[table,db[table].length])),googleIdentity:GoogleConfig.identity()};});}
function backupPilot_(){requireProvisioningApproval_();return GoogleConfig.lock(()=>{GooglePilot.config();const id=GoogleDrive.backup(GoogleStorage.load()),text=DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');return {backupId:id,sha256:GooglePilot.hash(text),status:'BACKUP_CREATED'};});}
function restorePilotBackup_(){requireProvisioningApproval_();return GoogleConfig.lock(()=>GooglePilot.restore());}
