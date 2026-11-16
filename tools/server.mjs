import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Genesis from './core.mjs';
import {inspectBook} from './importer.mjs';
import {authentication} from './auth.mjs';
const root=path.resolve(import.meta.dirname,'..'),institutional=path.join(root,'data/privado/institucional'),dir=process.env.GENESIS_DATA_DIR||(fs.existsSync(path.join(institutional,'database.json'))?institutional:path.join(root,'data/local'));fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'database.json');
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(Genesis.seed(),null,2));
const sessions=new Map(), token=crypto.randomBytes(24).toString('hex');
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=db=>{fs.writeFileSync(file+'.tmp',JSON.stringify(db,null,2));fs.renameSync(file+'.tmp',file);};
const auth=authentication(dir,read());
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
    const hosts=[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`];
    if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.some(host=>req.headers.origin==='http://'+host))return send(403,{error:'Origen no autorizado'});
    if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(root,'web/Index.html'),'utf8').replace('__LOCAL_TOKEN__',token));}
    const assets={'/assets/inco-formats.js':['../src/inco-formats.js','text/javascript'],'/assets/inco.js':['Inco.js','text/javascript'],'/assets/print-formats.css':['PrintFormats.css','text/css'],'/assets/inco-boleta-lion.png':['assets/inco-boleta-lion.png','image/png'],'/assets/google-auth.js':['GoogleAuth.js','text/javascript'],'/assets/app.js':['App.js','text/javascript'],'/assets/functional.js':['Functional.js','text/javascript'],'/assets/core.js':['../src/core.js','text/javascript'],'/assets/gradebook-xlsx.js':['../src/gradebook-xlsx.js','text/javascript'],'/assets/styles.css':['Styles.css','text/css'],'/assets/inco-logo.png':['assets/inco-logo.png','image/png']};
    Object.assign(assets,{
      '/assets/section-workflows.js':['SectionWorkflows.js','text/javascript'],
      '/assets/report-pdf.js':['ReportPdf.js','text/javascript'],
      '/assets/jspdf.js':['../node_modules/jspdf/dist/jspdf.umd.min.js','text/javascript']
    });
    if(req.method==='GET'&&assets[req.url]){const [name,type]=assets[req.url];res.writeHead(200,{'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':'')});return res.end(fs.readFileSync(path.join(root,'web',name)));}
    if(req.method!=='POST'||!['/api','/login','/logout','/access-account','/roster-review','/xlsx-preview'].includes(req.url))return send(404,{error:'No encontrado'});
    if(req.headers['x-genesis-local']!==token)return send(403,{error:'Origen local no autorizado'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>(req.url==='/xlsx-preview'?10000000:1000000))throw Error('El archivo o la solicitud supera el tamaño permitido');}
    const p=JSON.parse(body), db=read();
    if(req.url==='/login'){
      const user=auth.login(p.username,p.password,db);
      const old=req.headers.cookie?.match(/(?:^|; )genesis=([^;]+)/)?.[1];if(old)sessions.delete(old);
      const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{email:user.email,expires:Date.now()+28800000});res.setHeader('Set-Cookie',`genesis=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);return send(200,{ok:true});
    }
    const sid=req.headers.cookie?.match(/(?:^|; )genesis=([^;]+)/)?.[1];const session=sessions.get(sid);const email=session&&session.expires>Date.now()?session.email:undefined;
    if(req.url==='/logout'){sessions.delete(sid);res.setHeader('Set-Cookie','genesis=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
    if(req.url==='/access-account'){const result=Genesis.execute(db,email,'credentials',p);const undo=auth.set(p.username,p.password,p.userId);try{write(db);}catch(error){undo();throw error;}for(const [key,value]of sessions)if(value.email===db.users.find(u=>u.id===p.userId)?.email)sessions.delete(key);return send(200,result);}
    if(req.url==='/roster-review'){const actor=Genesis.execute(db,email,'bootstrap').user;if(actor.role!=='ADMIN')throw Error('Acceso denegado');const file=path.join(dir,'revision-privada.json');const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).pending:[];return send(200,{rows:rows.filter(r=>r.nie).map(r=>({nie:r.nie,choices:[...new Map(r.rows.map(c=>[c.name+'|'+c.sectionId,{name:c.name,section:c.sectionId}])).values()]}))});}
    if(req.url==='/xlsx-preview'){const roster=Genesis.execute(db,email,'roster',p);if(roster.closed)throw Error('El período está cerrado');if(db.users.find(u=>u.email===email)?.role==='DIRECTION')throw Error('Dirección tiene acceso de consulta');if(typeof p.content!=='string'||typeof p.name!=='string')throw Error('Archivo inválido');let preview;try{preview=inspectBook(Buffer.from(p.content,'base64'),path.basename(p.name),{privateRows:true});}catch{throw Error('No se pudo leer el archivo Excel. Verificá que no esté dañado o protegido');}return send(200,preview);}
    const result=Genesis.execute(db,email,p.action,p.params,{id:()=>crypto.randomUUID()});
    if(!Genesis.readActions.includes(p.action))write(db);
    send(200,result);
  }catch(e){send(400,{error:e instanceof TypeError||e instanceof SyntaxError?'No se pudo procesar la solicitud. Revisá los datos e intentá nuevamente':e.message});}
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('GENESIS · acceso local · http://127.0.0.1:'+server.address().port));
