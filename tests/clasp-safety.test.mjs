import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const run=(file,args,extra={})=>spawnSync(process.execPath,[file,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GENESIS_GOOGLE_AUTHORIZED:'NO'},...extra});
test('clasp no modifica Google sin autorización, incluidas variantes de despliegue y ejecución',()=>{
 for(const command of ['push','deploy','create-script','create-deployment','update-deployment','run-function','run','undeploy']){const result=run('tools/clasp.mjs',[command]);assert.notEqual(result.status,0);assert.match(result.stderr,/autorización explícita/);}
});
test('clasp rechaza credenciales globales, auth alternativo y ADC antes de invocar Google',()=>{
 for(const args of [['--auth=C:/fuera/token.json','show-authorized-user'],['--adc','show-authorized-user'],['--auth','C:/fuera/token.json','show-authorized-user']]){const result=run('tools/clasp.mjs',args);assert.notEqual(result.status,0);assert.match(result.stderr,/credenciales|migration\/private/);}
});
test('la configuración no crea un vínculo con un ID de ejemplo',()=>{
 const existed=fs.existsSync('.clasp.json'),result=run('tools/configure-clasp.mjs',['ID_REAL_DEL_PROYECTO_AUTORIZADO']);assert.notEqual(result.status,0);assert.match(result.stderr,/marcadores de ejemplo/);assert.equal(fs.existsSync('.clasp.json'),existed);
});
test('la autorización para subir código no permite publicar un despliegue',()=>{
 const result=run('tools/clasp.mjs',['deploy'],{env:{...process.env,GENESIS_GOOGLE_AUTHORIZED:'YES',GENESIS_PUBLISH_AUTHORIZED:'NO'}});assert.notEqual(result.status,0);assert.match(result.stderr,/publicación requiere autorización separada/);
});
