// Private institutional roster ingestion. Never prints names, identifiers, or grades.
import fs from 'node:fs';
import crypto from 'node:crypto';
import G from './core.mjs';
import {unzip,workbook,normalize} from './xlsx.mjs';
const dir='data/privado/institucional';fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(dir+'/database.json')){const previous=JSON.parse(fs.readFileSync(dir+'/database.json'));if(!process.argv.includes('--refresh')||previous.grades.length||previous.assignments.length||previous.version!==1)throw Error('La base institucional ya existe. No se sobrescribirá');fs.copyFileSync(dir+'/database.json',dir+'/respaldo-roster-'+Date.now()+'.json');}
const source=fs.readFileSync('NOTAS PROFESORES.zip'),sections=new Map(),candidates=new Map(),pending=[],subjects=new Map();let occurrences=0;
for(const [file,bytes]of unzip(source))if(/\.xlsx$/i.test(file))for(const sheet of workbook(bytes)){
 if(normalize(sheet.name)==='RESPUESTAS DE FORMULARIO 1')continue;
 const aliases={'1ACienciasNaturales':['1A','Ciencias Naturales'],'1KCienciayTecnología':['1K','Ciencia y Tecnología'],'Costos 3B':['3B','Costos'],'1KLenguayLiteratura':['1K','Lengua y Literatura']},alias=aliases[sheet.name];
 const match=alias?['',alias[0][0],alias[0][1]]:normalize(sheet.name).match(/^\s*([123])\s*[º°.ª]?\s*([A-Z])(?=\s|-|$)/),anchors=sheet.cells.filter(c=>normalize(c.value)==='NIE');
 if(!match){if(anchors.length)pending.push({file,sheet:sheet.name,reason:'SECTION_REVIEW'});continue;}
 const sectionId=match[1]+match[2];if(!sections.has(sectionId))sections.set(sectionId,{id:sectionId,name:`${match[1]}.º ${match[2]}`,grade:match[1],subjectIds:[]});
 const subjectName=alias?alias[1]:sheet.name.slice(match[0].length).replace(/^[-\s]+/,'').trim();
 if(subjectName&&!/CONDUCT|COMP[EO]T|REMED|SOCIAL(?!ES)/.test(normalize(subjectName))){const id='sub-'+crypto.createHash('sha256').update(normalize(subjectName)).digest('hex').slice(0,12);subjects.set(id,{id,name:subjectName,type:/MODULO/.test(normalize(subjectName))?'MODULO_FASES':'GENERAL_4_PERIODOS'});if(!sections.get(sectionId).subjectIds.includes(id))sections.get(sectionId).subjectIds.push(id);}
 for(const h of anchors){
  const next=anchors.filter(x=>x.row>h.row).sort((a,b)=>a.row-b.row)[0]?.row||Infinity,right=anchors.filter(x=>x.row===h.row&&x.col>h.col).sort((a,b)=>a.col-b.col)[0]?.col||Infinity;
  const nameCols=[...new Set(sheet.cells.filter(c=>c.row>=h.row-1&&c.row<=h.row+1&&c.col>h.col&&c.col<right&&/APELLID|NOMBRE/.test(normalize(c.value))).map(c=>c.col))].sort((a,b)=>a-b);
  if(!nameCols.length){pending.push({file,sheet:sheet.name,cell:h.cell,reason:'NAME_COLUMNS_REVIEW'});continue;}
  const byRow=new Map();for(const c of sheet.cells){if(!byRow.has(c.row))byRow.set(c.row,new Map());byRow.get(c.row).set(c.col,c);}
  for(const c of sheet.cells.filter(c=>c.col===h.col&&c.row>h.row&&c.row<next&&c.value!==null)){
   const nie=String(c.value).trim(),name=nameCols.map(col=>byRow.get(c.row)?.get(col)?.value).filter(v=>typeof v==='string'&&v.trim()).join(' ').replace(/\s+/g,' ').trim();
   if(!/^\d{1,20}$/.test(nie)||!name)continue;occurrences++;
   if(typeof c.value==='number'&&!Number.isSafeInteger(c.value)){pending.push({file,sheet:sheet.name,cell:c.cell,reason:'NIE_REVIEW'});continue;}
   if(!candidates.has(nie))candidates.set(nie,[]);candidates.get(nie).push({nie,name,sectionId,numeric:typeof c.value==='number',source:{file,sheet:sheet.name,cell:c.cell}});
  }
 }
}
const db=G.seed();for(const t of G.tables)db[t]=[];
db.version=1;db.roles=[{id:'ADMIN'},{id:'DIRECTION'},{id:'TEACHER'}];db.users=[{id:'admin',name:'Rocío',email:'rocio@local.invalid',role:'ADMIN',active:true}];db.years=[{id:'2026',label:'2026'}];db.periods=[1,2,3,4].map(n=>({id:String(n),name:`Período ${n}`,year:'2026'}));db.sections=[...sections.values()].sort((a,b)=>a.id.localeCompare(b.id));db.subjects=[...subjects.values()];
const numericKeys=new Map();for(const nie of candidates.keys()){const k=BigInt(nie).toString();if(!numericKeys.has(k))numericKeys.set(k,[]);numericKeys.get(k).push(nie);}
let numericImported=0;
for(const [nie,rows]of candidates){
 const names=new Set(rows.map(r=>normalize(r.name).replace(/[^A-Z0-9]/g,''))),groups=new Set(rows.map(r=>r.sectionId));
 if(names.size!==1||groups.size!==1||numericKeys.get(BigInt(nie).toString()).length!==1){pending.push({reason:'IDENTITY_OR_ENROLLMENT_CONFLICT',nie,rows});continue;}
 const id='s-'+crypto.createHash('sha256').update(nie).digest('hex').slice(0,20),r=rows[0];db.students.push({id,nie,name:r.name,source:r.source});db.enrollments.push({id:'e-'+id,studentId:id,year:'2026',sectionId:r.sectionId});if(rows.some(r=>r.numeric))numericImported++;
}
db.audit=[{id:crypto.randomUUID(),at:new Date().toISOString(),userId:'admin',kind:'ROSTERS_IMPORTED',detail:{students:db.students.length,sections:db.sections.length,pending:pending.length,sourceHash:crypto.createHash('sha256').update(source).digest('hex')}}];
fs.writeFileSync(dir+'/database.json',JSON.stringify(db,null,2));fs.writeFileSync(dir+'/revision-privada.json',JSON.stringify({pending,numericImported,notice:'Los NIE numéricos se conservan como texto exacto sin reconstruir ceros. Los nombres, matrículas y alias pendientes requieren revisión institucional.'},null,2));
const summary={sections:db.sections.length,students:db.students.length,subjects:db.subjects.length,rosterOccurrences:occurrences,pending:pending.length,numericImported,assignments:0,grades:0};fs.writeFileSync(dir+'/resumen.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
