import {spawnSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
import {validDeployment} from '../src/auth-policy.mjs';
const root=path.resolve(import.meta.dirname,'..');if(path.resolve(process.cwd())!==root)throw Error('Ejecutá clasp desde GENESIS-GOOGLE');
const args=process.argv.slice(2),command=args[0]||'--version';
if(args.some(arg=>/^(?:--auth=|-A.|--adc(?:=|$))/.test(arg)))throw Error('Usá --auth seguido de un archivo privado local; no se utilizan credenciales globales o ADC');
const modifying=args.some(arg=>['push','deploy','create','create-script','create-deployment','delete-deployment','update-deployment','delete','delete-script','undeploy','redeploy','create-version','version','enable-api','disable-api','setup-logs','mcp','start-mcp-server','run','run-function'].includes(arg))&&!args.includes('--help');
if(modifying&&process.env.GENESIS_GOOGLE_AUTHORIZED!=='YES')throw Error('No se modifican recursos de Google sin autorización explícita. Revisá el procedimiento de despliegue.');
if(modifying){
 const publishing=args.some(arg=>['deploy','create-deployment','update-deployment','redeploy','delete-deployment','undeploy'].includes(arg));
 if(publishing&&process.env.GENESIS_PUBLISH_AUTHORIZED!=='YES')throw Error('La publicación requiere autorización separada de la subida de código');
 if(args.includes('--force')||args.includes('-f'))throw Error('No se permiten subidas forzadas');
 const manifest=JSON.parse(fs.readFileSync('dist/apps-script/appsscript.json','utf8'));
 const profile=JSON.parse(fs.readFileSync('migration/config/auth-profile.json','utf8'));
 if(!validDeployment(manifest,profile.mode))throw Error('La identidad o el acceso del manifiesto no coincide con el perfil autorizado');
 if(!fs.existsSync('.clasp.json'))throw Error('Falta vincular el ID real del proyecto de pruebas');
 const config=JSON.parse(fs.readFileSync('.clasp.json','utf8'));
 if(path.resolve(config.rootDir)!==path.join(root,'dist/apps-script')||!config.scriptId||/REEMPLAZAR|ID_REAL|LOCAL_SELECTION|YOUR_|EXAMPLE/i.test(config.scriptId))throw Error('El proyecto debe apuntar al destino real autorizado y únicamente a dist/apps-script');
 if(args.some(arg=>arg==='--project'||arg==='-P'||arg.startsWith('--project=')))throw Error('No se cambia el proyecto de destino durante una operación remota');
}
const binary='node_modules/@google/clasp/build/src/index.js';if(!fs.existsSync(binary))throw Error('Instalá las dependencias de desarrollo con npm ci');
const authFlag=args.findIndex(arg=>['--auth','-A'].includes(arg));
if(authFlag>=0){const auth=path.resolve(args[authFlag+1]||'');if(!auth.startsWith(path.join(root,'migration/private')+path.sep))throw Error('Las credenciales de clasp deben quedar dentro de migration/private');}
const scopedArgs=authFlag>=0?args:['--auth',path.resolve('migration/private/clasp-auth.json'),...(args.length?args:['--version'])];
const result=spawnSync(process.execPath,[binary,...scopedArgs],{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;process.exitCode=result.status??1;
