import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import G from '../tools/core.mjs';
import X from '../tools/gradebook-xlsx.mjs';
import {oauthPlatform} from './helpers/oauth-platform.mjs';
const c={Genesis:G,GenesisXlsx:X};vm.createContext(c);vm.runInContext(fs.readFileSync('src/inco-formats.js','utf8'),c);const F=c.IncoFormats;
const json=value=>JSON.parse(JSON.stringify(value));

test('INCO: annual teacher sheets reuse all period results from one authorized snapshot, without writes',()=>{
 const env=oauthPlatform(),session=env.login();
 for(const p of ['1','2','3','4'])env.c.api('saveGrades',{version:Number(p)-1,assignmentId:'a1',periodId:p,rows:[{studentId:'s1',values:[0,8.95,9]}]},session.token);
 const before=env.database(),writes=env.stats.writes,book=env.c.api('teacherWorkbook',{assignmentId:'a1',role:'ADMIN'},session.token);
 assert.equal(book.version,4);assert.equal(book.periods.length,4);assert.equal(book.subject.id,'math');
 for(const p of book.periods){assert.equal(p.roster.version,4);assert.deepEqual(json(p.roster.students[0].values),[0,8.95,9]);assert.equal(p.roster.students[0].result.value,5.8325);}
 assert.equal(env.stats.writes,writes);assert.deepEqual(env.database(),before);
 assert.throws(()=>env.c.api('teacherWorkbook',{assignmentId:'a2',teacherId:'teacher',email:env.emails.admin},session.token),/no autorizada/);
 assert.throws(()=>env.c.api('teacherWorkbook',{assignmentId:'missing'},session.token),/no autorizada/);
});

test('INCO: closures, individual locks and five evaluations retain their restrictions in the annual sheet',()=>{
 const db=G.seed();db.evaluationPolicies=[{id:'five',year:'2026',sectionId:'1A',subjectId:'math',periodId:'2',mode:'WEIGHTED',count:5,weights:[.2,.2,.2,.2,.2],labels:['A','B','C','D','E']}];
 db.periodStates=[{year:'2026',periodId:'2',closed:true}];db.gradeLocks=[{id:'l',year:'2026',sectionId:'1A',subjectId:'math',periodId:'1',studentId:'s1',active:true,reason:'Revisión'}];
 const book=G.execute(db,'docente@example.invalid','teacherWorkbook',{assignmentId:'a1'}),active=book.periods[0].roster;
 const html=F.sheetTable(book,active,{editable:true,role:'TEACHER'});
 assert.equal(book.periods[1].roster.evaluation.count,5);assert.equal(book.periods[1].roster.closed,true);assert.equal(active.students[0].locked,true);
 assert.match(html,/Bloqueado/);assert.match(html,/data-inco-period="2"/);assert.match(html,/value="" disabled/);
 assert.equal((html.match(/data-row="0"/g)||[]).length,3);assert.ok(!html.includes('data-grade-lock'));
 const saved=JSON.stringify(db);assert.throws(()=>G.execute(db,'docente@example.invalid','saveGrades',{version:db.version,assignmentId:'a1',periodId:'2',rows:[{studentId:'s1',values:[1,2,3,4,5]}]}),/cerrado/);assert.equal(JSON.stringify(db),saved);
});

test('INCO: report renders all authorized categories and module numbers with one decimal and no invented names',()=>{
 const db=G.seed();db.subjects[1].moduleNumber='1.6';db.assignments[1].sectionId='1A';
 const doc=G.execute(db,'rocio@example.invalid','consolidated',{year:'2026',sectionId:'1A'});doc.students[0].entries[0].periods[0].value=0;doc.students[0].entries[0].periods[1].value=8.95;
 doc.students[0].name='<script>Untrusted</script>';const before=JSON.stringify(doc),html=F.reportPages(doc,{director:'<img src=x onerror=alert(1)>',registrar:'Registro'});
 assert.match(html,/Boleta de Calificaciones/);assert.match(html,/Asignaturas básicas/);assert.match(html,/Módulos técnicos/);assert.match(html,/Módulo 1.6/);assert.match(html,/>0.0<\/td>/);assert.match(html,/>9.0<\/td>/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;script&gt;'));assert.equal(JSON.stringify(doc),before);
 assert.equal(F.names({name:'Nombre completo sin desglosar'}).full,'Nombre completo sin desglosar');assert.equal(F.names({name:'Nombre completo sin desglosar'}).last,'');
});

test('INCO: teacher reports are visibly partial, escaped, paginated, and never add foreign subjects',()=>{
 const db=G.seed();db.assignments[1].teacherId='other';const doc=G.execute(db,'docente@example.invalid','reportCard',{year:'2026',sectionId:'1A',studentId:'s1'});
 let html=F.reportPages(doc);assert.match(html,/CONSULTA PARCIAL/);assert.ok(!html.includes('Módulo de comercio'));
 const entry=doc.students[0].entries[0];doc.students[0].entries=Array.from({length:35},(_,i)=>({...entry,subject:{...entry.subject,id:'m'+i,name:'Materia '+i}}));html=F.reportPages(doc);assert.equal((html.match(/class="inco-report-page"/g)||[]).length,3);assert.match(html,/Materia 34/);assert.match(html,/3 \/ 3/);
});

test('INCO: module phase subtotals follow the existing weights and keep pending scores pending',()=>{
 const values=[8,9,10,5,6,7,0,1,2],before=values.slice();assert.equal(F.phase(values,[.25,.5,.25],0).average,9);assert.equal(F.phase(values,[.25,.5,.25],1).weighted,3);assert.equal(F.phase([null,9,10],[.25,.5,.25],0).average,null);assert.deepEqual(values,before);
});
