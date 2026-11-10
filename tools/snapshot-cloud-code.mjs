// Read-only Google source download, isolated from the project's clasp configuration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),projectFile=path.join(root,'.clasp.json'),before=fs.readFileSync(projectFile),project=JSON.parse(before);
const snapshots=path.join(root,'migration/private/cloud-code-snapshots');fs.mkdirSync(snapshots,{recursive:true});
const directory=path.join(snapshots,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));fs.mkdirSync(directory);
const binary=path.join(root,'node_modules/@google/clasp/build/src/index.js'),auth=path.join(root,'migration/private/clasp-auth.json');
const result=spawnSync(process.execPath,[binary,'--auth',auth,'--project','.', 'clone-script',project.scriptId,'--rootDir','.'],{cwd:directory,encoding:'utf8',windowsHide:true});
if(!before.equals(fs.readFileSync(projectFile)))throw Error('La configuración principal cambió; detener operaciones remotas');
if(result.status!==0)throw Error('No se pudo descargar el código remoto para verificarlo: '+String(result.stderr).slice(0,1200));
const files=fs.readdirSync(directory).filter(file=>/\.(?:js|gs|html|json)$/.test(file)&&file!=='.clasp.json');
const report={downloaded:true,scriptId:project.scriptId,directory,fileCount:files.length,mainConfigurationUnchanged:true,googleWritePerformed:false};
fs.writeFileSync(path.join(root,'migration/private/latest-cloud-code-snapshot.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
