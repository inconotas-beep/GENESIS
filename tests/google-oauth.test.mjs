import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthPlatform} from './helpers/oauth-platform.mjs';
import {prepareAccounts} from '../src/account-migration.mjs';
import G from '../tools/core.mjs';
import {validDeployment} from '../src/auth-policy.mjs';
test('OAuth: personal accounts require explicit approval, even when the executing owner is an administrator',()=>{
 const env=oauthPlatform();env.as(env.emails.admin);const loads=env.stats.loads;assert.throws(()=>env.c.api('bootstrap',{email:env.emails.admin,role:'ADMIN'}),/sesión de Google venció/);assert.equal(env.stats.loads,loads);
 const session=env.login();const me=env.c.api('bootstrap',{},session.token).user;assert.equal(me.id,'teacher');assert.equal(me.role,'TEACHER');assert.equal(env.stats.writes,0);
});
test('OAuth: authorization code uses state, PKCE and the configured client; secrets and Google access tokens never reach the browser',()=>{
 const env=oauthPlatform(),flow=env.c.api('authStart'),url=new URL(flow.authorizationUrl);assert.equal(url.searchParams.get('scope'),'openid email');assert.equal(url.searchParams.get('state'),flow.flowId);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(!flow.authorizationUrl.includes(env.props.get('GOOGLE_OAUTH_CLIENT_SECRET')));
 const code=env.authorize(flow);env.c.GoogleOAuth.callback({state:flow.flowId,code});const session=env.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret});assert.match(session.token,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(session).includes('test-access-'));assert.ok(!JSON.stringify([...env.cache.values()]).includes('synthetic-secret-never-real'));assert.equal(env.requests.filter(r=>r.url.endsWith('/token')).length,1);
});
test('OAuth: forged state, wrong browser secret, swapped code and repeated callback are rejected',()=>{
 const env=oauthPlatform();assert.throws(()=>env.c.GoogleOAuth.callback({state:'a'.repeat(64),code:'forged'}));assert.equal(env.requests.length,0);
 const one=env.c.api('authStart'),two=env.c.api('authStart'),code=env.authorize(two);assert.throws(()=>env.c.GoogleOAuth.callback({state:one.flowId,code}));
 const third=env.c.api('authStart'),thirdCode=env.authorize(third);env.c.GoogleOAuth.callback({state:third.flowId,code:thirdCode});assert.throws(()=>env.c.api('authPoll',{flowId:third.flowId,claimSecret:'b'.repeat(64)}));
 env.c.api('authPoll',{flowId:third.flowId,claimSecret:third.claimSecret});assert.throws(()=>env.c.GoogleOAuth.callback({state:third.flowId,code:thirdCode}));assert.throws(()=>env.c.api('authPoll',{flowId:third.flowId,claimSecret:third.claimSecret}));
});
test('OAuth: unverified and unapproved emails never receive an application session',()=>{
 for(const verified of [false,'true',undefined]){const env=oauthPlatform(),flow=env.c.api('authStart');const code=env.authorize(flow,env.emails.teacher,{email_verified:verified});assert.throws(()=>env.c.GoogleOAuth.callback({state:flow.flowId,code}));assert.throws(()=>env.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret}));}
 const env=oauthPlatform();assert.throws(()=>env.login('unknown@gmail.com'),/no confirmada/);assert.throws(()=>env.login(env.emails.other),/no confirmada/);assert.equal(env.stats.writes,0);
});
test('OAuth: sessions expire and logout removes access without falling back to the owner',()=>{
 const env=oauthPlatform(),session=env.login();env.c.api('authLogout',{},session.token);assert.throws(()=>env.c.api('bootstrap',{},session.token),/venció/);const other=env.login();env.advance(3601000);assert.throws(()=>env.c.api('bootstrap',{},other.token),/venció/);
});
test('OAuth: disabling a registered account revokes an existing session immediately',()=>{
 const env=oauthPlatform(),teacher=env.login(),admin=env.login(env.emails.admin);env.c.api('googleAccount',{version:0,userId:'teacher',email:env.emails.teacher,role:'TEACHER',active:false,confirmed:true},admin.token);assert.throws(()=>env.c.api('bootstrap',{},teacher.token),/inactiva/);assert.equal(env.database().users[1].active,false);
});
test('OAuth: teacher sessions cannot elevate roles or access another assignment; notes retain zeros and precision',()=>{
 const env=oauthPlatform(),session=env.login();env.c.api('saveGrades',{version:0,assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[0,8.95,null]}]},session.token);assert.deepEqual(env.database().grades[0].values,[0,8.95,null]);assert.throws(()=>env.c.api('googleAccount',{version:1,userId:'teacher',email:env.emails.teacher,role:'ADMIN',active:true,confirmed:true},session.token),/administración/);
 assert.throws(()=>env.c.api('roster',{assignmentId:'a2',periodId:'1',role:'ADMIN',email:env.emails.admin},session.token),/denegado/);
});
test('OAuth: missing configuration, changed client, expired flow or an unexpected provider fail closed',()=>{
 const blank=oauthPlatform();for(const property of ['AUTH_MODE','AUTH_DOMAIN','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI'])blank.props.delete(property);assert.equal(blank.c.api('authConfig').mode,'GOOGLE_OAUTH');assert.equal(blank.c.api('authConfig').ready,false);assert.throws(()=>blank.c.api('bootstrap'));assert.equal(blank.stats.loads,0);
 const env=oauthPlatform();env.props.delete('GOOGLE_OAUTH_CLIENT_SECRET');assert.equal(env.c.api('authConfig').ready,false);assert.throws(()=>env.c.api('authStart'));
 const changed=oauthPlatform(),session=changed.login();changed.props.set('GOOGLE_OAUTH_CLIENT_ID','other-client.apps.googleusercontent.com');assert.throws(()=>changed.c.api('bootstrap',{},session.token),/venció/);
 const expired=oauthPlatform(),flow=expired.c.api('authStart');expired.advance(600001);assert.throws(()=>expired.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret}));
 const wrong=oauthPlatform();wrong.provider.token_endpoint='https://attacker.example.invalid/token';assert.throws(()=>wrong.c.api('authStart'),/proveedor/);
 const weak=oauthPlatform();weak.provider.code_challenge_methods_supported=[];assert.throws(()=>weak.c.api('authStart'),/proveedor/);
});
test('OAuth: editor operations verify the actual responsible account and never need a browser session',()=>{
 const env=oauthPlatform();env.as(env.emails.admin);assert.equal(env.c.requireResponsibleAccount_(),env.emails.admin);env.as(env.emails.teacher);assert.throws(()=>env.c.requireResponsibleAccount_(),/responsable/);
});
test('OAuth: reviewed personal accounts can be prepared without changing roles, records or pending users',()=>{
 const db=G.seed(),before=JSON.stringify(db),prepared=prepareAccounts(db,{admin:'owner@gmail.com'},'owner@gmail.com','2099-01-01','GOOGLE_OAUTH');assert.equal(prepared.users[0].email,'owner@gmail.com');assert.equal(prepared.users[1].googleIdentity.status,'PENDING');assert.equal(prepared.users[1].email,db.users[1].email);assert.equal(JSON.stringify(db),before);assert.equal(JSON.stringify(prepared.assignments),JSON.stringify(db.assignments));
});
test('OAuth: a verified session cannot open academic data while production access is disabled',()=>{
 const env=oauthPlatform(),session=env.login();env.props.set('ACCESS_ENABLED','NO');assert.throws(()=>env.c.api('bootstrap',{},session.token),/todavía no está habilitado/);assert.equal(env.stats.writes,0);
});
test('OAuth: deployment policy permits private staging and refuses anonymous or unsupported profiles',()=>{
 const manifest={webapp:{access:'MYSELF',executeAs:'USER_DEPLOYING'}};assert.equal(validDeployment(manifest,'GOOGLE_OAUTH'),true);manifest.webapp.access='ANYONE';assert.equal(validDeployment(manifest,'GOOGLE_OAUTH'),true);manifest.webapp.access='ANYONE_ANONYMOUS';assert.equal(validDeployment(manifest,'GOOGLE_OAUTH'),false);manifest.webapp.access='DOMAIN';assert.equal(validDeployment(manifest,'unknown'),false);
});

