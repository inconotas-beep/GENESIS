// Read-only guard for updates to the existing owner-only OAuth test deployment.
import fs from 'node:fs';
import path from 'node:path';
import {google} from 'googleapis';
import {initAuth} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const deploymentId=process.env.GENESIS_EXPECTED_DEPLOYMENT_ID;
const expectedScriptId=process.env.GENESIS_EXPECTED_SCRIPT_ID;
if(!deploymentId||!expectedScriptId)throw Error('Configurá los dos ID autorizados en las variables locales');
const deadline=setTimeout(()=>{console.error('La consulta privada excedió 60 segundos. No se modificó Google.');process.exit(1);},60000);
async function inspect(){
 google.options({timeout:20000,retry:false});
 const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});
 if(!credentials)throw Error('NO_AUTH');
 const account=(await google.oauth2({version:'v2',auth:credentials}).userinfo.get()).data.email;
 if(account!=='inconotas@gmail.com')throw Error('WRONG_ACCOUNT');
 const project=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
 if(project.scriptId!==expectedScriptId||path.resolve(project.rootDir)!==path.resolve('dist/apps-script'))throw Error('WRONG_PROJECT');
 const api=google.script({version:'v1',auth:credentials});
 const deployment=(await api.projects.deployments.get({scriptId:project.scriptId,deploymentId})).data;
 const web=deployment.entryPoints?.find(e=>e.entryPointType==='WEB_APP')?.webApp;
 if(web?.entryPointConfig?.access!=='MYSELF'||web?.entryPointConfig?.executeAs!=='USER_DEPLOYING')throw Error('DEPLOYMENT_NOT_PRIVATE');
 if(web.url!=='https://script.google.com/macros/s/'+deploymentId+'/exec')throw Error('WRONG_REDIRECT');
 const head=(await api.projects.getContent({scriptId:project.scriptId})).data.files||[];
 const manifest=JSON.parse(head.find(file=>file.name==='appsscript')?.source||'{}');
 if(manifest.webapp?.access!=='MYSELF'||manifest.webapp?.executeAs!=='USER_DEPLOYING')throw Error('HEAD_NOT_PRIVATE');
 const expected=fs.readdirSync('dist/apps-script').filter(name=>/\.(gs|html|json)$/.test(name));
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const normalized=(name,text)=>name.endsWith('.json')?JSON.stringify(stable(JSON.parse(text))):text.replace(/\r\n/g,'\n');
 function matches(files){return files.length===expected.length&&expected.every(name=>{
  const remote=files.find(file=>file.name===name.replace(/\.(gs|html|json)$/,''));
  return !!remote&&normalized(name,remote.source||'')===normalized(name,fs.readFileSync(path.join('dist/apps-script',name),'utf8'));
 });}
 if(!matches(head))throw Error('HEAD_DIFFERS_FROM_REVIEWED_CODE');
 const version=deployment.deploymentConfig?.versionNumber;
 if(!Number.isInteger(version))throw Error('UNVERSIONED_DEPLOYMENT');
 const released=(await api.projects.getContent({scriptId:project.scriptId,versionNumber:version})).data.files||[];
 const deployedCodeMatches=matches(released);
 if(process.argv.includes('--verify-released')&&!deployedCodeMatches)throw Error('DEPLOYED_CODE_DIFFERS');
 const report={account,scriptId:project.scriptId,deploymentId,version,url:web.url,access:'MYSELF',executeAs:'USER_DEPLOYING',headFilesVerified:expected.length,deployedCodeMatches,googleWritePerformed:false,scriptPropertiesVerified:false};
 fs.writeFileSync('migration/private/oauth-private-deployment-check.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
try{await inspect();}catch(error){console.error('Comprobación privada detenida: '+String(error.code||error.status||(/^[A-Z_]+$/.test(error.message)?error.message:'GOOGLE_QUERY_FAILED')));process.exitCode=1;}finally{clearTimeout(deadline);}
