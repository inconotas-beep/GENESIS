/* OAuth sessions stay in this tab. Academic drafts are preserved during reauthentication. */
var GoogleLogin=(()=>{
 let mode='',session='',timer=null,inFlight=false,flow=null,generation=0;
 const pendingKey='genesis-google-pending';
 try{session=sessionStorage.getItem('genesis-google-session')||'';}catch{}
 const raw=(action,params={},token=session)=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(action,params,token));
 function save(token){session=token;try{if(token)sessionStorage.setItem('genesis-google-session',token);else sessionStorage.removeItem('genesis-google-session');}catch{}}
 function pending(){try{return JSON.parse(localStorage.getItem(pendingKey));}catch{return null;}}
 function clearPending(flowId){try{if(pending()?.flowId===flowId)localStorage.removeItem(pendingKey);}catch{}}
 function stop(){
  generation++;clearInterval(timer);timer=null;
  if(flow)clearPending(flow.flowId);
  flow=null;inFlight=false;
  $('googleFinishHere').classList.add('hidden');
 }
 function showLogin(text){$('login').classList.remove('hidden');$('googleSignInPanel').classList.remove('hidden');$('googleAccess').textContent=text;$('googleSignIn').disabled=false;}
 function expired(error){if(!String(error?.message||'').includes('Iniciá sesión nuevamente'))return;if(mode==='PASSWORD'){$('login').classList.remove('hidden');$('loginForm').classList.remove('hidden');}else if(mode==='GOOGLE_OAUTH')showLogin('Tu sesión venció. Volvé a ingresar para continuar; tus notas pendientes se conservan.');}
 async function poll(){
  if(inFlight||!flow)return;inFlight=true;
  const request=generation;
  try{
   const result=await raw('authPoll',flow);
   if(request!==generation){if(result.status==='AUTHENTICATED')await raw('authLogout',{},result.token);return;}
   if(result.status==='IDENTITY_VERIFIED'){stop();save('');showLogin(result.message);$('googleContinue').classList.add('hidden');return;}
   if(result.status!=='AUTHENTICATED')return;
   stop();
   if(state&&dirty&&String(state.user.email).toLowerCase()!==result.email){await raw('authLogout',{},result.token);showLogin('Ingresá con la misma cuenta del borrador. Guardá o descartá sus notas antes de cambiar de cuenta.');return;}
   save(result.token);$('googleSignInPanel').classList.add('hidden');$('googleSignOut').classList.remove('hidden');$('login').classList.add('hidden');
   if(state&&dirty)message('Sesión recuperada. Tu borrador y su versión se conservaron.');else await refresh();
  }catch(error){if(request===generation){stop();showLogin(error.message);message(error.message,true);}}finally{if(request===generation)inFlight=false;}
 }
 async function start(){
  stop();
  $('googleSignIn').disabled=true;$('googleContinue').classList.add('hidden');$('googleAccess').textContent='Preparando el ingreso con Google…';
  let popup;try{popup=window.open('about:blank','_blank');if(popup){popup.opener=null;popup.document.write('<p>Conectando con Google…</p>');}}catch{}
  try{
   const result=await raw('authStart');flow={flowId:result.flowId,claimSecret:result.claimSecret};
   const url=new URL(result.authorizationUrl);if(url.origin!=='https://accounts.google.com')throw Error('Dirección de ingreso inválida');
   if(!dirty)try{localStorage.setItem(pendingKey,JSON.stringify({...flow,expiresAt:Date.now()+600000}));}catch{}
   const canContinueInGoogleTab=!dirty&&pending()?.flowId===flow.flowId;
   $('googleContinue').href=result.authorizationUrl;$('googleContinue').classList.remove('hidden');
   if(popup)popup.location.replace(result.authorizationUrl);
   $('googleAccess').textContent=canContinueInGoogleTab?'Completá el ingreso en Google y pulsá Has accedido a GENESIS.':'Completá el ingreso en Google y volvé a esta pestaña.';
   if(canContinueInGoogleTab)$('googleFinishHere').classList.remove('hidden');
   else timer=setInterval(poll,2000);
  }catch(error){stop();try{popup?.close();}catch{}showLogin(error.message);message(error.message,true);}
 }
 async function initialize(){
  const settings=await raw('authConfig');mode=settings.mode;
  if(mode==='PASSWORD'){
   $('googleAccess').classList.add('hidden');
   $('loginForm').classList.remove('hidden');
   $('loginForm').onsubmit=safe(async()=>{
    const password=$('password').value;
    $('password').value='';
    const result=await raw('nativeLogin',{username:$('username').value,password});
    save(result.token);
    const next=await api('bootstrap');
    if(state&&dirty&&state.user.id!==next.user.id){await raw('authLogout');save('');throw Error('Ingresá con la misma cuenta para conservar el borrador.');}
    if(state&&dirty)$('login').classList.add('hidden');else await refresh();
   });
   $('googleSignOut').onclick=safe(async()=>{if(canDiscard()){await raw('authLogout');save('');location.reload();}});
   if(session)try{await refresh();return;}catch{save('');}
   return;
  }
  if(mode!=='GOOGLE_OAUTH'){await refresh();return;}
  $('googleSignIn').onclick=start;
  document.addEventListener('visibilitychange',()=>{if(timer&&!document.hidden)void poll();});
  $('googleFinishHere').onclick=()=>{
   if(!flow)return;
   clearPending(flow.flowId);
   $('googleFinishHere').classList.add('hidden');
   timer=setInterval(poll,2000);
   void poll();
  };
  $('googleSignOut').onclick=safe(async()=>{if(!canDiscard())return;await raw('authLogout');save('');stop();dirty=false;location.reload();});
  if(!settings.ready){showLogin('Administración debe completar la configuración del ingreso con Google.');$('googleSignIn').disabled=true;return;}
  const resumeId=await new Promise(resolve=>google.script.url?google.script.url.getLocation(location=>resolve(location.parameter.resume)):resolve(''));
  const saved=pending();
  if(resumeId&&saved?.flowId===resumeId){
   clearPending(resumeId);
   if(saved.expiresAt>Date.now()){
    flow={flowId:saved.flowId,claimSecret:saved.claimSecret};
    showLogin('Completando el ingreso a GENESIS…');$('googleSignIn').disabled=true;
    timer=setInterval(poll,2000);
    await poll();
    return;
   }
  }
  if(session){try{await refresh();$('googleSignOut').classList.remove('hidden');return;}catch{save('');}}
  showLogin('Ingresá con una cuenta de Google aprobada por administración.');
 }
 return {initialize,token:()=>session,expired,native:()=>mode==='PASSWORD'};
})();
