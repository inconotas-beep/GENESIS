import fs from 'node:fs';
fs.mkdirSync('dist/apps-script',{recursive:true});
for(const f of fs.readdirSync('apps-script').filter(f=>f.endsWith('.gs')||f==='appsscript.json'))fs.copyFileSync('apps-script/'+f,'dist/apps-script/'+f);
fs.copyFileSync('src/sheets-schema.js','dist/apps-script/Schema.gs');
fs.copyFileSync('src/core.js','dist/apps-script/Core.gs');
fs.copyFileSync('src/subject-names.js','dist/apps-script/SubjectNames.gs');
const bcryptSource=fs.readFileSync('node_modules/bcryptjs/umd/index.js','utf8');
const timerFallback=': setTimeout;';
if(!bcryptSource.includes(timerFallback))throw Error('Revisá la compatibilidad de bcrypt con Apps Script');
fs.writeFileSync('dist/apps-script/Bcrypt.gs',bcryptSource.replace(timerFallback,
  ": function () { throw Error('Usá la API síncrona de bcrypt en Apps Script'); };"));
let html=fs.readFileSync('web/Index.html','utf8')
  .replaceAll('/assets/inco-logo.png','data:image/png;base64,'+fs.readFileSync('web/assets/inco-logo.png').toString('base64'))
  .replaceAll('/assets/inco-boleta-lion.png','data:image/png;base64,'+fs.readFileSync('web/assets/inco-boleta-lion.png').toString('base64'))
  .replace('<link rel="stylesheet" href="/assets/print-formats.css">',()=>'<style data-inco-format>'+fs.readFileSync('web/PrintFormats.css','utf8')+'</style>')
  .replace('<link rel="stylesheet" href="/assets/styles.css">',()=>'<style>'+fs.readFileSync('web/Styles.css','utf8')+'</style>')
  .replace('<script src="/assets/app.js"></script>',()=>'<script>'+fs.readFileSync('web/App.js','utf8')+'</script>');
for(const [asset,file]of [['core.js','src/core.js'],['gradebook-xlsx.js','src/gradebook-xlsx.js'],['inco-formats.js','src/inco-formats.js'],['functional.js','web/Functional.js'],['google-auth.js','web/GoogleAuth.js'],['inco.js','web/Inco.js']])html=html.replace('<script src="/assets/'+asset+'"></script>',()=>'<script>'+fs.readFileSync(file,'utf8')+'</script>');
for(const [asset,file] of [['jspdf.js','node_modules/jspdf/dist/jspdf.umd.min.js'],['report-pdf.js','web/ReportPdf.js'],['section-workflows.js','web/SectionWorkflows.js']]){
  if(!fs.existsSync(file))throw Error('Instalá las dependencias con npm ci antes de compilar');
  const source=fs.readFileSync(file,'utf8').replace(/<\/script/gi,'<\\/script');
  html=html.replace('<script src="/assets/'+asset+'"></script>',()=>'<script>'+source+'\n</script>');
}
fs.writeFileSync('dist/apps-script/Index.html',html);
console.log('Apps Script generado en dist/apps-script. Sin datos ficticios ni credenciales institucionales.');

// Reuse the exact audited XML/formula reader; adapt only ZIP and SHA-256 platform services.
let xlsx=fs.readFileSync('tools/xlsx.mjs','utf8');
xlsx=xlsx.slice(xlsx.indexOf('export const decode=')).replaceAll('export ','');
let importer=fs.readFileSync('tools/importer.mjs','utf8');
importer=importer.slice(importer.indexOf('const family=')).split('export function auditZip')[0].replaceAll('export ','').replaceAll('blockCells.at(-1)','blockCells[blockCells.length-1]');
const adapter=fs.readFileSync('src/apps-script-zip.js','utf8')+`\nconst hash=bytes=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');\n`;
fs.writeFileSync('dist/apps-script/Xlsx.gs','var GoogleXlsx=(()=>{\n'+adapter+xlsx+'\n'+importer+'\nreturn {inspectBook};\n})();');
