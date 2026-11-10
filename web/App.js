/* UI only. The server remains authoritative for identities, permissions and grades. */
const local=!(typeof google!=='undefined'&&google.script&&google.script.run);
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleNames={ADMIN:'Administración',DIRECTION:'Dirección',TEACHER:'Docente'};
const viewNames={overview:'Inicio',subjects:'Materias y módulos',admin:'Docentes y asignaciones',catalog:'Estudiantes y organización',periods:'Períodos',imports:'Importaciones',settings:'Configuración',audit:'Auditoría',tools:'Administración',documents:'Consolidados y boletas',frames:'Cuadros y especialidades',subjectTeachers:'Docentes por materia',sectionTeachers:'Docentes por sección',teacherSubjects:'Materias por docente'};
function navigationIcon(view){
  const paths={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',subjects:'<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/>',admin:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',catalog:'<path d="m2 8 10-5 10 5-10 5L2 8Zm4 3v6c4 3 8 3 12 0v-6m4-3v8"/>',periods:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 5h3m4 0h3"/>',imports:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',audit:'<path d="M8 4H5v17h14V4h-3"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="m8 14 3 3 5-6"/>',tools:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[['subjectTeachers','sectionTeachers','teacherSubjects'].includes(view)?'admin':view]||paths.overview}</svg>`;
}
const displayName=value=>String(value||'').replace(/\s*·\s*demostración/gi,'').replace(/^Docente de prueba$/,'Docente');
let state,roster,selected,preview,currentView='overview',dirty=false,busy=false,loadedPeriod='1',noticeTimer,editingPolicy=false,importRowsData=[],importRoster;
let pendingOperation=Promise.resolve();
let lastBrowse={};
let editingSubjectId=null;

function message(text,error=false){
  clearTimeout(noticeTimer);$('message').textContent=text;$('message').className=error?'error':'';$('message').style.display='flex';
  const close=document.createElement('button');close.type='button';close.className='close-notice';close.setAttribute('aria-label','Cerrar aviso');close.textContent='×';close.onclick=()=>{$('message').style.display='none';};$('message').append(close);
  if(!error)noticeTimer=setTimeout(()=>{$('message').style.display='none';},6000);
}
async function api(action,params={}){
  if(!local){const token=GoogleLogin.token();return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(value=>{if(token!==GoogleLogin.token())reject(Error('La sesión cambió. Volvé a consultar los datos.'));else resolve(value);}).withFailureHandler(error=>{if(token===GoogleLogin.token())GoogleLogin.expired(error);reject(error);}).api(action,params,token));}
  const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:JSON.stringify({action,params})});
  const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
