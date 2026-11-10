/* Small, dependency-free OOXML interchange. Runs in the browser in local and Apps Script UI. */
var GenesisXlsx = (()=>{
  const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const decode=value=>value.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,name)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]));
  const utf8=value=>new TextEncoder().encode(value),text=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const attrs=value=>Object.fromEntries([...value.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
  const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const crcTable=Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=n&1?0xEDB88320^(n>>>1):n>>>1;return n>>>0;});
  const crc=bytes=>{let value=0xFFFFFFFF;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xFFFFFFFF)>>>0;};
  function join(parts){const output=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output;}
  function zip(files){
    const local=[],central=[];let offset=0;
    for(const [name,value]of Object.entries(files)){
      const filename=utf8(name),data=utf8(value),checksum=crc(data),header=new Uint8Array(30+filename.length),h=new DataView(header.buffer);
      h.setUint32(0,0x04034B50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,checksum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,filename.length,true);header.set(filename,30);
      const record=new Uint8Array(46+filename.length),r=new DataView(record.buffer);r.setUint32(0,0x02014B50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(8,0x800,true);r.setUint16(14,33,true);r.setUint32(16,checksum,true);r.setUint32(20,data.length,true);r.setUint32(24,data.length,true);r.setUint16(28,filename.length,true);r.setUint32(42,offset,true);record.set(filename,46);
      local.push(header,data);central.push(record);offset+=header.length+data.length;
    }
    const directory=join(central),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054B50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
    return join([...local,directory,end]);
  }
  function sheetXml(rows){
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="100" width="22" customWidth="1"/></cols><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{const ref=col(j)+(i+1);if(value===null||value===undefined)return `<c r="${ref}" s="1"/>`;if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Número inválido en exportación');return `<c r="${ref}" s="${i===0?2:1}"><v>${value}</v></c>`;}return `<c r="${ref}" t="inlineStr" s="${i===0?2:0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData></worksheet>`;
  }
  function write(sheets){
    if(!Array.isArray(sheets)||!sheets.length||sheets.length>100)throw Error('Hojas de exportación inválidas');
    const ns='http://schemas.openxmlformats.org/',files={};
    const names=new Set();for(const sheet of sheets){if(!sheet.name||sheet.name.length>31||/[\\/*?:\[\]]/.test(sheet.name)||names.has(sheet.name))throw Error('Nombre de hoja inválido');names.add(sheet.name);}
    files['[Content_Types].xml']=`<?xml version="1.0"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    files['_rels/.rels']=`<?xml version="1.0"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    files['xl/workbook.xml']=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"${s.hidden?' state="hidden"':''}/>`).join('')}</sheets></workbook>`;
    files['xl/_rels/workbook.xml.rels']=`<?xml version="1.0"?><Relationships xmlns="${ns}package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    files['xl/styles.xml']=`<?xml version="1.0"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF34443D"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFF8FAF7"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF104D35"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    sheets.forEach((sheet,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(sheet.rows));return zip(files);
  }
  async function inflateRaw(bytes,limit){
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('XLSX expandido supera el límite');chunks.push(value);}}finally{await reader.cancel();}return join(chunks);
  }
  async function unzip(input,inflate=inflateRaw){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>6000000)throw Error('El archivo supera el tamaño permitido');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054B50){end=i;break;}
    if(end<0)throw Error('No es un archivo XLSX válido');
    const count=view.getUint16(end+10,true);if(count>512||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('Libro demasiado complejo o ZIP incompatible');
    const files=new Map();let at=view.getUint32(end+16,true),total=0;
    for(let i=0;i<count;i++){
      if(at+46>bytes.length||view.getUint32(at,true)!==0x02014B50)throw Error('Directorio XLSX inválido');
      const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),checksum=view.getUint32(at+16,true),size=view.getUint32(at+20,true),expanded=view.getUint32(at+24,true),length=view.getUint16(at+28,true),offset=view.getUint32(at+42,true);
      if(flags&1||expanded>16000000||(total+=expanded)>32000000||![0,8].includes(method))throw Error('XLSX cifrado, incompatible o demasiado grande');
      const name=text(bytes.subarray(at+46,at+46+length));if(files.has(name)||name.includes('..')||name.startsWith('/'))throw Error('Ruta XLSX inválida');
      at+=46+length+view.getUint16(at+30,true)+view.getUint16(at+32,true);
      if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034B50)throw Error('Entrada XLSX inválida');
      const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);if(start+size>bytes.length)throw Error('XLSX truncado');
      const payload=bytes.subarray(start,start+size),data=method===0?payload:await inflate(payload,expanded);
      if(data.length!==expanded||crc(data)!==checksum)throw Error('Contenido XLSX dañado');files.set(name,/\.(xml|rels)$/i.test(name)?text(data):'');
    }return files;
  }
  async function read(input,inflate){
    const files=await unzip(input,inflate),get=name=>files.get(name)||'';
    for(const value of files.values())if(/<!DOCTYPE|<!ENTITY/i.test(value))throw Error('XML no permitido');
    const texts=value=>[...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
    const strings=[...get('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
    const rels=new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(m=>{const a=attrs(m[1]);if(a.TargetMode==='External')throw Error('Relaciones externas no admitidas');return [a.Id,a.Target];}));
    return [...get('xl/workbook.xml').matchAll(/<sheet\b([^>]*?)\/?\s*>/g)].map(m=>{
      const a=attrs(m[1]),target=rels.get(a['r:id']);if(!target)throw Error('Hoja sin relación válida');
      const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(path.includes('..'))throw Error('Relación de hoja inválida');
      const cells=[];for(const match of get(path).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const ca=attrs(match[1]),body=match[2]||'',v=body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1],position=ca.r?.match(/^([A-Z]+)(\d+)$/);if(!position)continue;
        const value=ca.t==='inlineStr'?texts(body):ca.t==='s'?strings[Number(v)]:v===undefined?null:['str','e','b'].includes(ca.t)?decode(v):Number(v);
        cells.push({cell:ca.r,column:position[1],row:Number(position[2]),value,formula:/<f\b/.test(body),error:ca.t==='e'});
      }return {name:a.name,cells};
    });
  }
  const statusText=final=>({APROBADO:'Aprobado',REPROBADO:'Reprobado',PENDIENTE:'Pendiente',SIN_CRITERIO:'Criterio pendiente'}[final?.status]||'Pendiente');
  function groupSheets(roster,assignment,blank=false){
    const metadata={schema:'GENESIS_TEMPLATE_V1',assignmentId:assignment.id,teacherId:assignment.teacherId,year:assignment.year,sectionId:assignment.sectionId,subjectId:assignment.subjectId,periodId:roster.periodId,evaluation:{mode:roster.evaluation.mode,count:roster.evaluation.count,weights:roster.evaluation.weights,labels:roster.evaluation.labels}};
    const headers=['NIE','Estudiante',...roster.evaluation.labels,'Resultado del período','Estado'];
    return [{name:'Cuadro docente',rows:[headers,...roster.students.map(s=>[s.nie,s.name,...s.values.map(v=>blank?null:v),blank?null:s.result.value,s.locked?'Bloqueado':s.conflict?'En revisión':roster.closed?'Período cerrado':'Abierto'])]},{name:'Contexto',rows:[['Dato','Valor'],['Asignatura',roster.subject.name],['Número de módulo',roster.subject.type==='MODULO_FASES'?(roster.subject.moduleNumber||'Pendiente de registrar'):'No aplica'],['Año lectivo',assignment.year],['Sección',assignment.sectionId],['Período',roster.periodId],['Uso','Solo se importan notas originales. No editar NIE ni el contexto. Los vacíos quedan pendientes; 0.0 es válido.']]},{name:'_GENESIS',hidden:true,rows:[['Clave','Valor'],['metadata',JSON.stringify(metadata)]]}];
  }
  function documentSheets(document){
    const subjectLabel=subject=>subject.displayName||(subject.moduleNumber?'Módulo '+subject.moduleNumber+' · ':'')+subject.name;const headers=['NIE','Estudiante'];for(const c of document.columns){for(const p of c.periods)headers.push(`${subjectLabel(c.subject)} · ${p.name}`);headers.push(`${subjectLabel(c.subject)} · Final`,`${subjectLabel(c.subject)} · Resultado`);}
    const rows=[headers,...document.students.map(s=>[s.nie,s.name,...s.entries.flatMap(e=>[...e.periods.map(p=>p.value),e.final.value,statusText(e.final)])])];
    const notes=[['NIE','Estudiante','Asignatura','Número de módulo','Período','Evaluación','Nota','Componente ponderado','Ponderación (%)','Resultado del período','Bloqueo individual','Conciliación']];
    for(const student of document.students)for(const entry of student.entries)for(const period of entry.periods)for(const [i,value]of period.values.entries()){
      const evaluation=period.evaluation,phased=evaluation?.mode==='PHASES',component=phased?Math.floor(i/3):i;
      const label=evaluation?.labels?.[i]||`Nota ${i+1}`,weighted=phased?label.split(' · ')[0]:label;
      notes.push([student.nie,student.name,subjectLabel(entry.subject),entry.subject.moduleNumber||'',period.name,label,value,weighted,evaluation?.weights?.[component]===undefined?null:evaluation.weights[component]*100,period.value,period.locked?'Sí':'No',period.conflict?'En revisión':'']);
    }
    return [{name:document.kind==='reportCard'?'Boleta':'Consolidado',rows},{name:'Calificaciones',rows:notes},{name:'Contexto',rows:[['Dato','Valor'],['Año lectivo',document.year.label],['Sección',document.section.name],['Especialidad',document.specialty?.name||'Sin especialidad configurada'],['Cuadro',document.frame?.name||'Todos'],['Formato solicitado',document.frame?.formatSlot?'Formato '+document.frame.formatSlot+' · plantilla oficial pendiente':'Sin formato oficial seleccionado'],['Alcance',document.notice],['Ponderación por fases','En módulos por fases, el porcentaje corresponde al promedio de las tres evaluaciones de la fase; no a cada nota individual.']]}];
  }
  function template(sheets,file){
    const metadataSheet=sheets.find(s=>s.name==='_GENESIS');if(!metadataSheet)return null;
    const raw=metadataSheet.cells.find(c=>c.cell==='B2');if(raw?.formula||typeof raw?.value!=='string')throw Error('Contexto de plantilla inválido');let metadata;try{metadata=JSON.parse(raw.value);}catch{throw Error('Contexto de plantilla inválido');}
    if(metadata.schema!=='GENESIS_TEMPLATE_V1'||!Number.isInteger(metadata.evaluation?.count)||metadata.evaluation.count<1||metadata.evaluation.count>9)throw Error('Versión o configuración de plantilla inválida');
    const sheet=sheets.find(s=>s.name==='Cuadro docente');if(!sheet)throw Error('Falta el cuadro docente');
    const cells=new Map(sheet.cells.map(c=>[c.cell,c])),rowNumbers=[...new Set(sheet.cells.filter(c=>c.row>1).map(c=>c.row))],rows=[];
    const headers=['NIE','Estudiante',...(metadata.evaluation.labels||[])];if(headers.length!==metadata.evaluation.count+2||headers.some((label,i)=>cells.get(col(i)+'1')?.value!==label||cells.get(col(i)+'1')?.formula))throw Error('Los encabezados o el orden de las notas fueron modificados');
    for(const row of rowNumbers){const nie=cells.get('A'+row),values=Array.from({length:metadata.evaluation.count},(_,i)=>{const c=cells.get(col(i+2)+row);if(c?.formula||c?.error)throw Error('Las notas no pueden contener fórmulas o errores');if(c?.value===null||c===undefined)return null;if(typeof c.value!=='number'||!Number.isFinite(c.value)||c.value<0||c.value>10)throw Error('Nota inválida en '+c.cell);return c.value;});
      if(values.every(v=>v===null))continue;
      if(nie?.formula||typeof nie?.value!=='string'||!/^\d{1,20}$/.test(nie.value))throw Error('El NIE debe conservarse como texto, incluyendo sus ceros iniciales');
      rows.push({nie:nie.value,values,source:{file,sheet:sheet.name,block:'GENESIS_TEMPLATE_V1',range:`A${row}:${col(metadata.evaluation.count+3)}${row}`,cell:'A'+row}});
    }if(!rows.length)throw Error('La plantilla no contiene notas para revisar');if(rows.length>200)throw Error('La plantilla supera los 200 estudiantes permitidos');return {metadata,rows};
  }
  return {MIME,write,read,template,groupSheets,documentSheets,statusText};
})();
if(typeof module!=='undefined')module.exports=GenesisXlsx;
