import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {syntheticXlsx} from '../tests/helpers/synthetic-xlsx.mjs';
let playwright;try{playwright=createRequire(import.meta.url)('playwright');}catch{playwright=createRequire(process.execPath)('playwright');}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-stage2-')),base='http://127.0.0.1:3002';
const child=spawn(process.execPath,['tools/server.mjs'],{env:{...process.env,PORT:'3002',GENESIS_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;const report={screens:[],flows:[],directChecks:0,javascriptErrors:[]};
try{
 await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.stderr.once('data',b=>reject(Error(String(b))));});
 browser=await playwright.chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let acceptDialogs=true;
 page.on('dialog',dialog=>acceptDialogs?dialog.accept():dialog.dismiss());page.on('pageerror',error=>report.javascriptErrors.push(error.message));
 const nav=async view=>{await page.locator(`[data-nav="${view}"]`).click();await page.waitForFunction(()=>!busy);};
 const login=async role=>{await page.goto(base);await page.locator('#demoUser').selectOption(role);await page.locator('#enter').click();await page.waitForFunction(()=>!!state&&!busy);assert.equal(await page.evaluate(()=>state.user.id),role);if(await page.locator('#message.error').isVisible())throw Error(await page.locator('#message').innerText());};
 const save=async selector=>{await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api')&&r.request().postData()?.includes('bootstrap')),page.locator(selector).click()]);await page.waitForFunction(()=>!busy);};
 const chooseText=async(selector,text)=>{const value=await page.locator(selector+' option').filter({hasText:text}).first().getAttribute('value');assert.ok(value);await page.locator(selector).selectOption(value);return value;};
 await login('admin');assert.equal(await page.locator('#workspace h1 + p, #workspace h2 + p, #workspace h3 + p').count(),0);
 assert.ok(!/JSON|MVP|versión demostrativa|datos ficticios|base de datos/i.test(await page.locator('body').innerText()));
 await nav('admin');await page.locator('#teacherForm input[name="name"]').fill('Docente Ficticio Etapa Dos');await page.locator('#teacherForm input[name="email"]').fill('etapa2@example.invalid');await save('#teacherForm button');
 await chooseText('#teacherRecord','Docente Ficticio Etapa Dos');await page.locator('#teacherForm input[name="name"]').fill('Docente Ficticio Actualizado');await save('#teacherForm button');
 assert.ok((await page.locator('#teacherRecord').innerText()).includes('Docente Ficticio Actualizado'));report.flows.push('Alta y edición de docente');
 await nav('settings');await page.locator('#roleUser').selectOption('other');await page.locator('#accountRole').selectOption('DIRECTION');await save('#roleForm button');await page.locator('#accountRole').selectOption('TEACHER');await save('#roleForm button');report.flows.push('Cambio de rol confirmado y restauración de la cuenta');
 await nav('catalog');assert.equal(await page.locator('#catalogForm input[name="id"]').count(),0);
 await page.locator('#catalogEntity').selectOption('years');await page.locator('#catalogForm input[name="name"]').fill('2027');await save('#catalogForm button');
 await chooseText('#catalogRecord','2027');await page.locator('#catalogForm input[name="name"]').fill('2028');await save('#catalogForm button');
 await page.locator('#catalogEntity').selectOption('sections');await page.locator('#catalogGrade').selectOption('3');await page.locator('#catalogForm input[name="name"]').fill('C');await save('#catalogForm button');
 await page.locator('#catalogEntity').selectOption('subjects');await page.locator('#catalogForm input[name="name"]').fill('Contabilidad Ficticia');await save('#catalogForm button');
 await page.locator('#enrollForm input[name="nie"]').fill('00000004');await page.locator('#enrollForm input[name="name"]').fill('Estudiante Ficticio Cuatro');await chooseText('#enrollYear','2028');await chooseText('#enrollSection','3.º C');await save('#enrollForm button:not(#saveStudent)');
 await page.locator('#enrollmentSearch').fill('00000004');assert.equal(await page.locator('#enrollmentRows tr').count(),1);await page.locator('[data-student]').click();await page.locator('#enrollForm input[name="name"]').fill('Estudiante Ficticio Cuatro Editado');await save('#saveStudent');
 assert.ok((await page.locator('#enrollmentRows').innerText()).includes('Cuatro Editado'));report.flows.push('Año y edición, grado, sección, materia, matrícula, búsqueda y edición de estudiante');
 await nav('admin');await chooseText('#yearSelect','2028');await page.locator('#teacherSelect').selectOption('teacher');await chooseText('#sectionSelect','3.º C');await chooseText('#subjectSelect','Contabilidad Ficticia');await save('#assignmentForm button');
 await chooseText('#assignmentRecord','Contabilidad Ficticia');await chooseText('#teacherSelect','Docente Ficticio Actualizado');await save('#assignmentForm button');
 await chooseText('#assignmentRecord','Contabilidad Ficticia');await page.locator('#teacherSelect').selectOption('teacher');await save('#assignmentForm button');assert.ok((await page.locator('#assignmentHistory').textContent()).includes('Contabilidad Ficticia'));report.flows.push('Alta y modificación de asignación sin eliminar historial');
 await nav('imports');await chooseText('#importGroup','Matemática');await page.locator('#importPeriod').selectOption('2');await page.locator('#importFile').setInputFiles('examples/preview-ficticio.json');await page.waitForFunction(()=>!busy);
 await page.locator('#buildImportRows').click();await page.waitForFunction(()=>!busy);assert.equal(await page.locator('#importRows [data-include]:checked').count(),1);assert.equal(await page.locator('#stageImport').isDisabled(),true);
 await page.locator('#importConfirmed').check();await save('#stageImport');await chooseText('#batchId','Matemática');await page.waitForFunction(()=>!busy);await page.locator('#approveConfirmed').check();await save('#approve');assert.ok((await page.locator('#batches').innerText()).includes('Importada'));
 await save('#batches [data-revert]');assert.ok((await page.locator('#batches').innerText()).includes('Revertida'));assert.equal(await page.locator('#buildImportRows').isVisible(),true);await page.locator('#buildImportRows').click();await page.waitForFunction(()=>!busy);assert.equal(await page.locator('#importRows [data-include]:checked').count(),1);report.flows.push('Previsualización visual, solicitud, aprobación confirmada, reversión y nueva revisión de importación');
 // Every administrative screen is checked at desktop, laptop, tablet and phone widths.
 fs.mkdirSync('data/local',{recursive:true});
 for(const width of [1440,1280,768,390]){
  await page.setViewportSize({width,height:900});
  for(const view of ['overview','admin','catalog','periods','imports','settings','audit','tools']){
   await nav(view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Desbordamiento ${view} ${width}`);
   if(view!=='tools')assert.ok(!/JSON|MVP|datos ficticios|servidor|base de datos/i.test(await page.locator('#workspace').innerText()),`Texto técnico ${view}`);
   report.screens.push({view,width});
   if(width===1440||width===390){const close=page.getByRole('button',{name:'Cerrar aviso'});if(await close.isVisible())await close.click();await page.screenshot({path:`data/local/etapa2-${view}-${width}.png`,fullPage:true});}
  }
 }
 await page.setViewportSize({width:1360,height:900});await login('teacher');assert.equal(await page.locator('[data-group]').count(),3);assert.equal(await page.locator('[data-nav="admin"]').count(),0);
 await page.locator('[data-group="a1"]').click();await page.locator('#gradeTable input').first().waitFor();
 await page.locator('#gradeTable input').first().press('Enter');assert.equal(await page.locator('#gradeTable [data-row="1"][data-col="0"]').evaluate(el=>el===document.activeElement),true);
 await page.locator('#gradeTable [data-row="1"][data-col="0"]').press('ArrowUp');assert.equal(await page.locator('#gradeTable [data-row="0"][data-col="0"]').evaluate(el=>el===document.activeElement),true);
 const paste=async text=>page.locator('#gradeTable input').first().evaluate((el,text)=>{const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);
 await paste('8\t9\t11');assert.equal(await page.locator('#gradeTable input').first().inputValue(),'');
 await paste('8\t9\t10\n0\t0\t0');assert.match(await page.locator('#gradeTable [data-result]').first().innerText(),/8.95/);assert.equal(await page.locator('#gradeTable [data-result]').nth(1).innerText(),'0.00');
 acceptDialogs=false;await page.locator('#refresh').click();await page.waitForFunction(()=>!busy);assert.equal(await page.locator('#gradeTable input').first().inputValue(),'8');acceptDialogs=true;
 await save('#save');report.flows.push('Docente: tres asignaciones, teclado, pegado validado y atómico, cero, vista previa, prevención de pérdida y guardado');
 // Direct HTTP requests use the real session cookies and cannot elevate the teacher role.
 const token=await page.evaluate(()=>LOCAL_TOKEN),post=async(action,params={})=>page.request.post(base+'/api',{headers:{'X-Genesis-Local':token},data:{action,params}}),version=(await(await post('bootstrap')).json()).version;
 for(const [action,params]of [['assign',{teacherId:'teacher',sectionId:'1A',subjectId:'module',year:'2026'}],['userRole',{userId:'teacher',role:'ADMIN',active:true}],['student',{studentId:'s1',nie:'1',name:'Ataque'}],['approveImport',{batchId:'inventado',rows:[]}],['revoke',{assignmentId:'a1'}]]){const response=await post(action,{...params,version,userId:'admin',role:'ADMIN'});assert.equal(response.status(),400);report.directChecks++;}
 await nav('imports');await chooseText('#importGroup','Matemática');await page.locator('#importPeriod').selectOption('3');await page.locator('#importFile').setInputFiles({name:'notas-ficticias.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:syntheticXlsx()});await page.waitForFunction(()=>!busy);await page.locator('#buildImportRows').click();await page.waitForFunction(()=>!busy);assert.equal(await page.locator('#importRows [data-include]:checked').count(),1);report.flows.push('Lectura local de XLSX sintético y selección de columnas originales');
 await login('direction');assert.equal(await page.locator('[data-nav="settings"]').count(),0);await nav('periods');assert.equal(await page.locator('#closeAction option[value="open"]').evaluate(el=>el.disabled),true,JSON.stringify(await page.evaluate(()=>({role:state.user.role,disabled:document.querySelector('#closeAction option[value="open"]').disabled}))));await save('#periodForm button');
 await login('teacher');await page.locator('[data-group="a1"]').click();await page.locator('#periodState').waitFor();assert.equal(await page.locator('#save').isDisabled(),true);
 const closedVersion=(await(await post('bootstrap')).json()).version,closed=await post('saveGrades',{version:closedVersion,assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[10,10,10]}],role:'ADMIN'});assert.equal(closed.status(),400);assert.match((await closed.json()).error,/cerrado/);report.directChecks++;
 await login('other');await page.getByText('Aún no tenés secciones asignadas. Consultá con administración').waitFor();
 for(const action of ['roster','export','checkImport']){const response=await post(action,{assignmentId:'a1',periodId:'1',rows:[{nie:'00000001',values:[8,9,10]}],userId:'admin'});assert.equal(response.status(),400);report.directChecks++;}
 const unauthorizedXlsx=await page.request.post(base+'/xlsx-preview',{headers:{'X-Genesis-Local':token},data:{assignmentId:'a1',periodId:'1',name:'ficticio.xlsx',content:syntheticXlsx().toString('base64')}});assert.equal(unauthorizedXlsx.status(),400);report.directChecks++;
 report.flows.push('Dirección: consulta y cierre sin reapertura; docente bloqueado por cierre; cuenta sin grupos denegada');assert.deepEqual(report.javascriptErrors,[]);
 report.success=true;fs.writeFileSync('data/local/resultados-interfaz-etapa2.json',JSON.stringify(report,null,2));console.log(JSON.stringify({screens:report.screens.length,flows:report.flows.length,directChecks:report.directChecks,javascriptErrors:report.javascriptErrors.length,success:true}));
}finally{await browser?.close();child.kill();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('genesis-stage2-'));fs.rmSync(dir,{recursive:true,force:true});}
