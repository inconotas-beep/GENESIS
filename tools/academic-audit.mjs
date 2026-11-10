import fs from 'node:fs';
import crypto from 'node:crypto';
import {unzip,workbook,normalize} from './xlsx.mjs';
import {parseFormula,evaluate,rangeCells,sumTerms} from './formula-check.mjs';
import G from './core.mjs';
const findings={general:[],module:[],annual:[],rounding:[],special:[],alerts:[]},counts={formulas:0,parsed:0,notCovered:0},cache=new Map(),displayFormats={};
const cases={general:[[8,9,10],[0,0,0],[3.333,6.666,9.999]],module:[[6,8,10,9,9,9,6,6,6],Array(9).fill(0),[1.1,2.2,3.3,4.4,5.5,6.6,7.7,8.8,9.9]],annual:[[8,9,10,7],[0,0,0,0],[3.333,6.666,9.999,4.444]]};
let comparisons=0;const differences=[],source=fs.readFileSync('NOTAS PROFESORES.zip');
for(const [file,buffer]of unzip(source))if(/\.xlsx$/i.test(file)){
  for(const sheet of workbook(buffer)){
    const cells=new Map(sheet.cells.map(c=>[c.cell,c]));
    const parse=expression=>{if(!cache.has(expression)){try{cache.set(expression,parseFormula(expression));}catch{cache.set(expression,null);}}return cache.get(expression);};
    const resolveNode=(node,depth=0)=>{if(depth>5)return node;return node.ref&&cells.get(node.ref)?.formula?resolveNode(parse(cells.get(node.ref).formula)||node,depth+1):node;};
    function group(term){
      term=resolveNode(term);if(term.op!=='*')return null;
      const coefficient='value'in term.left?term.left:term.right,source=coefficient===term.left?term.right:term.left;
      if(!('value'in coefficient))return null;
      const expanded=resolveNode(source);
      if(expanded.ref&&!cells.get(expanded.ref)?.formula)return {weight:coefficient.value,refs:[expanded.ref],kind:'general'};
      if(expanded.call==='AVERAGE'){const refs=expanded.args.flatMap(n=>n.range?rangeCells(n.range):n.ref?[n.ref]:[]);if(refs.length===3&&refs.every(ref=>!cells.get(ref)?.formula))return {weight:coefficient.value,refs,kind:'module'};}
      return null;
    }
    for(const c of sheet.cells)if(c.formula!==null){
      counts.formulas++;displayFormats[c.numberFormat]=(displayFormats[c.numberFormat]||0)+1;const ast=parse(c.formula);if(!ast){counts.notCovered++;continue;}counts.parsed++;
      if(/ROUND\(/i.test(c.formula))findings.rounding.push({file,sheet:sheet.name,cell:c.cell,formula:c.formula});
      const groups=sumTerms(ast).map(group);let kind,inputs;
      if(groups.length===3&&groups.every(Boolean)){
        if(groups.every(g=>g.kind==='general')&&groups.every((g,i)=>Math.abs(g.weight-[.35,.35,.3][i])<1e-9))kind='general';
        if(groups.every(g=>g.kind==='module')&&groups.every((g,i)=>Math.abs(g.weight-[.25,.5,.25][i])<1e-9))kind='module';
        if(kind)inputs=groups.flatMap(g=>g.refs);
      }
      if(ast.call==='AVERAGE'){const refs=ast.args.flatMap(n=>n.range?rangeCells(n.range):n.ref?[n.ref]:[]);if(refs.length===4&&/^[123].*/.test(sheet.name)&&!/(MODULO|SOCIAL(?!ES)|REMED)/.test(normalize(sheet.name))){kind='annual';inputs=refs;}}
      if(!kind||new Set(inputs).size!==inputs.length)continue;
      let checked=0;const dependencies={};
      for(const values of cases[kind]){
        const synthetic=new Map(inputs.map((ref,i)=>[ref,values[i]])),visiting=new Set();
        function resolve(ref){if(synthetic.has(ref))return synthetic.get(ref);if(visiting.has(ref))throw Error('Referencia circular');const target=cells.get(ref);if(!target?.formula)throw Error('Referencia fuera de la muestra');const node=parse(target.formula);if(!node)throw Error('Fórmula no cubierta');dependencies[ref]=target.formula;visiting.add(ref);const value=evaluate(node,resolve);visiting.delete(ref);return value;}
        try{const actual=evaluate(ast,resolve),expected=kind==='annual'?G.annual(values):G.calculate(kind==='general'?'GENERAL_4_PERIODOS':'MODULO_FASES',values).value;comparisons++;checked++;if(Math.abs(actual-expected)>1e-10)differences.push({file,sheet:sheet.name,cell:c.cell,expected,actual,case:values});}catch{/* Not a safely isolated graph; do not claim it as checked. */}
      }
      if(checked)findings[kind].push({file,sheet:sheet.name,cell:c.cell,formula:c.formula,inputs,dependencies,cases:checked,visibility:sheet.visibility});
    }
    if(/CONDUCTA|COMP[EO]T|REMED|SOCIAL(?!ES)/.test(normalize(sheet.name)))findings.special.push({file,sheet:sheet.name,visibility:sheet.visibility,formulas:sheet.cells.filter(c=>c.formula!==null).length});
    for(const c of sheet.cells)if(c.error||c.formula&&/^IF\(/i.test(c.formula)&&[...c.formula.matchAll(/\b[A-Z]+(\d+)\b/g)].some(m=>Number(m[1])<c.row))findings.alerts.push({file,sheet:sheet.name,cell:c.cell,kind:c.error?'CACHED_ERROR':'CROSS_ROW_IF_REVIEW'});
  }
}
const report={sourceHash:crypto.createHash('sha256').update(source).digest('hex'),method:'Solo fórmulas originales y entradas sintéticas. No se leyeron valores personales para comparar resultados.',counts,displayFormats,summary:{generalFormulas:findings.general.length,moduleFormulas:findings.module.length,annualFormulas:findings.annual.length,syntheticComparisons:comparisons,differences:differences.length,explicitRounding:findings.rounding.length,specialSheets:findings.special.length},samples:Object.fromEntries(['general','module','annual'].map(kind=>[kind,findings[kind].slice(0,4)])),rounding:findings.rounding,special:findings.special,alerts:findings.alerts,differences,missingVsZero:'Excel puede calcular vacíos como cero o ignorarlos. GENESIS conserva pendientes sin resultado definitivo; esta diferencia es deliberada y no confirma una política oficial.',pending:['Aprobación y recuperación','Redondeo institucional','Anual modular','Conducta, competencias, remediación y servicio social','Fórmulas no cubiertas por el evaluador restringido']};
fs.writeFileSync('docs/validacion-academica-etapa-2.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(differences.length)process.exitCode=1;
