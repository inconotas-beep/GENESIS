// Run with the local server stopped. No grade values are changed.
import fs from 'node:fs';import G from './core.mjs';
const dir='data/privado/institucional',file=dir+'/database.json',initial=fs.readFileSync(file,'utf8'),db=JSON.parse(initial),admin=db.users.find(u=>u.active&&u.role==='ADMIN');
if(!admin)throw Error('No hay cuenta administradora activa');let changed=0;
for(const year of db.years){if(year.finalPolicy?.method==='AVERAGE_4'&&year.finalPolicy?.passMark===6)continue;G.execute(db,admin.email,'finalPolicy',{version:db.version,year:year.id,method:'AVERAGE_4',passMark:6,reason:'Confirmación expresa del usuario: todo lo no modular aprueba desde 6. Promedio de cuatro períodos según las plantillas.'});changed++;}
if(changed){if(fs.readFileSync(file,'utf8')!==initial)throw Error('La base cambió');fs.copyFileSync(file,dir+'/respaldo-criterio-final-'+Date.now()+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(db,null,2));fs.renameSync(file+'.tmp',file);}
console.log(JSON.stringify({yearsConfigured:changed,method:'AVERAGE_4',passMark:6,gradesUnchanged:true}));
