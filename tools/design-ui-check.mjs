import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const localRequire=createRequire(import.meta.url),runtimeRequire=createRequire(process.execPath);
const dependency=name=>{try{return localRequire(name);}catch{return runtimeRequire(name);}};
const pw=dependency('playwright'),sharp=dependency('sharp');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-design-'));
const output=path.resolve('data/local/redesign-qa');fs.mkdirSync(output,{recursive:true});
const institutional=path.resolve('data/privado/institucional');
const fingerprint=()=>['database.json','credentials.json'].filter(f=>fs.existsSync(path.join(institutional,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(institutional,f))).digest('hex')]);
const original=fingerprint(),password='Test-Design-918!';
const child=spawn(process.execPath,['tools/server.mjs'],{env:{...process.env,PORT:'0',GENESIS_DATA_DIR:dir,GENESIS_INITIAL_PASSWORD:password,GENESIS_TEST_ACCOUNTS:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const report={screens:[],contrasts:[],flows:[],javascriptErrors:[],institutionalUnchanged:false};
let browser;
try {
  const base=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(String(data).match(/http:\/\/127\.0\.0\.1:\d+/)[0]));child.stderr.once('data',data=>reject(Error(String(data))));child.once('error',reject);});
  browser=await pw.chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',e=>report.javascriptErrors.push(e.message));page.on('dialog',d=>d.accept());
  const capture=async name=>{await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});await page.screenshot({path:path.join(output,name+'-viewport.png')});};
  const checkWidth=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Desbordamiento: '+label);
  const navigate=async view=>{await page.locator(`[data-nav="${view}"]`).click();await page.waitForFunction(()=>!busy);await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.locator(`[data-nav="${view}"]`).getAttribute('aria-current'),'page');};
  const login=async name=>{await context.clearCookies();await page.goto(base);await page.locator('#username').fill(name);await page.locator('#password').fill(password);await page.locator('#enter').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>!busy&&!!state);};
  for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:900});await page.goto(base);await page.locator('#loginForm').waitFor();await checkWidth('login '+width);
    assert.equal(await page.locator('#username').isVisible(),true);await capture('login-'+width);report.screens.push({role:'login',width});
  }
  const roles={Rocio:['overview','subjects','admin','subjectTeachers','sectionTeachers','teacherSubjects','catalog','periods','imports','settings','audit','tools','frames','documents'],teacher:['overview','imports','frames','documents'],direction:['overview','subjectTeachers','sectionTeachers','teacherSubjects','periods','audit','frames','documents'],other:['overview','imports','frames','documents']};
  for(const [role,views] of Object.entries(roles)){
    await login(role);assert.equal(await page.locator('[data-nav]').count(),views.length);
    for(const width of [1440,1024,768,390,320]){
      await page.setViewportSize({width,height:900});
      for(const view of views){
        await navigate(view);await checkWidth(`${role} ${view} ${width}`);
        assert.equal(await page.locator(`[data-nav="${view}"] svg`).count(),1);
        if(width>=1024){assert.equal(await page.locator('#navigation').evaluate(el=>getComputedStyle(el).position),'fixed');}
        report.screens.push({role,view,width});
        if(width===1440||width===390)await capture(`${role}-${view}-${width}`);
      }
    }
    if(role==='direction'){
      await navigate('overview');assert.equal(await page.locator('#save').isDisabled(),true);assert.equal(await page.locator('#gradeTable input:enabled').count(),0);
      report.flows.push('Dirección conserva consulta de notas sin edición.');
    }
    if(role==='other'){await navigate('overview');assert.equal(await page.locator('.dashboard-metrics').count(),0);assert.equal(await page.locator('#gradePanel').isVisible(),false);}
  }
  await login('Rocio');await page.setViewportSize({width:1440,height:1000});
  await navigate('catalog');await page.locator('#enrollmentSectionFilter').selectOption('1A');assert.equal(await page.locator('#enrollmentRows [data-student]').count(),2);await page.locator('#enrollmentSearch').fill('00000001');assert.equal(await page.locator('#enrollmentRows [data-student]').count(),1);report.flows.push('Filtro de sección combinado con búsqueda por NIE.');
  await navigate('settings');await page.locator('#policySubjectSearch').fill('MATEMATICA');assert.equal(await page.locator('#policySubject').inputValue(),'math');await page.locator('#policySubjectSearch').fill('sin coincidencias');assert.equal(await page.locator('#enablePolicy').isDisabled(),true);await page.locator('#policySubjectSearch').fill('modulo');assert.equal(await page.locator('#weightLabel0').innerText(),'Preparación');await page.locator('#policySubjectSearch').fill('');report.flows.push('Lupa por materia, búsqueda sin tildes, vacío y ponderaciones modulares.');
  await page.locator('#policySubject').focus();assert.equal(await page.locator('#policySubject').evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(23, 107, 69)');
  await navigate('subjects');await page.locator('#addSubject').click();await page.locator('#subjectEditor').waitFor();await capture('editor-1440');await page.setViewportSize({width:390,height:900});await checkWidth('editor móvil');await capture('editor-390');await page.locator('#cancelSubject').click();
  // Use only the isolated test database to show all annual result states.
  await page.evaluate(async()=>{for(const periodId of ['1','2','3','4']){const current=await api('bootstrap');await api('saveGrades',{version:current.version,assignmentId:'a1',periodId,rows:[{studentId:'s1',values:[6,6,6]},{studentId:'s2',values:[5,5,5]}]});}await refresh();});
  await navigate('overview');assert.equal(await page.locator('[data-result="approved"]').count(),1);assert.equal(await page.locator('[data-result="failed"]').count(),1);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#gradePanel').screenshot({path:path.join(output,'notas-'+width+'.png')});}
  await login('teacher');await navigate('overview');await page.locator('#gradeTable input').first().fill('8');assert.equal(await page.locator('#save').isDisabled(),false);await page.locator('#save').click();await page.waitForFunction(()=>!busy&&!dirty);assert.equal(await page.locator('#gradeTable input').first().inputValue(),'8.0');report.flows.push('Docente conserva edición y guardado de calificaciones.');
  const palette=await page.evaluate(()=>Object.fromEntries(['inco-green','inco-forest','inco-sage','inco-cream','inco-white','inco-slate','primary','primary-hover','background','surface','text','text-secondary','muted','accent-text','button-text','surface-inset','surface-hover','control-border','success-bg','success-text','warning-bg','warning-text','danger-bg','danger-text','sidebar-bg','sidebar-text','sidebar-muted','sidebar-hover','sidebar-active-bg','sidebar-active-text'].map(key=>[key,getComputedStyle(document.documentElement).getPropertyValue('--'+key).trim()])));
  for(const [key,value]of Object.entries({'inco-green':'#176B45','inco-forest':'#104D35','inco-sage':'#A8C9B1','inco-cream':'#F2DEA0','inco-white':'#F8FAF7','inco-slate':'#34443D'}))assert.equal(palette[key],value);
  const luminance=hex=>{const c=hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  for(const [front,back,minimum]of [['text','surface',4.5],['text','background',4.5],['muted','surface',4.5],['text-secondary','background',4.5],['text-secondary','surface-inset',4.5],['text-secondary','surface-hover',4.5],['button-text','primary',4.5],['button-text','primary-hover',4.5],['accent-text','surface',4.5],['accent-text','surface-hover',4.5],['success-text','success-bg',4.5],['success-text','inco-sage',4.5],['warning-text','warning-bg',4.5],['danger-text','danger-bg',4.5],['danger-text','surface',4.5],['sidebar-text','sidebar-bg',4.5],['sidebar-muted','sidebar-bg',4.5],['sidebar-text','sidebar-hover',4.5],['sidebar-active-text','sidebar-active-bg',4.5],['control-border','surface',3],['control-border','background',3],['control-border','surface-inset',3],['primary','surface',3],['primary','surface-hover',3],['inco-sage','sidebar-bg',3]]){
    const a=luminance(palette[front]),b=luminance(palette[back]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=minimum,`${front}/${back}: ${ratio}`);report.contrasts.push({front,back,ratio:Number(ratio.toFixed(2)),minimum});
  }
  const makeSheet=async(name,files,cellWidth,cellHeight,columns)=>{
    const layers=[];
    for(const [i,file]of files.entries()){
      const image=await sharp(path.join(output,file+'-viewport.png')).resize(cellWidth,cellHeight-28,{fit:'cover',position:'top'}).png().toBuffer();
      const label=Buffer.from(`<svg width="${cellWidth}" height="28"><rect width="100%" height="100%" fill="${palette['sidebar-bg']}"/><text x="10" y="19" font-family="sans-serif" font-size="12" fill="${palette['sidebar-text']}">${file}</text></svg>`);
      layers.push({input:label,left:(i%columns)*cellWidth,top:Math.floor(i/columns)*cellHeight},{input:image,left:(i%columns)*cellWidth,top:Math.floor(i/columns)*cellHeight+28});
    }
    await sharp({create:{width:columns*cellWidth,height:Math.ceil(files.length/columns)*cellHeight,channels:3,background:palette['background']}}).composite(layers).png().toFile(path.join(output,name+'.png'));
  };
  await makeSheet('administracion-escritorio',roles.Rocio.map(view=>`Rocio-${view}-1440`),720,478,2);
  await makeSheet('administracion-movil',roles.Rocio.map(view=>`Rocio-${view}-390`),390,928,3);
  await makeSheet('docentes-direccion',['teacher-overview-1440','teacher-imports-1440','direction-overview-1440','direction-periods-1440','direction-audit-1440','other-overview-1440'],720,478,2);
  assert.deepEqual(report.javascriptErrors,[]);assert.deepEqual(fingerprint(),original);report.institutionalUnchanged=true;report.success=true;
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({screens:report.screens.length,contrastChecks:report.contrasts.length,flows:report.flows,javascriptErrors:0,institutionalUnchanged:true,output},null,2));
}finally{
  await browser?.close();child.kill();assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('genesis-design-'));fs.rmSync(dir,{recursive:true,force:true});
}
