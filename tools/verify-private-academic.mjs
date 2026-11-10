import fs from 'node:fs';import {unzip,workbook} from './xlsx.mjs';import {parseFormula,evaluate} from './formula-check.mjs';import G from './core.mjs';
const dir='data/privado/institucional',db=JSON.parse(fs.readFileSync(dir+'/database.json')),batch=db.batches.findLast(b=>b.bulk&&b.status==='IMPORTED');if(!batch)throw Error('No hay una carga académica aplicada');
const grades=db.grades.filter(g=>g.source?.batch===batch.id),seen=new Set(),failures=[];let originalComparisons=0,pending=0,sourceMatched=0;
for(const g of grades){const key=[g.year,g.sectionId,g.subjectId,g.studentId,g.periodId].join('|');if(seen.has(key))failures.push({id:g.id,reason:'DUPLICATE'});seen.add(key);const a=db.assignments.find(a=>a.id===g.source.assignmentId&&a.active);if(!a||a.year!==g.year||a.sectionId!==g.sectionId||a.subjectId!==g.subjectId||!db.enrollments.some(e=>e.studentId===g.studentId&&e.year===g.year&&e.sectionId===g.sectionId))failures.push({id:g.id,reason:'RELATION'});G.calculate(db.subjects.find(s=>s.id===g.subjectId).type,g.values);}
for(const [file,bytes]of unzip(fs.readFileSync('NOTAS PROFESORES.zip')))if(grades.some(g=>g.source.file===file))for(const sheet of workbook(bytes)){
 const relevant=grades.filter(g=>g.source.file===file&&g.source.sheet===sheet.name),cells=new Map(sheet.cells.map(c=>[c.cell,c]));
 for(const g of relevant){
  const raw=g.source.activityCells.map(ref=>cells.get(ref)?.value??null);if(JSON.stringify(raw)!==JSON.stringify(g.values)){failures.push({id:g.id,reason:'SOURCE_VALUES'});continue;}sourceMatched++;
  const header=g.source.block.split(':').at(-1),nieCol=header.match(/^[A-Z]+/)[0],row=g.source.cell.match(/\d+/)[0],student=db.students.find(s=>s.id===g.studentId);if(String(cells.get(nieCol+row)?.value)!==student.nie)failures.push({id:g.id,reason:'SOURCE_IDENTITY'});
  if(g.values.includes(null)){pending++;continue;}
  const visiting=new Set();function resolve(ref){const c=cells.get(ref);if(!c)throw Error('Celda ausente');if(!c.formula)return c.value;if(visiting.has(ref))throw Error('Referencia circular');visiting.add(ref);const value=evaluate(parseFormula(c.formula),resolve);visiting.delete(ref);return value;}
  try{const original=resolve(g.source.cell),computed=G.calculate(db.subjects.find(s=>s.id===g.subjectId).type,g.values).value;if(!Number.isFinite(original)||Math.abs(original-computed)>1e-10)failures.push({id:g.id,reason:'CALCULATION'});else originalComparisons++;}catch{failures.push({id:g.id,reason:'FORMULA_REVIEW'});}
 }
}
const summary={teachers:db.teachers.length,assignments:db.assignments.filter(a=>a.active).length,records:grades.length,sourceMatched,originalComparisons,pendingResults:pending,failures:failures.length};fs.writeFileSync(dir+'/verificacion-notas.json',JSON.stringify({summary,failures},null,2));console.log(JSON.stringify(summary));if(failures.length||sourceMatched!==grades.length)process.exitCode=1;
