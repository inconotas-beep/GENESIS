var GoogleConfig=(()=>{
 function property(name,required=true){const value=PropertiesService.getScriptProperties().getProperty(name);if(required&&!value)throw publicError_('Falta configurar '+name);return value||'';}
 function authMode(){const mode=property('AUTH_MODE',false)||(property('AUTH_DOMAIN',false)?'WORKSPACE_SESSION':'GOOGLE_OAUTH');if(!['WORKSPACE_SESSION','GOOGLE_OAUTH'].includes(mode))throw publicError_('Modo de autenticación inválido');return mode;}
 function domainEmail(email){return typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&(authMode()==='GOOGLE_OAUTH'||email.toLowerCase().endsWith('@'+property('AUTH_DOMAIN').toLowerCase()));}
 function editorIdentity(){let email;try{email=Session.getActiveUser().getEmail();}catch{throw publicError_('No se pudo verificar tu cuenta de Google');}if(!email)throw publicError_('Acceso denegado: identidad de Google no disponible');email=email.trim().toLowerCase();if(!domainEmail(email))throw publicError_('Acceso denegado: usá tu cuenta de Google autorizada');return email;}
 function identity(token){return authMode()==='GOOGLE_OAUTH'?GoogleOAuth.identity(token):editorIdentity();}
 function lock(fn){const lock=LockService.getScriptLock();try{lock.waitLock(30000);}catch{throw publicError_('El sistema está ocupado. Tu borrador no se guardó; intentá nuevamente');}try{return fn();}finally{lock.releaseLock();}}
 function admin(db,email){const user=GoogleAccounts.authenticate(db,email);if(user.role!=='ADMIN')throw publicError_('Solo administración puede realizar esta operación');return user;}
 function access(){const environment=property('ENVIRONMENT',false);if(environment==='PILOT')return;if(environment!=='PRODUCTION'||property('ACCESS_ENABLED',false)!=='YES')throw publicError_('El acceso institucional todavía no está habilitado. La migración está pendiente de verificación y autorización');}
 return {property,authMode,domainEmail,editorIdentity,identity,lock,admin,access};
})();
