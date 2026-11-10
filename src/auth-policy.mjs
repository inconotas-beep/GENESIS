export function validGoogleEmail(email,mode='WORKSPACE_SESSION'){
 if(!['WORKSPACE_SESSION','GOOGLE_OAUTH'].includes(mode))throw Error('Modo de autenticación inválido');
 return typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&(mode==='GOOGLE_OAUTH'||email.endsWith('@clases.edu.sv'));
}
export function validDeployment(manifest,mode){return ['WORKSPACE_SESSION','GOOGLE_OAUTH'].includes(mode)&&manifest.webapp?.executeAs==='USER_DEPLOYING'&&(mode==='GOOGLE_OAUTH'?['MYSELF','ANYONE'].includes(manifest.webapp.access):manifest.webapp?.access==='DOMAIN');}
