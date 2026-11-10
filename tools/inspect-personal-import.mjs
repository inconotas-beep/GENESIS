// Read-only inspection of the exact private target and prepared package.
import fs from 'node:fs';import crypto from 'node:crypto';import vm from 'node:vm';
import {google} from 'googleapis';import {initAuth} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const timer=setTimeout(()=>{console.error('La inspección excedió 60 segundos; no se modificó Sheets.');process.exit(1);},60000);
try{
 google.options({timeout:20000,retry:false});const plan=JSON.parse(fs.readFileSync('migration/private/personal-storage-connection.json','utf8'));
 const pointer=JSON.parse(fs.readFileSync('migration/private/latest-package.json','utf8')),bytes=fs.readFileSync(pointer.file);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==plan.importSha256)throw Error('El paquete local cambió');
 const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});const account=(await google.oauth2({version:'v2',auth:credentials}).userinfo.get()).data.email;if(account!==plan.owner||account!=='inconotas@gmail.com')throw Error('Cuenta incorrecta');
 const drive=google.drive({version:'v3',auth:credentials}),file=(await drive.files.get({fileId:plan.resources.SPREADSHEET_ID,fields:'id,owners(emailAddress),parents,trashed'})).data;
 if(file.trashed||file.owners?.length!==1||file.owners[0].emailAddress!==account||file.parents?.[0]!==plan.resources.ROOT_FOLDER_ID)throw Error('Destino incorrecto');
 const access=(await drive.permissions.list({fileId:file.id,fields:'permissions(type,role,emailAddress),nextPageToken'})).data;if(access.nextPageToken||access.permissions?.length!==1||access.permissions[0].type!=='user'||access.permissions[0].role!=='owner'||access.permissions[0].emailAddress!==account)throw Error('Permisos no privados');
 const api=google.sheets({version:'v4',auth:credentials}),metadata=(await api.spreadsheets.get({spreadsheetId:file.id,fields:'spreadsheetId,sheets(properties)'})).data;
 const titles=metadata.sheets.map(s=>s.properties.title),ranges=titles.map(t=>"'"+t.replaceAll("'","''")+"'");
 const data=(await api.spreadsheets.values.batchGet({spreadsheetId:file.id,ranges,valueRenderOption:'UNFORMATTED_VALUE'})).data.valueRanges;
 const context={};vm.createContext(context);for(const source of ['src/subject-names.js','src/core.js','src/sheets-schema.js'])vm.runInContext(fs.readFileSync(source,'utf8'),context);
 const expected=JSON.parse(bytes).database,expectedRows=Object.fromEntries(context.Genesis.tables.map(t=>[t,JSON.parse(JSON.stringify(context.GoogleSchema.encode(t,expected[t])))]));
 const sheets=metadata.sheets.map((s,i)=>({...s.properties,values:data[i].values||[]}));
 const snapshot={spreadsheetId:file.id,sourceSha256:plan.sourceSha256,packageSha256:plan.importSha256,capturedAt:new Date().toISOString(),sheets};fs.writeFileSync('migration/private/personal-import-before-recovery.json',JSON.stringify(snapshot));
 const tables=sheets.map(s=>({table:s.title,rowsPresent:s.values.length,rowsExpected:expectedRows[s.title]?.length??null,columns:s.gridProperties.columnCount}));
 console.log(JSON.stringify({readOnly:true,account,privateTargetVerified:true,meta:sheets.find(s=>s.title==='_meta')?.values||null,tables,expectedGrades:expected.grades.length},null,2));
}catch(error){console.error('Inspección detenida: '+String(error.code||error.status||(!error.config&&!error.response?error.message:'GOOGLE_QUERY_FAILED')));process.exitCode=1;}finally{clearTimeout(timer);}
