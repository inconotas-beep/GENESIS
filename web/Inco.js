/* Reference formats reuse the existing authorized API and grade-save controls. */
let incoWorkbook=null;
function incoLogo(){return document.querySelector('.brand-logo').src;}
function incoPrintOptions(){return {logo:incoLogo(),lion:$('incoLionAsset').src,director:$('reportDirector').value,registrar:$('reportRegistrar').value};}
async function renderIncoGradeSheet(){
 const id=selected,periodId=loadedPeriod,owner=state.user.id;
 incoWorkbook=null;
 const result=await api('teacherWorkbook',{assignmentId:id});
 if(selected!==id||loadedPeriod!==periodId||state.user.id!==owner)return;
 if(result.version!==roster.version)throw Error('Las notas cambiaron al cargar el cuadro. Volvé a consultar el grupo.');
 incoWorkbook=result;$('incoSheetHeader').innerHTML=IncoFormats.sheetHeader(result,incoLogo());
 $('gradeTable').innerHTML=IncoFormats.sheetTable(result,roster,{editable:true,role:state.user.role});
 $('incoSheetTabs').innerHTML=state.assignments.filter(a=>a.year===result.assignment.year&&(state.user.role!=='TEACHER'||a.teacherId===state.user.id)).map(a=>`<button type="button" class="secondary" data-inco-assignment="${esc(a.id)}" aria-current="${a.id===id?'true':'false'}">${esc(nameOf('sections',a.sectionId))} · ${esc(nameOf('subjects',a.subjectId))}</button>`).join('');
 $('incoActivePeriod').textContent='Se edita '+(state.periods.find(p=>p.id===periodId&&p.year===result.assignment.year)?.name||periodId)+'. Los demás períodos muestran las notas guardadas. Cambiá de período con Editar.';
}
function updateIncoDerived(rows){
 if(!incoWorkbook)return;
 $('gradeTable').querySelectorAll('tbody tr').forEach((tr,i)=>{
  if(roster.evaluation.mode==='PHASES'){
   for(const td of tr.querySelectorAll('[data-inco-phase]')){
    const values=rows[i].values,valid=values.every(v=>v===null||Number.isFinite(v)&&v>=0&&v<=10);
    const result=valid&&!roster.students[i].conflict?IncoFormats.phase(values,roster.weights,Number(td.dataset.incoPhase)):{};
    td.textContent=Genesis.formatGrade(result[td.dataset.incoCalculation==='phaseAverage'?'average':'weighted'],'—');
   }
  }
  if(roster.subject.type==='MODULO_FASES'){
   tr.querySelector('[data-annual]').textContent=tr.querySelector('[data-result]').textContent;
   tr.querySelector('[data-status]').textContent=roster.students[i].conflict?'En revisión':'—';
  }
 });
}
$('gradeTable').addEventListener('click',event=>{const button=event.target.closest('[data-inco-period]');if(!button||button.disabled||busy)return;$('period').value=button.dataset.incoPeriod;$('period').dispatchEvent(new Event('change'));});
async function selectIncoAssignment(id){
 const a=state.assignments.find(a=>a.id===id);if(!a)throw Error('La asignación ya no está disponible');
 const section=state.sections.find(s=>s.id===a.sectionId),gradeOf=s=>s.grade||s.name.match(/^([123])/)?.[1]||'otros';
 $('browseYear').value=a.year;
 const sections=state.sections.filter(s=>state.user.role!=='TEACHER'||state.assignments.some(a=>a.year===$('browseYear').value&&a.sectionId===s.id));
 options('browseGrade',[...new Set(sections.map(gradeOf))].sort().map(id=>({id,name:id==='otros'?'Otros':id+'.º año'})));$('browseGrade').value=gradeOf(section);
 options('browseSection',sections.filter(s=>gradeOf(s)===gradeOf(section)).map(s=>({...s,name:sectionLabel(s)})));$('browseSection').value=section.id;
 const subjects=new Set(state.assignments.filter(x=>x.year===a.year&&x.sectionId===a.sectionId).map(x=>x.subjectId));
 options('browseSubject',state.subjects.filter(s=>subjects.has(s.id)));$('browseSubject').value=a.subjectId;
 await renderSelection();
}
$('incoSheetTabs').onclick=safe(async event=>{const button=event.target.closest('[data-inco-assignment]');if(button&&canDiscard())await selectIncoAssignment(button.dataset.incoAssignment);});
function openIncoPrint(){const popup=window.open('','_blank');if(!popup)throw Error('Permití la ventana de impresión del navegador.');popup.opener=null;popup.document.write('<!doctype html><html lang="es"><title>GENESIS · Impresión</title><p>Preparando el documento…</p></html>');popup.document.close();return popup;}
function writeIncoPrint(popup,body,landscape=false){
 const styles=[...document.querySelectorAll('style[data-inco-format],link[href*="print-formats.css"]')].map(el=>el.tagName==='LINK'?`<link rel="stylesheet" href="${esc(el.href)}">`:el.outerHTML).join('');
 popup.document.open();popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>GENESIS · ${landscape?'Cuadro docente':'Boletas'}</title>${styles}<style>@page{size:letter ${landscape?'landscape':'portrait'};margin:12mm}body{background:#eef1ee}.inco-print-actions button{padding:12px 20px}</style></head><body class="inco-print"><div class="inco-print-actions"><button id="incoPrintNow">Imprimir o guardar PDF</button><button id="incoPrintClose">Cerrar</button></div>${body}</body></html>`);popup.document.close();
 const ready=async()=>{await Promise.all([...popup.document.images].map(img=>img.decode().catch(()=>{})));await popup.document.fonts.ready;popup.document.getElementById('incoPrintNow').onclick=()=>popup.print();popup.document.getElementById('incoPrintClose').onclick=()=>popup.close();popup.focus();popup.print();};
 if(popup.document.readyState==='complete')ready();else popup.onload=ready;
}
$('printGradeSheet').onclick=safe(async()=>{
 if(!selected)return;if(dirty)throw Error('Guardá las notas antes de imprimir el cuadro.');const popup=openIncoPrint();
 try{
  const workbook=await api('teacherWorkbook',{assignmentId:selected}),active=workbook.periods.find(p=>p.id===loadedPeriod)?.roster;if(!active)throw Error('Período no disponible');
  const pages=[];for(let i=0;i<active.students.length;i+=24){const students=active.students.slice(i,i+24);pages.push('<article class="inco-print-sheet">'+IncoFormats.sheetHeader(workbook,incoLogo())+'<table class="inco-sheet-table">'+IncoFormats.sheetTable(workbook,active,{students})+'</table></article>');}
  if(!pages.length)throw Error('La sección no tiene estudiantes matriculados');writeIncoPrint(popup,pages.join(''),true);
 }catch(error){popup.close();throw error;}
});
$('printAllReports').onclick=safe(async()=>{
 if(dirty)throw Error('Guardá las notas antes de generar las boletas.');const popup=openIncoPrint();
 try{const result=await fetchAcademicDocument('consolidated',documentParams());if(!result||!result.students.length)throw Error('No hay estudiantes para imprimir');writeIncoPrint(popup,IncoFormats.reportPages(result,incoPrintOptions()));}catch(error){popup.close();throw error;}
});
for(const id of ['reportDirector','reportRegistrar'])$(id).oninput=()=>{if(academicDocument?.kind==='reportCard')renderAcademicDocument();};
