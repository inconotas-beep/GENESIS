"""Check the generated synthetic print fixtures, never institutional records."""
from pathlib import Path
import json
import pymupdf

root=Path(__file__).resolve().parent.parent
out=root/'data/local/inco-format-qa'
reports=[]
for filename,expected,landscape in [('boleta.pdf',1,False),('boletas-seccion.pdf',5,False),('cuadro-docente.pdf',1,True)]:
 document=pymupdf.open(out/filename)
 assert len(document)==expected, f'{filename}: {len(document)} pages, expected {expected}; pagination needs correction'
 for number,page in enumerate(document):
  assert (page.rect.width>page.rect.height)==landscape, f'{filename}: wrong paper orientation'
  text=page.get_text()
  assert ('CUADRO DE REGISTRO' if landscape else 'Estudiante:') in text, f'{filename}: missing repeated identity/header on page {number+1}'
  if not landscape: assert 'Dinastía' in text and 'Registro Académico' in text, f'{filename}: footer or signatures spilled onto another page'
  for block in page.get_text('blocks'):
   if len(block)>6 and block[6]==0:
    assert block[0]>=20 and block[1]>=20 and block[2]<=page.rect.width-20 and block[3]<=page.rect.height-20, f'{filename}: text outside printable margins'
  page.get_pixmap(matrix=pymupdf.Matrix(1.25,1.25)).save(out/f'{filename}-page-{number+1}.png')
 reports.append({'file':filename,'pages':len(document),'orientation':'LANDSCAPE' if landscape else 'PORTRAIT','allHeadersAndFootersPresent':True})
(out/'print-report.json').write_text(json.dumps({'passed':True,'fixturesOnly':True,'reports':reports},indent=2),encoding='utf8')
print(json.dumps(reports))