function options(id,items,label='name'){
  const value=$(id).value;
  const option=x=>`<option value="${esc(x.id)}">${esc(displayName(x[label]||x.id))}</option>`;
  $(id).innerHTML=['browseSubject','subjectSelect','policySubject'].includes(id)?[['BASIC','Materias básicas'],['CONCEPTUAL','Materias conceptuales'],['TECHNICAL','Módulos técnicos']].map(([type,name])=>{const group=items.filter(x=>Genesis.categoryOf(x)===type).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));return group.length?`<optgroup label="${name}">${group.map(option).join('')}</optgroup>`:'';}).join(''):items.map(option).join('');
  if(items.some(i=>i.id===value))$(id).value=value;
}
function allowedViews(){
  if(state.user.role==='ADMIN')return ['overview','subjects','admin','subjectTeachers','sectionTeachers','teacherSubjects','catalog','periods','imports','settings','audit','tools','frames','documents'];
  return state.user.role==='DIRECTION'?['overview','subjectTeachers','sectionTeachers','teacherSubjects','periods','audit','frames','documents']:['overview','imports','frames','documents'];
}
function setView(view){
  if(!allowedViews().includes(view))view='overview';currentView=view;
  document.querySelectorAll('[data-view]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.view!==view||(panel.id==='gradePanel'&&!selected)));
  document.querySelectorAll('[data-nav]').forEach(button=>{button.classList.toggle('active',button.dataset.nav===view);if(button.dataset.nav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('approvalPanel').classList.toggle('hidden',state.user.role!=='ADMIN'||!state.batches.some(b=>b.status==='REVIEW'));
}
function canDiscard(){return !dirty||window.confirm('Tenés notas sin guardar. ¿Querés descartar esos cambios?');}
function sectionLabel(record){return record?.grade&&!/^[123][.º°\s]/.test(record.name)?`${record.grade}.º ${record.name}`:record?.name||'Sección';}
function nameOf(table,id){const record=state[table]?.find(item=>item.id===id);return displayName(table==='sections'?sectionLabel(record):record?.name||'Registro');}
function editableOptions(id,items,label,empty='Nuevo registro'){
  const previous=$(id).value;$(id).innerHTML=`<option value="">${empty}</option>`+items.map(x=>`<option value="${esc(x.id)}">${esc(displayName(label(x)))}</option>`).join('');if(items.some(x=>x.id===previous))$(id).value=previous;
}
function renderGroups(){
 options('browseYear',state.years,'label');return renderSectionMenu();
}
function renderSectionMenu(){
 const year=$('browseYear').value,admin=state.user.role!=='TEACHER';
 const allowed=state.sections.filter(s=>admin||state.assignments.some(a=>a.year===year&&a.sectionId===s.id));
 const gradeOf=s=>s.grade||s.name.match(/^([123])/)?.[1]||'otros',grades=[...new Set(allowed.map(gradeOf))].sort();options('browseGrade',grades.map(id=>({id,name:id==='otros'?'Otros':id+'.º año'})));
 options('browseSection',allowed.filter(s=>gradeOf(s)===$('browseGrade').value).map(s=>({...s,name:sectionLabel(s)})));return renderSubjectMenu();
}
function renderSubjectMenu(){
 const year=$('browseYear').value,section=$('browseSection').value,assignments=state.assignments.filter(a=>a.year===year&&a.sectionId===section);
 const ids=new Set(assignments.map(a=>a.subjectId));if(state.user.role==='ADMIN')for(const id of state.sections.find(s=>s.id===section)?.subjectIds||[])ids.add(id);
 options('browseSubject',state.subjects.filter(s=>ids.has(s.id)));return renderSelection();
}
async function renderSelection(){
 const a=state.assignments.find(a=>a.year===$('browseYear').value&&a.sectionId===$('browseSection').value&&a.subjectId===$('browseSubject').value);
 $('groups').innerHTML=a?'':'<div class="empty-inline">'+(state.user.role==='TEACHER'?'Aún no tenés secciones asignadas. Consultá con administración':'Sin docente asignado para esta materia. Administrá la asignación en Docentes y asignaciones.')+'</div>';
 $('sectionStudents').classList.toggle('hidden',state.user.role!=='ADMIN'||!!a);renderSectionStudents();
 lastBrowse=Object.fromEntries(['browseYear','browseGrade','browseSection','browseSubject'].map(id=>[id,$(id).value]));
 if(a)await openGroup(a.id);else{selected=null;roster=null;dirty=false;$('gradePanel').classList.add('hidden');}
}
function renderSectionStudents(){
 const q=$('sectionSearch').value.trim().toLocaleLowerCase('es'),ids=new Set(state.enrollments.filter(e=>e.year===$('browseYear').value&&e.sectionId===$('browseSection').value).map(e=>e.studentId));
 const students=state.students.filter(s=>ids.has(s.id)&&(s.name+' '+s.nie).toLocaleLowerCase('es').includes(q));
 $('sectionStudentRows').innerHTML=students.length?students.map(s=>'<tr><td>'+esc(s.name)+'</td><td>'+esc(s.nie)+'</td></tr>').join(''):'<tr><td colspan="2">Sin estudiantes para mostrar</td></tr>';
}
async function browseChange(fn){if(!canDiscard()){for(const [id,value]of Object.entries(lastBrowse))$(id).value=value;return;}dirty=false;selected=null;$('gradePanel').classList.add('hidden');await fn();}
$('browseYear').onchange=safe(()=>browseChange(renderSectionMenu));$('browseGrade').onchange=safe(()=>browseChange(renderSectionMenu));$('browseSection').onchange=safe(()=>browseChange(renderSubjectMenu));$('browseSubject').onchange=safe(()=>browseChange(renderSelection));$('sectionSearch').oninput=renderSectionStudents;
function filterPolicySubjects(){
  const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const query=normalize($('policySubjectSearch').value.trim()),previous=$('policySubject').value;
  const subjects=state.subjects.filter(subject=>normalize(subject.name).includes(query));
  options('policySubject',subjects);$('policySubject').disabled=!subjects.length;
  $('policySearchEmpty').classList.toggle('hidden',subjects.length>0);
  if($('policySubject').value!==previous)syncPolicy();
}
function syncPolicy(){
  const subject=state.subjects.find(s=>s.id===$('policySubject').value);
  $('enablePolicy').disabled=!subject;
  const modular=subject?.type==='MODULO_FASES';
  const weights=state.weights?.find(w=>w.id===subject?.id)?.values||(modular?[.25,.5,.25]:[.35,.35,.3]);
  const labels=modular?['Preparación','Ejecución','Evaluación']:['Actividad 1','Actividad 2','Actividad 3'];
  labels.forEach((label,i)=>{$('weightLabel'+i).textContent=label;$('weight'+i).value=Number((weights[i]*100).toFixed(8));});
  $('policyDecimals').value='1';
  editingPolicy=false;$('policyWeights').disabled=true;$('policyDecimals').disabled=true;$('policyReason').disabled=true;$('policyReason').value='';$('policyReason').closest('label').classList.add('hidden');$('configurePolicy').classList.add('hidden');$('enablePolicy').classList.remove('hidden');
  updateWeightTotal();
}
function updateWeightTotal(){
  const inputs=[0,1,2].map(i=>$('weight'+i)),values=inputs.map(input=>Number(input.value));
  const total=values.reduce((a,b)=>a+b,0),valid=inputs.every(input=>input.value!==''&&input.checkValidity())&&Math.abs(total-100)<1e-8;
  $('weightTotal').textContent=`Total: ${Number(total.toFixed(8))} %${valid?' · Distribución completa':' · Los tres porcentajes deben sumar 100 %'}`;
  $('weightTotal').classList.toggle('invalid',!valid);$('configurePolicy').disabled=!editingPolicy||!valid||!$('policySubject').value;
  values.forEach((value,i)=>$('weightBar'+i).style.width=Math.min(100,Math.max(0,value))+'%');
  return valid;
}
function syncTeacher(){const record=state.users.find(u=>u.id===$('teacherRecord').value);$('teacherForm').elements.name.value=record?.name||'';$('teacherForm').elements.email.value=record?.email||'';$('teacherForm').querySelector('button').textContent=record?'Guardar docente':'Registrar docente';}
function syncAssignment(){const record=state.assignments.find(a=>a.id===$('assignmentRecord').value);if(record){for(const [field,id]of Object.entries({year:'yearSelect',teacherId:'teacherSelect',sectionId:'sectionSelect',subjectId:'subjectSelect'}))$(id).value=record[field];}}
function syncCatalog(){
  const entity=$('catalogEntity').value;editableOptions('catalogRecord',state[entity],r=>entity==='sections'?sectionLabel(r):r.name||r.label);
  const record=state[entity].find(r=>r.id===$('catalogRecord').value);$('catalogForm').elements.name.value=record?.name||record?.label||'';
  $('subjectTypeField').classList.toggle('hidden',entity!=='subjects'||!!record);$('catalogGradeField').classList.toggle('hidden',entity!=='sections');
  $('catalogForm').elements.type.disabled=entity!=='subjects'||!!record;if(entity==='subjects'&&record)$('catalogForm').elements.type.value=record.type;
  $('catalogGrade').value=record?.grade||'';
  $('catalogForm').elements.name.placeholder=entity==='years'?'Ej.: 2027':entity==='subjects'?'Ej.: Matemática':'Ej.: A';
}
function syncStudent(){const student=state.students.find(s=>s.id===$('studentSelect').value);$('enrollForm').elements.name.value=student?.name||'';$('enrollForm').elements.nie.value=student?.nie||'';$('saveStudent').disabled=!student;}
function renderEnrollments(){
  const query=$('enrollmentSearch').value.trim().toLocaleLowerCase('es'),sectionId=$('enrollmentSectionFilter').value;
  const records=state.enrollments.filter(e=>!sectionId||e.sectionId===sectionId).map(e=>({...e,student:state.students.find(s=>s.id===e.studentId)})).filter(e=>e.student&&(e.student.name+' '+e.student.nie).toLocaleLowerCase('es').includes(query));
  $('enrollmentCount').textContent=`${records.length} de ${state.enrollments.length} matrículas`;
  $('enrollmentRows').innerHTML=records.length?records.map(e=>`<tr><td>${esc(e.student.name)}</td><td>${esc(e.student.nie)}</td><td>${esc(state.years.find(y=>y.id===e.year)?.label||e.year)}</td><td>${esc(nameOf('sections',e.sectionId))}</td><td><button type="button" class="secondary" data-student="${esc(e.studentId)}">Editar</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty-inline">Sin estudiantes para mostrar.</td></tr>';
  options('enrollmentRecord',state.enrollments.map(e=>({...e,name:`${state.students.find(s=>s.id===e.studentId)?.name} · ${state.years.find(y=>y.id===e.year)?.label||e.year} · ${nameOf('sections',e.sectionId)}`})));
  options('enrollmentSection',state.sections.map(s=>({...s,name:sectionLabel(s)})));
}
function renderAdministration(){
  $('googleAccounts').classList.toggle('hidden',local||state.user.role!=='ADMIN');
  $('googleAccountsTitle').classList.toggle('hidden',local||state.user.role!=='ADMIN');
  options('googleAccountUser',state.users);syncGoogleAccount();
  editableOptions('teacherRecord',state.teachers,r=>r.name,'Nuevo docente');
  editableOptions('assignmentRecord',state.assignments,a=>`${nameOf('teachers',a.teacherId)} · ${nameOf('subjects',a.subjectId)} · ${nameOf('sections',a.sectionId)} · ${state.years.find(y=>y.id===a.year)?.label||a.year}`,'Nueva asignación');
  editableOptions('studentSelect',state.students,s=>`${s.name} · ${s.nie}`,'Nuevo estudiante');
  editableOptions('enrollmentSectionFilter',state.sections.slice().sort((a,b)=>sectionLabel(a).localeCompare(sectionLabel(b),'es',{numeric:true})),sectionLabel,'Todas las secciones');
  $('assignmentHistory').innerHTML=state.assignmentHistory?.length?state.assignmentHistory.map(a=>`<div class="record-row"><div><strong>${esc(nameOf('teachers',a.teacherId))}</strong><small>${esc(nameOf('subjects',a.subjectId))} · ${esc(nameOf('sections',a.sectionId))} · ${esc(state.years.find(y=>y.id===a.year)?.label||a.year)}</small></div><span class="pill neutral">Retirada</span></div>`).join(''):'<p class="empty-inline">Sin asignaciones anteriores.</p>';
  syncTeacher();syncAssignment();syncCatalog();syncStudent();renderEnrollments();
}
function renderSubjectCatalog(){
 const q=$('subjectSearch').value.trim().toLocaleLowerCase('es'),category=$('subjectCategoryFilter').value;
 for(const [type,target,label]of [['GENERAL_4_PERIODOS','basicSubjects','Materias básicas'],['CONCEPTUAL','conceptualSubjects','Materias conceptuales'],['MODULO_FASES','moduleSubjects','Módulos técnicos']]){
  const container=$(target);container.classList.toggle('hidden',!!category&&category!==type);
  const records=state.subjects.filter(s=>(type==='CONCEPTUAL'?Genesis.categoryOf(s)==='CONCEPTUAL':type==='GENERAL_4_PERIODOS'?Genesis.categoryOf(s)==='BASIC':Genesis.categoryOf(s)==='TECHNICAL')&&s.name.toLocaleLowerCase('es').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
  container.innerHTML=`<div class="section-heading"><h3>${label}</h3><span class="muted">${records.length}</span></div><div class="scroll"><table><thead><tr><th>Nombre</th><th>Acción</th></tr></thead><tbody>${records.length?records.map(s=>`<tr><td>${esc(s.name)}<small>${({BASIC:'Materia básica',CONCEPTUAL:'Materia conceptual',TECHNICAL:'Módulo técnico'})[Genesis.categoryOf(s)]}${Genesis.categoryOf(s)==='TECHNICAL'?' · '+esc(Genesis.moduleIdentity(s).number?'Número '+Genesis.moduleIdentity(s).number:'Número pendiente de registrar'):''}</small></td><td><button type="button" class="secondary" data-edit-subject="${esc(s.id)}" aria-label="Editar ${esc(s.name)}">Editar</button></td></tr>`).join(''):'<tr><td colspan="2" class="empty-inline">Sin coincidencias.</td></tr>'}</tbody></table></div>`;
 }
}
function openSubjectEditor(id=null){
 if(state.user.role!=='ADMIN')return;
 editingSubjectId=id;const subject=state.subjects.find(s=>s.id===id),hasHistory=!!state.subjectUsage?.find(s=>s.id===id)?.hasHistory;
 $('subjectName').value=subject?.name||'';$('subjectType').value=subject?.type||($('subjectCategoryFilter').value==='MODULO_FASES'?'MODULO_FASES':'GENERAL_4_PERIODOS');$('subjectCategory').value=subject?Genesis.categoryOf(subject):$('subjectCategoryFilter').value==='CONCEPTUAL'?'CONCEPTUAL':$('subjectType').value==='MODULO_FASES'?'TECHNICAL':'BASIC';$('subjectModuleNumber').value=subject?Genesis.moduleIdentity(subject).number:'';
 $('subjectType').disabled=hasHistory;$('subjectCategoryNotice').classList.toggle('hidden',!hasHistory);$('subjectEditorTitle').textContent=subject?'Editar materia':'Añadir materia';
 $('saveSubject').textContent=subject?'Guardar cambios':'Guardar materia';$('subjectEditor').classList.remove('hidden');setView('subjects');$('subjectEditor').scrollIntoView({behavior:'smooth',block:'center'});$('subjectName').focus();
}
$('addSubjectShortcut').onclick=() =>openSubjectEditor();$('addSubject').onclick=()=>openSubjectEditor();$('cancelSubject').onclick=()=>{$('subjectEditor').classList.add('hidden');editingSubjectId=null;};
$('subjectSearch').oninput=renderSubjectCatalog;$('subjectCategoryFilter').onchange=renderSubjectCatalog;
for(const id of ['basicSubjects','conceptualSubjects','moduleSubjects'])$(id).onclick=event=>{const id=event.target.closest('[data-edit-subject]')?.dataset.editSubject;if(id)openSubjectEditor(id);};
$('subjectEditor').onsubmit=safe(async()=>{
 if(state.user.role!=='ADMIN')throw Error('Solo administración puede gestionar materias');
 await mutate(editingSubjectId?'updateCatalog':'catalog',{entity:'subjects',...(editingSubjectId?{recordId:editingSubjectId}:{}),name:$('subjectName').value,type:$('subjectType').value,category:$('subjectCategory').value,moduleNumber:$('subjectModuleNumber').value});
 $('subjectEditor').classList.add('hidden');editingSubjectId=null;
});
function syncPeriodAction(){const reopen=$('closeAction').value==='open';$('reopenReasonField').classList.toggle('hidden',!reopen);$('reopenReason').required=reopen;$('reopenReason').minLength=reopen?10:0;const button=$('periodForm').querySelector('button');button.textContent=reopen?'Reabrir período':'Cerrar período';const pending=(state.notifications||[]).filter(n=>n.year===$('closeYear').value&&(!n.periodId||n.periodId===$('closePeriod').value)).length;button.disabled=!reopen&&pending>0;$('periodCloseNotice').classList.toggle('hidden',reopen||!pending);$('periodCloseNotice').textContent=pending?`${pending} grupos tienen notas o períodos pendientes. Revisá los avisos antes de cerrar.`:'';}
function renderPeriods(){
    $('states').innerHTML=state.periods.map(p=>{const closed=state.periodStates.find(s=>s.year===p.year&&s.periodId===p.id)?.closed;return `<div class="period-item"><strong>${esc(p.name)} · ${esc(state.years.find(y=>y.id===p.year)?.label||p.year)}</strong><span class="pill ${closed?'closed':''}">${closed?'Período cerrado':'Período abierto'}</span></div>`;}).join('');
}
function renderNotifications(){
 const notifications=state.notifications||[];options('noticeYear',state.years,'label');$('notificationPanel').classList.toggle('hidden',!notifications.length);
 $('notificationTitle').textContent=`${notifications.length} avisos de períodos incompletos`;
 const visible=notifications.filter(n=>n.year===$('noticeYear').value&&(!$('noticePeriod').value||!n.periodId||n.periodId===$('noticePeriod').value));
 $('notificationRows').innerHTML=visible.length?visible.map(n=>`<div class="record-row"><div><strong>${esc(nameOf('subjects',n.subjectId))} · ${esc(nameOf('sections',n.sectionId))}${n.periodId?' · período '+esc(n.periodId):''}</strong><small>${state.user.role!=='TEACHER'?esc(nameOf('teachers',n.teacherId))+' · ':''}${n.reason==='CONFIRMAR_PERIODOS'?'Confirmar los períodos de este módulo':n.reason==='SIN_MATRICULA'?'No hay estudiantes matriculados':`${n.incompleteStudents} estudiantes con ${n.missingActivities} notas pendientes`}</small></div></div>`).join(''):'<div class="empty-inline">Sin pendientes para este filtro.</div>';
}
$('noticeYear').onchange=renderNotifications;$('noticePeriod').onchange=renderNotifications;
function syncFinalPolicy(){const policy=state.years.find(y=>y.id===$('finalYear').value)?.finalPolicy;$('finalMethod').value=policy?.method||'';$('finalPassMark').value=policy?.passMark??'';$('finalPassMark').max=policy?.method==='AVERAGE_4'?'10':'40';}
function syncModuleSchedule(){const a=state.assignments.find(a=>a.id===$('moduleAssignment').value);const ids=a?.requiredPeriods||[];$('modulePeriodOptions').innerHTML=state.periods.filter(p=>p.year===a?.year).map(p=>`<label class="checkbox-field"><input type="checkbox" value="${esc(p.id)}" ${ids.includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('');}
$('finalYear').onchange=syncFinalPolicy;$('finalMethod').onchange=()=>{$('finalPassMark').max=$('finalMethod').value==='AVERAGE_4'?'10':'40';};$('moduleAssignment').onchange=syncModuleSchedule;
$('finalPolicyForm').onsubmit=safe(async()=>{if(!window.confirm('¿Guardar el criterio de aprobación para este año lectivo?'))return;await mutate('finalPolicy',{year:$('finalYear').value,method:$('finalMethod').value,passMark:Number($('finalPassMark').value),reason:$('finalReason').value});});
$('moduleScheduleForm').onsubmit=safe(()=>mutate('moduleSchedule',{assignmentId:$('moduleAssignment').value,periodIds:[...$('modulePeriodOptions').querySelectorAll('input:checked')].map(input=>input.value)}));
function renderAudit(){
  const names={GRADE_LOCK:'Calificaciones bloqueadas',GRADE_UNLOCK:'Calificaciones desbloqueadas',EVALUATION_POLICY:'Notas por período configuradas',SPECIALTY:'Especialidad registrada',SECTION_SPECIALTY:'Sección vinculada a especialidad',FRAME_CONFIG:'Composición de cuadro actualizada',GRADE:'Notas guardadas',ASSIGN:'Asignación creada',REVOKE:'Asignación revocada',CLOSE:'Período cerrado',REOPEN:'Período reabierto',TEACHER_CREATE:'Docente registrado',CATALOG_CREATE:'Catálogo actualizado',ENROLL:'Estudiante matriculado',POLICY:'Evaluación configurada',USER_ROLE:'Permisos actualizados',IMPORT_PREVIEW:'Importación en revisión',IMPORT_APPROVED:'Importación aprobada',IMPORT_REVERTED:'Importación revertida'};
  $('auditRows').innerHTML=state.audit.length?state.audit.slice(-100).reverse().map(e=>{
    const date=new Date(e.at),when=Number.isNaN(date.getTime())?'Fecha no disponible':date.toLocaleString('es-SV',{timeZone:'America/El_Salvador'});
    const user=displayName(state.actors?.find(u=>u.id===e.userId)?.name||'Personal autorizado'),detail=e.detail||{};
    let description='Cambio registrado';
    if(e.kind==='GRADE')description=`${detail.studentName?detail.studentName+' · ':''}${detail.subjectId?nameOf('subjects',detail.subjectId)+' · '+nameOf('sections',detail.sectionId)+' · período '+detail.periodId+' · ':''}${(detail.before||[]).map(v=>Genesis.formatGrade(v)).join(' / ')||'Sin notas'} → ${(detail.after||[]).map(v=>Genesis.formatGrade(v)).join(' / ')}`;
    else if(['GRADE_LOCK','GRADE_UNLOCK'].includes(e.kind)){const lock=detail.after;description=`${state.students.find(s=>s.id===lock.studentId)?.name||'Estudiante'} · ${nameOf('subjects',lock.subjectId)} · período ${lock.periodId} · ${lock.reason}`;}
    else if(e.kind==='EVALUATION_POLICY')description=`${nameOf('subjects',detail.after.subjectId)} · ${detail.after.count} notas · período ${detail.after.periodId} · ${detail.after.reason}`;
    else if(e.kind==='FRAME_CONFIG')description=detail.after.name;
    else if(['ASSIGN','REVOKE'].includes(e.kind))description=`${nameOf('subjects',detail.subjectId)} · ${nameOf('sections',detail.sectionId)}`;
    else if(['CLOSE','REOPEN'].includes(e.kind))description=`Período ${detail.periodId}${detail.reason?' · '+detail.reason:''}`;
    else if(e.kind==='POLICY')description=`${nameOf('subjects',detail.subjectId)} · ${(detail.weights||[]).map(w=>Number((w*100).toFixed(6))+' %').join(' / ')}`;
    else if(e.kind==='USER_ROLE')description=`${roleNames[detail.role]} · ${detail.active?'Activa':'Inactiva'}`;
    else if(e.kind==='CATALOG_CREATE')description=detail.record?.name||detail.record?.label||'Registro académico';
    else if(e.kind==='TEACHER_CREATE')description=displayName(state.actors?.find(u=>u.id===detail.id)?.name||'Docente registrado');
    else if(e.kind==='ENROLL'||e.kind==='ENROLLMENT_UPDATE'){const enrollment=detail.after||detail;description=`${state.students.find(s=>s.id===enrollment.studentId)?.name||'Estudiante'} · ${nameOf('sections',enrollment.sectionId)} · ${state.years.find(y=>y.id===enrollment.year)?.label||''}`;}
    else if(e.kind.startsWith('IMPORT_')){const batch=state.batches.find(b=>b.id===detail.batchId||b.id===detail.id),assignment=[...state.assignments,...state.assignmentHistory].find(a=>a.id===(batch?.assignmentId||detail.assignmentId));description=assignment?`${nameOf('subjects',assignment.subjectId)} · ${nameOf('sections',assignment.sectionId)} · período ${batch?.periodId||detail.periodId}${detail.count?' · '+detail.count+' notas':''}`:'Carga de notas';}
    else if(detail.after?.name)description=detail.after.name;
    return `<tr><td>${esc(when)}</td><td>${esc(user)}</td><td>${esc(names[e.kind]||({STUDENT_UPDATE:'Estudiante actualizado',TEACHER_UPDATE:'Docente actualizado',CATALOG_UPDATE:'Organización actualizada',ENROLLMENT_UPDATE:'Matrícula actualizada'}[e.kind])||'Registro actualizado')}</td><td>${esc(description)}</td></tr>`;
  }).join(''):'<tr><td colspan="4" class="empty-inline">Todavía no hay movimientos registrados.</td></tr>';
  const incidentNames={FORMULA_ERROR:'Error de cálculo en el archivo',CROSS_ROW_IF_REVIEW:'Revisar referencia de una fórmula',NUMERIC_NIE_REVIEW:'Revisar formato de NIE',EXCLUDED_FORM_RESPONSES:'Cuestionario excluido',MAPPING_REQUIRES_REVIEW:'Revisar columnas'};
  Object.assign(incidentNames,{ACADEMIC_RULES_REVIEW:'Regla académica pendiente de validación',MODULE_PERIOD_REVIEW:'Confirmar período del módulo',MODULE_TITLE_REVIEW:'Confirmar nombre del módulo',MULTIPLE_TEACHERS:'Conflicto entre docentes de una misma materia y sección',ENROLLMENT_REVIEW:'Confirmar matrícula del estudiante',SOURCE_GRADES_CONFLICT:'Notas diferentes en los archivos de origen',SOURCE_GRADE_REVIEW:'Revisar una nota de origen',PONDERATIONS_REVIEW:'Confirmar ponderaciones',SCHEME_REVIEW:'Confirmar esquema de evaluación',PERIOD_REVIEW:'Confirmar período',CROSS_ROW_REFERENCES:'Fórmula con referencia a otra fila'});
  Object.assign(incidentNames,{SUBJECT_MERGE_TEACHER_CONFLICT:'Confirmar docente tras unificar materias',SUBJECT_MERGE_GRADE_CONFLICT:'Conciliar notas diferentes tras unificar materias'});
  $('incidents').innerHTML=state.incidents.length?state.incidents.map(i=>`<div class="record-row"><div><strong>${esc(incidentNames[i.kind]||'Revisar cuadro de calificaciones')}</strong><small>${esc(i.subjectId?nameOf('subjects',i.subjectId):i.file)} · ${esc(i.sectionId?nameOf('sections',i.sectionId):i.sheet)} ${esc(i.cell)}${i.teacherIds?' · '+esc(i.teacherIds.map(id=>nameOf('teachers',id)).join(' / ')):''}</small></div><span class="pill closed">Por revisar</span></div>`).join(''):'<div class="empty-inline">Sin incidencias.</div>';
  const statusNames={REVIEW:'En revisión',IMPORTED:'Importada',REVERTED:'Revertida'};
  $('batches').innerHTML=state.batches.length?'<h3>Cargas registradas</h3>'+state.batches.map((b,i)=>`<div class="record-row"><div><strong>Solicitud ${i+1}</strong><small>${esc(statusNames[b.status]||'En revisión')}</small></div>${state.user.role==='ADMIN'&&b.status==='IMPORTED'?`<button class="danger" data-revert="${esc(b.id)}">Revertir carga</button>`:''}</div>`).join(''):'';
  editableOptions('batchId',state.batches.filter(b=>b.status==='REVIEW'),b=>{const a=state.assignments.find(a=>a.id===b.assignmentId);return a?`${nameOf('subjects',a.subjectId)} · ${nameOf('sections',a.sectionId)} · período ${b.periodId}`:'Asignación retirada';},'Seleccionar carga');
}
async function refresh(){
  state=await api('bootstrap');$('login').classList.add('hidden');$('workspace').classList.remove('hidden');
  $('identity').textContent=displayName(state.user.name);$('roleLabel').textContent=roleNames[state.user.role];$('switchAccount').classList.toggle('hidden',!local);
  $('addSubjectShortcut').classList.toggle('hidden',state.user.role!=='ADMIN');renderSubjectCatalog();
  $('navigation').innerHTML=allowedViews().map(view=>`<button type="button" data-nav="${view}" title="${viewNames[view]}" aria-label="${viewNames[view]}">${navigationIcon(view)}<span>${viewNames[view]}</span></button>`).join('');
  options('period',state.periods.filter(p=>p.year===(state.assignments.find(a=>a.id===selected)?.year||state.years[0]?.id)));
  for(const id of ['yearSelect','closeYear','enrollYear'])options(id,state.years,'label');
  options('closePeriod',state.periods.filter(p=>p.year===$('closeYear').value));
  options('teacherSelect',state.teachers.filter(t=>state.users.some(u=>u.id===t.id&&u.active&&u.role==='TEACHER')));
  options('sectionSelect',state.sections.map(s=>({...s,name:sectionLabel(s)})));options('enrollSection',state.sections.map(s=>({...s,name:sectionLabel(s)})));options('subjectSelect',state.subjects);filterPolicySubjects();
  $('assignments').innerHTML=state.assignments.length?state.assignments.map(a=>`<div class="record-row"><div><strong>${esc(nameOf('teachers',a.teacherId))}</strong><small>${esc(state.years.find(y=>y.id===a.year)?.label||a.year)} · ${esc(nameOf('sections',a.sectionId))} · ${esc(nameOf('subjects',a.subjectId))}</small></div><button class="danger" data-revoke="${esc(a.id)}" aria-label="Retirar ${esc(nameOf('subjects',a.subjectId)+' '+nameOf('sections',a.sectionId))}">Retirar</button></div>`).join(''):'<p class="empty-inline">Todavía no hay asignaciones activas.</p>';
  renderPeriods();renderAudit();renderAdministration();syncPolicy();syncPeriodAction();
  options('importGroup',state.assignments.map(a=>({...a,name:`${nameOf('subjects',a.subjectId)} · ${nameOf('sections',a.sectionId)} · ${state.years.find(y=>y.id===a.year)?.label||a.year}`})));syncImportPeriod();
  options('accessUser',state.users.filter(u=>u.active));$('accessForm').classList.toggle('hidden',!local||state.user.role!=='ADMIN');
  $('periodAdminSettings').classList.toggle('hidden',state.user.role!=='ADMIN');options('finalYear',state.years,'label');syncFinalPolicy();options('moduleAssignment',state.assignments.filter(a=>state.subjects.find(s=>s.id===a.subjectId)?.type==='MODULO_FASES').map(a=>({...a,name:`${nameOf('subjects',a.subjectId)} · ${nameOf('sections',a.sectionId)} · ${state.years.find(y=>y.id===a.year)?.label||a.year}`})));syncModuleSchedule();
  $('environmentInfo').textContent=local?'Instalación local privada. Acceso mediante usuario y contraseña. Las asignaciones de docentes requieren autorización de administración.':'Acceso institucional mediante la cuenta de Google verificada. Revisá las autorizaciones y respaldos antes de operar.';
  if(state.user.role!=='ADMIN')$('closeAction').querySelector('[value="open"]').disabled=true;
  else $('closeAction').querySelector('[value="open"]').disabled=false;
  await renderGroups();renderNotifications();if(typeof renderFunctional==='function')await renderFunctional();setView(currentView);
}
function formRows(){
  const rows=roster.students.map(s=>({studentId:s.id,values:s.values.slice()}));
  for(const input of $('gradeTable').querySelectorAll('input[data-row]')){const i=Number(input.dataset.row),j=Number(input.dataset.col),original=roster.students[i].values[j];rows[i].values[j]=input.value===Genesis.formatGrade(original,'')?original:input.value===''?null:Number(input.value);}
  return rows;
}
function filterStudents(){
  const query=$('studentSearch').value.trim().toLocaleLowerCase('es');let shown=0;
  $('gradeTable').querySelectorAll('tbody tr').forEach((row,i)=>{const student=roster.students[i];const matches=(student.name+' '+student.nie).toLocaleLowerCase('es').includes(query);row.classList.toggle('hidden',!matches);if(matches)shown++;});
  $('rosterCount').textContent=`${shown} de ${roster.students.length} ${roster.students.length===1?'estudiante':'estudiantes'}`;$('studentSearchEmpty').classList.toggle('hidden',shown>0);
}
function updateGradePreview(){
  const rows=formRows();dirty=rows.some((r,i)=>r.values.some((v,j)=>v!==roster.students[i].values[j]));
  $('saveState').textContent=dirty?'Cambios sin guardar · promedios en vista previa':roster.closed?'Este período está cerrado':'Notas guardadas';
  $('saveState').classList.toggle('unsaved',dirty);$('save').disabled=!dirty||roster.closed||state.user.role==='DIRECTION';
  $('gradeTable').querySelectorAll('tbody tr').forEach((tr,i)=>{
    const values=rows[i].values,valid=values.every(v=>v===null||(Number.isFinite(v)&&v>=0&&v<=10));let value=null;
    if(valid&&!roster.students[i].conflict)value=Genesis.evaluate(values,roster.evaluation).value;
    tr.querySelector('[data-result]').textContent=!valid?'Revisá la nota':Genesis.formatGrade(value);
    const changed=values.some((v,j)=>v!==roster.students[i].values[j]),annual=roster.students[i].annual;
    const periods=roster.students[i].periodResults.slice();periods[roster.periodIds.indexOf(loadedPeriod)]=value;
    const final=roster.subject.type==='GENERAL_4_PERIODOS'&&periods.length===4?Genesis.finalResult(periods,roster.finalPolicy):{sum:null,value:null,status:'SIN_CRITERIO'};
    tr.querySelector('[data-sum]').textContent=Genesis.formatGrade(final.sum);
    tr.querySelector('[data-annual]').textContent=Genesis.formatGrade(final.value,final.status==='SIN_CRITERIO'?'Por validar':'Pendiente');
    tr.querySelector('[data-status]').textContent=GenesisXlsx.statusText(final);
    tr.querySelector('[data-status]').dataset.result=tr.querySelector('[data-status]').textContent==='Aprobado'?'approved':tr.querySelector('[data-status]').textContent==='Reprobado'?'failed':'pending';
  });
  const missing=rows.reduce((n,r)=>n+r.values.filter(v=>v===null).length,0);$('missingNotice').classList.toggle('hidden',!missing);$('missingNotice').textContent=missing?`Faltan ${missing} notas. El período no podrá cerrarse hasta completarlas. El docente y administración tienen un aviso de pendientes.`:'';
  $('save').textContent=missing?'Guardar borrador':'Guardar notas';
  if(typeof updateIncoDerived==='function')updateIncoDerived(rows);
}
async function openGroup(id){
  const assignment=state.assignments.find(a=>a.id===id);if(!assignment)throw Error('La asignación ya no está disponible');options('period',state.periods.filter(p=>p.year===assignment.year));
  const requestedPeriod=$('period').value,nextRoster=await api('roster',{assignmentId:id,periodId:requestedPeriod});selected=id;roster=nextRoster;loadedPeriod=requestedPeriod;dirty=false;
  $('groupTitle').textContent=`${nameOf('sections',assignment.sectionId)} · ${Genesis.subjectTitle(roster.subject)}`;
  $('periodState').textContent=roster.closed?'Período cerrado':'Período abierto';$('periodState').className='pill'+(roster.closed?' closed':'');
  const modular=roster.subject.type==='MODULO_FASES',readonly=roster.closed||state.user.role==='DIRECTION';
  const labels=roster.evaluation.labels;
  $('rule').innerHTML=(modular?'<span class="pill">'+esc(roster.subject.moduleNumber?'Módulo '+roster.subject.moduleNumber:'Número de módulo pendiente')+'</span>':'')+(roster.evaluation.mode==='PHASES'?['Preparación','Ejecución','Evaluación']:labels).map((name,i)=>`<span class="pill neutral">${esc(name)} · ${Number((roster.weights[i]*100).toFixed(6))} %</span>`).join('');
  $('gradeTable').innerHTML='<thead><tr><th>Estudiante / NIE</th>'+labels.map(l=>`<th>${esc(l)}</th>`).join('')+`<th>Resultado del período</th><th>Suma de períodos</th><th>Nota final (${roster.finalPolicy?.method==='SUM_4'?'suma':'promedio'})</th><th>Resultado</th><th>Protección</th></tr></thead><tbody>`+roster.students.map((s,i)=>`<tr><td>${esc(s.name)}<small>NIE ${esc(s.nie)}</small></td>${s.values.map((v,j)=>`<td><input aria-label="${esc(s.name+' '+labels[j])}" type="number" min="0" max="10" step="any" data-row="${i}" data-col="${j}" value="${Genesis.formatGrade(v,'')}" ${readonly||s.locked||s.conflict?'disabled':''}></td>`).join('')}<td class="result" data-result></td><td data-sum></td><td data-annual></td><td data-status></td><td>${s.conflict?'<span class="pill closed">En revisión</span>':s.locked?'<span class="pill closed">Bloqueado</span><small>'+esc(s.lock.reason)+'</small>':'<span class="pill neutral">Sin bloqueo individual</span>'}${state.user.role==='ADMIN'?`<button type="button" class="secondary" data-grade-lock="${esc(s.id)}">${s.locked?'Desbloquear':'Bloquear'}</button>`:''}</td></tr>`).join('')+'</tbody>';
  if(typeof renderIncoGradeSheet==='function')await renderIncoGradeSheet();
  $('studentSearch').value='';filterStudents();updateGradePreview();
  setView(currentView);
}
async function mutate(action,params){if(dirty&&action!=='saveGrades')throw Error('Guardá las notas pendientes antes de continuar.');await api(action,{...params,version:state.version});await refresh();message('Cambios guardados.');}
function safe(fn){const handle=async event=>{
  if(event?.type==='submit')event.preventDefault();if(busy){if(event?.type==='change'){await pendingOperation;return handle(event);}return;}
  busy=true;let release;pendingOperation=new Promise(resolve=>{release=resolve;});const button=event?.target?.closest?.('button');button?.setAttribute('aria-busy','true');
  try{await fn(event);}catch(error){message(error.message,true);}finally{busy=false;button?.removeAttribute('aria-busy');release();}
};return handle;}
function syncImportPeriod(){const a=state.assignments.find(a=>a.id===$('importGroup').value);options('importPeriod',state.periods.filter(p=>p.year===a?.year));}
function clearImportReview(){importRowsData=[];$('importRowsPanel').classList.add('hidden');$('importConfirmed').checked=false;$('approveConfirmed').checked=false;$('stageImport').disabled=true;$('approve').disabled=true;if(preview&&!preview.template&&!$('batchId').value){$('importColumns').classList.remove('hidden');$('buildImportRows').classList.remove('hidden');}}
async function importGroupRoster(){if(!$('importGroup').value)throw Error('Seleccioná una materia asignada');return api('roster',{assignmentId:$('importGroup').value,periodId:$('importPeriod').value});}
function importLabels(){return importRoster?.evaluation.labels||[];}
function renderImportColumns(){
  clearImportReview();const block=preview?.blocks.find(b=>b.id===$('importBlock').value);if(!block)return;
  const available=block.columns||[...new Set((block.rows||[]).flatMap(r=>r.cells?.map(c=>c.cell.replace(/\d+/g,''))||[]))].map(column=>({column,label:''}));
  const direct=available.filter(({column})=>block.rows?.some(r=>r.cells?.some(c=>c.cell.replace(/\d+/g,'')===column&&!c.formula&&!c.error)));
  $('importColumns').innerHTML=importLabels().map((label,i)=>`<label>${esc(label)}<select data-import-column="${i}"><option value="">Seleccionar columna</option>${available.map(c=>`<option value="${esc(c.column)}" ${direct[i]?.column===c.column?'selected':''}>Columna ${esc(c.column)}${c.label?' · '+esc(c.label):''}</option>`).join('')}</select></label>`).join('');
  $('importColumns').classList.remove('hidden');$('buildImportRows').classList.remove('hidden');
}
function updateImportActions(){
  const checked=[...$('importRows').querySelectorAll('input[data-include]:checked')].length>0;
  $('stageImport').disabled=!preview||!$('importConfirmed').checked||!checked||!!$('batchId').value;
  $('approve').disabled=state.user.role!=='ADMIN'||!$('batchId').value||!$('approveConfirmed').checked||!checked;
}
function reviewedRows(){
  const output=[];for(const checkbox of $('importRows').querySelectorAll('input[data-include]:checked')){
    const i=Number(checkbox.dataset.include),row=importRowsData[i],inputs=[...checkbox.closest('tr').querySelectorAll('[data-import-note]')];
    if(inputs.some(input=>!input.checkValidity()))throw Error('Revisá las notas seleccionadas');
    output.push({...row,values:inputs.map((input,j)=>input.value===Genesis.formatGrade(row.values[j],'')?row.values[j]:input.value===''?null:Number(input.value))});
  }if(!output.length)throw Error('Seleccioná al menos un estudiante sin conflictos');return output;
}
async function renderImportRows(rows){
  const check=await api('checkImport',{assignmentId:$('importGroup').value,periodId:$('importPeriod').value,rows,template:preview?.template});importRowsData=rows;
  $('importRows').innerHTML='<thead><tr><th>Incluir</th><th>Estudiante / NIE</th>'+importLabels().map(label=>`<th>${esc(label)}</th>`).join('')+'<th>Revisión</th></tr></thead><tbody>'+rows.map((r,i)=>{
    const issues=check.rows[i].issues,blocked=issues.length>0;
    return `<tr><td><input type="checkbox" data-include="${i}" aria-label="Incluir ${esc(r.nie)}" ${blocked?'disabled':'checked'}></td><td>${esc(check.rows[i].name||'Revisar matrícula')}<small>NIE ${esc(r.nie)}</small></td>${r.values.map((v,j)=>`<td><input type="number" min="0" max="10" step="any" data-import-note="${j}" aria-label="${esc(r.nie+' '+importLabels()[j])}" value="${Genesis.formatGrade(v,'')}" ${blocked?'disabled':''}></td>`).join('')}<td>${blocked?esc(issues.join(' · ')):'Sin conflictos'}</td></tr>`;
  }).join('')+'</tbody>';$('importMapping').classList.remove('hidden');$('importRowsPanel').classList.remove('hidden');$('importConfirmed').checked=false;$('approveConfirmed').checked=false;updateImportActions();
}
async function loadPendingBatch(){
  clearImportReview();const batch=state.batches.find(b=>b.id===$('batchId').value);if(!batch)return;
  if(!state.assignments.some(a=>a.id===batch.assignmentId))throw Error('La asignación de esta carga fue retirada');
  $('importGroup').value=batch.assignmentId;syncImportPeriod();$('importPeriod').value=batch.periodId;importRoster=await importGroupRoster();
  preview=batch.template?{template:batch.template,blocks:[{id:batch.blockId,directRows:batch.reviewRows}]}:null;if(!batch.reviewRows){message('Seleccioná el archivo y revisá sus columnas antes de aprobar esta carga.',true);return;}
  $('importColumns').classList.add('hidden');$('buildImportRows').classList.add('hidden');await renderImportRows(batch.reviewRows);
}

$('loginForm').onsubmit=safe(async event=>{
 const response=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:JSON.stringify({username:$('username').value,password:$('password').value})});
 const result=await response.json();if(!response.ok)throw Error(result.error);$('password').value='';currentView='overview';selected=null;await refresh();
});
$('accessForm').onsubmit=safe(async()=>{const response=await fetch('/access-account',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:JSON.stringify({userId:$('accessUser').value,username:$('accessUsername').value,password:$('accessPassword').value,version:state.version})});const result=await response.json();if(!response.ok)throw Error(result.error);$('accessPassword').value='';if($('accessUser').value===state.user.id){dirty=false;location.reload();return;}await refresh();message('Acceso guardado.');});
$('reviewRosters').onclick=safe(async()=>{let data;if(!local){data=await api('rosterReview');}else{const response=await fetch('/roster-review',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:'{}'});data=await response.json();if(!response.ok)throw Error(data.error);}$('rosterPending').innerHTML=data.rows.length?'<p class="info">Confirmá el nombre y la sección antes de matricular estos alumnos.</p>'+data.rows.map(r=>'<div class="record-row"><div><strong>NIE '+esc(r.nie)+'</strong>'+r.choices.map(c=>'<small>'+esc(c.name)+' · '+esc(c.section)+'</small>').join('')+'</div></div>').join(''):'<p>Sin pendientes.</p>';});
$('switchAccount').onclick=safe(async()=>{if(canDiscard()){await fetch('/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:'{}'});dirty=false;location.reload();}});
$('navigation').onclick=event=>{const view=event.target.closest('[data-nav]')?.dataset.nav;if(view)setView(view);};
document.querySelector('.brand').onclick=event=>{event.preventDefault();if(state)setView('overview');};
$('refresh').onclick=safe(()=>canDiscard()&&refresh());
$('period').onchange=safe(async()=>{if(selected){if(canDiscard())await openGroup(selected);else $('period').value=loadedPeriod;}});
$('assignmentForm').onsubmit=safe(async event=>{const p=Object.fromEntries(new FormData(event.target));if($('assignmentRecord').value){if(!window.confirm('¿Modificar esta asignación? Los accesos del docente cambiarán y se conservarán las notas anteriores.'))return;p.assignmentId=$('assignmentRecord').value;}await mutate('assign',p);$('assignmentRecord').value='';});
$('assignmentRecord').onchange=syncAssignment;
$('teacherForm').onsubmit=safe(async event=>{const p=Object.fromEntries(new FormData(event.target));if($('teacherRecord').value)p.teacherId=$('teacherRecord').value;await mutate('teacher',p);});
$('teacherRecord').onchange=syncTeacher;
$('catalogForm').onsubmit=safe(async event=>{const p=Object.fromEntries(new FormData(event.target));p.recordId=$('catalogRecord').value;await mutate(p.recordId?'updateCatalog':'catalog',p);});
$('catalogEntity').onchange=()=>{$('catalogRecord').value='';syncCatalog();};$('catalogRecord').onchange=syncCatalog;
$('enrollForm').onsubmit=safe(async event=>{await mutate('enroll',Object.fromEntries(new FormData(event.target)));});
$('studentSelect').onchange=syncStudent;
$('saveStudent').onclick=safe(()=>mutate('student',{studentId:$('studentSelect').value,nie:$('enrollForm').elements.nie.value,name:$('enrollForm').elements.name.value}));
$('enrollmentRows').onclick=event=>{const id=event.target.closest('[data-student]')?.dataset.student;if(id){$('studentSelect').value=id;syncStudent();$('enrollForm').scrollIntoView({behavior:'smooth'});}};
$('enrollmentSearch').oninput=renderEnrollments;
$('enrollmentSectionFilter').onchange=renderEnrollments;
$('enrollmentEditForm').onsubmit=safe(()=>mutate('updateEnrollment',{enrollmentId:$('enrollmentRecord').value,sectionId:$('enrollmentSection').value}));
$('closeYear').onchange=()=>{options('closePeriod',state.periods.filter(p=>p.year===$('closeYear').value));syncPeriodAction();};$('closePeriod').onchange=syncPeriodAction;
$('closeAction').onchange=syncPeriodAction;
$('policySubject').onchange=syncPolicy;[0,1,2].forEach(i=>$('weight'+i).oninput=updateWeightTotal);
$('policySubjectSearch').oninput=filterPolicySubjects;
$('enablePolicy').onclick=()=>{editingPolicy=true;$('policyWeights').disabled=false;$('policyDecimals').disabled=true;$('policyReason').disabled=false;$('policyReason').closest('label').classList.remove('hidden');$('configurePolicy').classList.remove('hidden');$('enablePolicy').classList.add('hidden');updateWeightTotal();$('weight0').focus();};
$('policyForm').onsubmit=safe(async event=>{
  event.preventDefault();if(!updateWeightTotal())throw Error('Los porcentajes deben sumar 100 %.');
  const p=Object.fromEntries(new FormData(event.target));p.weights=[0,1,2].map(i=>Number(p['weight'+i])/100);p.decimals=1;await mutate('policy',p);
});
$('assignments').onclick=safe(async event=>{const id=event.target.closest('[data-revoke]')?.dataset.revoke;if(id&&window.confirm('¿Retirar esta asignación? El docente perderá el acceso; las notas se conservarán.'))await mutate('revoke',{assignmentId:id});});
$('periodForm').onsubmit=safe(async event=>{const p=Object.fromEntries(new FormData(event.target));p.closed=p.operation==='close';if(!window.confirm(p.closed?'¿Cerrar este período? Se bloqueará el registro de notas.':'¿Reabrir este período con el motivo indicado?'))return;await mutate('period',p);});
$('gradeTable').oninput=updateGradePreview;$('studentSearch').oninput=filterStudents;
$('gradeTable').onkeydown=event=>{
  const input=event.target.closest('input[data-row]');if(!input||!['Enter','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const visible=[...$('gradeTable').querySelectorAll('tbody tr:not(.hidden)')],row=input.closest('tr'),next=visible[visible.indexOf(row)+(event.key==='ArrowUp'||event.shiftKey?-1:1)];next?.querySelector(`[data-col="${input.dataset.col}"]`)?.focus();
};
$('gradeTable').onpaste=event=>{
  const input=event.target.closest('input[data-row]'),text=event.clipboardData?.getData('text');if(!input||input.disabled||!text||!/[\t\n]/.test(text))return;event.preventDefault();
  try{const matrix=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(line=>line.split('\t')),visible=[...$('gradeTable').querySelectorAll('tbody tr:not(.hidden)')],start=visible.indexOf(input.closest('tr')),changes=[];
    matrix.forEach((line,i)=>line.forEach((text,j)=>{const target=visible[start+i]?.querySelector(`[data-col="${Number(input.dataset.col)+j}"]`),clean=text.trim().replace(',','.'),value=clean===''?null:Number(clean);if(!target||target.disabled||value!==null&&(!Number.isFinite(value)||value<0||value>10))throw Error('Revisá el rango y las notas que querés pegar');changes.push({target,value});}));changes.forEach(({target,value})=>{target.value=value===null?'':value;});updateGradePreview();
  }catch(error){message(error.message,true);}
};
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&currentView==='overview'&&selected){event.preventDefault();if(!$('save').disabled)$('save').click();}});
$('save').onclick=safe(async()=>{
  for(const input of $('gradeTable').querySelectorAll('input'))if(!input.checkValidity())throw Error('Revisá las notas: deben estar entre 0 y 10.');
  const rows=formRows().filter((r,i)=>r.values.some((v,j)=>v!==roster.students[i].values[j]));if(!rows.length)return;const clearing=rows.some(r=>{const old=roster.students.find(s=>s.id===r.studentId);return old.values.some((v,i)=>v!==null&&r.values[i]===null);});let reason;if(clearing){if(!window.confirm('¿Vaciar notas ya guardadas? Esta corrección quedará auditada.'))return;reason=window.prompt('Motivo de la corrección (al menos 10 caracteres):');if(!reason||reason.trim().length<10)throw Error('Se requiere un motivo de al menos 10 caracteres.');}await mutate('saveGrades',{assignmentId:selected,periodId:$('period').value,rows,...(clearing?{confirmClear:true,reason}:{})});
});
$('exportJson').onclick=safe(async()=>{const data=await api('export',{assignmentId:selected,periodId:$('period').value});const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download='genesis-grupo-autorizado.json';a.click();URL.revokeObjectURL(url);message('Se exportaron las notas guardadas de este grupo.');});
$('importGroup').onchange=safe(async()=>{syncImportPeriod();clearImportReview();$('batchId').value='';importRoster=await importGroupRoster();if(preview?.template)await renderImportRows(preview.blocks?.[0]?.directRows||[]);else if(preview?.template)await renderImportRows(preview.blocks?.[0]?.directRows||[]);else if(preview)renderImportColumns();});$('importPeriod').onchange=safe(async()=>{clearImportReview();$('batchId').value='';importRoster=await importGroupRoster();if(preview)renderImportColumns();});
$('importFile').onchange=safe(async event=>{
  clearImportReview();preview=null;$('previewInfo').textContent='';const file=event.target.files[0];if(!file)return;if(file.size>6000000)throw Error('El archivo supera el tamaño permitido');importRoster=await importGroupRoster();if(importRoster.closed)throw Error('El período está cerrado');let candidate;
  if(/\.xlsx$/i.test(file.name)){
    if(await prepareCompatibleXlsx(file))return;
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    if(!local){candidate=await api('xlsxPreview',{name:file.name,content:btoa(binary),assignmentId:$('importGroup').value,periodId:$('importPeriod').value});}else{const response=await fetch('/xlsx-preview',{method:'POST',headers:{'Content-Type':'application/json','X-Genesis-Local':LOCAL_TOKEN},body:JSON.stringify({name:file.name,content:btoa(binary),assignmentId:$('importGroup').value,periodId:$('importPeriod').value})});candidate=await response.json();if(!response.ok)throw Error(candidate.error);}
  }else{try{candidate=JSON.parse(await file.text());}catch{throw Error('No se pudo leer el archivo de calificaciones');}}
  if(Array.isArray(candidate)){
    if(!candidate.every(r=>typeof r.nie==='string'&&Array.isArray(r.values)&&r.source))throw Error('El archivo de notas revisadas está incompleto');await renderImportRows(candidate);$('previewInfo').textContent=`${candidate.length} estudiantes`;return;
  }
  if(candidate.schema!=='GENESIS_PREVIEW_V1'||!Array.isArray(candidate.blocks)||!candidate.blocks.length)throw Error('No se encontraron cuadros de calificaciones');
  preview=candidate;options('importBlock',preview.blocks.map((b,i)=>{const count=b.studentRowCount??b.rows?.length??0;return {...b,name:`${b.sheet||'Cuadro'} · ${i+1} · ${count} ${count===1?'estudiante':'estudiantes'}${b.visibility==='hidden'?' · hoja oculta':''}`};}));
  $('previewInfo').innerHTML=`<div class="info">${preview.blocks.length} ${preview.blocks.length===1?'cuadro encontrado':'cuadros encontrados'}${preview.incidents?.length?' · '+preview.incidents.length+(preview.incidents.length===1?' advertencia':' advertencias'):''}</div>`;$('importMapping').classList.remove('hidden');renderImportColumns();
});
$('importBlock').onchange=renderImportColumns;
$('buildImportRows').onclick=safe(async()=>{
  const block=preview?.blocks.find(b=>b.id===$('importBlock').value);if(!block?.rows?.length)throw Error('El archivo no incluye filas para revisar');
  const columns=[...$('importColumns').querySelectorAll('select')].map(select=>select.value);if(columns.some(v=>!v)||new Set(columns).size!==columns.length)throw Error('Seleccioná una columna distinta para cada componente');
  if(block.type&&block.type!==importRoster.subject.type)throw Error('El tipo de evaluación del cuadro no coincide con la materia');
  const rows=block.rows.map(r=>{const values=columns.map(column=>{const c=r.cells?.find(c=>c.cell.replace(/\d+/g,'')===column);if(c?.formula||c?.error)throw Error('Una columna contiene cálculos o errores. Seleccioná las notas originales');if(!c||c.value===null)return null;if(typeof c.value!=='number')throw Error('Una columna contiene texto en lugar de notas');return c.value;});return {nie:r.nie,values,source:{file:preview.file,sheet:block.sheet,block:block.id,range:r.source?.range||`${block.anchor}:${block.endRow}`,cell:r.nieCell||r.source?.cell||block.anchor}};});
  await renderImportRows(rows);
});
$('importRows').oninput=()=>{$('importConfirmed').checked=false;$('approveConfirmed').checked=false;updateImportActions();};$('importRows').onchange=updateImportActions;
$('importConfirmed').onchange=updateImportActions;$('approveConfirmed').onchange=updateImportActions;$('batchId').onchange=safe(loadPendingBatch);
$('stageImport').onclick=safe(async()=>{
  if(!$('importConfirmed').checked)throw Error('Confirmá la revisión de la carga');const rows=reviewedRows();
  const metadata={schema:preview.schema,hash:preview.hash,file:preview.file,blocks:preview.blocks.map(({id,sheet,type})=>({id,sheet,type})),incidents:preview.incidents||[]};
  await mutate('importPreview',{assignmentId:$('importGroup').value,periodId:$('importPeriod').value,preview:metadata,template:preview.template,blockId:$('importBlock').value,rows});clearImportReview();
});
$('approve').onclick=safe(async()=>{if(!$('approveConfirmed').checked)throw Error('Confirmá la carga de notas');if(!window.confirm('¿Importar las notas seleccionadas? No se reemplazarán notas existentes.'))return;await mutate('approveImport',{batchId:$('batchId').value,rows:reviewedRows()});clearImportReview();});
$('batches').onclick=safe(async event=>{const id=event.target.closest('[data-revert]')?.dataset.revert;if(id&&window.confirm('¿Revertir esta carga? Se retirarán las notas importadas que no tengan cambios posteriores.')){await mutate('revertImport',{batchId:id});clearImportReview();}});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
// Refresh in-app notices without replacing drafts or advancing the version used for writes.
setInterval(async()=>{if(!state||busy||document.hidden)return;try{const latest=await api('bootstrap');state.notifications=latest.notifications;renderNotifications();syncPeriodAction();if(typeof refreshVisibleAcademicDocument==='function')await refreshVisibleAcademicDocument(latest.version);}catch{/* A failed refresh must not discard a draft. */}},30000);
if(local){$('loginForm').classList.remove('hidden');$('googleAccess').classList.add('hidden');}else{safe(()=>GoogleLogin.initialize())();}

function syncGoogleAccount(){const record=state?.users.find(user=>user.id===$('googleAccountUser').value);$('googleAccountEmail').value=record?.email||'';$('googleAccountRole').value=record?.role||'TEACHER';$('googleAccountActive').checked=record?.active??true;$('googleAccountConfirmed').checked=record?.googleIdentity?.status==='CONFIRMED';$('googleAccountStatus').textContent=$('googleAccountConfirmed').checked?'Correo de Google confirmado por administración.':'Identidad pendiente: esta cuenta no puede acceder mediante Google.';}
$('googleAccountUser').onchange=syncGoogleAccount;
$('googleAccounts').onsubmit=safe(async()=>{if(local)throw Error('Esta gestión requiere el acceso institucional de Google');await mutate('googleAccount',{userId:$('googleAccountUser').value,email:$('googleAccountEmail').value,role:$('googleAccountRole').value,active:$('googleAccountActive').checked,confirmed:$('googleAccountConfirmed').checked});});
