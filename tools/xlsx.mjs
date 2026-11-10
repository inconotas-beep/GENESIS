// Read-only ZIP/XLSX reader for the local importer. No extraction to disk, no formula execution.
import {inflateRawSync} from 'node:zlib';
export function unzip(buffer){
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw Error('ZIP inválido');
  const count=buffer.readUInt16LE(end+10);let pos=buffer.readUInt32LE(end+16);const result=new Map();let total=0;
  for(let i=0;i<count;i++){
    if(buffer.readUInt32LE(pos)!==0x02014b50)throw Error('Directorio ZIP inválido');
    const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),size=buffer.readUInt32LE(pos+20),expanded=buffer.readUInt32LE(pos+24),n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),offset=buffer.readUInt32LE(pos+42);
    if(flags&1||expanded>100000000||(total+=expanded)>400000000)throw Error('ZIP cifrado o excede límite de seguridad');
    const name=buffer.subarray(pos+46,pos+46+n).toString('utf8');pos+=46+n+extra+comment;
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28),payload=buffer.subarray(start,start+size);
    const data=method===0?payload:method===8?inflateRawSync(payload,{maxOutputLength:100000000}):null;if(!data)throw Error('Compresión ZIP no soportada');
    if(data.length!==expanded)throw Error('Tamaño ZIP inconsistente');result.set(name,data);
  }return result;
}
export const decode=s=>s.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,named)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[named]));
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const texts=s=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
export const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
export const colNumber=s=>[...s].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);
export function colLetters(value){let result='';for(let n=value;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
export function shiftFormula(formula,dc,dr){
  return formula.split(/("(?:[^"]|"")*")/).map((part,i)=>i%2?part:part.replace(/(?<![A-Z0-9_])(\$?)([A-Z]{1,3})(\$?)(\d+)\b/g,(match,ac,col,ar,row)=>`${ac}${colLetters(colNumber(col)+(ac?0:dc))}${ar}${Number(row)+(ar?0:dr)}`)).join('');
}
export function workbook(buffer){
  const zip=unzip(buffer), get=p=>zip.get(p)?.toString('utf8')||'';
  const strings=[...get('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
  const styleXml=get('xl/styles.xml'),customFormats=new Map([...styleXml.matchAll(/<numFmt\b([^>]*?)\/?\s*>/g)].map(m=>{const a=attrs(m[1]);return [a.numFmtId,a.formatCode];})),styleFormats=[...(styleXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1]||'').matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map(m=>attrs(m[1]).numFmtId||'0');
  const rels=new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(m=>{const a=attrs(m[1]);return [a.Id,a.Target];}));
  return [...get('xl/workbook.xml').matchAll(/<sheet\b([^>]*?)\/?\s*>/g)].map(m=>{
    const a=attrs(m[1]),target=rels.get(a['r:id']);if(!target)throw Error('Relación de hoja inválida');
    const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
    const cells=[];
    for(const c of get(path).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const ca=attrs(c[1]),body=c[2]||'',v=body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1],f=body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1];
      let value=ca.t==='s'?strings[Number(v)]:ca.t==='inlineStr'?texts(body):v===undefined?null:ca.t==='e'||ca.t==='str'?decode(v):Number(v);
      const address=ca.r?.match(/^([A-Z]+)(\d+)$/);if(!address)continue;
      const formulaTag=body.match(/<f\b([^>]*?)(?:\/>|>)/),meta=formulaTag?attrs(formulaTag[1]):null;
      const formatId=styleFormats[Number(ca.s||0)]||'0',numberFormat=customFormats.get(formatId)||({'0':'General','1':'0','2':'0.00','9':'0%','10':'0.00%'}[formatId])||`builtin-${formatId}`;
      cells.push({cell:ca.r,col:colNumber(address[1]),row:Number(address[2]),value,numberFormat,formula:f===undefined?(/<f\b[^>]*\/>/.test(body)?'[SHARED_FORMULA_REQUIRES_REVIEW]':null):decode(f),formulaMeta:meta,error:ca.t==='e'});
    }
    const shared=new Map(cells.filter(c=>c.formulaMeta?.t==='shared'&&c.formula!=='[SHARED_FORMULA_REQUIRES_REVIEW]').map(c=>[c.formulaMeta.si,c]));
    for(const c of cells)if(c.formula==='[SHARED_FORMULA_REQUIRES_REVIEW]'){const base=shared.get(c.formulaMeta?.si);if(base){c.formula=shiftFormula(base.formula,c.col-base.col,c.row-base.row);c.sharedFrom=base.cell;}}
    return {name:a.name,visibility:a.state||'visible',cells};
  });
}
