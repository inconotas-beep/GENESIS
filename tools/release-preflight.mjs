// Offline preparation only: never logs tokens, contacts Google, pushes, or deploys.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validDeployment,validGoogleEmail} from '../src/auth-policy.mjs';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist/apps-script');
assert.equal(path.resolve(process.cwd()),root,'Ejecutá la revisión desde GENESIS-GOOGLE');
const expected=[...fs.readdirSync('apps-script').filter(file=>file.endsWith('.gs')),'appsscript.json','Core.gs','Schema.gs','SubjectNames.gs','Xlsx.gs','Index.html'].sort();
assert.deepEqual(fs.readdirSync(dist).sort(),expected,'La distribución incluye archivos inesperados o incompletos');
for(const file of expected){
 const bytes=fs.readFileSync(path.join(dist,file),'utf8');if(file.endsWith('.gs'))new vm.Script(bytes,{filename:file});
 if(fs.existsSync('apps-script/'+file))assert.equal(bytes,fs.readFileSync('apps-script/'+file,'utf8'),'Adaptador desactualizado: '+file);
}
for(const [built,source]of [['Core.gs','src/core.js'],['Schema.gs','src/sheets-schema.js'],['SubjectNames.gs','src/subject-names.js']])assert.equal(fs.readFileSync(path.join(dist,built),'utf8'),fs.readFileSync(source,'utf8'));
const html=fs.readFileSync(path.join(dist,'Index.html'),'utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,8);
scripts.forEach((match,i)=>new vm.Script(match[1],{filename:'browser-'+i}));
for(const file of ['web/App.js','web/Functional.js','web/GoogleAuth.js','web/Inco.js','src/inco-formats.js','src/core.js','src/gradebook-xlsx.js','web/Styles.css','web/PrintFormats.css'])assert.ok(html.includes(fs.readFileSync(file,'utf8')),'Recurso desactualizado: '+file);
assert.ok(html.includes(fs.readFileSync('web/assets/inco-logo.png').toString('base64')));assert.ok(!html.includes('src="/assets/'));
const profile=JSON.parse(fs.readFileSync('migration/config/auth-profile.json','utf8')),manifest=JSON.parse(fs.readFileSync(path.join(dist,'appsscript.json'),'utf8'));assert.ok(validDeployment(manifest,profile.mode));assert.ok(manifest.dependencies.enabledAdvancedServices.some(s=>s.serviceId==='sheets'&&s.version==='v4'));
fs.mkdirSync('migration/private',{recursive:true});const propertiesFile='migration/private/script-properties.local.json';
if(!fs.existsSync(propertiesFile))fs.copyFileSync('migration/config/script-properties.example.json',propertiesFile,fs.constants.COPYFILE_EXCL);
const properties=JSON.parse(fs.readFileSync(propertiesFile,'utf8'));assert.equal(properties.AUTH_MODE||'WORKSPACE_SESSION',profile.mode);assert.equal(properties.ENVIRONMENT,'PRODUCTION');
const pending=[];for(const key of ['ADMIN_EMAIL','ROOT_FOLDER_ID','SPREADSHEET_ID','BACKUPS_FOLDER_ID','EXPORTS_FOLDER_ID','DOCUMENTS_FOLDER_ID','IMPORT_FILE_ID','CONFIRM_IMPORT_FILE_ID','IMPORT_SHA256'])if(!properties[key])pending.push('Completar '+key+' con el valor institucional verificado');
if(properties.ADMIN_EMAIL)assert.ok(validGoogleEmail(properties.ADMIN_EMAIL,profile.mode));
if(profile.mode==='GOOGLE_OAUTH')for(const key of ['GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI'])if(!properties[key])pending.push('Configurar '+key+' en las propiedades privadas de Apps Script');
const linked=fs.existsSync('.clasp.json'),credentialFilePresent=fs.existsSync('migration/private/clasp-auth.json');
if(linked){const config=JSON.parse(fs.readFileSync('.clasp.json','utf8'));assert.equal(path.resolve(config.rootDir),dist);assert.match(config.scriptId,/^[A-Za-z0-9_-]{20,}$/);assert.ok(!/REEMPLAZAR|ID_REAL|LOCAL_SELECTION|YOUR_|EXAMPLE/i.test(config.scriptId));}else pending.push('Vincular el ID real del proyecto Apps Script autorizado');
if(!credentialFilePresent)pending.push('Iniciar sesión en clasp y completar personalmente OAuth con la cuenta autorizada');
const temporary='.release-preflight.clasp.json';let selection,created=false;
try{fs.writeFileSync(temporary,JSON.stringify({scriptId:'LOCAL_SELECTION_CHECK_ONLY',rootDir:'dist/apps-script'}),{flag:'wx'});created=true;selection=spawnSync(process.execPath,['tools/clasp.mjs','--project',path.resolve(temporary),'show-file-status'],{encoding:'utf8',windowsHide:true});assert.equal(selection.status,0,'La selección offline de clasp falló');}finally{if(created)fs.unlinkSync(temporary);}
const tracked=selection.stdout.split(/\r?\n/).filter(line=>line.includes('└─')).map(line=>line.split('└─')[1].trim().replaceAll('\\','/'));assert.equal(tracked.length,expected.length);assert.ok(tracked.every(file=>file.startsWith('dist/apps-script/')));
pending.push('Autorizar expresamente la creación de recursos y la subida de código','Ejecutar el piloto con identidades reales en Google y registrar evidencias','Transferir el paquete institucional solo con autorización y ejecutar verifyInstitutionImport_','Medir concurrencia, cuotas y recuperación en el entorno real','Autorizar expresamente la publicación y habilitación de usuarios reales');
const result={status:'PREPARED_LOCALLY_NOT_VERIFIED_IN_GOOGLE',localChecks:'PASSED',authMode:profile.mode,stagingAccess:manifest.webapp.access,distributionFiles:expected.length,inlineScripts:scripts.length,claspVersion:JSON.parse(fs.readFileSync('node_modules/@google/clasp/package.json','utf8')).version,claspSelectionOnlyDist:true,credentialFilePresent,linkedProject:linked,configuredProductionAccessEnabled:properties.ACCESS_ENABLED==='YES',pending,googleOperationsExecuted:false,realGoogleValidation:'NOT_EXECUTED'};
fs.writeFileSync('migration/RELEASE-PREFLIGHT.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
