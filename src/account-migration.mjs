// Local preparation only. Never infer an institutional address or change an ID/role.
import {validGoogleEmail} from './auth-policy.mjs';
export function prepareAccounts(database,mapping,adminEmail,now=new Date().toISOString(),mode='WORKSPACE_SESSION'){
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('La correspondencia debe ser un objeto ID → correo confirmado');
  const valid=email=>validGoogleEmail(email,mode);
  const normalized=Object.fromEntries(Object.entries(mapping).filter(([,value])=>value!=='').map(([id,value])=>{
    if(!database.users.some(user=>user.id===id))throw Error('La correspondencia incluye un usuario inexistente');
    if(typeof value!=='string'||!valid(value.trim().toLowerCase()))throw Error('Correo confirmado inválido o fuera del dominio institucional');
    return [id,value.trim().toLowerCase()];
  }));
  const responsible=typeof adminEmail==='string'?adminEmail.trim().toLowerCase():'';
  const admin=database.users.find(user=>user.active&&user.role==='ADMIN'&&normalized[user.id]===responsible);
  if(!valid(responsible)||!admin)throw Error('Debe confirmarse al menos la cuenta administradora activa y responsable de la migración');
  if(new Set(Object.values(normalized)).size!==Object.keys(normalized).length)throw Error('Correos confirmados repetidos');
  const prepared=structuredClone(database);
  for(const user of prepared.users){
    const email=normalized[user.id];
    user.googleIdentity={status:email?'CONFIRMED':'PENDING',email:email||'',originalEmail:user.email,confirmedBy:email?admin.id:null,confirmedAt:email?now:null};
    if(email)user.email=email;
  }
  if(new Set(prepared.users.map(user=>String(user.email).toLowerCase())).size!==prepared.users.length)throw Error('El correo confirmado coincide con otra cuenta existente; revisá la correspondencia');
  return prepared;
}
