import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {unzip,workbook,normalize} from './xlsx.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const family=name=>{const n=normalize(name);return /REMED/.test(n)?'REMEDIACION':/SOCIAL(?!ES)/.test(n)?'SERVICIO_SOCIAL':/CONDUCTA/.test(n)?'CONDUCTA':/COMP[EO]T/.test(n)?'COMPETENCIAS':/MODULO/.test(n)?'MODULO_FASES':'GENERAL_4_PERIODOS';};
export function inspectBook(buffer,file,{privateRows=false}={}){
  const digest=hash(buffer),sheets=workbook(buffer), blocks=[],incidents=[];
  const inventory=sheets.map(sheet=>{
    const excluded=normalize(sheet.name)==='RESPUESTAS DE FORMULARIO 1';
    const headers=sheet.cells.filter(c=>normalize(c.value)==='NIE'),phases=sheet.cells.filter(c=>normalize(c.value)==='PREPARACION');
    const errors=sheet.cells.filter(c=>c.error),anomalies=sheet.cells.filter(c=>c.formula&&/IF\(/i.test(c.formula)&&[...c.formula.matchAll(/\b[A-Z]+(\d+)\b/g)].some(m=>Number(m[1])<c.row));
    errors.forEach(c=>incidents.push({file,sheet:sheet.name,cell:c.cell,kind:'FORMULA_ERROR',error:c.value}));
    anomalies.forEach(c=>incidents.push({file,sheet:sheet.name,cell:c.cell,kind:'CROSS_ROW_IF_REVIEW'}));
    if(excluded){incidents.push({file,sheet:sheet.name,kind:'EXCLUDED_FORM_RESPONSES'});}
    else headers.forEach((h,i)=>{
      const right=headers.filter(x=>x.row===h.row&&x.col>h.col).sort((a,b)=>a.col-b.col)[0],endCol=right?right.col-1:Infinity;
      const next=headers.filter(x=>x.row>h.row&&x.col>=h.col&&x.col<=endCol).sort((a,b)=>a.row-b.row)[0];
      const end=next?next.row-1:Math.max(...sheet.cells.map(c=>c.row));
      const blockCells=sheet.cells.filter(c=>c.row>=h.row&&c.row<=end&&c.col>=h.col&&c.col<=endCol), lastCol=Math.max(...blockCells.map(c=>c.col));
      const names=sheet.cells.filter(c=>c.row>=h.row-2&&c.row<=h.row+2&&c.col>=h.col&&c.col<=endCol&&/APELLIDOS|NOMBRES/.test(normalize(c.value)));
      const associatedPhases=phases.filter(p=>p.row>=h.row-6&&p.row<=h.row+2&&p.col>=h.col&&p.col<=endCol),type=associatedPhases.length?'MODULO_FASES':family(sheet.name);
      const rows=sheet.cells.filter(c=>c.col===h.col&&c.row>h.row&&c.row<=end&&c.value!==null&&/^\d+$/.test(String(c.value)));
      const blockId=`${digest.slice(0,12)}-${blocks.length+1}`;
      const rowMap=new Map();if(privateRows)for(const c of blockCells){if(!rowMap.has(c.row))rowMap.set(c.row,[]);rowMap.get(c.row).push(c);}
      const candidates=rows.map(c=>{
        const row=privateRows?rowMap.get(c.row):[];
        // Raw cells remain local/private. Formula caches never become approved grades.
        return {nie:String(c.value),nieCell:c.cell,nieWasNumeric:typeof c.value==='number',source:{file,sheet:sheet.name,block:blockId,range:`${h.cell}:${blockCells.at(-1)?.cell||h.cell}`,cell:c.cell,batch:digest},cells:row.filter(x=>x.col>Math.max(h.col,...names.map(n=>n.col))).map(x=>({cell:x.cell,value:x.value,formula:x.formula,error:x.error}))};
      });
      const section=normalize(sheet.name).match(/(?:^|\s)([123])\s*[°º]?\s*([A-Z])(?:\b|\s|-)/);
      const b={id:blockId,file,sheet:sheet.name,visibility:sheet.visibility,anchor:h.cell,endRow:end,lastCol,type,sectionCandidate:section?section[1]+section[2]:null,status:'REQUIRES_REVIEW',studentRowCount:rows.length,phaseAnchors:associatedPhases.map(p=>p.cell),reason:'Confirmar sección, asignatura/módulo, período y columnas; nunca aprobar por título solamente.'};
      if(privateRows)b.columns=[...new Set(candidates.flatMap(r=>r.cells.map(c=>c.cell.replace(/\d+/g,''))))].map(column=>({column,label:sheet.cells.filter(c=>c.cell.replace(/\d+/g,'')===column&&c.row>=h.row-3&&c.row<=h.row&&typeof c.value==='string').map(c=>c.value).join(' · ').slice(0,100)}));
      if(privateRows)b.rows=candidates;
      if(candidates.some(c=>c.nieWasNumeric))incidents.push({file,sheet:sheet.name,block:blockId,kind:'NUMERIC_NIE_REVIEW',message:'El origen es numérico; los ceros perdidos no se pueden reconstruir con seguridad.'});
      if(new Set(candidates.map(c=>c.nie)).size<candidates.length)incidents.push({file,sheet:sheet.name,block:blockId,kind:'DUPLICATE_NIE_REVIEW'});
      blocks.push(b);
    });
    return {name:sheet.name,visibility:sheet.visibility,type:family(sheet.name),excluded,headers:headers.length,phases:phases.length,formulas:sheet.cells.filter(c=>c.formula!==null).length,errors:errors.length};
  });
  return {schema:'GENESIS_PREVIEW_V1',hash:digest,status:'REQUIRES_REVIEW',file,inventory,blocks,incidents};
}
export function auditZip(buffer){
  const books=[];for(const [file,b]of unzip(buffer))if(/\.xlsx$/i.test(file))books.push(inspectBook(b,file));
  const sheets=books.flatMap(b=>b.inventory);
  return {schema:'GENESIS_AUDIT_V1',sourceHash:hash(buffer),summary:{books:books.length,sheets:sheets.length,hidden:sheets.filter(s=>s.visibility!=='visible').length,formulas:sheets.reduce((n,s)=>n+s.formulas,0),nieHeaders:sheets.reduce((n,s)=>n+s.headers,0),multiHeaderSheets:sheets.filter(s=>s.headers>1).length,preparationAnchors:sheets.reduce((n,s)=>n+s.phases,0),moduleSheets:sheets.filter(s=>s.phases>0).length,multiModuleSheets:sheets.filter(s=>s.phases>1).length,errors:sheets.reduce((n,s)=>n+s.errors,0),excluded:sheets.filter(s=>s.excluded).length},books};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [mode,input,output]=process.argv.slice(2);
  try{
    if(!['audit','preview'].includes(mode)||!input)throw Error('Uso: node tools/importer.mjs audit archivo.zip [salida.json] | preview archivo.xlsx data/privado/preview.json');
    if(mode==='preview'&&(!output||!path.resolve(output).startsWith(path.resolve('data/privado')+path.sep)))throw Error('La previsualización con datos debe guardarse dentro de data/privado/');
    const b=fs.readFileSync(input),result=mode==='audit'?auditZip(b):inspectBook(b,path.basename(input),{privateRows:true});
    const destination=output||'docs/auditoria-plantillas.json';fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(result,null,2));
    console.log(JSON.stringify(mode==='audit'?result.summary:{blocks:result.blocks.length,status:result.status}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
