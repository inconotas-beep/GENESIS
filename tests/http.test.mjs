import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('HTTP autenticado: elimina acceso por rol, valida contraseña, autorización y cierre de sesión',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-http-')),child=spawn(process.execPath,['tools/server.mjs'],{env:{...process.env,PORT:'0',GENESIS_DATA_DIR:dir,GENESIS_INITIAL_PASSWORD:'Test-Access-918!',GENESIS_TEST_ACCOUNTS:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{const base=await new Promise((resolve,reject)=>{child.stdout.once('data',b=>resolve(String(b).match(/http:\/\/127\.0\.0\.1:\d+/)[0]));child.once('error',reject);child.stderr.once('data',b=>reject(Error(String(b))));});
 const html=await(await fetch(base)).text(),token=html.match(/const LOCAL_TOKEN='([^']+)'/)[1];
 const post=async(url,body,cookie='')=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':token,Cookie:cookie},body:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 assert.equal((await post('/demo-login',{userId:'admin'})).status,404);assert.equal((await post('/login',{username:'Rocio',password:'incorrecta',role:'ADMIN'})).status,400);
 const login=await post('/login',{username:'teacher',password:'Test-Access-918!'});assert.equal(login.status,200);const boot=await post('/api',{action:'bootstrap'},login.cookie);assert.equal(boot.body.user.role,'TEACHER');
 assert.equal((await post('/api',{action:'userRole',params:{userId:'teacher',role:'ADMIN',active:true,version:boot.body.version}},login.cookie)).status,400);
 assert.equal((await post('/access-account',{userId:'admin',username:'atacante',password:'Test-Attack-918!',version:boot.body.version},login.cookie)).status,400);
 const admin=await post('/login',{username:'Rocio',password:'Test-Access-918!'});
 assert.equal((await post('/access-account',{userId:'teacher',username:'docente',password:'Docente-New-918!',version:boot.body.version},admin.cookie)).status,200);
 assert.equal((await post('/api',{action:'bootstrap'},login.cookie)).status,400);
 assert.equal((await post('/login',{username:'docente',password:'Docente-New-918!'})).status,200);
 await post('/logout',{},login.cookie);assert.equal((await post('/api',{action:'bootstrap'},login.cookie)).status,400);
 }finally{child.kill();assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
