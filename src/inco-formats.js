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
 const reportFormats={
  general:{name:'Bachillerato General'},
  accounting:{name:'Bachillerato Técnico Vocacional Administrativo Contable',conduct:true},
  software:{name:'Bachillerato Técnico Vocacional Desarrollo de Software',conduct:true},
  tourism:{name:'Bachillerato Técnico Productivo opción Servicios Turísticos'}
 };
 const conductCriteria=[
  'Evidencia actitudes favorables para la convivencia y cultura de paz',
  'Toma de decisiones de forma autónoma y responsable',
  'Se expresa y participa con respeto con los demás',
  'Muestra sentido de pertenencia y respeto por nuestra cultura'
 ];
 function normalizeReportLabel(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
 function resolveReportFormat(document,format){
  if(Object.hasOwn(reportFormats,format))return reportFormats[format];
  const name=normalizeReportLabel(document.specialty?.name);
  if(/^(bachillerato )?general$/.test(name))return reportFormats.general;
  if(/\badministrativ[oa] contable\b/.test(name))return reportFormats.accounting;
  if(/\bdesarrollo de software\b/.test(name))return reportFormats.software;
  if(/\bservicios turisticos\b/.test(name))return reportFormats.tourism;
  return null;
 }
 const moduleGrade=value=>typeof value==='number'?'NL '+(value>=9?5:value>=7?4:value>=5?3:value>=3?2:1):grade(value);
 const reportLegend={
  title:'NL = Nivel de logro en módulos',
  levels:[['NL 1–3','No aprobado'],['NL 4','Aprobado'],['NL 5','Excelente']],
  minimum:'Nota mínima · Básicas 5.55 · Módulos 7.00',
  pending:'— = Nota pendiente'
 };
 function reportPeriodGrade(result,modular){
  if(result?.conflict)return 'En revisión';
  if(result?.unfilledModule)return 'Modulo sin llenar';
  return modular?moduleGrade(result?.value):grade(result?.value);
 }
 function reportModuleGrade(entry,results){
  if(results.some(result=>result.conflict))return 'En revisión';
  if(typeof entry.final.value==='number')return moduleGrade(entry.final.value);
  if(results.length&&results.every(result=>result.unfilledModule))return 'Modulo sin llenar';
  const graded=results.filter(result=>typeof result.value==='number');
  if(entry.reportModuleNumber&&graded.length>1)return graded.map(p=>`P${p.id} ${moduleGrade(p.value)}`).join(' · ');
  return graded.length===1?moduleGrade(graded[0].value):grade(null);
 }
 function reportConductGrade(result,index){
  if(result?.conductCriteria)return result.conflict?'En revisión':result.conductCriteria[index];
  if(index>=(result?.evaluation?.count??0))return '';
  return result.conflict?'En revisión':grade(result.values[index],'');
 }
 function reportTable(document,student,format){
  const template=resolveReportFormat(document,format);
  const periods=document.periods||document.columns.flatMap(c=>c.periods).filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
  const headers=[template?'Asignatura Complementaria':'Asignatura o módulo',...periods.map((p,i)=>periods.length===4?periodNames[i]:p.name),'Observación'];
  const groups=[['BASIC','Asignaturas básicas'],['CONCEPTUAL','Asignaturas conceptuales'],['TECHNICAL','Módulos técnicos']];
  const rows=[],modules=[];
  const entriesForReport=student.entries.map(entry=>{
   if(document.section.id!=='3D'||entry.subject.type==='MODULO_FASES')return entry;
   const number={'ingles tecnico':'3.6',emprendedurismo:'3.7'}[normalizeReportLabel(entry.subject.name)];
   if(!number)return entry;
   return {...entry,reportModuleNumber:number,subject:{...entry.subject,type:'MODULO_FASES',category:'TECHNICAL',moduleNumber:number}};
  });
  for(const [category,label] of groups){
   const entries=entriesForReport.filter(e=>Genesis.categoryOf(e.subject)===category);
   if(!entries.length)continue;
   if(!template)rows.push({category:label});
   for(const entry of entries){
    if(!entry.reportModuleNumber&&entry.periods.every(p=>p.unfilledModule&&!p.conflict)&&entries.some(item=>item.reportModuleNumber===Genesis.moduleIdentity(entry.subject).number))continue;
    const note=entry.periods.some(p=>p.conflict)?'En revisión':entry.final.status==='REGISTRADO'?`Resultado final: ${moduleGrade(entry.final.value)}`:entry.final.status==='SIN_CRITERIO'?'':GenesisXlsx.statusText(entry.final);
    const title=Genesis.subjectTitle(entry.subject);
    const results=periods.map(p=>entry.periods.find(x=>x.id===p.id));
    if(template&&category==='TECHNICAL'){
     modules.push({title,result:reportModuleGrade(entry,entry.periods)});
     continue;
    }
    rows.push({cells:[title,...results.map(result=>entry.final.status==='REGISTRADO'?moduleGrade(result?.value):reportPeriodGrade(result,category==='TECHNICAL')),note]});
    if(template?.conduct&&normalizeReportLabel(entry.subject.name)==='conducta'){
     conductCriteria.forEach((criterion,index)=>rows.push({criterion:true,cells:[criterion,...results.map(result=>reportConductGrade(result,index)),'']}));
    }
   }
  }
  return {headers,rows,modules,specialty:document.specialty?.name||template?.name||''};
 }
 function reportModuleGroups(modules){
  const groups=[];
  for(let start=0;start<modules.length;start+=4)groups.push(modules.slice(start,start+4));
  return groups;
 }
 const reportQuote='“Recuerda que una calificación mide tu desempeño en un momento dado, pero no define tu inteligencia, tu talento ni tu capacidad de brillar en el mundo”.';
 function reportYear(document){return (document.section.grade?({1:'Primer Año',2:'Segundo Año',3:'Tercer Año'}[document.section.grade]||document.section.grade+' Año'):groupLabel(document.section))+' '+(document.year.label||document.year.id);}
 function reportPages(document,{logo='',lion='',director='Lic. German Véliz Méndez',registrar='Rocío Guadalupe Hernández Morales',format}={}){
  const pages=[];
  for(const student of document.students){
    const {headers,rows,modules,specialty}=reportTable(document,student,format),identity=names(student);
    const header=`<header class="inco-report-heading"><img src="${escape(logo)}" class="inco-report-logo" alt="Escudo del INCO"><div><h2>Instituto Nacional de Comercio</h2><p>Final Calle Campos y Avenida Barberena, San Jacinto, San Salvador<br>Tel. 2270-2852</p></div>${lion?`<span class="inco-lion-crop" aria-hidden="true"><img src="${escape(lion)}" alt=""></span>`:''}</header><h3 class="inco-report-title">Boleta de Calificaciones</h3><p class="inco-report-year">${escape(reportYear(document))}</p><div class="inco-report-identity"><span>Estudiante: <strong>${escape(identity.full)}</strong></span><span>NIE: <strong>${escape(student.nie)}</strong></span></div><div class="inco-report-section"><strong>${escape(specialty)}</strong><span>Sección: ${escape(groupLabel(document.section))}</span></div>`;
    let body=`<table class="inco-report-table"><colgroup><col class="inco-report-subject">${headers.slice(1,-1).map(()=>'<col>').join('')}<col class="inco-report-observation"></colgroup><thead><tr>${headers.map(label=>`<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>`;
    for(const row of rows){
     if(row.category)body+=`<tr class="inco-report-category"><th colspan="${headers.length}" scope="rowgroup">${escape(row.category)}</th></tr>`;
     else body+=`<tr${row.criterion?' class="inco-report-criterion"':''}><th scope="row">${escape(row.cells[0])}</th>${row.cells.slice(1).map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`;
    }
    if(!rows.length&&!modules.length)body+=`<tr><td colspan="${headers.length}">Sin asignaturas autorizadas para esta selección.</td></tr>`;
    body+='</tbody></table>';
    if(!rows.length&&modules.length)body='';
    if(modules.length){
     body+='<div class="inco-report-technical"><h4>Área Técnica</h4>';
     for(const group of reportModuleGroups(modules))body+=`<table class="inco-report-table"><thead><tr>${group.map(module=>`<th scope="col">${escape(module.title)}</th>`).join('')}</tr></thead><tbody><tr>${group.map(module=>`<td>${escape(module.result)}</td>`).join('')}</tr></tbody></table>`;
     body+='</div>';
    }
    const signatures=`<div class="inco-signatures"><div><span>${escape(director)}</span><strong>Director</strong></div><div><span>${escape(registrar)}</span><strong>Responsable de Registro Académico</strong></div></div>`;
    const quote=`<footer class="inco-report-footer"><p class="inco-report-credits"><b>${reportLegend.title}</b></p><table class="inco-report-legend"><thead><tr>${reportLegend.levels.map(([level])=>`<th scope="col">${level}</th>`).join('')}</tr></thead><tbody><tr>${reportLegend.levels.map(([,meaning])=>`<td>${meaning}</td>`).join('')}</tr></tbody></table><p class="inco-report-credits">${reportLegend.minimum} · ${reportLegend.pending}</p><p>${reportQuote}</p><strong>Dinastía de Campeones!!!</strong><p class="inco-report-credits">${reportCredits}</p></footer>`;
    pages.push(`<article class="inco-report-page" data-report-student="${escape(student.id)}"><div class="inco-report-frame"><div class="inco-report-content">${header}${document.scope==='PARTIAL'?'<p class="inco-partial">CONSULTA PARCIAL · Únicamente asignaturas autorizadas al docente</p>':''}${body}${signatures}${quote}</div></div></article>`);
  }return pages.join('');
 }
 const reportCredits='Fernando Ortiz · Kevin Alvarado · Anderson Aleman';
 return {escape,grade,names,phase,columns,sheetHeader,sheetTable,reportPages,reportTable,reportModuleGroups,reportFormats,reportYear,reportQuote,reportCredits,reportLegend,groupLabel};
})();
if(typeof module!=='undefined')module.exports=IncoFormats;