test('OAuth: token failures show only fixed diagnostics in the callback and the originating tab',()=>{
 for(const [providerError,diagnostic] of [['invalid_client','CLIENT_REJECTED'],['invalid_grant','CODE_REJECTED'],['redirect_uri_mismatch','REDIRECT_REJECTED'],['unknown-sensitive-body','TOKEN_REJECTED']]){
  const env=oauthPlatform(),flow=env.c.api('authStart'),original=env.c.UrlFetchApp.fetch;
  env.c.UrlFetchApp.fetch=(url,options)=>url===env.provider.token_endpoint?{getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:providerError,error_description:'PRIVATE_SECRET_AND_EMAIL<script>alert(1)</script>'})}:original(url,options);
  env.c.HtmlService={createHtmlOutput:html=>html};
  const html=env.c.doGet({parameter:{state:flow.flowId,code:'PRIVATE_AUTHORIZATION_CODE'}});
  assert.ok(html.includes(diagnostic));assert.ok(!html.includes('PRIVATE_'));assert.ok(!html.includes('<script>'));
  assert.throws(()=>env.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret}),error=>error.genesisOAuthCode===diagnostic&&!error.message.includes('PRIVATE_'));
  assert.equal(env.stats.loads,0);assert.equal(env.stats.writes,0);
 }
});

