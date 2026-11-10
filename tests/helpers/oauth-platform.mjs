// Entire OAuth provider is local and synthetic. No Google endpoints are contacted.
import crypto from 'node:crypto';
import G from '../../tools/core.mjs';
import {googlePlatform} from './google-platform.mjs';
export function oauthPlatform(){
 const db=G.seed(),emails={admin:'admin@accounts.example.invalid',teacher:'teacher@accounts.example.invalid',other:'pending@accounts.example.invalid',direction:'direction@accounts.example.invalid'};
 for(const user of db.users)user.email=emails[user.id];
 db.assignments[1].teacherId='other';db.users.find(user=>user.id==='other').googleIdentity={status:'PENDING',email:''};
 const env=googlePlatform({db}),{c,props}=env,cache=new Map(),codes=new Map(),tokens=new Map(),requests=[];let now=Date.now();
 c.Date=class extends Date{static now(){return now;}};
 Object.entries({AUTH_MODE:'GOOGLE_OAUTH',AUTH_DOMAIN:'',ADMIN_EMAIL:emails.admin,GOOGLE_OAUTH_CLIENT_ID:'synthetic-client.apps.googleusercontent.com',GOOGLE_OAUTH_CLIENT_SECRET:'synthetic-secret-never-real',GOOGLE_OAUTH_REDIRECT_URI:'https://script.google.com/macros/s/LOCAL_TEST_DEPLOYMENT/exec'}).forEach(([key,value])=>props.set(key,value));
 c.CacheService={getScriptCache:()=>({get:key=>{const value=cache.get(key);return value&&value.expires>now?value.text:null;},put:(key,text,seconds)=>{if(!(seconds>0))throw Error('Invalid cache TTL');cache.set(key,{text,expires:now+seconds*1000});},remove:key=>cache.delete(key)})};
 c.Utilities.base64EncodeWebSafe=bytes=>Buffer.from(bytes.map(b=>(b+256)%256)).toString('base64url');
 const provider={issuer:'https://accounts.google.com',code_challenge_methods_supported:['S256'],authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',userinfo_endpoint:'https://openidconnect.googleapis.com/v1/userinfo'};
 const response=(data,status=200)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
 c.UrlFetchApp={fetch:(url,options)=>{
  requests.push({url,options});
  if(url==='https://accounts.google.com/.well-known/openid-configuration')return response(provider);
  if(url===provider.token_endpoint){
   const p=options.payload,grant=codes.get(p.code),challenge=crypto.createHash('sha256').update(p.code_verifier).digest('base64url');
   if(!grant||grant.used||grant.challenge!==challenge||p.client_id!==props.get('GOOGLE_OAUTH_CLIENT_ID')||p.client_secret!==props.get('GOOGLE_OAUTH_CLIENT_SECRET')||p.redirect_uri!==props.get('GOOGLE_OAUTH_REDIRECT_URI'))return response({error:'invalid_grant'},400);
   grant.used=true;const token='test-access-'+crypto.randomUUID();tokens.set(token,grant.profile);return response({access_token:token,token_type:'Bearer',expires_in:3600});
  }
  if(url===provider.userinfo_endpoint){const profile=tokens.get(options.headers.Authorization.slice(7));return profile?response(profile):response({},401);}
  throw Error('Unexpected endpoint');
 }};
 function authorize(flow,email=emails.teacher,overrides={}){const url=new URL(flow.authorizationUrl),code='local-code-'+crypto.randomUUID();codes.set(code,{challenge:url.searchParams.get('code_challenge'),profile:{email,email_verified:true,sub:'local-sub-'+email,...overrides}});return code;}
 function login(email=emails.teacher){const flow=c.api('authStart'),code=authorize(flow,email);c.GoogleOAuth.callback({state:flow.flowId,code});return c.api('authPoll',{flowId:flow.flowId,claimSecret:flow.claimSecret});}
 return {...env,emails,requests,cache,codes,provider,authorize,login,advance(ms){now+=ms;}};
}
