/* INCO reference layouts. Presentation only: all results come from the academic core. */
var IncoFormats=(()=>{
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const grade=(value,pending='—')=>Genesis.formatGrade(value,pending);
 const periodNames=['Primer Período','Segundo Período','Tercer Período','Cuarto Período'];
 function names(student){
  const last=student.lastNames||student.lastName||student.surnames,first=student.firstNames||student.firstName||student.givenNames;
  // Migrated records may only have a full name. Never guess where surnames end.
  return last&&first?{last,first,full:student.name||last+' '+first}:{last:'',first:'',full:student.name||''};
 }
 function groupLabel(section){return section?.grade&&!/^[123][.º°\s]/.test(section.name)?section.grade+'.º '+section.name:section?.name||'';}
 function phase(values,weights,index){const list=values.slice(index*3,index*3+3);const average=list.length===3&&list.every(v=>typeof v==='number'&&Number.isFinite(v))?list.reduce((a,b)=>a+b,0)/3:null;return {average,weighted:average===null?null:average*weights[index]};}
 function columns(plan){
  if(plan.mode==='PHASES')return ['Preparación','Ejecución','Evaluación'].flatMap((name,phaseIndex)=>[...plan.labels.slice(phaseIndex*3,phaseIndex*3+3).map((label,index)=>({kind:'input',index:phaseIndex*3+index,label:['Eval.','Auto.','Hete.'][index],title:label,phase:phaseIndex})),{kind:'phaseAverage',phase:phaseIndex,label:'Prom.'},{kind:'phaseWeighted',phase:phaseIndex,label:Number((plan.weights[phaseIndex]*100).toFixed(6))+' %'}]);
  return plan.labels.map((label,index)=>({kind:'input',index,label:String(index+1),title:label,weight:Number((plan.weights[index]*100).toFixed(6))+' %'}));
 }
 function sheetHeader(workbook,logo){return `<header class="inco-sheet-heading"><img src="${escape(logo)}" alt="Escudo del INCO"><div><p>MINISTERIO DE EDUCACIÓN</p><p>DIRECCIÓN GENERAL DE EDUCACIÓN</p><h3>INSTITUTO NACIONAL DE COMERCIO</h3><p>CUADRO DE REGISTRO DE EVALUACIÓN DE LOS APRENDIZAJES${workbook.subject.type==='MODULO_FASES'?' MODULARES':''}</p><p>POR ASIGNATURA Y PERÍODO ${escape(workbook.year.label||workbook.year.id)}</p></div></header><div class="inco-sheet-meta"><strong>Asignatura: ${escape(Genesis.subjectTitle(workbook.subject))}</strong><span>${escape(workbook.specialty?.name||'')} · Sección: ${escape(groupLabel(workbook.section))}</span><span>Docente: ${escape(workbook.teacher.name)}</span></div>`;}
 function sheetTable(workbook,active,{editable=false,role='',students=null}={}){
  const modular=workbook.subject.type==='MODULO_FASES',periods=modular?workbook.periods.filter(p=>p.id===active.periodId):workbook.periods,rows=students||active.students;
  let html='<thead><tr><th rowspan="3" scope="col" class="inco-number">N.º</th><th rowspan="3" scope="col" class="inco-nie">NIE</th><th colspan="2" scope="colgroup" class="inco-name">Apellidos y nombres</th>';
  for(const p of periods){const plan=p.roster.evaluation,items=columns(plan);html+=`<th colspan="${items.length+1}" scope="colgroup" class="${p.id===active.periodId?'inco-period-selected':''}">${escape(p.name)}${editable?` <button type="button" class="inco-edit-period" data-inco-period="${escape(p.id)}" ${p.id===active.periodId?'disabled':''}>${p.id===active.periodId?'En edición':'Editar'}</button>`:''}</th>`;}
  html+=`<th rowspan="3" class="inco-final">${modular?'Resultado del módulo':active.finalPolicy?.method==='SUM_4'?'Nota final (suma)':'Promedio final'}</th><th rowspan="3" class="inco-status">Observación</th>${editable?'<th rowspan="3">Protección</th>':''}</tr><tr><th colspan="2" rowspan="2" class="inco-name">${escape(groupLabel(workbook.section))}</th>`;
  for(const p of periods){const plan=p.roster.evaluation;if(plan.mode==='PHASES')html+=['Preparación','Ejecución','Evaluación'].map(name=>`<th colspan="5">${name}</th>`).join('');else html+=`<th colspan="${plan.count}">Actividades</th>`;html+='<th rowspan="2" class="inco-average">'+(plan.mode==='PHASES'?'PF':'Promedio')+'</th>';}
  html+='</tr><tr>';
  for(const p of periods)html+=columns(p.roster.evaluation).map(c=>`<th title="${escape(c.title||c.label)}">${escape(c.label)}${c.weight?'<small>'+c.weight+'</small>':''}</th>`).join('');
  html+='</tr></thead><tbody>';
  rows.forEach((student,rowIndex)=>{
   const identity=names(student);html+=`<tr data-student="${escape(student.id)}"><td>${active.students.findIndex(s=>s.id===student.id)+1}</td><td class="inco-nie">${escape(student.nie)}</td>`+(identity.last?`<td class="inco-name">${escape(identity.last)}</td><td class="inco-name">${escape(identity.first)}</td>`:`<td colspan="2" class="inco-name">${escape(identity.full)}</td>`);
   for(const p of periods){
    const current=p.id===active.periodId,row=current?student:p.roster.students.find(s=>s.id===student.id),plan=p.roster.evaluation,readonly=!editable||!current||p.roster.closed||role==='DIRECTION'||row?.locked||row?.conflict;
    for(const c of columns(plan)){
     let value=c.kind==='input'?row?.values[c.index]??null:row?phase(row.values,plan.weights,c.phase)[c.kind==='phaseAverage'?'average':'weighted']:null;
     html+=`<td class="${current?'inco-period-selected ':''}${c.kind==='input'?'inco-note':'inco-derived'}" ${current&&c.kind!=='input'?`data-inco-phase="${c.phase}" data-inco-calculation="${c.kind}"`:''}>`;
     if(current&&editable&&c.kind==='input')html+=`<input type="number" min="0" max="10" step="any" inputmode="decimal" aria-label="${escape(identity.full+' · '+p.name+' · '+plan.labels[c.index])}" data-row="${rowIndex}" data-col="${c.index}" value="${grade(value,'')}" ${readonly?'disabled':''}>`;
     else html+=escape(grade(value));html+='</td>';
    }
    html+=`<td class="inco-average" ${current?'data-result':''}>${escape(grade(row?.result.value))}</td>`;
   }
   const final=student.final;html+=`<td class="inco-final" data-annual>${modular?escape(grade(student.result.value)):escape(grade(final.value))}</td><td class="inco-status" data-status>${escape(modular?'':GenesisXlsx.statusText(final))}</td>`;
   if(editable)html+=`<td class="inco-protection"><span>${student.conflict?'En revisión':student.locked?'Bloqueado':active.closed?'Período cerrado':'Sin bloqueo individual'}</span>${student.locked?'<small>'+escape(student.lock?.reason)+'</small>':''}${role==='ADMIN'?`<button type="button" class="secondary" data-grade-lock="${escape(student.id)}">${student.locked?'Desbloquear':'Bloquear'}</button>`:''}<span hidden data-sum></span></td>`;
   html+='</tr>';
  });return html+'</tbody>';
 }
 function reportPages(document,{logo='',lion='',director='',registrar=''}={}){
  const pages=[];
  for(const student of document.students){
   const entries=student.entries,groups=[['BASIC','Asignaturas básicas'],['CONCEPTUAL','Asignaturas conceptuales'],['TECHNICAL','Módulos técnicos']],ordered=groups.flatMap(([category,label])=>entries.filter(e=>Genesis.categoryOf(e.subject)===category).map(e=>({...e,groupLabel:label})));
   const chunks=[];let chunk=[],units=0;
   for(const entry of ordered){const size=Math.max(1,Math.ceil(Genesis.subjectTitle(entry.subject).length/52));if(chunk.length&&units+size>14){chunks.push(chunk);chunk=[];units=0;}chunk.push(entry);units+=size;}
   if(chunk.length)chunks.push(chunk);if(!chunks.length)chunks.push([]);
   chunks.forEach((chunk,pageIndex)=>{
    const periods=document.columns.flatMap(c=>c.periods).filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
    const cols=Math.max(1,periods.length),identity=names(student),gradeYear=document.section.grade?({1:'Primer Año',2:'Segundo Año',3:'Tercer Año'}[document.section.grade]||document.section.grade+' Año'):groupLabel(document.section);
    const header=`<header class="inco-report-heading"><img src="${escape(logo)}" class="inco-report-logo" alt="Escudo del INCO"><div><h2>Instituto Nacional de Comercio</h2><p>Final Calle Campos y Avenida Barberena, San Jacinto, San Salvador<br>Tel. 2270-2852</p></div>${lion?`<span class="inco-lion-crop" aria-hidden="true"><img src="${escape(lion)}" alt=""></span>`:''}</header><h3 class="inco-report-title">Boleta de Calificaciones</h3><p class="inco-report-year">${escape(gradeYear)} ${escape(document.year.label||document.year.id)}</p><div class="inco-report-identity"><span>Estudiante: <strong>${escape(identity.full)}</strong></span><span>NIE: <strong>${escape(student.nie)}</strong></span></div><div class="inco-report-section"><strong>${escape(document.specialty?.name||'')}</strong><span>Sección: ${escape(groupLabel(document.section))}</span></div>`;
    let body=`<table class="inco-report-table"><colgroup><col class="inco-report-subject">${periods.map(()=>'<col>').join('')}<col class="inco-report-observation"></colgroup><thead><tr><th>Asignatura o módulo</th>${periods.map((p,i)=>`<th>${escape(periods.length===4?periodNames[i]:p.name)}</th>`).join('')}<th>Observación</th></tr></thead><tbody>`;
    let previous='';for(const e of chunk){if(e.groupLabel!==previous){previous=e.groupLabel;body+=`<tr class="inco-report-category"><th colspan="${cols+2}" scope="rowgroup">${escape(previous)}</th></tr>`;}
     const note=e.periods.some(p=>p.conflict)?'En revisión':e.final.status==='SIN_CRITERIO'?'':GenesisXlsx.statusText(e.final);
     body+=`<tr><th scope="row">${escape(Genesis.subjectTitle(e.subject))}</th>${periods.map(p=>{const result=e.periods.find(x=>x.id===p.id);return `<td>${escape(result?.conflict?'En revisión':grade(result?.value))}</td>`;}).join('')}<td>${escape(note)}</td></tr>`;
    }if(!chunk.length)body+=`<tr><td colspan="${cols+2}">Sin asignaturas autorizadas para esta selección.</td></tr>`;body+='</tbody></table>';
    const signatures=`<div class="inco-signatures"><div><span>${escape(director)}</span><strong>Director</strong></div><div><span>${escape(registrar)}</span><strong>Responsable de Registro Académico</strong></div></div>`;
    const quote='<footer class="inco-report-footer"><p>“Recuerda que una calificación mide tu desempeño en un momento dado, pero no define tu inteligencia, tu talento ni tu capacidad de brillar en el mundo”.</p><strong>Dinastía de Campeones!!!</strong></footer>';
    pages.push(`<article class="inco-report-page" data-report-student="${escape(student.id)}">${header}${document.scope==='PARTIAL'?'<p class="inco-partial">CONSULTA PARCIAL · Únicamente asignaturas autorizadas al docente</p>':''}${body}${signatures}${quote}<small class="inco-report-pagination">${pageIndex+1} / ${chunks.length}</small></article>`);
   });
  }return pages.join('');
 }
 return {escape,grade,names,phase,columns,sheetHeader,sheetTable,reportPages};
})();
if(typeof module!=='undefined')module.exports=IncoFormats;
