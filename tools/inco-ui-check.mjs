// The complete compiled UI with local Google service doubles. No real records or cloud writes.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {googlePlatform} from '../tests/helpers/google-platform.mjs';
import G from './core.mjs';
import X from './gradebook-xlsx.mjs';
const pw=createRequire(process.execPath)('playwright'),db=G.seed(),output='data/local/inco-format-qa';fs.mkdirSync(output,{recursive:true});
db.sections[0].grade='1';db.sections[0].specialtyId='ac';db.specialties=[{id:'ac',name:'Bachillerato Técnico Vocacional Administrativo Contable'}];
db.students[0].name='Apellido compuesto de ejemplo y segundo apellido · Nombre largo de prueba';
db.assignments[1].sectionId='1A';db.subjects[1].moduleNumber='1.6';db.subjects[1].name='Conversación en inglés sobre sistemas informáticos y desarrollo de páginas Web';
for(let i=4;i<=6;i++){db.students.push({id:'s'+i,nie:'0000000'+i,name:'Estudiante sintético de prueba '+i});db.enrollments.push({id:'e'+i,studentId:'s'+i,year:'2026',sectionId:'1A'});}
for(let i=0;i<33;i++){db.subjects.push({id:'extra'+i,name:'Asignatura de ejemplo '+i+' · Preparación técnica con nombre largo',type:'GENERAL_4_PERIODOS',category:i%2?'CONCEPTUAL':'BASIC'});db.assignments.push({id:'extra'+i,teacherId:'teacher',year:'2026',sectionId:'1A',subjectId:'extra'+i,active:true});}
db.subjects.push({id:'conduct',name:'Conducta',type:'GENERAL_4_PERIODOS',category:'CONCEPTUAL'});
db.assignments.push({id:'conduct',teacherId:'teacher',year:'2026',sectionId:'1A',subjectId:'conduct',active:true});
db.evaluationPolicies.push({id:'conduct-1',year:'2026',sectionId:'1A',subjectId:'conduct',periodId:'1',mode:'WEIGHTED',count:4,weights:[.25,.25,.25,.25]});
db.grades.push({id:'conduct-s1-1',studentId:'s1',year:'2026',sectionId:'1A',subjectId:'conduct',periodId:'1',values:[5,0,9,8.95],assignmentId:'conduct'});
db.assignments.push({id:'foreign',teacherId:'other',year:'2026',sectionId:'2B',subjectId:'math',active:true});
db.evaluationPolicies.push({id:'five',year:'2026',sectionId:'1A',subjectId:'math',periodId:'2',mode:'WEIGHTED',count:5,labels:['Nota 1','Nota 2','Nota 3','Nota 4','Nota 5'],weights:[.2,.2,.2,.2,.2]});
for(const period of ['1','2','3','4'])for(const student of db.students.filter(s=>s.id!=='s3'))db.grades.push({id:student.id+'-'+period,studentId:student.id,year:'2026',sectionId:'1A',subjectId:'math',periodId:period,values:period==='2'?[0,8.95,7,9,10]:[0,8.95,9],assignmentId:'a1'});
const env=googlePlatform({db}),browser=await pw.chromium.launch({headless:true,channel:'msedge'}),errors=[];
const html=fs.readFileSync('dist/apps-script/Index.html','utf8');
async function pageFor(email){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.exposeFunction('__googleApi',(action,params)=>{env.as(email);return JSON.parse(JSON.stringify(env.c.api(action,params)));});
 const bridge='<script>function runner(s,f){return {withSuccessHandler:fn=>runner(fn,f),withFailureHandler:fn=>runner(s,fn),api:(a,p)=>window.__googleApi(a,p).then(v=>s?.(v),e=>f?.(e))};}window.google={script:{run:runner()}};const openWindow=window.open;window.open=(...args)=>{const child=openWindow.apply(window,args);if(child)child.print=()=>{};return child;};</script>';
 await page.route('https://genesis.test/',route=>route.fulfill({contentType:'text/html',body:html.replace('<head>','<head>'+bridge)}));
 await page.goto('https://genesis.test/');await page.locator('#workspace').waitFor();await page.waitForFunction(()=>!busy&&!!state&&!!incoWorkbook);await page.evaluate(async()=>{document.getElementById('period').value='1';await selectIncoAssignment('a1');});return page;
}
try{
 const teacher=await pageFor('docente@clases.edu.sv');assert.equal(await teacher.locator('#gradeTable thead [data-inco-period]').count(),4);assert.equal(await teacher.locator('#incoSheetTabs [data-inco-assignment="foreign"]').count(),0);
 assert.match(await teacher.locator('#incoSheetHeader').innerText(),/CUADRO DE REGISTRO/);
 const before=env.database().grades.find(g=>g.id==='s1-1').values.slice();assert.equal(before[1],8.95);
  await teacher.locator('#gradeTable tbody tr').first().locator('input').first().fill('5');await teacher.locator('#save').click();await teacher.waitForFunction(()=>!busy&&!dirty);const saved=env.database().grades.find(g=>g.subjectId==='math'&&g.studentId==='s1'&&g.periodId==='1');assert.equal(saved.values[0],5);assert.equal(saved.values[1],8.95);await teacher.evaluate(()=>openGroup('a1'));
 await teacher.locator('[data-inco-period="2"]').click();await teacher.waitForFunction(()=>!busy&&loadedPeriod==='2');assert.equal(await teacher.locator('#gradeTable tbody tr').first().locator('input').count(),5);
 await teacher.locator('[data-inco-assignment="a2"]').click();await teacher.waitForFunction(()=>!busy&&selected==='a2');assert.equal(await teacher.locator('#gradeTable tbody tr').first().locator('input').count(),9);assert.equal(await teacher.locator('[data-inco-period]').count(),1);
 await teacher.screenshot({path:output+'/modulo-fases.png',fullPage:true});
 const admin=await pageFor('rocio@clases.edu.sv');
 for(const width of [1440,768,390]){await admin.setViewportSize({width,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:output+'/cuadro-'+width+'.png',fullPage:true});}
 await admin.setViewportSize({width:1440,height:1000});await admin.locator('[data-nav="documents"]').click();await admin.locator('#loadConsolidated').click();await admin.waitForFunction(()=>!busy&&!!academicDocument);
 await admin.locator('#reportStudent').selectOption('s1');await admin.locator('#loadReportCard').click();await admin.waitForFunction(()=>!busy&&academicDocument?.kind==='reportCard');
 assert.match(await admin.locator('#reportOutput').innerText(),/Módulo 1.6/);assert.match(await admin.locator('#reportOutput').innerText(),/Área Técnica/);
 assert.equal(await admin.locator('#reportFormat option').count(),5);
 for(const format of ['general','software','tourism','accounting']){
  await admin.locator('#reportFormat').selectOption(format);
  assert.match(await admin.locator('#reportOutput').innerText(),/Asignatura Complementaria/);
  assert.equal(await admin.locator('#reportOutput .inco-report-criterion').count(),['software','accounting'].includes(format)?4:0);
 }
 await admin.locator('#reportFormat').selectOption('');
 assert.equal(await admin.locator('#reportOutput .inco-report-criterion').nth(1).locator('td').first().innerText(),'0.0');
 for(const width of [1440,768,390]){
  await admin.setViewportSize({width,height:1000});
  const layout=await admin.evaluate(async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const preview=document.querySelector('.inco-report-preview');
   const page=preview.querySelector('.inco-report-page');
   const paper=page.getBoundingClientRect();
   const table=page.querySelector('.inco-report-table');
   const footer=page.querySelector('.inco-report-footer').getBoundingClientRect();
   const bounds=table.getBoundingClientRect();
   return {pages:preview.querySelectorAll('.inco-report-page').length,subjects:table.querySelectorAll('tr:not(.inco-report-criterion) th[scope=row]').length+page.querySelectorAll('.inco-report-technical th').length,
    aspectError:Math.abs(paper.height-paper.width*11/8.5),horizontalScroll:preview.scrollWidth-preview.clientWidth,
    tableLeft:bounds.left-paper.left,tableRight:paper.right-bounds.right,footerHeight:footer.height,footerMargin:paper.bottom-footer.bottom};
  });
  assert.equal(layout.pages,1);
  assert.equal(layout.subjects,36);
  assert.ok(layout.aspectError<1&&layout.horizontalScroll<=1&&layout.tableLeft>=0&&layout.tableRight>=-1&&layout.footerHeight>0&&layout.footerMargin>=0,JSON.stringify({width,...layout}));
 }
 await admin.setViewportSize({width:1440,height:1000});
 await admin.locator('.inco-report-page').screenshot({path:output+'/boleta-preview.png'});
 const printPromise=admin.waitForEvent('popup');await admin.locator('#printDocument').click();const printPage=await printPromise;await printPage.waitForSelector('.inco-report-page');await printPage.waitForFunction(()=>!!document.getElementById('incoPrintNow').onclick);
 fs.writeFileSync(output+'/boleta-print.html',await printPage.content());await printPage.pdf({path:output+'/boleta.pdf',preferCSSPageSize:true,printBackground:true});await printPage.close();
 const batchPromise=admin.waitForEvent('popup');await admin.locator('#printAllReports').click();const batch=await batchPromise;await batch.waitForSelector('.inco-report-page');await batch.waitForFunction(()=>!!document.getElementById('incoPrintNow').onclick);assert.equal(await batch.locator('.inco-report-page').count(),5);fs.writeFileSync(output+'/boletas-seccion-print.html',await batch.content());await batch.pdf({path:output+'/boletas-seccion.pdf',preferCSSPageSize:true,printBackground:true});await batch.close();
 const downloadPromise=admin.waitForEvent('download');await admin.locator('#downloadReportPdf').click();const download=await downloadPromise;await download.saveAs(output+'/boleta-descargada.pdf');
 await admin.locator('#reportBatch summary').click();await admin.locator('#reportBatchStudents input[value="s1"]').check();await admin.locator('#reportBatchStudents input[value="s2"]').check();
 const subsetPromise=admin.waitForEvent('popup');await admin.locator('#printSelectedReports').click();const subset=await subsetPromise;await subset.waitForFunction(()=>!!document.getElementById('incoPrintNow')?.onclick);assert.equal(await subset.locator('.inco-report-page').count(),2);await subset.pdf({path:output+'/boletas-seleccion.pdf',preferCSSPageSize:true,printBackground:true});await subset.close();
 const beforeOutputFilter=env.database();
 await admin.locator('#reportOutputSubjects summary').click();
 await admin.locator('#reportOutputSubjectList input[value="math"]').uncheck();
 await admin.locator('#reportOutputSubjectList input[value="module"]').uncheck();
 assert.doesNotMatch(await admin.locator('#reportOutput').innerText(),/Matemática|Módulo 1\.6/);
 const filteredPromise=admin.waitForEvent('popup');await admin.locator('#printAllReports').click();const filtered=await filteredPromise;
 await filtered.waitForFunction(()=>!!document.getElementById('incoPrintNow')?.onclick);
 assert.equal(await filtered.locator('.inco-report-page').count(),5);
 assert.doesNotMatch(await filtered.locator('body').innerText(),/Matemática|Módulo 1\.6/);
 assert.match(await filtered.locator('.inco-report-page').first().innerText(),/Asignatura de ejemplo 32/);
 await filtered.close();
 const filteredDownload=admin.waitForEvent('download');await admin.locator('#downloadReportPdf').click();await (await filteredDownload).saveAs(output+'/boleta-filtrada.pdf');
 await admin.locator('#restoreReportOutputSubjects').click();
 assert.match(await admin.locator('#reportOutput').innerText(),/Módulo 1\.6/);
 assert.deepEqual(env.database(),beforeOutputFilter);
 await admin.locator('#documentPeriod').selectOption('2');
 const excelPromise=admin.waitForEvent('download');await admin.locator('#documentSectionExcel').click();const excel=await excelPromise;await excel.saveAs(output+'/seccion.xlsx');
 await admin.locator('#reportSubjectEditor summary').click();await admin.locator('#loadReportSubjects').click();
 await admin.locator('#reportSubjectOptions input[value="math"]').uncheck();await admin.locator('#saveReportSubjects').click();await admin.waitForFunction(()=>!busy);
 await admin.locator('#loadConsolidated').click();await admin.waitForFunction(()=>!busy&&academicDocument?.kind==='consolidated');
 await admin.locator('#loadReportCard').click();await admin.waitForFunction(()=>!busy&&academicDocument?.kind==='reportCard');
 assert.equal(await admin.evaluate(()=>academicDocument.columns.some(c=>c.subject.id==='math')),true);
 assert.match(await admin.locator('#reportOutput').innerText(),/Modulo sin llenar/);
 await admin.locator('[data-nav="imports"]').click();await admin.locator('#sectionImportPanel summary').click();
 await admin.locator('#sectionImportSection').selectOption('1A');await admin.locator('#sectionImportPeriod').selectOption('2');
 const templatePromise=admin.waitForEvent('download');await admin.locator('#sectionImportTemplate').click();const template=await templatePromise;await template.saveAs(output+'/plantilla-seccion.xlsx');
 const workbook=G.execute(env.database(),'rocio@clases.edu.sv','sectionWorkbook',{year:'2026',sectionId:'1A',periodId:'2'}),sheets=X.sectionSheets(workbook,true);
 sheets.find(s=>s.name.includes('Módulo')).rows[1].splice(2,9,0,8,7,6,5,4,3,2,1);
 await admin.locator('#sectionImportFile').setInputFiles({name:'seccion-sintetica.xlsx',mimeType:X.MIME,buffer:Buffer.from(X.write(sheets))});
 await admin.locator('#sectionImportPreview').click();await admin.waitForFunction(()=>!busy&&!document.getElementById('sectionImportCommit').disabled);
 const beforeImport=env.database().grades.length;
 await admin.locator('#sectionImportCommit').click();await admin.waitForFunction(()=>!busy);
 const afterImport=env.database();
 assert.equal(afterImport.grades.length,beforeImport+1);
 assert.deepEqual(afterImport.grades.find(g=>g.subjectId==='module'&&g.periodId==='2').values,[0,8,7,6,5,4,3,2,1]);
 await admin.locator('[data-nav="overview"]').click();const sheetPromise=admin.waitForEvent('popup');await admin.locator('#printGradeSheet').click();const sheet=await sheetPromise;await sheet.waitForSelector('.inco-print-sheet');fs.writeFileSync(output+'/cuadro-docente-print.html',await sheet.content());await sheet.pdf({path:output+'/cuadro-docente.pdf',preferCSSPageSize:true,printBackground:true});await sheet.close();
 for(const width of [768,390]){await admin.setViewportSize({width,height:1000});await admin.locator('[data-nav="documents"]').click();await admin.locator('#loadReportCard').click();await admin.waitForFunction(()=>!busy);assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);fs.writeFileSync(output+'/report.json',JSON.stringify({success:true,realGoogleExecuted:false,javascriptErrors:0,checks:['Cuatro períodos y edición por período','Cinco notas y fases de módulos','Guardar conserva decimales internos y otros períodos','Pestañas solo de asignaciones autorizadas','Boleta con todas las categorías y número del módulo','Impresión individual y de cinco boletas por sección','Cuadro docente apaisado','Tres tamaños sin desbordamiento']},null,2));console.log('INCO: recorrido de interfaz y PDFs aprobados. Sin errores JavaScript.');
}finally{await browser.close();}
