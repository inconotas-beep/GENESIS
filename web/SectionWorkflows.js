/* Section workbooks, saved report composition and selected-student printing. */
let sectionImportReview=null,reportSubjectContext=null,reportOutputSubjectRequest=0;
const sectionFilename=(prefix,context,ext)=>[prefix,context.section?.name||context.sectionId,context.periodId||'anual'].map(part=>String(part||'').replace(/[^\p{L}\p{N}_.-]+/gu,'-')).join('-')+'.'+ext;
function workbookContext(fromImport=false){
  if(fromImport)return {year:$('sectionImportYear').value,sectionId:$('sectionImportSection').value,periodId:$('sectionImportPeriod').value};
  const {year,sectionId,periodId}=documentParams();
  return {year,sectionId,periodId};
}
async function exportSectionWorkbook(fromImport=false,blank=false){
  const context=workbookContext(fromImport);
  if(!context.year||!context.sectionId||!context.periodId)throw Error('Seleccioná el año, la sección y un período para el Excel.');
  const book=await api('sectionWorkbook',context);
  downloadWorkbook(GenesisXlsx.sectionSheets(book,blank),sectionFilename(blank?'plantilla-seccion':'notas-seccion',book,'xlsx'));
}
function clearSectionImport(){
  sectionImportReview=null;
  $('sectionImportResults').replaceChildren();
  $('sectionImportCommit').disabled=true;
}
function fillSectionImportPeriods(){
  options('sectionImportPeriod',state.periods.filter(p=>p.year===$('sectionImportYear').value));
  clearSectionImport();
}
function syncSectionWorkflows(){
  const admin=state.user.role==='ADMIN';
  $('sectionImportPanel').classList.toggle('hidden',!admin);
  $('reportSubjectEditor').classList.toggle('hidden',!admin);
  if(!admin){clearSectionImport();return;}
  options('sectionImportYear',state.years,'label');
  editableOptions('sectionImportSection',state.sections,sectionLabel,'Seleccionar sección');
  fillSectionImportPeriods();
}
function clearReportSubjectEditor(){
  reportSubjectContext=null;
  $('reportSubjectOptions').replaceChildren();
  $('saveReportSubjects').disabled=true;
  $('resetReportSubjects').disabled=true;
}
function updateReportStudentActions(students){
  const checked=new Set([...$('reportBatchStudents').querySelectorAll('input:checked')].map(input=>input.value));
  $('reportBatchStudents').innerHTML=students.map(s=>`<label class="checkbox-field"><input type="checkbox" value="${esc(s.id)}" ${checked.has(s.id)?'checked':''}><span>${esc(s.name)} <small>${esc(s.nie)}</small></span></label>`).join('');
  $('reportBatch').classList.toggle('hidden',!students.length);
  $('downloadReportPdf').disabled=!$('reportStudent').value;
  syncSelectedPrint();
}
function syncSelectedPrint(){
  const count=$('reportBatchStudents').querySelectorAll('input:checked').length;
  $('printSelectedReports').disabled=!count;
  $('reportBatchCount').textContent=count?count+' seleccionados':'Elegí a los estudiantes que necesitás imprimir.';
}
function renderSectionImportReview(review){
  const result=$('sectionImportResults');
  result.innerHTML=`<p class="info">${review.additions} registros nuevos · ${review.unchanged} sin cambios · ${review.errors} filas con conflictos</p>`+
    review.groups.map(group=>`<details class="subpanel" ${group.rows.some(row=>row.issues.length)?'open':''}><summary>${esc(group.subject)} · ${group.rows.length} estudiantes</summary><div class="scroll" tabindex="0"><table><thead><tr><th>Fila</th><th>NIE</th><th>Estudiante</th><th>Calificaciones</th><th>Validación</th></tr></thead><tbody>${group.rows.map(row=>`<tr><td>${esc(row.rowNumber)}</td><td>${esc(row.nie)}</td><td>${esc(row.name)}</td><td>${esc(row.values?.map(value=>Genesis.formatGrade(value,'—')).join(' · '))}</td><td>${esc(row.issues.join(' · ')||(row.status==='UNCHANGED'?'Sin cambios':'Nota nueva'))}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
  $('sectionImportCommit').disabled=!!review.errors||!review.additions;
}
$('documentSectionExcel').onclick=safe(()=>exportSectionWorkbook());
$('sectionImportTemplate').onclick=safe(()=>exportSectionWorkbook(true,true));
$('sectionImportYear').onchange=fillSectionImportPeriods;
for(const id of ['sectionImportSection','sectionImportPeriod','sectionImportFile'])$(id).onchange=clearSectionImport;
$('sectionImportForm').onsubmit=safe(async()=>{
  clearSectionImport();
  const context=workbookContext(true),file=$('sectionImportFile').files[0];
  if(!context.year||!context.sectionId||!context.periodId)throw Error('Seleccioná año, sección y período.');
  if(!file||!/\.xlsx$/i.test(file.name)||file.size>6000000)throw Error('Seleccioná un archivo XLSX de hasta 6 MB.');
  const buffer=await file.arrayBuffer(),workbook=GenesisXlsx.sectionTemplate(await GenesisXlsx.read(buffer));
  if(Object.keys(context).some(key=>workbook[key]!==context[key]))throw Error('El libro corresponde a otro año, sección o período.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const params={...workbook,file:file.name,hash};
  const review=await api('checkSectionImport',params);
  if($('sectionImportFile').files[0]!==file||JSON.stringify(workbookContext(true))!==JSON.stringify(context))return;
  sectionImportReview={params,version:review.version};renderSectionImportReview(review);
});
$('sectionImportCommit').onclick=safe(async()=>{
  const review=sectionImportReview;
  if(!review)throw Error('Revisá el archivo antes de importar.');
  if(dirty)throw Error('Guardá primero las notas pendientes.');
  if(!window.confirm('¿Importar las notas nuevas de esta sección?'))return;
  await api('importSectionWorkbook',{...review.params,version:review.version});
  clearSectionImport();$('sectionImportFile').value='';await refresh();
  message('Notas nuevas importadas. La carga quedó registrada en auditoría.');
});
$('loadReportSubjects').onclick=safe(async()=>{
  clearReportSubjectEditor();
  const context=workbookContext();
  if(!context.year||!context.sectionId||!context.periodId)throw Error('Elegí un período para configurar sus materias y módulos.');
  const options=await api('reportOptions',context);
  if(JSON.stringify(workbookContext())!==JSON.stringify(context))return;
  reportSubjectContext=context;
  $('reportSubjectOptions').innerHTML=options.subjects.map(({subject,included})=>`<label class="checkbox-field"><input type="checkbox" value="${esc(subject.id)}" ${included?'checked':''}><span>${esc(subjectTitle(subject))} <small>${esc(categoryLabel(subject))}</small></span></label>`).join('')||'<p class="empty-inline">Esta sección no tiene asignaturas registradas.</p>';
  $('saveReportSubjects').disabled=!options.subjects.length;$('resetReportSubjects').disabled=!options.configured;
});
async function saveReportSubjectSelection(subjectIds){
  if(!reportSubjectContext)throw Error('Cargá primero las asignaturas del período.');
  await mutate('reportSubjects',{...reportSubjectContext,subjectIds});
}
$('reportSubjectForm').onsubmit=safe(()=>saveReportSubjectSelection([...$('reportSubjectOptions').querySelectorAll('input:checked')].map(input=>input.value)));
$('resetReportSubjects').onclick=safe(()=>saveReportSubjectSelection(null));
$('reportStudent').onchange=()=>{$('downloadReportPdf').disabled=!$('reportStudent').value;};
$('reportBatchStudents').onchange=syncSelectedPrint;
function clearReportOutputSubjects(){
  reportOutputSubjectRequest++;
  $('reportOutputSubjects').open=false;
  $('reportOutputSubjectList').replaceChildren();
  $('restoreReportOutputSubjects').disabled=true;
}
function reportOutputContext(){return {...documentParams(),allSubjects:true,reportLayout:true};}
function excludedReportSubjects(){return [...$('reportOutputSubjectList').querySelectorAll('input:not(:checked)')].map(input=>input.value);}
function filterReportOutput(report){
  const excluded=new Set(excludedReportSubjects());
  if(!excluded.size)return report;
  const included=entry=>!excluded.has(entry.subject.id);
  return {...report,columns:report.columns.filter(included),students:report.students.map(student=>({...student,entries:student.entries.filter(included)}))};
}
function updateReportOutputSelection(){
  $('restoreReportOutputSubjects').disabled=!excludedReportSubjects().length;
  if(academicDocument?.kind==='reportCard')renderAcademicDocument();
}
const loadReportOutputSubjects=safe(async()=>{
  const list=$('reportOutputSubjectList');
  if(!$('reportOutputSubjects').open||list.querySelector('input'))return;
  const params=reportOutputContext();
  if(!params.year||!params.sectionId){list.textContent='Seleccioná el año y la sección.';return;}
  const request=++reportOutputSubjectRequest;
  list.textContent='Cargando materias y módulos…';
  let result;
  try{result=await api('reportOptions',{...params,forOutput:true});}
  catch(error){if(request!==reportOutputSubjectRequest)return;list.textContent='Cerrá y volvé a abrir la lista para intentar de nuevo.';throw error;}
  if(request!==reportOutputSubjectRequest)return;
  const choices=result.subjects.filter(subject=>!params.periodId||Genesis.categoryOf(subject)==='TECHNICAL'||
    (params.sectionId==='3D'&&['Inglés Técnico','Emprendedurismo'].includes(subject.name)));
  list.innerHTML=choices.map(subject=>`<label class="checkbox-field"><input type="checkbox" value="${esc(subject.id)}" checked><span>${esc(subjectTitle(subject))} <small>${esc(categoryLabel(subject))}</small></span></label>`).join('')||'<p class="empty-inline">No hay materias o módulos para elegir en esta selección.</p>';
});
$('reportOutputSubjects').ontoggle=async()=>{
  if(!$('reportOutputSubjects').open)return;
  if(busy)await pendingOperation;
  await loadReportOutputSubjects();
};
$('reportOutputSubjectList').onchange=updateReportOutputSelection;
$('restoreReportOutputSubjects').onclick=()=>{
  for(const input of $('reportOutputSubjectList').querySelectorAll('input'))input.checked=true;
  updateReportOutputSelection();
};
async function sectionReport(kind,extra={}){
  if(dirty)throw Error('Guardá las notas antes de generar las boletas.');
  const params=reportOutputContext(),selection=JSON.stringify([params,excludedReportSubjects()]);
  const report=await api(kind,{...params,...extra});
  if(JSON.stringify([reportOutputContext(),excludedReportSubjects()])!==selection)throw Error('La selección cambió. Volvé a generar las boletas.');
  const result=filterReportOutput(report);
  if(!result.students.length)throw Error('No hay estudiantes para generar boletas.');
  if(!result.columns.length)throw Error('No hay asignaturas seleccionadas para estas boletas.');
  return result;
}
async function printSectionReports(studentIds){
  const popup=openIncoPrint();
  try{
    const report=await sectionReport('sectionReportCards',studentIds?{studentIds}:{});
    writeIncoPrint(popup,IncoFormats.reportPages(report,incoPrintOptions()));
  }catch(error){popup.close();throw error;}
}
$('printAllReports').onclick=safe(()=>printSectionReports());
$('printSelectedReports').onclick=safe(()=>{
  const studentIds=[...$('reportBatchStudents').querySelectorAll('input:checked')].map(input=>input.value);
  if(!studentIds.length)throw Error('Seleccioná al menos un estudiante.');
  return printSectionReports(studentIds);
});
$('downloadReportPdf').onclick=safe(async()=>{
  const studentId=$('reportStudent').value;
  if(!studentId)throw Error('Seleccioná un estudiante.');
  const report=await sectionReport('reportCard',{studentId});
  const blob=await createReportPdf(report,incoPrintOptions());
  downloadAcademic(blob,'boleta-'+String(report.students[0].nie).replace(/\D/g,'')+'.pdf');
});
