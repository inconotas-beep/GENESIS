// Package reviewed identities locally. Does not contact Google or change the source.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');if(path.resolve(process.cwd())!==root)throw Error('Ejecutá desde GENESIS-GOOGLE');
const settings=JSON.parse(fs.readFileSync('migration/private/script-properties.local.json','utf8'));
const result=spawnSync(process.execPath,['tools/migration-audit.mjs','--capture-current-data','--prepare-private','--email-map','migration/private/email-map.google.json','--admin-email',settings.ADMIN_EMAIL,'--auth-mode',settings.AUTH_MODE],{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;process.exitCode=result.status??1;
if(result.status===0){const pointer=JSON.parse(fs.readFileSync('migration/private/latest-package.json','utf8')),current=JSON.parse(fs.readFileSync('migration/private/script-properties.local.json','utf8'));if(!current.IMPORT_FILE_ID){current.IMPORT_SHA256=pointer.sha256;fs.writeFileSync('migration/private/script-properties.local.json',JSON.stringify(current,null,2));}console.log('Ruta y hash del paquete en migration/private/latest-package.json. No se subió a Google.');}
