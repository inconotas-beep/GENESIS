// Verify the actual downloaded Google source against the prepared distribution.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const snapshot=JSON.parse(fs.readFileSync('migration/private/latest-cloud-code-snapshot.json','utf8')),project=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
assert.equal(snapshot.scriptId,project.scriptId);assert.equal(path.resolve(project.rootDir),path.resolve('dist/apps-script'));
const expected=fs.readdirSync('dist/apps-script').filter(name=>/\.(gs|html|json)$/.test(name)),remote=fs.readdirSync(snapshot.directory).filter(name=>/\.(js|gs|html|json)$/.test(name)&&name!=='.clasp.json');
assert.equal(remote.length,expected.length,'El número de archivos remotos no coincide');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const normalized=(file,text)=>file.endsWith('.json')?JSON.stringify(stable(JSON.parse(text))):text.replace(/\r\n/g,'\n');
const files=expected.map(file=>{
 const stem=file.replace(/\.gs$/, ''),name=file.endsWith('.gs')?remote.find(item=>item===stem+'.gs'||item===stem+'.js'):remote.find(item=>item===file);assert.ok(name,'Falta en Google: '+file);
 const local=normalized(file,fs.readFileSync(path.join('dist/apps-script',file),'utf8')),downloaded=normalized(file,fs.readFileSync(path.join(snapshot.directory,name),'utf8'));assert.equal(downloaded,local,'El contenido remoto difiere: '+file);
 return {name:file,sha256:crypto.createHash('sha256').update(local).digest('hex')};
});
const report={status:'UPLOADED_AND_VERIFIED',scriptId:project.scriptId,filesVerified:files.length,verifiedFromGoogle:true,files,deploymentCreated:false,oauthClientConfigured:false,storageConfigured:false,studentDataUploaded:false,originalProjectWritten:false};
fs.writeFileSync('migration/SUBIDA-CODIGO.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,filesVerified:files.length,verifiedFromGoogle:true,deploymentCreated:false,oauthClientConfigured:false,storageConfigured:false,studentDataUploaded:false},null,2));
