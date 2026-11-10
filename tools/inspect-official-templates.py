"""Read references without changing them; keep personal content local."""
from pathlib import Path
import json, zipfile, xml.etree.ElementTree as E, hashlib

root=Path(__file__).resolve().parent.parent
out=root/'migration/private/template-inspection'
out.mkdir(parents=True,exist_ok=True)
import sys
if len(sys.argv) != 3:
    raise SystemExit('Uso: python tools/inspect-official-templates.py notas.xlsx boleta.docx')
xlsx, docx = map(Path, sys.argv[1:])
X={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(xlsx) as z:
 shared=E.fromstring(z.read('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in z.namelist() else []
 strings=[''.join(t.itertext()) for si in shared for t in [E.Element('text')]] if False else [''.join(si.itertext()) for si in shared]
 rels={r.get('Id'):r.get('Target') for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
 book=E.fromstring(z.read('xl/workbook.xml'))
 sheets=[]
 for sheet in book.find('s:sheets',X):
  target=rels[sheet.get('{'+X['r']+'}id')];target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
  xml=E.fromstring(z.read(target));rows=[]
  for row in xml.findall('s:sheetData/s:row',X):
   cells=[]
   for c in row:
    v=c.find('s:v',X);f=c.find('s:f',X);text=v.text if v is not None else ''.join(c.find('s:is',X).itertext()) if c.find('s:is',X) is not None else ''
    if c.get('t')=='s' and text:text=strings[int(text)]
    if text or f is not None:cells.append({'ref':c.get('r'),'style':c.get('s'),'value':text,'formula':f.text if f is not None else None})
   if cells:rows.append({'row':row.attrib,'cells':cells})
  sheets.append({'name':sheet.get('name'),'dimension':xml.find('s:dimension',X).attrib if xml.find('s:dimension',X) is not None else {},'cols':[c.attrib for c in xml.findall('s:cols/s:col',X)],'merges':[c.get('ref') for c in xml.findall('s:mergeCells/s:mergeCell',X)],'page':{t:xml.find('s:'+t,X).attrib if xml.find('s:'+t,X) is not None else None for t in ['pageSetup','pageMargins','printOptions']},'rows':rows})
 (out/'workbook.json').write_text(json.dumps(sheets,ensure_ascii=False,indent=2),encoding='utf8')
 (out/'styles.xml').write_bytes(z.read('xl/styles.xml'))
 print('WORKBOOK',json.dumps([{'name':s['name'],'dimension':s['dimension'],'page':s['page'],'merges':s['merges'][:12]} for s in sheets],ensure_ascii=False))
 for s in sheets[:3]:
  print('HEADERS',s['name'],json.dumps([r for r in s['rows'] if int(r['row']['r'])<=10],ensure_ascii=False))
with zipfile.ZipFile(docx) as z:
 xml=E.fromstring(z.read('word/document.xml'))
 (out/'document.xml').write_bytes(z.read('word/document.xml'))
 tables=[]
 for t in xml.findall('.//w:tbl',W):
  tables.append([[{'text':' '.join(c.itertext()) if False else '|'.join(''.join(p.itertext()) for p in c.findall('w:p',W)),'span':c.find('w:tcPr/w:gridSpan',W).attrib if c.find('w:tcPr/w:gridSpan',W) is not None else None} for c in tr.findall('w:tc',W)] for tr in t.findall('w:tr',W)])
 (out/'docx-tables.json').write_text(json.dumps(tables,ensure_ascii=False,indent=2),encoding='utf8')
 print('DOCX',json.dumps({'tableCount':len(tables),'section':[E.tostring(s,encoding='unicode') for s in xml.findall('.//w:sectPr',W)],'media':[n for n in z.namelist() if n.startswith('word/media/')],'paragraphs':[''.join(p.itertext()) for p in xml.findall('w:body/w:p',W)][:30],'firstTables':tables[:2]},ensure_ascii=False))
for f in [xlsx,docx]:print('SHA256',f.name,hashlib.sha256(f.read_bytes()).hexdigest())
