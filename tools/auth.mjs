import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const key=value=>String(value||'').trim().toLowerCase();
export function passwordRecord(username,password,userId){
 if(!key(username)||typeof password!=='string'||password.length<8||password.length>128)throw Error('Ingresá un usuario y una contraseña de al menos 8 caracteres');
 const salt=crypto.randomBytes(24).toString('hex');return {username:key(username),userId,salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};
}
export function authentication(dir,db){
 const file=path.join(dir,'credentials.json');
 if(!fs.existsSync(file)){
  if(!process.env.GENESIS_INITIAL_PASSWORD)throw Error('Configurá GENESIS_INITIAL_PASSWORD para inicializar el acceso local');
  const admin=db.users.find(u=>u.active&&u.role==='ADMIN');if(!admin)throw Error('No hay una cuenta administradora activa');
  const records=[passwordRecord('Rocio',process.env.GENESIS_INITIAL_PASSWORD,admin.id)];
  if(process.env.GENESIS_TEST_ACCOUNTS==='1')for(const user of db.users.filter(u=>u.id!==admin.id))records.push(passwordRecord(user.id,process.env.GENESIS_INITIAL_PASSWORD,user.id));
  fs.writeFileSync(file,JSON.stringify(records,null,2));
 }
 const attempts=new Map();
 return {set(username,password,userId){const previous=fs.readFileSync(file,'utf8'),records=JSON.parse(previous),name=key(username);if(records.some(r=>r.username===name&&r.userId!==userId))throw Error('El usuario ya existe');const record=passwordRecord(name,password,userId),next=records.filter(r=>r.userId!==userId);next.push(record);fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2));fs.renameSync(file+'.tmp',file);return ()=>{fs.writeFileSync(file+'.tmp',previous);fs.renameSync(file+'.tmp',file);};},login(username,password,database){
  const name=key(username),now=Date.now(),state=attempts.get(name)||{count:0,until:now+900000};if(state.until<=now){state.count=0;state.until=now+900000;}
  if(state.count>=5)throw Error('Demasiados intentos. Esperá 15 minutos antes de volver a intentar');
  const records=JSON.parse(fs.readFileSync(file,'utf8')),record=records.find(r=>r.username===name),salt=record?.salt||'unregistered-account';
  const hash=crypto.scryptSync(typeof password==='string'?password.slice(0,129):'',salt,64),valid=record&&record.hash.length===128&&crypto.timingSafeEqual(hash,Buffer.from(record.hash,'hex'));
  const user=record&&database.users.find(u=>u.id===record.userId&&u.active);
  if(!valid||!user){state.count++;attempts.set(name,state);throw Error('Usuario o contraseña incorrectos');}attempts.delete(name);return user;
 }};
}
