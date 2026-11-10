// Browser integration against the real migration code with in-memory Google services.
// This validates google.script.run transport locally, not a deployed Google account.
import {createRequire} from 'node:module';import fs from 'node:fs';import assert from 'node:assert/strict';
import {googlePlatform} from '../tests/helpers/google-platform.mjs';import G from './core.mjs';import {syntheticXlsx} from '../tests/helpers/synthetic-xlsx.mjs';
const require=createRequire(process.execPath),pw=require('playwright'),db=G.seed();
db.users.push({id:'second',name:'Docente dos ficticio',email:'second@example.invalid',role:'TEACHER',active:true});db.teachers.push({id:'second',userId:'second',name:'Docente dos ficticio'});db.assignments[1].teacherId='second';
const env=googlePlatform({db}),browser=await pw.chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),errors=[];
const html=fs.readFileSync('dist/apps-script/Index.html','utf8'),output='data/local/google-ui';fs.mkdirSync(output,{recursive:true});
async function pageFor(email){
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'Revisión académica sintética autorizada':undefined));
 await page.exposeFunction('__googleApi',(action,params)=>{env.as(email);return JSON.parse(JSON.stringify(env.c.api(action,params)));});
 const bridge=`<script>function runner(success,failure){return {withSuccessHandler:fn=>runner(fn,failure),withFailureHandler:fn=>runner(success,fn),api:(action,params)=>window.__googleApi(action,params).then(value=>success&&success(value),error=>failure&&failure(error))};}window.google={script:{run:runner()}};</script>`;
 await page.setContent(html.replace('<head>','<head>'+bridge));await page.locator('#workspace').waitFor();await page.waitForFunction(()=>!busy&&!!state);return page;
}
try{
 const one=await pageFor('docente@clases.edu.sv'),two=await pageFor('second@clases.edu.sv');
 assert.equal(await one.locator('#loginForm').isVisible(),false);assert.equal(await one.locator('[data-nav="tools"]').count(),0);
 await one.locator('#gradeTable input').first().fill('8');await one.locator('#save').click();await one.waitForFunction(()=>!busy&&!dirty);assert.equal(env.database().version,1);
 const inputs=two.locator('#gradeTable input');for(let i=0;i<9;i++)await inputs.nth(i).fill('7');await two.locator('#save').click();await two.waitForFunction(()=>!busy);assert.equal(await inputs.first().inputValue(),'7.0');assert.match(await two.locator('#message').innerText(),/datos cambiaron/);assert.equal(env.database().grades.length,1); // Only the edited row is saved; an untouched student stays unrecorded.
 await two.locator('#refresh').click();await two.waitForFunction(()=>!busy);for(let i=0;i<9;i++)await two.locator('#gradeTable input').nth(i).fill('7');await two.locator('#save').click();await two.waitForFunction(()=>!busy&&!dirty);assert.equal(env.database().grades.length,2);assert.equal(env.database().grades.find(g=>g.studentId==='s1').values[0],8);
 await one.locator('[data-nav="imports"]').click();await one.locator('#importPeriod').selectOption('2');await one.locator('#importFile').setInputFiles({name:'notas-ficticias.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:syntheticXlsx()});await one.waitForFunction(()=>!busy);assert.equal(await one.locator('#importMapping').isVisible(),true);assert.equal(env.files.filter(file=>file.folder==='documents').length,1);
 const admin=await pageFor('rocio@clases.edu.sv');await admin.locator('[data-nav="tools"]').click();assert.equal(await admin.locator('#googleAccounts').isVisible(),true);assert.equal(await admin.locator('#accessForm').isVisible(),false);
 const direction=await pageFor('direccion@clases.edu.sv');assert.equal(await direction.locator('#save').isDisabled(),true);assert.equal(await direction.locator('[data-nav="tools"]').count(),0);
 // Exercise the updated institutional interface over google.script.run and the Sheets adapter.
 const ready=page=>page.waitForFunction(()=>!busy);
 await admin.locator('[data-nav="settings"]').click();await admin.locator('#evaluationAssignment').selectOption('a1');await ready(admin);await admin.locator('#evaluationPeriod').selectOption('2');await ready(admin);await admin.locator('#evaluationCount').selectOption('5');
 for(const [i,value]of [10,20,30,20,20].entries())await admin.locator(`[data-evaluation-weight="${i}"]`).fill(String(value));
 await admin.locator('#evaluationReason').fill('Cinco notas sintéticas para la aceptación local de Google');await admin.locator('#saveEvaluation').click();await ready(admin);assert.equal(env.database().evaluationPolicies[0].count,5);
 await one.locator('#refresh').click();await ready(one);await one.locator('[data-nav="overview"]').click();await one.locator('#period').selectOption('2');await ready(one);
 for(const [i,value]of [0,6,7,8,9].entries())await one.locator(`#gradeTable input[data-row="0"][data-col="${i}"]`).fill(String(value));
 await one.locator('#save').click();await one.waitForFunction(()=>!busy&&!dirty);assert.deepEqual(env.database().grades.find(g=>g.studentId==='s1'&&g.periodId==='2').values,[0,6,7,8,9]);
 const groupDownload=one.waitForEvent('download');await one.locator('#export').click();await (await groupDownload).saveAs(output+'/cuadro-google.xlsx');
 await admin.locator('#refresh').click();await ready(admin);await admin.locator('[data-nav="documents"]').click();await admin.locator('#documentSection').selectOption('1A');await admin.locator('#loadConsolidated').click();await ready(admin);assert.ok((await admin.locator('#reportOutput').innerText()).includes('6.7'));
 await admin.locator('#reportStudent').selectOption('s1');await admin.locator('#loadReportCard').click();await ready(admin);assert.ok((await admin.locator('#reportOutput').innerText()).includes('0.0 · 6.0 · 7.0 · 8.0 · 9.0'));
 await admin.screenshot({path:output+'/boleta-google-escritorio.png',fullPage:true});const reportDownload=admin.waitForEvent('download');await admin.locator('#exportDocument').click();await (await reportDownload).saveAs(output+'/boleta-google.xlsx');
 await admin.locator('[data-nav="overview"]').click();await admin.locator('#period').selectOption('2');await ready(admin);await admin.locator('[data-grade-lock="s1"]').click();await ready(admin);
 await one.locator('#refresh').click();await ready(one);assert.equal(await one.locator('#gradeTable input[data-row="0"]:disabled').count(),5);
 await admin.locator('[data-nav="tools"]').click();await admin.locator('#googleAccountUser').selectOption('second');await admin.locator('#googleAccountConfirmed').uncheck();await admin.locator('#googleAccounts button').click();await ready(admin);
 assert.equal(await two.evaluate(async()=>{try{await api('bootstrap');return false;}catch(error){return error.message.includes('no confirmada');}}),true);
 await admin.locator('#googleAccountConfirmed').check();await admin.locator('#googleAccounts button').click();await ready(admin);await two.locator('#refresh').click();await ready(two);
 for(const page of [admin,one,two,direction])for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await admin.screenshot({path:output+'/cuentas-google-movil.png',fullPage:true});assert.deepEqual(errors,[]);
 fs.writeFileSync(output+'/report.json',JSON.stringify({success:true,realGoogleExecuted:false,javascriptErrors:0,transport:'google.script.run con servicios simulados',checks:['Dos docentes y concurrencia sin pérdida de borradores','Aislamiento de asignaciones','Cinco notas y ponderaciones','XLSX histórico, cuadro y boleta','Consolidado y boleta desde las mismas notas','Bloqueo individual de cinco notas','Confirmación y revocación de cuentas','Dirección de consulta','Cuatro perfiles en tres tamaños']},null,2));
 console.log('Google UI local aprobada: transporte, dos docentes, concurrencia, cinco notas, documentos, XLSX, bloqueos, confirmación de cuentas y tres tamaños. No se contactó Google.');
}finally{await browser.close();}
