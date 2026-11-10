import {parseFormula,sumTerms,rangeCells} from './formula-check.mjs';
import {normalize,colNumber} from './xlsx.mjs';
export function weightedComponents(sheet,issues=[]){
 const cells=new Map(sheet.cells.map(c=>[c.cell,c])),cache=new Map();
 function ast(formula){if(!cache.has(formula)){try{cache.set(formula,parseFormula(formula));}catch{cache.set(formula,null);}}return cache.get(formula);}
 function expand(node,depth=0){if(depth>6)return null;return node?.ref&&cells.get(node.ref)?.formula?expand(ast(cells.get(node.ref).formula),depth+1):node;}
 function group(node){node=expand(node);if(node?.op!=='*')return null;const coefficient='value'in node.left?node.left:node.right,source=expand(coefficient===node.left?node.right:node.left);if(!('value'in coefficient)||!source)return null;
  if(source.ref&&!cells.get(source.ref)?.formula)return {weight:coefficient.value,refs:[source.ref],type:'GENERAL_4_PERIODOS'};
  if(source.call==='AVERAGE'){const refs=source.args.flatMap(n=>n.range?rangeCells(n.range):n.ref?[n.ref]:[]);if(refs.length===3&&refs.every(r=>!cells.get(r)?.formula))return {weight:coefficient.value,refs,type:'MODULO_FASES'};}return null;
 }
 const out=[];for(const cell of sheet.cells){if(!cell.formula||cell.error)continue;const root=ast(cell.formula);if(!root)continue;const groups=sumTerms(root).map(group);if(groups.length!==3||!groups.every(Boolean))continue;
  const type=groups[0].type,expected=type==='MODULO_FASES'?[.25,.5,.25]:[.35,.35,.3];if(!groups.every((g,i)=>g.type===type&&Math.abs(g.weight-expected[i])<1e-10)){issues.push({cell:cell.cell,reason:'PONDERATIONS_REVIEW'});continue;}
  const refs=groups.flatMap(g=>g.refs);if(new Set(refs).size!==refs.length||refs.some(r=>Number(r.match(/\d+/)[0])!==cell.row)){issues.push({cell:cell.cell,reason:'CROSS_ROW_REFERENCES'});continue;}
  const values=refs.map(ref=>cells.get(ref)?.value??null);if(refs.some(r=>cells.get(r)?.error)||values.some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0||v>10))){issues.push({cell:cell.cell,reason:'SOURCE_GRADE_REVIEW'});continue;}
  out.push({row:cell.row,col:cell.col,cell:cell.cell,type,refs,values,formula:cell.formula,firstCol:Math.min(...refs.map(r=>colNumber(r.match(/[A-Z]+/)[0])))});
 }return out;
}
export function periodNumber(value){const n=normalize(value);if(!/PERIODO/.test(n))return null;const digit=n.match(/PERIODO\s*(?:N[°ºO.]?\s*)?([1-4])\b|\b([1-4])\s*[°ºO.]?\s*PERIODO/);if(digit)return digit[1]||digit[2];const words={PRIMER:'1',PRIMERO:'1',SEGUNDO:'2',TERCER:'3',TERCERO:'3',CUARTO:'4'};for(const [word,id]of Object.entries(words))if(n.includes(word))return id;return null;}
export function periodForComponent(component,labels){
 const matches=labels.filter(c=>c.col>=component.firstCol-1&&c.col<=component.col&&periodNumber(c.value));const ids=new Set(matches.map(c=>periodNumber(c.value)));return ids.size===1?[...ids][0]:null;
}
export function moduleMetadata(labels,cells){
 const markers=labels.filter(c=>/^MODULO\s*:?$/.test(normalize(c.value))).sort((a,b)=>b.row-a.row);
 let titles=[],headerRow;
 if(markers.length){const marker=markers[0];headerRow=marker.row;titles=labels.filter(c=>c.row===marker.row&&c.col>marker.col&&c.col<marker.col+10&&/^\d+(?:\.\d+)+\s+\S/.test(String(c.value))).map(c=>String(c.value).trim());}
 else{const explicit=labels.filter(c=>/MODULO\s*(?:N[°ºO.]?\s*)?\d|^MODULO\s*:/.test(normalize(c.value))&&!/NOMBRE DEL MODULO/.test(normalize(c.value))).sort((a,b)=>b.row-a.row);if(explicit.length){headerRow=explicit[0].row;titles=explicit.filter(c=>c.row===headerRow).map(c=>String(c.value).trim());}}
 const distinct=[...new Set(titles.map(normalize))],periods=new Set(labels.filter(c=>c.row===headerRow).map(c=>periodNumber(c.value)).filter(Boolean));
 for(const label of labels.filter(c=>c.row===headerRow&&/^PERIODO\s*:?$/.test(normalize(c.value)))){const adjacent=cells.filter(c=>c.row===headerRow&&c.col>label.col&&c.col<=label.col+2&&c.value!==null).sort((a,b)=>a.col-b.col)[0];if(adjacent&&/^[1-4]$/.test(String(adjacent.value).trim()))periods.add(String(adjacent.value).trim());}
 return {title:distinct.length===1?titles[0]:null,period:periods.size===1?[...periods][0]:null};
}
