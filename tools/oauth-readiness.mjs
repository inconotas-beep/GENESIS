// Read-only inspection. Never logs tokens or changes deployments/properties.
import fs from 'node:fs';
import {google} from 'googleapis';
import {initAuth,getUserInfo} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const project=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});
if(!credentials)throw Error('Falta iniciar sesión en clasp');
const account=await getUserInfo(credentials);
if(account?.email!=='inconotas@gmail.com')throw Error('La cuenta conectada no es inconotas@gmail.com');
const script=google.script({version:'v1',auth:credentials});
const metadata=(await script.projects.get({scriptId:project.scriptId})).data;
const deployments=[];let pageToken;
do{
 const page=(await script.projects.deployments.list({scriptId:project.scriptId,pageToken})).data;
 for(const deployment of page.deployments||[])for(const entry of deployment.entryPoints||[]){
  if(entry.entryPointType==='WEB_APP')deployments.push({deploymentId:deployment.deploymentId,version:deployment.deploymentConfig?.versionNumber??null,url:entry.webApp?.url,access:entry.webApp?.entryPointConfig?.access,executeAs:entry.webApp?.entryPointConfig?.executeAs});
 }
 pageToken=page.nextPageToken;
}while(pageToken);
const report={account:account.email,scriptId:project.scriptId,title:metadata.title,webApps:deployments,scriptPropertiesInspected:false,oauthClientInspected:false,googleWritePerformed:false,storageConfigured:false};
fs.writeFileSync('migration/private/oauth-readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
