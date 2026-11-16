/* Read-only academic documents, explicit frame composition and scoped evaluation controls. */
let academicDocument=null,academicDocumentParams=null,academicDocumentOwner=null,academicDocumentRequest=0,evaluationReadOnly=false;
let reportPreviewResize;
const subjectTitle=subject=>Genesis.subjectTitle(subject);
const categoryLabel=subject=>({BASIC:'Materia básica',CONCEPTUAL:'Materia conceptual',TECHNICAL:'Módulo técnico'}[Genesis.categoryOf(subject)]);
function downloadAcademic(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadWorkbook(sheets,name){downloadAcademic(new Blob([GenesisXlsx.write(sheets)],{type:GenesisXlsx.MIME}),name);}
async function exportGroupWorkbook(blank=false){
  if(!selected)throw Error('Seleccioná un grupo asignado');
  const saved=await api('export',{assignmentId:selected,periodId:loadedPeriod});
  downloadWorkbook(GenesisXlsx.groupSheets(saved,saved.assignment,blank),blank?'genesis-plantilla.xlsx':'genesis-cuadro-docente.xlsx');
  message(blank?'Plantilla del grupo y período seleccionado descargada.':'Se exportaron las notas guardadas del grupo.');
}
$('export').onclick=safe(()=>exportGroupWorkbook());$('downloadTemplate').onclick=safe(()=>exportGroupWorkbook(true));
async function prepareCompatibleXlsx(file){
  const buffer=await file.arrayBuffer(),sheets=await GenesisXlsx.read(buffer),canonical=GenesisXlsx.template(sheets,file.name);if(!canonical)return false;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');
  preview={schema:'GENESIS_PREVIEW_V1',hash,file:file.name,template:canonical.metadata,incidents:[],blocks:[{id:'GENESIS_TEMPLATE_V1',sheet:'Cuadro docente',type:importRoster.subject.type,studentRowCount:canonical.rows.length,directRows:canonical.rows}]};
  options('importBlock',[{id:'GENESIS_TEMPLATE_V1',name:'Plantilla GENESIS · '+canonical.rows.length+' estudiantes'}]);
  $('previewInfo').innerHTML='<p class="info">Plantilla compatible: se validará el docente, grupo, asignatura, período, esquema de evaluación y matrícula antes de aprobar.</p>';
  $('importColumns').classList.add('hidden');$('buildImportRows').classList.add('hidden');await renderImportRows(canonical.rows);return true;
}
function resetAcademicDocument(){
  academicDocumentRequest++;academicDocument=null;academicDocumentParams=null;academicDocumentOwner=null;
  reportPreviewResize?.disconnect();
  $('reportOutput').innerHTML='<p class="empty-inline">Consultá el consolidado con los filtros seleccionados.</p>';
  for(const id of ['exportDocument','printDocument','loadReportCard','downloadReportPdf'])$(id).disabled=true;
  $('reportStudent').innerHTML='';
  updateReportStudentActions([]);clearReportSubjectEditor();clearReportOutputSubjects();
}
function syncDocumentContext(){
  const year=$('documentYear').value,section=$('documentSection').value;
  editableOptions('documentPeriod',state.periods.filter(p=>p.year===year),p=>p.name,'Todos los períodos');
  editableOptions('documentFrame',state.academicFrames.filter(f=>state.frameLinks.some(l=>l.frameId===f.id&&l.year===year&&l.sectionId===section)||state.sections.find(s=>s.id===section)?.specialtyId===f.specialtyId),f=>f.name,'Todas las asignaturas autorizadas');resetAcademicDocument();
}
function documentParams(){return {year:$('documentYear').value,sectionId:$('documentSection').value,...($('documentPeriod').value?{periodId:$('documentPeriod').value}:{}),...($('documentFrame').value?{frameId:$('documentFrame').value}:{})};}
async function fetchAcademicDocument(kind,params){
  const request=++academicDocumentRequest,owner={id:state.user.id,role:state.user.role};
  academicDocumentParams={kind,params};academicDocumentOwner=owner;
  let result;try{result=await api(kind,params);}catch(error){if(request!==academicDocumentRequest||state.user.id!==owner.id||state.user.role!==owner.role)return null;throw error;}
  if(request!==academicDocumentRequest||state.user.id!==owner.id||state.user.role!==owner.role)return null;
  academicDocument=result;
  if(kind!=='reportCard'){
    options('reportStudent',result.students.map(s=>({id:s.id,name:s.name+' · '+s.nie})));
    updateReportStudentActions(result.students);
  }
  $('loadReportCard').disabled=!result.students.length;$('exportDocument').disabled=!result.columns.length;$('printDocument').disabled=!result.columns.length;renderAcademicDocument();
  return result;
}
async function loadAcademicDocument(kind='consolidated'){
  const params=kind==='reportCard'?{...reportOutputContext(),studentId:$('reportStudent').value}:documentParams();
  return fetchAcademicDocument(kind,params);
}
async function refreshVisibleAcademicDocument(version){
  if(currentView!=='documents'||!academicDocumentParams||academicDocument?.version===version)return;
  const {kind,params}=academicDocumentParams;await fetchAcademicDocument(kind,params);
}
async function syncAcademicDocumentControls(){
  const previous=academicDocumentParams&&academicDocumentOwner?.id===state.user.id&&academicDocumentOwner?.role===state.user.role?{...academicDocumentParams,students:[...$('reportStudent').options].map(o=>({id:o.value,name:o.textContent})),student:$('reportStudent').value}:null;
  options('documentYear',state.years,'label');options('documentSection',state.sections.map(s=>({...s,name:sectionLabel(s)})));
  if(previous){$('documentYear').value=previous.params.year;$('documentSection').value=previous.params.sectionId;}
  syncDocumentContext();
  if(!previous||!$('documentYear').value||!$('documentSection').value)return;
  $('documentPeriod').value=previous.params.periodId||'';$('documentFrame').value=previous.params.frameId||'';
  if(previous.params.periodId&&!$('documentPeriod').value||previous.params.frameId&&!$('documentFrame').value)return;
  options('reportStudent',previous.students);$('reportStudent').value=previous.student;
  try{await fetchAcademicDocument(previous.kind,previous.params);}catch(error){$('reportOutput').innerHTML='<p class="info">No se pudo actualizar el documento. Las notas guardadas se conservan; intentá consultarlo nuevamente.</p>';message(error.message,true);}
}
function resultCell(value,locked=false,conflict=false){return esc(Genesis.formatGrade(value))+(conflict?'<small>En revisión</small>':locked?'<small>Bloqueado</small>':'');}
function renderAcademicDocument(){
  if(!academicDocument)return;
  const d=academicDocument.kind==='reportCard'?filterReportOutput(academicDocument):academicDocument;
  reportPreviewResize?.disconnect();
  const title=d.kind==='reportCard'?'Boleta de calificaciones':'Consolidado de calificaciones';
  const heading=`<div class="panel-heading"><div class="brand"><img class="brand-logo" src="${document.querySelector('.brand-logo').src}" alt="Escudo del INCO" width="46" height="54"><div><h3>${title}</h3><small>Instituto Nacional de Comercio · ${esc(d.year.label)} · ${esc(sectionLabel(d.section))}</small>${d.specialty?'<small>'+esc(d.specialty.name)+'</small>':''}${d.frame?'<small>'+esc(d.frame.name)+'</small>':''}${d.frame?.formatSlot?'<small>Formato '+esc(d.frame.formatSlot)+' · plantilla oficial pendiente</small>':''}</div></div></div><p class="help">${esc(d.notice)}</p>`;
  if(!d.columns.length){$('reportOutput').innerHTML=heading+'<p class="empty-inline">Sin materias y períodos configurados para esta selección. No se han creado ni modificado notas.</p>';return;}
  if(d.kind==='reportCard'&&typeof IncoFormats!=='undefined'){
    showIncoReportPreview($('reportOutput'),d);
  }else if(d.kind==='reportCard'){
    const s=d.students[0];$('reportOutput').innerHTML=heading+`<h3>${esc(s.name)}</h3><p class="muted">NIE ${esc(s.nie)}</p>`+s.entries.map(e=>`<article><h3>${esc(subjectTitle(e.subject))}</h3><p class="help">${categoryLabel(e.subject)} · ${esc(e.teachers.join(', ')||'Sin asignación activa')}</p><div class="scroll"><table><thead><tr><th>Período</th><th>Calificaciones</th><th>Resultado del período</th></tr></thead><tbody>${e.periods.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.values.map(v=>esc(Genesis.formatGrade(v))).join(' · ')}</td><td>${resultCell(p.value,p.locked,p.conflict)}</td></tr>`).join('')}</tbody></table></div><p><strong>Resultado final: ${esc(Genesis.formatGrade(e.final.value,e.final.status==='SIN_CRITERIO'?'Criterio pendiente':'Pendiente'))}</strong> · ${GenesisXlsx.statusText(e.final)}</p></article>`).join('');
  }else{
    const headers=d.columns.flatMap(c=>[...c.periods.map(p=>`<th>${esc(subjectTitle(c.subject))}<small>${esc(p.name)}</small></th>`),`<th>${esc(subjectTitle(c.subject))}<small>Final</small></th>`]);
    $('reportOutput').innerHTML=heading+`<div class="scroll" tabindex="0" aria-label="Consolidado académico"><table><thead><tr><th>Estudiante / NIE</th>${headers.join('')}</tr></thead><tbody>${d.students.map(s=>`<tr><td>${esc(s.name)}<small>${esc(s.nie)}</small></td>${s.entries.map(e=>e.periods.map(p=>`<td>${resultCell(p.value,p.locked,p.conflict)}</td>`).join('')+`<td>${esc(Genesis.formatGrade(e.final.value,e.final.status==='SIN_CRITERIO'?'Criterio pendiente':'Pendiente'))}<small>${GenesisXlsx.statusText(e.final)}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
}
$('documentYear').onchange=syncDocumentContext;$('documentSection').onchange=syncDocumentContext;
$('documentPeriod').onchange=resetAcademicDocument;$('documentFrame').onchange=resetAcademicDocument;
$('loadConsolidated').onclick=safe(()=>loadAcademicDocument());$('loadReportCard').onclick=safe(()=>loadAcademicDocument('reportCard'));
$('exportDocument').onclick=safe(async()=>{if(!academicDocumentParams)return;const {kind,params}=academicDocumentParams,result=await fetchAcademicDocument(kind,params);if(result)downloadWorkbook(GenesisXlsx.documentSheets(result),result.kind==='reportCard'?'genesis-boleta.xlsx':'genesis-consolidado.xlsx');});
$('printDocument').onclick=safe(async()=>{
  if(academicDocument?.kind==='reportCard'){
    const popup=openIncoPrint();
    try{
      const studentId=academicDocument.students[0].id;
      const result=await sectionReport('reportCard',{studentId});
      writeIncoPrint(popup,IncoFormats.reportPages(result,incoPrintOptions()));
    }catch(error){popup.close();throw error;}
    return;
  }
  if(!academicDocument)return;const printWindow=window.open('','_blank');if(!printWindow){message('Permití la ventana de impresión del navegador.',true);return;}
  const styles=[...document.querySelectorAll('style,link[rel="stylesheet"]')].map(el=>el.tagName==='LINK'?`<link rel="stylesheet" href="${esc(el.href)}">`:el.outerHTML).join('');
  printWindow.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>GENESIS · Documento académico</title>'+styles+'</head><body><main><section>'+$('reportOutput').innerHTML+'</section></main></body></html>');printWindow.onload=()=>{printWindow.focus();printWindow.print();};printWindow.document.close();
});
function renderFrameCards(){
  const specialty=$('frameSpecialty').value,frames=state.academicFrames.filter(f=>f.specialtyId===specialty);
  $('frameCards').innerHTML=frames.length?frames.map(f=>`<article class="card"><span class="pill neutral">Cuadro ${f.number}</span><h3>${esc(f.name)}</h3><p class="help">${f.formatSlot?'Formato '+esc(f.formatSlot)+' · plantilla oficial pendiente':'Formato oficial sin seleccionar'}</p><p class="muted">${f.status==='CONFIGURED'?state.frameLinks.filter(l=>l.frameId===f.id).length+' vínculos de materias y períodos':'Composición pendiente de confirmar'}</p><button type="button" class="secondary" data-consult-frame="${esc(f.id)}">Consultar cuadro</button></article>`).join(''):'<p class="empty-inline">Administración debe registrar la especialidad y la composición de sus cuadros.</p>';
  options('frameManage',frames);$('linkSpecialtySection').disabled=!specialty;syncFrameEditor();
}
function syncFrameEditor(){
  const frame=state.academicFrames.find(f=>f.id===$('frameManage').value);$('frameName').value=frame?.name||'';
  $('frameFormatSlot').value=frame?.formatSlot?String(frame.formatSlot):'';
  for(const option of $('frameFormatSlot').options)option.disabled=!!option.value&&state.academicFrames.some(f=>f.id!==frame?.id&&f.specialtyId===frame?.specialtyId&&f.formatSlot===Number(option.value));
  options('frameSection',state.sections.filter(s=>s.specialtyId===frame?.specialtyId).map(s=>({...s,name:sectionLabel(s)})));renderFrameLinks();
}
function renderFrameLinks(){
  const frameId=$('frameManage').value,year=$('frameYear').value,sectionId=$('frameSection').value,links=state.frameLinks.filter(l=>l.frameId===frameId&&l.year===year&&l.sectionId===sectionId),assignments=state.assignments.filter(a=>a.year===year&&a.sectionId===sectionId);
  $('saveFrame').disabled=!frameId||!sectionId;
  const rows=assignments.flatMap(a=>state.periods.filter(p=>p.year===year).map(p=>`<label class="checkbox-field"><input type="checkbox" data-frame-assignment="${esc(a.id)}" value="${esc(p.id)}" ${links.some(l=>l.subjectId===a.subjectId&&l.periodId===p.id)?'checked':''}>${esc(nameOf('subjects',a.subjectId))} · ${esc(p.name)}</label>`));
  for(const l of links.filter(l=>!assignments.some(a=>a.subjectId===l.subjectId)))rows.push(`<label class="checkbox-field"><input type="checkbox" data-existing-frame="${esc(l.id)}" checked>${esc(nameOf('subjects',l.subjectId))} · período ${esc(l.periodId)} · sin asignación activa</label>`);
  $('frameLinks').innerHTML=rows.join('')||'<p class="empty-inline">Vinculá una sección a esta especialidad y registrá sus asignaciones.</p>';
}
$('frameSpecialty').onchange=renderFrameCards;$('frameManage').onchange=syncFrameEditor;$('frameYear').onchange=renderFrameLinks;$('frameSection').onchange=renderFrameLinks;
$('specialtyForm').onsubmit=safe(async()=>{await mutate('specialty',{name:$('specialtyName').value});$('specialtyName').value='';});
$('sectionSpecialtyForm').onsubmit=safe(()=>mutate('sectionSpecialty',{sectionId:$('specialtySection').value,specialtyId:$('frameSpecialty').value}));
$('frameForm').onsubmit=safe(async()=>{
  const id=$('frameManage').value,year=$('frameYear').value,section=$('frameSection').value;
  const preserved=state.frameLinks.filter(l=>l.frameId===id&&(l.year!==year||l.sectionId!==section));
  const selectedExisting=[...$('frameLinks').querySelectorAll('[data-existing-frame]:checked')].map(el=>state.frameLinks.find(l=>l.id===el.dataset.existingFrame));
  const links=[...preserved,...selectedExisting,...[...$('frameLinks').querySelectorAll('[data-frame-assignment]:checked')].map(el=>({assignmentId:el.dataset.frameAssignment,periodId:el.value}))];
  await mutate('frameConfig',{frameId:id,name:$('frameName').value,links,formatSlot:$('frameFormatSlot').value?Number($('frameFormatSlot').value):null});
});
$('frameCards').onclick=safe(async event=>{
  const id=event.target.closest('[data-consult-frame]')?.dataset.consultFrame;if(!id)return;
  const link=state.frameLinks.find(l=>l.frameId===id);if(!link)throw Error('Este cuadro está pendiente de composición académica.');
  $('documentYear').value=link.year;$('documentSection').value=link.sectionId;syncDocumentContext();$('documentFrame').value=id;setView('documents');await loadAcademicDocument();
});
async function syncEvaluationScope(){
  const a=state.assignments.find(a=>a.id===$('evaluationAssignment').value);if(!a){$('saveEvaluation').disabled=true;return;}
  const result=await api('roster',{assignmentId:a.id,periodId:$('evaluationPeriod').value});
  evaluationReadOnly=result.closed||result.students.some(s=>s.recorded);
  $('evaluationCount').value=String(result.evaluation.mode==='PHASES'?3:result.evaluation.count);
  $('evaluationCount').disabled=evaluationReadOnly;$('evaluationReason').disabled=evaluationReadOnly;
  renderEvaluationWeights(result.evaluation.mode==='PHASES'?[]:result.weights);
  if(evaluationReadOnly)$('evaluationTotal').textContent='Configuración histórica protegida: este grupo y período tienen registros o están cerrados.';
  else if(result.evaluation.mode==='PHASES')$('evaluationTotal').textContent='Esquema actual: nueve notas por fases. Para usar de una a cinco notas, indicá todos sus porcentajes y una justificación.';
}
function renderEvaluationWeights(weights=[]){
  const count=Number($('evaluationCount').value);$('evaluationWeights').innerHTML=Array.from({length:count},(_,i)=>`<label>Nota ${i+1} · porcentaje<input type="number" min="0" max="100" step="any" required data-evaluation-weight="${i}" value="${weights[i]===undefined?'':Number((weights[i]*100).toFixed(8))}" ${evaluationReadOnly?'disabled':''}></label>`).join('');updateEvaluationTotal();
}
function updateEvaluationTotal(){const inputs=[...$('evaluationWeights').querySelectorAll('input')],total=inputs.reduce((sum,input)=>sum+Number(input.value),0),valid=inputs.length>0&&inputs.every(input=>input.value!==''&&input.checkValidity())&&Math.abs(total-100)<1e-8;$('evaluationTotal').textContent=`Total: ${Number(total.toFixed(6))} % · ${valid?'Distribución completa':'Completá porcentajes que sumen 100 %'}`;$('saveEvaluation').disabled=evaluationReadOnly||!valid;}
function fillEvaluationPeriods(){const a=state.assignments.find(a=>a.id===$('evaluationAssignment').value);options('evaluationPeriod',state.periods.filter(p=>p.year===a?.year));}
$('evaluationAssignment').onchange=safe(async()=>{fillEvaluationPeriods();await syncEvaluationScope();});$('evaluationPeriod').onchange=safe(syncEvaluationScope);$('evaluationCount').onchange=()=>renderEvaluationWeights();$('evaluationWeights').oninput=updateEvaluationTotal;
$('evaluationForm').onsubmit=safe(()=>mutate('evaluationPolicy',{assignmentId:$('evaluationAssignment').value,periodId:$('evaluationPeriod').value,count:Number($('evaluationCount').value),weights:[...$('evaluationWeights').querySelectorAll('input')].map(input=>Number(input.value)/100),reason:$('evaluationReason').value}));
$('gradeTable').addEventListener('click',safe(async event=>{
  const button=event.target.closest('[data-grade-lock]');if(!button)return;if(dirty)throw Error('Guardá las notas pendientes antes de cambiar el bloqueo.');
  const student=roster.students.find(s=>s.id===button.dataset.gradeLock),reason=window.prompt((student.locked?'Desbloquear':'Bloquear')+' a '+student.name+': indicá un motivo de al menos 10 caracteres.');if(reason===null)return;
  if(reason.trim().length<10)throw Error('El motivo debe tener al menos 10 caracteres.');await mutate('gradeLock',{assignmentId:selected,periodId:loadedPeriod,studentId:student.id,active:!student.locked,reason});
}));
$('gradeTable').addEventListener('focusout',event=>{const input=event.target.closest('input[data-row]');if(!input||input.value===''||!input.checkValidity())return;input.value=Genesis.formatGrade(Number(input.value));updateGradePreview();});
$('subjectCategory').onchange=()=>{if(!$('subjectType').disabled)$('subjectType').value=$('subjectCategory').value==='TECHNICAL'?'MODULO_FASES':'GENERAL_4_PERIODOS';if($('subjectCategory').value!=='TECHNICAL')$('subjectModuleNumber').value='';};
$('subjectType').onchange=()=>{$('subjectCategory').value=$('subjectType').value==='MODULO_FASES'?'TECHNICAL':'BASIC';};
const canViewSubjectTeachers=()=>state&&['ADMIN','DIRECTION'].includes(state.user.role);
function filterSubjectTeacherSubjects(fromSearch=false){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const query=normalize($('subjectTeacherSearch').value.trim()),previous=$('subjectTeacherSubject').value;
  const subjects=canViewSubjectTeachers()?state.subjects.filter(s=>normalize([s.name,...(s.aliases||[])].join(' ')).includes(query)).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true})):[];
  editableOptions('subjectTeacherSubject',subjects,subjectTitle,'Seleccionar materia o módulo');
  if(fromSearch&&query&&!subjects.some(s=>s.id===previous)&&subjects.length)$('subjectTeacherSubject').value=subjects[0].id;
  $('subjectTeacherSubject').disabled=!subjects.length;
  $('subjectTeacherSearchEmpty').classList.toggle('hidden',!canViewSubjectTeachers()||!query||subjects.length>0);
  renderSubjectTeachers();
}
function renderSubjectTeachers(){
  const subject=canViewSubjectTeachers()?state.subjects.find(s=>s.id===$('subjectTeacherSubject').value):null,year=$('subjectTeacherYear').value,teachers=new Map();
  if(subject)for(const assignment of state.assignments.filter(a=>a.active&&a.subjectId===subject.id&&(!year||a.year===year))){
    if(!teachers.has(assignment.teacherId)){
      const actor=state.actors.find(t=>t.id===assignment.teacherId)||state.teachers.find(t=>t.id===assignment.teacherId);
      teachers.set(assignment.teacherId,{name:displayName(actor?.name||'Docente sin nombre registrado'),groups:new Map()});
    }
    const section=state.sections.find(s=>s.id===assignment.sectionId),yearRecord=state.years.find(y=>y.id===assignment.year);
    teachers.get(assignment.teacherId).groups.set(assignment.year+'|'+assignment.sectionId,{section:section?sectionLabel(section):'Sección sin nombre registrado',year:yearRecord?.label||yearRecord?.name||assignment.year});
  }
  const rows=[...teachers.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')),groupCount=rows.reduce((sum,t)=>sum+t.groups.size,0);
  $('subjectTeacherCount').textContent=subject?`${rows.length} ${rows.length===1?'docente':'docentes'} · ${groupCount} ${groupCount===1?'grupo':'grupos'} · ${subjectTitle(subject)}`:'';
  $('subjectTeacherRows').innerHTML=rows.map(t=>`<tr><td><strong>${esc(t.name)}</strong></td><td><div class="flex">${[...t.groups.values()].sort((a,b)=>b.year.localeCompare(a.year,'es',{numeric:true})||a.section.localeCompare(b.section,'es',{numeric:true})).map(g=>`<span class="pill neutral">${esc(g.section)} · ${esc(g.year)}</span>`).join('')}</div></td><td>${t.groups.size}</td></tr>`).join('');
  $('subjectTeacherResults').classList.toggle('hidden',!rows.length);
  $('subjectTeacherEmpty').classList.toggle('hidden',rows.length>0||!$('subjectTeacherSearchEmpty').classList.contains('hidden'));
  $('subjectTeacherEmpty').textContent=subject?`No hay docentes con asignaciones activas para ${subjectTitle(subject)}${year?' en '+(state.years.find(y=>y.id===year)?.label||year):''}.`:'Seleccioná una materia o módulo para consultar sus docentes.';
}
$('subjectTeacherSearch').oninput=()=>filterSubjectTeacherSubjects(true);
$('subjectTeacherSubject').onchange=renderSubjectTeachers;$('subjectTeacherYear').onchange=renderSubjectTeachers;
function renderSectionTeachers(){
  const authorized=canViewSubjectTeachers(),year=authorized?state.years.find(y=>y.id===$('sectionTeacherYear').value):null,section=authorized?state.sections.find(s=>s.id===$('sectionTeacherSection').value):null;
  const teachers=new Map(),subjectIds=new Set();
  if(year&&section)for(const assignment of state.assignments.filter(a=>a.active&&a.year===year.id&&a.sectionId===section.id)){
    if(!teachers.has(assignment.teacherId)){
      const actor=state.actors.find(t=>t.id===assignment.teacherId)||state.teachers.find(t=>t.id===assignment.teacherId);
      teachers.set(assignment.teacherId,{name:displayName(actor?.name||'Docente sin nombre registrado'),subjects:new Map()});
    }
    const subject=state.subjects.find(s=>s.id===assignment.subjectId);subjectIds.add(assignment.subjectId);
    teachers.get(assignment.teacherId).subjects.set(assignment.subjectId,{name:subject?subjectTitle(subject):'Asignatura sin nombre registrado',category:subject?categoryLabel(subject):'Clasificación pendiente'});
  }
  const rows=[...teachers.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
  $('sectionTeacherCount').textContent=year&&section?`${rows.length} ${rows.length===1?'docente':'docentes'} · ${subjectIds.size} ${subjectIds.size===1?'asignatura':'asignaturas'} · ${sectionLabel(section)} · ${year.label||year.name||year.id}`:'';
  $('sectionTeacherRows').innerHTML=rows.map(t=>`<tr><td><strong>${esc(t.name)}</strong></td><td>${[...t.subjects.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true})).map(s=>`<p><strong>${esc(s.name)}</strong><small>${esc(s.category)}</small></p>`).join('')}</td><td>${t.subjects.size}</td></tr>`).join('');
  $('sectionTeacherResults').classList.toggle('hidden',!rows.length);$('sectionTeacherEmpty').classList.toggle('hidden',rows.length>0);
  $('sectionTeacherEmpty').textContent=year&&section?`No hay docentes con asignaciones activas para ${sectionLabel(section)} en ${year.label||year.name||year.id}.`:'Seleccioná el año lectivo y la sección para consultar sus docentes.';
}
function syncSectionTeacherFilters(){
  const authorized=canViewSubjectTeachers();
  editableOptions('sectionTeacherYear',authorized?state.years:[],y=>y.label||y.name||y.id,'Seleccionar año lectivo');
  editableOptions('sectionTeacherSection',authorized?state.sections.slice().sort((a,b)=>sectionLabel(a).localeCompare(sectionLabel(b),'es',{numeric:true})):[],sectionLabel,'Seleccionar sección');
  renderSectionTeachers();
}
$('sectionTeacherYear').onchange=renderSectionTeachers;$('sectionTeacherSection').onchange=renderSectionTeachers;
function teacherSubjectTeachers(){
  if(!canViewSubjectTeachers())return [];
  const ids=new Set([...state.teachers.map(t=>t.id),...state.assignments.filter(a=>a.active).map(a=>a.teacherId)]);
  return [...ids].map(id=>{const actor=state.actors.find(t=>t.id===id)||state.teachers.find(t=>t.id===id);return {id,name:displayName(actor?.name||'Docente sin nombre registrado')};}).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
}
function filterTeacherSubjectTeachers(fromSearch=false){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const query=normalize($('teacherSubjectSearch').value.trim()),previous=$('teacherSubjectTeacher').value;
  const teachers=teacherSubjectTeachers().filter(t=>normalize(t.name).includes(query));
  editableOptions('teacherSubjectTeacher',teachers,t=>t.name,'Seleccionar docente');
  if(fromSearch&&query&&!teachers.some(t=>t.id===previous)&&teachers.length)$('teacherSubjectTeacher').value=teachers[0].id;
  $('teacherSubjectTeacher').disabled=!teachers.length;
  $('teacherSubjectSearchEmpty').classList.toggle('hidden',!canViewSubjectTeachers()||!query||teachers.length>0);
  renderTeacherSubjects();
}
function renderTeacherSubjects(){
  const teacher=teacherSubjectTeachers().find(t=>t.id===$('teacherSubjectTeacher').value),year=$('teacherSubjectYear').value,subjects=new Map();
  if(teacher)for(const assignment of state.assignments.filter(a=>a.active&&a.teacherId===teacher.id&&(!year||a.year===year))){
    if(!subjects.has(assignment.subjectId)){
      const subject=state.subjects.find(s=>s.id===assignment.subjectId);
      subjects.set(assignment.subjectId,{name:subject?subjectTitle(subject):'Asignatura sin nombre registrado',category:subject?categoryLabel(subject):'Clasificación pendiente',groups:new Map()});
    }
    const section=state.sections.find(s=>s.id===assignment.sectionId),yearRecord=state.years.find(y=>y.id===assignment.year);
    subjects.get(assignment.subjectId).groups.set(assignment.year+'|'+assignment.sectionId,{section:section?sectionLabel(section):'Sección sin nombre registrado',year:yearRecord?.label||yearRecord?.name||assignment.year});
  }
  const rows=[...subjects.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true})),assignments=rows.reduce((sum,s)=>sum+s.groups.size,0);
  $('teacherSubjectCount').textContent=teacher?`${rows.length} ${rows.length===1?'asignatura':'asignaturas'} · ${assignments} ${assignments===1?'asignación':'asignaciones'} · ${teacher.name}`:'';
  $('teacherSubjectRows').innerHTML=rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong><small>${esc(s.category)}</small></td><td><div class="flex">${[...s.groups.values()].sort((a,b)=>b.year.localeCompare(a.year,'es',{numeric:true})||a.section.localeCompare(b.section,'es',{numeric:true})).map(g=>`<span class="pill neutral">${esc(g.section)} · ${esc(g.year)}</span>`).join('')}</div></td><td>${s.groups.size}</td></tr>`).join('');
  $('teacherSubjectResults').classList.toggle('hidden',!rows.length);
  $('teacherSubjectEmpty').classList.toggle('hidden',rows.length>0||!$('teacherSubjectSearchEmpty').classList.contains('hidden'));
  $('teacherSubjectEmpty').textContent=teacher?`No hay materias o módulos con asignaciones activas para ${teacher.name}${year?' en '+(state.years.find(y=>y.id===year)?.label||year):''}.`:'Seleccioná un docente para consultar sus materias, módulos y secciones.';
}
$('teacherSubjectSearch').oninput=()=>filterTeacherSubjectTeachers(true);
$('teacherSubjectTeacher').onchange=renderTeacherSubjects;$('teacherSubjectYear').onchange=renderTeacherSubjects;
async function renderFunctional(){
  editableOptions('subjectTeacherYear',canViewSubjectTeachers()?state.years:[],y=>y.label||y.name,'Todos los años lectivos');filterSubjectTeacherSubjects();
  syncSectionTeacherFilters();
  editableOptions('teacherSubjectYear',canViewSubjectTeachers()?state.years:[],y=>y.label||y.name||y.id,'Todos los años lectivos');filterTeacherSubjectTeachers();
  await syncAcademicDocumentControls();
  syncSectionWorkflows();
  options('frameSpecialty',state.specialties);options('specialtySection',state.sections.map(s=>({...s,name:sectionLabel(s)})));options('frameYear',state.years,'label');renderFrameCards();
  $('frameAdministration').classList.toggle('hidden',state.user.role!=='ADMIN');
  if(state.user.role==='ADMIN'){options('evaluationAssignment',state.assignments.map(a=>({...a,name:`${nameOf('subjects',a.subjectId)} · ${nameOf('sections',a.sectionId)} · ${a.year}`})));fillEvaluationPeriods();await syncEvaluationScope();}
}
if(state)renderFunctional().catch(error=>message(error.message,true));
