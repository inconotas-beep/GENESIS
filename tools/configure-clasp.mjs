import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');if(path.resolve(process.cwd())!==root)throw Error('Ejecutá la configuración desde GENESIS-GOOGLE');
const id=process.argv[2];if(!id||!/^[A-Za-z0-9_-]{20,}$/.test(id)||/REEMPLAZAR|ID_REAL|LOCAL_SELECTION|YOUR_|EXAMPLE/i.test(id))throw Error('Uso: node tools/configure-clasp.mjs ID_REAL_DEL_PROYECTO_AUTORIZADO (sin marcadores de ejemplo)');
if(fs.existsSync('.clasp.json'))throw Error('Ya existe .clasp.json; revisalo sin sobrescribirlo');
fs.writeFileSync('.clasp.json',JSON.stringify({scriptId:id,rootDir:'dist/apps-script'},null,2));console.log('Configuración local creada. No se contactó Google.');