test('OAuth: expired flows, Google cancellation and unexpected exceptions do not expose request data',()=>{
 const expired=oauthPlatform();expired.c.HtmlService={createHtmlOutput:html=>html};
 const html=expired.c.doGet({parameter:{state:'a'.repeat(64),code:'PRIVATE_CODE'}});assert.ok(html.includes('FLOW_EXPIRED'));assert.ok(!html.includes('PRIVATE_CODE'));
 for(const [providerError,expected] of [['access_denied','GOOGLE_CANCELLED'],['<img onerror=PRIVATE_SECRET>','GOOGLE_AUTH_REJECTED']]){
  const env=oauthPlatform(),flow=env.c.api('authStart');assert.throws(()=>env.c.GoogleOAuth.callback({state:flow.flowId,error:providerError,error_description:'PRIVATE_DESCRIPTION'}),error=>error.genesisOAuthCode===expected&&!error.message.includes('PRIVATE_'));
 }
 const env=oauthPlatform(),flow=env.c.api('authStart');env.c.UrlFetchApp.fetch=()=>{throw Error('PRIVATE_NETWORK_AUTHORIZATION_HEADER');};
 assert.throws(()=>env.c.GoogleOAuth.callback({state:flow.flowId,code:'PRIVATE_CODE'}),error=>error.genesisOAuthCode==='GOOGLE_NETWORK'&&!error.message.includes('PRIVATE_'));
 const detail=env.c.GoogleOAuth.failureDetail({genesisOAuthCode:'<script>PRIVATE</script>',message:'PRIVATE_MESSAGE'});assert.equal(detail.code,'OAUTH_FAILURE');assert.ok(!detail.message.includes('PRIVATE'));
});

test('OAuth: configuration-only verification needs no storage and grants no academic session, even to unapproved accounts',()=>{
 const env=oauthPlatform();env.props.set('ACCESS_ENABLED','NO');env.props.delete('SPREADSHEET_ID');env.props.delete('ENVIRONMENT');
 const flow=env.c.api('authStart'),code=env.authorize(flow,'unapproved@gmail.com');env.c.GoogleOAuth.callback({state:flow.flowId,code});
 const result=env.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret});
 assert.equal(result.status,'IDENTITY_VERIFIED');assert.equal(result.token,undefined);assert.equal(result.email,undefined);assert.equal(env.stats.loads,0);assert.equal(env.stats.writes,0);
 assert.equal([...env.cache.keys()].some(key=>key.startsWith('genesis-auth-session-')),false);
 assert.throws(()=>env.c.api('bootstrap',{},flow.flowId),/sesión de Google venció/);
 assert.throws(()=>env.c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret}));
});

test('OAuth: copied property whitespace is normalized, while empty secrets still fail closed',()=>{
 const env=oauthPlatform();for(const name of ['GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI'])env.props.set(name,'  '+env.props.get(name)+'\n');
 assert.equal(env.c.api('authConfig').ready,true);const url=new URL(env.c.api('authStart').authorizationUrl);assert.equal(url.searchParams.get('client_id'),'synthetic-client.apps.googleusercontent.com');assert.equal(url.searchParams.get('redirect_uri'),'https://script.google.com/macros/s/LOCAL_TEST_DEPLOYMENT/exec');
 env.props.set('GOOGLE_OAUTH_CLIENT_SECRET',' \n ');assert.equal(env.c.api('authConfig').ready,false);
});
