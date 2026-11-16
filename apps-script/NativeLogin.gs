var NativeLogin=(()=>{
 const props=()=>PropertiesService.getScriptProperties();
 const enabled=()=>props().getProperty('GENESIS_LOGIN_MODE')==='PASSWORD';
 const username=value=>typeof value==='string'?value.trim().toLowerCase():'';
 const hash=value=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
 const validName=name=>/^[a-z0-9._-]{3,40}$/.test(name);
 const sessionKey=token=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?'native-session:'+hash(token):null;
 const record=name=>JSON.parse(props().getProperty('native-user:'+name)||'null');
 const passwordOk=value=>typeof value==='string'&&value.length>=8&&!bcrypt.truncates(value)&&!value.includes('\0');
 function login(params){
  GoogleConfig.access();
  const name=username(params?.username),password=params?.password;
  if(!validName(name)||!passwordOk(password))throw publicError_('Usuario o contraseña incorrectos');
  return GoogleConfig.lock(()=>{
   const cache=CacheService.getScriptCache(),key='native-attempt:'+name,count=Number(cache.get(key)||0);
   if(count>=5)throw publicError_('Demasiados intentos. Esperá 15 minutos.');
   const account=record(name);
   if(!account||!bcrypt.compareSync(password,account.hash)){
    cache.put(key,String(count+1),900);
    throw publicError_('Usuario o contraseña incorrectos');
   }
   if(!loadDatabase_().users.some(u=>u.id===account.userId&&u.active))throw publicError_('Usuario o contraseña incorrectos');
   cache.remove(key);
   const token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
   cache.put(sessionKey(token),JSON.stringify({name,hash:account.hash,userId:account.userId}),3600);
   return {token};
  });
 }
 function session(token){
  const key=sessionKey(token),session=key&&JSON.parse(CacheService.getScriptCache().get(key)||'null');
  const account=session&&record(session.name);
  if(account&&account.hash===session.hash&&account.userId===session.userId)return account;
  throw publicError_('La sesión venció. Iniciá sesión nuevamente');
 }
 function actor(db,token){
  const account=session(token),user=db.users.find(u=>u.id===account.userId&&u.active);
  if(!user)throw publicError_('La sesión venció. Iniciá sesión nuevamente');
  return user;
 }
 function set(db,admin,p){
  if(admin.role!=='ADMIN')throw publicError_('Solo administración puede gestionar accesos');
  if(p.version!==db.version)throw publicError_('Los datos cambiaron. Recargá antes de guardar');
  const name=username(p.username),existing=validName(name)&&record(name);
  if(!validName(name)||!passwordOk(p.password)||!db.users.some(u=>u.id===p.userId&&u.active)||existing&&existing.userId!==p.userId)throw publicError_('Usuario o contraseña inválidos, o usuario repetido');
  bcrypt.setRandomFallback(size=>{
   const bytes=[];
   while(bytes.length<size)bytes.push(...Utilities.getUuid().replace(/-/g,'').match(/../g).map(pair=>parseInt(pair,16)));
   return bytes.slice(0,size);
  });
  const store=props(),previous=store.getProperties();
  store.setProperty('native-user:'+name,JSON.stringify({userId:p.userId,hash:bcrypt.hashSync(p.password,12),revision:Utilities.getUuid()}));
  for(const key of Object.keys(previous))if(key.startsWith('native-user:')&&key!=='native-user:'+name&&JSON.parse(previous[key]).userId===p.userId)store.deleteProperty(key);
  return {ok:true};
 }
 function logout(token){const key=sessionKey(token);if(key)CacheService.getScriptCache().remove(key);return {ok:true};}
 return {enabled,login,session,actor,set,logout};
})();

function prepararAccesoRocio_(){
 const email=GoogleConfig.editorIdentity();
 if(email!==GoogleConfig.property('ADMIN_EMAIL').trim().toLowerCase())throw publicError_('Ejecutá con la cuenta propietaria');
 return GoogleConfig.lock(()=>{
  const store=PropertiesService.getScriptProperties();
  const password=store.getProperty('GENESIS_ROCIO_INITIAL_PASSWORD');
  const db=loadDatabase_(),admin=GoogleConfig.admin(db,email);
  NativeLogin.set(db,admin,{version:db.version,userId:admin.id,username:'Rocio',password});
  store.deleteProperty('GENESIS_ROCIO_INITIAL_PASSWORD');
  return {status:'ACCESO_ROCIO_PREPARADO'};
 });
}
