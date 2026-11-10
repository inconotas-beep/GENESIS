import fs from 'node:fs';
const markdown=fs.readFileSync('GENESIS_INVENTARIO_PARA_CODEX.md','utf8');
const reference=JSON.parse(markdown.match(/```json\s*([\s\S]*?)```/)[1]);
const current=JSON.parse(fs.readFileSync('docs/auditoria-plantillas.json','utf8'));
const differences=[];let checked=0;
for(const book of reference.books){const actual=current.books.find(b=>b.file===book.filename);if(!actual){differences.push({file:book.filename,error:'Libro no encontrado'});continue;}for(const sheet of book.sheets){const s=actual.inventory.find(s=>s.name===sheet.name);checked++;if(!s){differences.push({file:book.filename,sheet:sheet.name,error:'Hoja no encontrada'});continue;}for(const [key,target]of Object.entries({visibility:'visibility',formula_count:'formulas',computed_error_count:'errors',roster_header_count:'headers',preparacion_block_count:'phases'}))if(sheet[key]!==s[target])differences.push({file:book.filename,sheet:sheet.name,field:key,expected:sheet[key],actual:s[target]});}}
const result={checkedSheets:checked,differenceCount:differences.length,differences};fs.writeFileSync('docs/comparacion-inventario.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checkedSheets:checked,differenceCount:differences.length}));if(differences.length)process.exitCode=1;
