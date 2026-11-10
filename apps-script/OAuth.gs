/* Google authorization-code flow. Browser-supplied emails/tokens are never identities. */
var GoogleOAuth=(()=>{
 const FLOW_TTL=600,SESSION_TTL=3600;
 const failures={
  FLOW_EXPIRED:'Este ingreso venció o ya fue utilizado. Volvé a GENESIS e iniciá de nuevo.',
  GOOGLE_CANCELLED:'El ingreso fue cancelado en Google. Volvé a GENESIS e intentá nuevamente.',
  GOOGLE_AUTH_REJECTED:'Google no autorizó el ingreso. Revisá la cuenta y la configuración de usuarios de prueba.',
  CLIENT_REJECTED:'Google rechazó el cliente OAuth. Administración debe revisar el ID y el secreto del cliente en las propiedades del script.',
  CODE_REJECTED:'Google rechazó el código de ingreso. Cerrá esta pestaña y comenzá de nuevo desde GENESIS; si se repite, administración debe revisar la URL de redireccionamiento.',
  REDIRECT_REJECTED:'La URL de redireccionamiento no coincide. Administración debe revisar la URL registrada en Google y en las propiedades del script.',
  TOKEN_REJECTED:'Google no pudo completar la verificación. Administración debe revisar el cliente OAuth.',
  GOOGLE_NETWORK:'No se pudo consultar Google desde el servidor. Volvé a intentar; si se repite, administración debe revisar las ejecuciones de Apps Script.',
  IDENTITY_REJECTED:'Google no entregó una identidad verificada. Volvé a ingresar con tu cuenta de Google.',
  CONFIG_CHANGED:'La configuración cambió durante el ingreso. Volvé a GENESIS e iniciá nuevamente.',
  CONFIGURATION:'Administración debe revisar las propiedades de configuración de Google OAuth.',
  OAUTH_FAILURE:'El ingreso no pudo completarse. Volvé a GENESIS e intentá nuevamente.'
 };
 function failure(code){const detail=failureDetail({genesisOAuthCode:code}),error=publicError_(detail.message);error.genesisOAuthCode=detail.code;return error;}
 function failureDetail(error){const code=Object.prototype.hasOwnProperty.call(failures,error?.genesisOAuthCode)?error.genesisOAuthCode:'OAUTH_FAILURE';return {code,message:failures[code]};}
 const cache=()=>CacheService.getScriptCache();
 const hash=text=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
 const random=()=>Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
 const key=(type,value)=>'genesis-auth-'+type+'-'+hash(value);
 const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 function read(type,value){if(!valid(value))return null;const text=cache().get(key(type,value));if(!text)return null;try{return JSON.parse(text);}catch{return null;}}
 function write(type,value,data,ttl){cache().put(key(type,value),JSON.stringify(data),ttl);}
 function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
 function config(){
  if(GoogleConfig.authMode()!=='GOOGLE_OAUTH')throw publicError_('El ingreso con Google OAuth no está habilitado');
  const clientId=GoogleConfig.property('GOOGLE_OAUTH_CLIENT_ID').trim(),secret=GoogleConfig.property('GOOGLE_OAUTH_CLIENT_SECRET').trim(),redirect=GoogleConfig.property('GOOGLE_OAUTH_REDIRECT_URI').trim();
  if(!secret||!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(redirect))throw publicError_('Administración debe completar la configuración de ingreso con Google');
  return {clientId,secret,redirect};
 }
 function json(url,options,stage){
  let response;try{response=UrlFetchApp.fetch(url,{...options,followRedirects:false,muteHttpExceptions:true});}catch{throw failure('GOOGLE_NETWORK');}
  let body;try{body=JSON.parse(response.getContentText());}catch{throw failure(stage==='IDENTITY'?'IDENTITY_REJECTED':'TOKEN_REJECTED');}
  if(response.getResponseCode()!==200){
   if(stage==='TOKEN'){
    const code=body?.error;
    if(code==='invalid_client'||code==='unauthorized_client')throw failure('CLIENT_REJECTED');
    if(code==='invalid_grant')throw failure('CODE_REJECTED');
    if(code==='redirect_uri_mismatch')throw failure('REDIRECT_REJECTED');
   }
   throw failure(stage==='IDENTITY'?'IDENTITY_REJECTED':'TOKEN_REJECTED');
  }
  if(!body||typeof body!=='object'||Array.isArray(body))throw failure(stage==='IDENTITY'?'IDENTITY_REJECTED':'TOKEN_REJECTED');
  return body;
 }
 function provider(){
  const stored=cache().get('genesis-auth-provider');if(stored)return JSON.parse(stored);
  const document=json('https://accounts.google.com/.well-known/openid-configuration',{});
  const endpoints={authorization_endpoint:document.authorization_endpoint,token_endpoint:document.token_endpoint,userinfo_endpoint:document.userinfo_endpoint};
  if(document.issuer!=='https://accounts.google.com'||!document.code_challenge_methods_supported?.includes('S256')||endpoints.authorization_endpoint!=='https://accounts.google.com/o/oauth2/v2/auth'||endpoints.token_endpoint!=='https://oauth2.googleapis.com/token'||endpoints.userinfo_endpoint!=='https://openidconnect.googleapis.com/v1/userinfo')throw publicError_('No se pudo comprobar el proveedor de identidad de Google');
  cache().put('genesis-auth-provider',JSON.stringify(endpoints),3600);return endpoints;
 }
 function settings(){const mode=GoogleConfig.authMode();let ready=false;if(mode==='GOOGLE_OAUTH')try{config();ready=true;}catch{}return {mode,ready};}
 function start(){
  const c=config(),endpoints=provider(),flowId=random(),claimSecret=random(),verifier=random(),expiresAt=Date.now()+FLOW_TTL*1000;
  const challenge=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,verifier,Utilities.Charset.UTF_8)).replace(/=+$/,'');
  write('flow',flowId,{status:'PENDING',claimHash:hash(claimSecret),verifier,expiresAt,clientId:c.clientId,redirect:c.redirect},FLOW_TTL);
  const params={client_id:c.clientId,redirect_uri:c.redirect,response_type:'code',scope:'openid email',state:flowId,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'};
  return {flowId,claimSecret,authorizationUrl:endpoints.authorization_endpoint+'?'+Object.entries(params).map(([name,value])=>encodeURIComponent(name)+'='+encodeURIComponent(value)).join('&')};
 }
 function callback(params){
  const state=params.state;let flow;
  GoogleConfig.lock(()=>{flow=read('flow',state);if(!flow||flow.expiresAt<=Date.now()||flow.status!=='PENDING')throw failure('FLOW_EXPIRED');flow.status='EXCHANGING';write('flow',state,flow,FLOW_TTL);});
  try{
   if(params.error)throw failure(params.error==='access_denied'?'GOOGLE_CANCELLED':'GOOGLE_AUTH_REJECTED');
   if(typeof params.code!=='string'||!params.code||params.code.length>4096)throw failure('CODE_REJECTED');
   let c;try{c=config();}catch{throw failure('CONFIGURATION');}
   const endpoints=provider();if(c.clientId!==flow.clientId||c.redirect!==flow.redirect)throw failure('CONFIG_CHANGED');
   const tokens=json(endpoints.token_endpoint,{method:'post',payload:{code:params.code,client_id:c.clientId,client_secret:c.secret,redirect_uri:c.redirect,grant_type:'authorization_code',code_verifier:flow.verifier}},'TOKEN');
   if(typeof tokens.access_token!=='string'||!tokens.access_token||String(tokens.token_type).toLowerCase()!=='bearer'||!(Number(tokens.expires_in)>0))throw failure('TOKEN_REJECTED');
   const profile=json(endpoints.userinfo_endpoint,{headers:{Authorization:'Bearer '+tokens.access_token}},'IDENTITY');
   if(profile.email_verified!==true||typeof profile.sub!=='string'||!profile.sub||profile.sub.length>255||!GoogleConfig.domainEmail(profile.email))throw failure('IDENTITY_REJECTED');
   flow={status:'VERIFIED',claimHash:flow.claimHash,expiresAt:flow.expiresAt,clientId:c.clientId,email:profile.email.trim().toLowerCase(),sub:profile.sub,sessionTtl:Math.min(SESSION_TTL,Math.floor(Number(tokens.expires_in)))};
   write('flow',state,flow,FLOW_TTL);return {success:true};
  }catch(error){const detail=failureDetail(error);write('flow',state,{status:'FAILED',claimHash:flow.claimHash,expiresAt:flow.expiresAt,failureCode:detail.code},FLOW_TTL);throw failure(detail.code);}
 }
 function poll(params){
  config();return GoogleConfig.lock(()=>{
   const flow=read('flow',params.flowId);
   if(!flow||flow.expiresAt<=Date.now()||!valid(params.claimSecret)||!equal(flow.claimHash,hash(params.claimSecret)))throw publicError_('El ingreso venció o no corresponde a esta pestaña');
   if(flow.status==='FAILED')throw failure(flow.failureCode);
   if(flow.status!=='VERIFIED')return {status:'PENDING'};
   // Configuration can be tested before storage exists. This never approves a
   // user, reads academic data, or creates an application session.
   if(GoogleConfig.property('ENVIRONMENT',false)!=='PILOT'&&GoogleConfig.property('ACCESS_ENABLED',false)!=='YES'){
    cache().remove(key('flow',params.flowId));
    return {status:'IDENTITY_VERIFIED',message:'Google verificó tu identidad. El acceso académico sigue deshabilitado; faltan la preparación del almacenamiento y la aprobación de cuentas por administración.'};
   }
   const db=loadDatabase_(),user=GoogleAccounts.authenticate(db,flow.email);
   if(typeof GooglePilot!=='undefined')GooglePilot.authorize(flow.email,'bootstrap');
   const token=random(),ttl=flow.sessionTtl,expiresAt=Date.now()+ttl*1000;
   write('session',token,{email:flow.email,sub:flow.sub,userId:user.id,clientId:flow.clientId,expiresAt},ttl);cache().remove(key('flow',params.flowId));
   return {status:'AUTHENTICATED',token,email:flow.email,expiresAt};
  });
 }
 function identity(token){const c=config(),session=read('session',token);if(!session||session.expiresAt<=Date.now()||session.clientId!==c.clientId)throw publicError_('La sesión de Google venció. Iniciá sesión nuevamente');return session.email;}
 function logout(token){if(valid(token))cache().remove(key('session',token));return {ok:true};}
 return {settings,start,callback,poll,identity,logout,failureDetail};
})();
