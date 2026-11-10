import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import X from '../tools/gradebook-xlsx.mjs';
import G from '../tools/core.mjs';
import {workbook,unzip} from '../tools/xlsx.mjs';
const fixture=()=>{const db=G.seed();const run=(email,action,p={})=>G.execute(db,email,action,{version:db.version,...p});return {db,run,roster:()=>run('docente@example.invalid','export',{assignmentId:'a1',periodId:'1'})};};
function compressedCopy(input){
  const bytes=Buffer.from(input),locals=[],directory=[];let offset=0,end=bytes.length-22;const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16);
  for(let i=0;i<count;i++){
    const length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),oldOffset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+length),size=bytes.readUInt32LE(at+20),start=oldOffset+30+bytes.readUInt16LE(oldOffset+26)+bytes.readUInt16LE(oldOffset+28),payload=deflateRawSync(bytes.subarray(start,start+size));
    const central=Buffer.from(bytes.subarray(at,at+46+length)),header=Buffer.from(bytes.subarray(oldOffset,oldOffset+30));header.writeUInt16LE(8,8);header.writeUInt32LE(payload.length,18);central.writeUInt16LE(8,10);central.writeUInt32LE(payload.length,20);central.writeUInt32LE(offset,42);locals.push(header,name,payload);directory.push(central);offset+=header.length+name.length+payload.length;at+=46+length+extra+comment;
  }
  const footer=Buffer.from(bytes.subarray(end)),central=Buffer.concat(directory);footer.writeUInt32LE(central.length,12);footer.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,footer]);
}
test('XLSX válido conserva NIE textual, ceros, pendientes, precisión y formato 0.0',async()=>{
  const {run,roster}=fixture();run('docente@example.invalid','saveGrades',{assignmentId:'a1',periodId:'1',rows:[{studentId:'s1',values:[0,8.95,null]}]});
  const group=roster(),bytes=X.write(X.groupSheets(group,group.assignment)),sheets=workbook(Buffer.from(bytes)),raw=unzip(Buffer.from(bytes));
  assert.equal(sheets[0].cells.find(c=>c.cell==='A2').value,'00000001');assert.equal(sheets[0].cells.find(c=>c.cell==='C2').value,0);assert.equal(sheets[0].cells.find(c=>c.cell==='D2').value,8.95);assert.equal(sheets[0].cells.find(c=>c.cell==='E2').value,null);assert.equal(sheets[0].cells.find(c=>c.cell==='C2').numberFormat,'0.0');assert.equal(sheets[2].visibility,'hidden');assert.ok(raw.get('xl/styles.xml').toString().includes('formatCode="0.0"'));
  const parsed=X.template(await X.read(bytes),'cuadro.xlsx');assert.equal(parsed.rows[0].nie,'00000001');assert.equal(parsed.rows[0].values[1],8.95);assert.equal(parsed.metadata.periodId,'1');
});
test('plantilla de cinco notas se importa y aparece en cuadro, consolidado y boleta',async()=>{
  const {db,run,roster}=fixture();run('rocio@example.invalid','evaluationPolicy',{assignmentId:'a1',periodId:'1',count:5,weights:[.1,.2,.3,.2,.2],reason:'Ponderación sintética autorizada'});
  const group=roster(),sheets=X.groupSheets(group,group.assignment,true);sheets[0].rows[1].splice(2,5,0,6,7,8,9);const bytes=X.write(sheets),parsed=X.template(await X.read(bytes),'plantilla.xlsx');
  const check=run('docente@example.invalid','checkImport',{assignmentId:'a1',periodId:'1',rows:parsed.rows,template:parsed.metadata});assert.equal(check.rows[0].issues.length,0);
  const preview={schema:'GENESIS_PREVIEW_V1',hash:'c'.repeat(64),blocks:[{id:'GENESIS_TEMPLATE_V1'}]};run('docente@example.invalid','importPreview',{assignmentId:'a1',periodId:'1',preview,template:parsed.metadata,rows:parsed.rows});run('rocio@example.invalid','approveImport',{batchId:db.batches[0].id,rows:parsed.rows});
  const expected=roster().students[0].result.value;for(const kind of ['consolidated','reportCard']){const d=run('rocio@example.invalid',kind,{year:'2026',sectionId:'1A',studentId:'s1'});assert.equal(d.students[0].entries[0].periods[0].value,expected);const exported=workbook(Buffer.from(X.write(X.documentSheets(d))));assert.equal(exported[0].cells.find(c=>c.cell==='C2').value,expected);assert.equal(exported[0].cells.find(c=>c.cell==='C2').numberFormat,'0.0');}
});
test('rechaza fórmulas, errores, NIE numérico y notas inválidas antes de revisar',async()=>{
  const {roster}=fixture(),group=roster();for(const invalid of ['formula','error','nie','range']){
    const sheets=await X.read(X.write(X.groupSheets(group,group.assignment))),data=sheets[0];for(let i=0;i<3;i++)data.cells.find(c=>c.cell===String.fromCharCode(67+i)+'2').value=8;
    if(invalid==='formula')data.cells.find(c=>c.cell==='C2').formula=true;if(invalid==='error')data.cells.find(c=>c.cell==='C2').error=true;if(invalid==='nie')data.cells.find(c=>c.cell==='A2').value=1;if(invalid==='range')data.cells.find(c=>c.cell==='C2').value=11;
    assert.throws(()=>X.template(sheets,'inválido.xlsx'));
  }
});
test('cadenas con aspecto de fórmula son texto y no se ejecutan al exportar',()=>{
  const bytes=X.write([{name:'Seguridad',rows:[['NIE','Nombre'],['0001','=HYPERLINK("https://example.invalid")'],['0002','<etiqueta> & símbolo']]}]),sheet=workbook(Buffer.from(bytes))[0];assert.equal(sheet.cells.find(c=>c.cell==='B2').formula,null);assert.equal(sheet.cells.find(c=>c.cell==='B2').value,'=HYPERLINK("https://example.invalid")');assert.equal(sheet.cells.find(c=>c.cell==='B3').value,'<etiqueta> & símbolo');
});
test('rechaza ZIP truncado, corrupto y entradas con nombres de hoja inválidos',async()=>{
  await assert.rejects(()=>X.read(new Uint8Array([1,2,3])));const bytes=X.write([{name:'Notas',rows:[['Nota'],[8]]}]);bytes[50]^=1;await assert.rejects(()=>X.read(bytes));assert.throws(()=>X.write([{name:'no/válido',rows:[]}]));
});
test('lee plantillas comprimidas como las guardadas de nuevo por Excel, sin dependencia del servidor',async()=>{
  const {roster}=fixture(),group=roster();group.students[0].values=[0,7,8];const bytes=compressedCopy(X.write(X.groupSheets(group,group.assignment)));const parsed=X.template(await X.read(bytes),'guardado-en-excel.xlsx');assert.equal(parsed.rows[0].values[0],0);assert.equal(parsed.rows[0].nie,'00000001');assert.equal(parsed.rows[0].values[2],8);
});
test('no acepta una plantilla con encabezados o componentes reordenados',async()=>{
  const {roster}=fixture(),group=roster();group.students[0].values=[8,9,10];const sheets=X.groupSheets(group,group.assignment);sheets[0].rows[0][2]='Nota diferente';await assert.rejects(async()=>X.template(await X.read(X.write(sheets)),'columnas-modificadas.xlsx'),/encabezados/);
});
