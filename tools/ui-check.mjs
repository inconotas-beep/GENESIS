import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
// Uses the optional Playwright installed with the desktop runtime, or a local dev installation.
let playwright;try{playwright=createRequire(import.meta.url)('playwright');}catch{playwright=createRequire(process.execPath)('playwright');}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-ui-'));
const child=spawn(process.execPath,['tools/server.mjs'],{env:{...process.env,PORT:'3001',GENESIS_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try{
 await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.stderr.once('data',b=>reject(Error(String(b))));});
 browser=await playwright.chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>dialog.accept());
 await page.goto('http://127.0.0.1:3001');await page.locator('#enter').click();await page.locator('[data-group="a1"]').waitFor();
 assert.equal(await page.title(),'GENESIS · INCO');assert.equal(await page.locator('[data-nav="settings"]').count(),0);
 assert.equal(await page.locator('[data-group]').count(),2);assert.equal(await page.locator('#admin').isVisible(),false);
 await page.locator('[data-group="a1"]').click();await page.locator('#gradeTable input').first().waitFor();
 for(const [i,v]of ['8','9','10'].entries())await page.locator('#gradeTable input').nth(i).fill(v);
 await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('Cambios sin guardar'));
 assert.match(await page.locator('#gradeTable [data-result]').first().textContent(),/8.95/);
 await page.locator('#studentSearch').fill('00000001');assert.equal(await page.locator('#gradeTable tbody tr:visible').count(),1);
 await page.locator('#studentSearch').fill('sin coincidencias');assert.equal(await page.locator('#studentSearchEmpty').isVisible(),true);
 await page.locator('#studentSearch').fill('');
 await page.locator('[data-nav="imports"]').click();await page.locator('[data-nav="overview"]').click();assert.equal(await page.locator('#gradeTable input').first().inputValue(),'8');
 await page.locator('#save').click();await page.getByRole('status').filter({hasText:'Cambios guardados'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#gradeTable').textContent.includes('8.95'));
 await page.reload();await page.locator('#enter').click();await page.locator('[data-group="a1"]').click();await page.waitForFunction(()=>document.querySelector('#gradeTable').textContent.includes('8.95'));
 // Switch demo accounts through the isolated local access screen.
 await page.reload();await page.locator('#demoUser').selectOption('admin');await page.locator('#enter').click();await page.locator('[data-nav="settings"]').click();await page.locator('#policyPanel').waitFor();
 assert.equal(await page.locator('#weight0').inputValue(),'35');assert.equal(await page.locator('#policyForm input[name="weights"]').count(),0);
 await page.locator('#policySubject').selectOption('module');assert.equal(await page.locator('#weightLabel0').textContent(),'Preparación');assert.equal(await page.locator('#weight1').inputValue(),'50');
 await page.locator('#enablePolicy').click();await page.locator('#weight0').fill('20');assert.equal(await page.locator('#configurePolicy').isDisabled(),true);
 await page.locator('#weight2').fill('30');assert.equal(await page.locator('#configurePolicy').isDisabled(),false);
 await page.locator('#policyDecimals').selectOption('3');await page.locator('#policyForm input[name="reason"]').fill('Configuración ficticia para verificar porcentajes');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api')&&r.request().postData()?.includes('bootstrap')),page.locator('#configurePolicy').click()]);
 await page.locator('#policySubject').selectOption('math');await page.locator('#policySubject').selectOption('module');assert.equal(await page.locator('#weight0').inputValue(),'20');assert.equal(await page.locator('#policyDecimals').inputValue(),'3');
 if(await page.getByRole('button',{name:'Cerrar aviso'}).isVisible())await page.getByRole('button',{name:'Cerrar aviso'}).click();
 fs.mkdirSync('data/local',{recursive:true});await page.screenshot({path:'data/local/interfaz-configuracion.png',fullPage:true});
 await page.locator('[data-nav="periods"]').click();await page.locator('#periodForm button').click();await page.waitForFunction(()=>document.querySelector('#states').textContent.includes('cerrado'));
 await page.locator('[data-nav="overview"]').click();
 await page.locator('[data-group="a1"]').click();await page.waitForFunction(()=>document.querySelector('#periodState').textContent==='Período cerrado');assert.equal(await page.locator('#save').isDisabled(),true);
 await page.locator('[data-group="a2"]').click();await page.waitForFunction(()=>document.querySelectorAll('#gradeTable input').length===9);
 await page.locator('[data-nav="admin"]').click();await page.locator('#assignments [data-revoke="a1"]').click();await page.waitForFunction(()=>!document.querySelector('[data-group="a1"]'));
 await page.reload();await page.locator('#enter').click();await page.locator('[data-group="a2"]').waitFor();assert.equal(await page.locator('[data-group]').count(),1);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-group="a2"]').click();await page.locator('#gradePanel').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.screenshot({path:'data/local/interfaz-movil.png',fullPage:true});
 await page.reload();await page.locator('#demoUser').selectOption('other');await page.locator('#enter').click();await page.getByText('Aún no tenés secciones asignadas. Consultá con administración').waitFor();
 assert.deepEqual(errors,[]);console.log('UI aprobada: nombre GENESIS, navegación por rol, porcentajes y validación del 100 %, configuración persistente, búsqueda, vista previa, cambios pendientes, guardado, cierres, revocación y diseño móvil. Sin errores JavaScript.');
}finally{await browser?.close();child.kill();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('genesis-ui-'));fs.rmSync(dir,{recursive:true,force:true});}
