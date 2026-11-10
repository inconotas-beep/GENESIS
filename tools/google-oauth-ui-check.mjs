// Real compiled UI; Google, OAuth provider and academic records are entirely simulated.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {oauthPlatform} from '../tests/helpers/oauth-platform.mjs';
const pw=createRequire(process.execPath)('playwright'),env=oauthPlatform(),output='data/local/google-oauth-qa';fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync('dist/apps-script/Index.html','utf8'),server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,lastFlow,lastSession,holdNext=false,release,held;
try{
 browser=await pw.chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Proveedor Google simulado</h1><p>No se contactó Google.</p>'}));
 const base='http://127.0.0.1:'+server.address().port;
 const callbackPage='http://127.0.0.1:40123';
 const callbackFrame=base+'/complete';
 await context.route(callbackPage+'/**',route=>route.fulfill({contentType:'text/html',body:'<iframe sandbox="allow-same-origin allow-scripts allow-top-navigation-by-user-activation" src="'+callbackFrame+new URL(route.request().url()).search+'"></iframe>'}));
 await context.route('https://script.google.com/macros/s/LOCAL_TEST_DEPLOYMENT/exec?*',route=>route.fulfill({status:302,headers:{location:base+'/'+new URL(route.request().url()).search}}));
 env.c.HtmlService={createHtmlOutput:markup=>markup};
 await context.route(callbackFrame+'*',route=>{
  const parameter=Object.fromEntries(new URL(route.request().url()).searchParams);
  return route.fulfill({contentType:'text/html',body:env.c.doGet({parameter})});
 });
 await context.exposeFunction('__googleApi',async(action,params,token)=>{
  const result=JSON.parse(JSON.stringify(env.c.api(action,params,token)));if(action==='authStart')lastFlow=result;if(action==='authPoll'&&result.status==='AUTHENTICATED')lastSession=result;
  if(action==='bootstrap'&&holdNext){holdNext=false;held=true;await new Promise(resolve=>{release=resolve;});}return result;
 });
 await context.addInitScript(()=>{function runner(success,failure){return {withSuccessHandler:fn=>runner(fn,failure),withFailureHandler:fn=>runner(success,fn),api:(action,params,token)=>window.__googleApi(action,params,token).then(value=>success?.(value),error=>failure?.(error))};}window.google={script:{run:runner(),url:{getLocation:callback=>callback({parameter:Object.fromEntries(new URLSearchParams(location.search))})}}};});
 await page.goto(base);await page.locator('#googleSignIn').waitFor();assert.equal(await page.locator('#loginForm').isVisible(),false);assert.equal(env.stats.loads,0);
 await page.screenshot({path:output+'/ingreso-google.png',fullPage:true});
 async function login(email=env.emails.teacher,continueInPopup=false){
  const popupWait=page.waitForEvent('popup');await page.locator('#googleSignIn').click();const popup=await popupWait;await popup.waitForURL('https://accounts.google.com/**');
  const params=new URLSearchParams({state:lastFlow.flowId,code:env.authorize(lastFlow,email)});
  await popup.goto(callbackPage+'/?'+params);
  const continueButton=popup.frameLocator('iframe').getByRole('button',{name:'Has accedido a GENESIS'});
  await continueButton.waitFor();
  if(continueInPopup){await continueButton.click();return popup;}
  await popup.close();
  const finishHere=page.getByRole('button',{name:'Completar ingreso en esta pestaña'});
  if(await finishHere.isVisible())await finishHere.click();
 }
 const continued=await login(env.emails.teacher,true);
 await continued.locator('#workspace').waitFor();
 await continued.locator('#gradeTable input').first().waitFor();
 assert.equal(await continued.evaluate(()=>state.user.id),'teacher');
 assert.equal(await continued.evaluate(()=>localStorage.getItem('genesis-google-pending')),null);
 env.c.GoogleOAuth.logout(lastSession.token);
 await continued.close();
 await page.reload();
 await login();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>!busy&&!!state);assert.equal(await page.evaluate(()=>state.user.id),'teacher');assert.equal(await page.locator('#googleSignOut').isVisible(),true);
 await page.locator('#gradeTable input').first().fill('8');assert.equal(await page.evaluate(()=>dirty),true);const version=await page.evaluate(()=>state.version);env.c.GoogleOAuth.logout(lastSession.token);
 await page.evaluate(async()=>{try{await api('bootstrap');}catch{}});await page.locator('#googleSignIn').waitFor();await login();await page.waitForFunction(()=>document.getElementById('login').classList.contains('hidden'));
 assert.equal(await page.locator('#gradeTable input').first().inputValue(),'8.0');assert.equal(await page.evaluate(()=>dirty),true);assert.equal(await page.evaluate(()=>state.version),version);
 await page.locator('#save').click();await page.waitForFunction(()=>!busy&&!dirty);assert.equal(env.database().grades[0].values[0],8);
 // Changing Google accounts cannot reuse a different user's unsaved academic form.
 await page.locator('#gradeTable input').first().fill('9');env.c.GoogleOAuth.logout(lastSession.token);await page.evaluate(async()=>{try{await api('bootstrap');}catch{}});await login(env.emails.admin);await page.waitForFunction(()=>document.getElementById('googleAccess').textContent.includes('misma cuenta'));
 assert.equal(await page.evaluate(()=>state.user.id),'teacher');assert.equal(await page.evaluate(()=>dirty),true);assert.equal(await page.locator('#gradeTable input').first().inputValue(),'9.0');
 await login();await page.waitForFunction(()=>document.getElementById('login').classList.contains('hidden'));await page.locator('#save').click();await page.waitForFunction(()=>!busy&&!dirty);assert.equal(env.database().grades[0].values[0],9);
 // A reload recovers this tab's own session, without trusting the executing owner.
 await page.reload();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>!busy&&!!state);assert.equal(await page.evaluate(()=>state.user.id),'teacher');
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.screenshot({path:output+'/docente-google-movil.png',fullPage:true});
 // A response from a previous session cannot overwrite a reauthenticated session.
 holdNext=true;await page.evaluate(()=>{window.pendingOldResponse=api('bootstrap').then(()=>false).catch(error=>error.message.includes('sesión cambió'));});
 for(let i=0;i<100&&!held;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(held);env.c.GoogleOAuth.logout(lastSession.token);await page.evaluate(async()=>{try{await api('bootstrap');}catch{}});await login();await page.waitForFunction(()=>document.getElementById('login').classList.contains('hidden'));release();assert.equal(await page.evaluate(()=>window.pendingOldResponse),true);
 const navigation=page.waitForNavigation();await page.locator('#googleSignOut').click();await navigation;await page.locator('#googleSignIn').waitFor();assert.equal(await page.evaluate(()=>!!state),false);assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#gradeTable tbody tr').count(),0);
 // OAuth setup can be checked before storage is configured; it grants no app session.
 env.props.set('ACCESS_ENABLED','NO');env.props.delete('SPREADSHEET_ID');const loadsBeforeSetup=env.stats.loads,writesBeforeSetup=env.stats.writes;
 await login('not-approved@gmail.com');await page.waitForFunction(()=>document.getElementById('googleAccess').textContent.includes('Google verificó tu identidad'));
 assert.equal(await page.evaluate(()=>!!GoogleLogin.token()),false);assert.equal(await page.evaluate(()=>!!state),false);assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(env.stats.loads,loadsBeforeSetup);assert.equal(env.stats.writes,writesBeforeSetup);
 assert.deepEqual(errors,[]);const report={success:true,realGoogleExecuted:false,javascriptErrors:0,checks:['El botón de confirmación abre GENESIS con la cuenta aprobada y muestra el cuadro de notas','Ingreso con proveedor Google y servicios simulados','Cuenta aprobada y rol del docente','Reautenticación conserva borrador y versión','Otra cuenta no recibe el borrador anterior','Recarga conserva la sesión de la pestaña','Respuesta de sesión anterior descartada','Cierre de sesión limpia expedientes del DOM','Tres tamaños sin desbordamiento','Verificación OAuth sin almacenamiento, sesión académica ni aprobación de cuentas']};fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{release?.();await browser?.close();await new Promise(resolve=>server.close(resolve));}
