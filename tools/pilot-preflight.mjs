import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
import {validDeployment,validGoogleEmail} from '../src/auth-policy.mjs';
const root=process.cwd(),dist=path.resolve('dist/apps-script');
const fail=message=>{throw Error(message);};
const expected=[...fs.readdirSync('apps-script').filter(file=>file.endsWith('.gs')),'appsscript.json','Core.gs','Schema.gs','SubjectNames.gs','Xlsx.gs','Index.html'].sort();
const found=fs.readdirSync(dist).sort();if(JSON.stringify(found)!==JSON.stringify(expected))fail('La distribución no coincide con los archivos previstos. Reconstruí y revisá los archivos sobrantes');
for(const file of found){if(file.endsWith('.gs'))new vm.Script(fs.readFileSync(path.join(dist,file),'utf8'),{filename:file});if(fs.existsSync('apps-script/'+file)&&fs.readFileSync('apps-script/'+file,'utf8')!==fs.readFileSync(path.join(dist,file),'utf8'))fail('Build desactualizado: '+file);}
const manifest=JSON.parse(fs.readFileSync(dist+'/appsscript.json','utf8'));
const profile=JSON.parse(fs.readFileSync('migration/config/auth-profile.json','utf8'));if(!validDeployment(manifest,profile.mode))fail('El manifiesto no coincide con el perfil de acceso');
if(!manifest.dependencies?.enabledAdvancedServices?.some(service=>service.userSymbol==='Sheets'&&service.version==='v4'))fail('Falta el servicio avanzado Sheets v4');
const linked=fs.existsSync('.clasp.json'),pending=[];let projectConfigValid=false;
const credentialFilePresent=fs.existsSync('migration/private/clasp-auth.json');if(!credentialFilePresent)pending.push('Completar el inicio de sesión y consentimiento de clasp en Google');
if(linked){const config=JSON.parse(fs.readFileSync('.clasp.json','utf8'));projectConfigValid=!!config.scriptId&&path.resolve(config.rootDir)===dist;if(!projectConfigValid)fail('La configuración clasp apunta fuera de dist/apps-script');}else pending.push('Vincular el ID real del proyecto autorizado con configure-clasp.mjs');
fs.mkdirSync('migration/private',{recursive:true});if(!fs.existsSync('migration/private/pilot-properties.local.json'))fs.copyFileSync('migration/config/pilot-properties.example.json','migration/private/pilot-properties.local.json',fs.constants.COPYFILE_EXCL);
const properties=JSON.parse(fs.readFileSync('migration/private/pilot-properties.local.json','utf8'));
if(properties.ENVIRONMENT!=='PILOT')fail('La configuración debe indicar ENVIRONMENT=PILOT');
for(const key of ['ADMIN_EMAIL','PILOT_TEACHER_A_EMAIL','PILOT_TEACHER_B_EMAIL','ROOT_FOLDER_ID'])if(!properties[key])pending.push('Completar '+key);
const emails=['ADMIN_EMAIL','PILOT_TEACHER_A_EMAIL','PILOT_TEACHER_B_EMAIL'].map(key=>(properties[key]||'').trim().toLowerCase());
if(properties.PILOT_DIRECTION_EMAIL)emails.push(properties.PILOT_DIRECTION_EMAIL.trim().toLowerCase());
if(emails.filter(Boolean).some(email=>!validGoogleEmail(email,properties.AUTH_MODE||'WORKSPACE_SESSION')))fail('Cuenta Google inválida para el perfil del piloto');
if(new Set(emails.filter(Boolean)).size!==emails.filter(Boolean).length)fail('Se requieren tres identidades distintas: responsable y dos docentes');
if(properties.PROVISIONING_APPROVED!=='YES')pending.push('Autorización del usuario para crear recursos todavía no registrada');
// Verify clasp selection offline, with an isolated fake configuration never sent to Google.
const temporary=path.join(root,'.pilot-preflight.clasp.json');if(fs.existsSync(temporary))fail('Ya existe el archivo temporal de comprobación');
let selection;
try{fs.writeFileSync(temporary,JSON.stringify({scriptId:'LOCAL_SELECTION_CHECK_ONLY',rootDir:'dist/apps-script'}));selection=spawnSync(process.execPath,['tools/clasp.mjs','--project',temporary,'show-file-status'],{encoding:'utf8',windowsHide:true});if(selection.status!==0)fail('Falló la selección local de clasp: '+selection.stderr);}finally{fs.unlinkSync(temporary);}
const tracked=selection.stdout.split(/\r?\n/).filter(line=>line.includes('└─')).map(line=>line.split('└─')[1].trim().replaceAll('\\','/'));
if(tracked.length!==expected.length||tracked.some(file=>!file.startsWith('dist/apps-script/')))fail('Clasp selecciona archivos ajenos a la distribución');
const result={localChecks:'PASSED',distributionFiles:expected.length,claspVersion:JSON.parse(fs.readFileSync('node_modules/@google/clasp/package.json','utf8')).version,authMode:profile.mode,claspSelectionOnlyDist:true,credentialsScopedToWorkspace:true,credentialFilePresent,linkedProject:linked,projectConfigValid,access:manifest.webapp.access,executeAs:manifest.webapp.executeAs,pending,realGoogleValidation:'NOT_EXECUTED',resourcesCreated:false,readyToProvision:pending.length===0};
fs.writeFileSync('migration/PILOT-PREFLIGHT.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
