// Renew the existing grant through Google's SDK; never print token material.
import {initAuth,getUserInfo} from '../node_modules/@google/clasp/build/src/auth/auth.js';
const {credentials}=await initAuth({authFilePath:'migration/private/clasp-auth.json'});
if(!credentials||(await getUserInfo(credentials))?.email!=='inconotas@gmail.com')throw Error('La sesión no corresponde a la cuenta autorizada');
await credentials.refreshAccessToken();
if((await getUserInfo(credentials))?.email!=='inconotas@gmail.com')throw Error('No se pudo verificar la cuenta después de renovar la sesión');
console.log('Sesión de clasp renovada y verificada. No se modificaron recursos ni permisos de Google.');
