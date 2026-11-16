/* Download the same grades and selection used by the on-screen report. */
async function reportImage(source,lion=false){
  if(!source)return null;
  const image=new Image();
  image.src=source;
  await image.decode();
  const width=image.naturalWidth,height=image.naturalHeight;
  const crop=lion?[width*.0218/2.8773,height*.2175/1.4043,width/2.8773,height/1.4043]:[0,0,width,height];
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(crop[2]);canvas.height=Math.round(crop[3]);
  canvas.getContext('2d').drawImage(image,...crop,0,0,canvas.width,canvas.height);
  return canvas;
}
function drawReportImage(pdf,image,x,y,maxWidth,maxHeight){
  if(!image)return;
  const scale=Math.min(maxWidth/image.width,maxHeight/image.height);
  const width=image.width*scale,height=image.height*scale;
  pdf.addImage(image,'PNG',x+(maxWidth-width)/2,y+(maxHeight-height)/2,width,height);
}
function measureReportPdfTable(pdf,headers,rows,width,font,equalColumns=false){
  const periods=headers.length-2;
  const subjectShare=periods===1 ? .56 : .42;
  const observationShare=periods===1 ? .19 : .15;
  const periodShare=(1-subjectShare-observationShare)/Math.max(1,periods);
  const widths=equalColumns?headers.map(()=>width/headers.length):[width*subjectShare,...Array(periods).fill(width*periodShare),width*(periods?observationShare:1-subjectShare)];
  const padding=font*.19;
  pdf.setFontSize(font);
  const layout=[{cells:headers,header:true},...rows].map(row=>{
    pdf.setFont('times',row.header||row.category?'bold':'normal');
    const lines=row.category?[pdf.splitTextToSize(row.category,width-2*padding)]:
      row.cells.map((cell,i)=>pdf.splitTextToSize(String(cell),widths[i]-2*padding));
    return {row,lines,height:Math.max(...lines.map(cell=>cell.length),1)*font*1.14+2*padding};
  });
  return {font,padding,width,widths,layout,height:layout.reduce((sum,row)=>sum+row.height,0)};
}
function fitReportPdfTables(pdf,headers,groups,width,available,moduleGroups,fullWidth){
  const measure=font=>{
    const tables=groups.map(rows=>measureReportPdfTable(pdf,headers,rows,width,font));
    const modules=moduleGroups.map(group=>measureReportPdfTable(pdf,group.map(item=>item.title),[{cells:group.map(item=>item.result)}],fullWidth,font,true));
    const technicalHeight=modules.length?font*2.5+modules.reduce((height,table)=>height+table.height,0):0;
    return {font,tables,modules,height:Math.max(0,...tables.map(table=>table.height))+technicalHeight};
  };
  const fits=layout=>layout.height<=available;
  const normal=measure(10);
  if(fits(normal))return normal;
  let low=0,high=10;
  for(let attempt=0;attempt<14;attempt++){
    const size=(low+high)/2;
    if(fits(measure(size)))low=size;
    else high=size;
  }
  return measure(low);
}
function drawReportPdfTable(pdf,{font,padding,width,widths,layout},x,y){
  pdf.setFontSize(font);
  for(const {row,lines,height} of layout){
    const shaded=!!(row.header||row.category);
    if(shaded)pdf.setFillColor('#edf4ee');
    pdf.setDrawColor('#34443D');
    pdf.setLineWidth(.4);
    let left=x;
    for(const [i,cell] of lines.entries()){
      const cellWidth=row.category?width:widths[i];
      pdf.rect(left,y,cellWidth,height,shaded?'FD':'S');
      const align=i===0?'left':'center';
      pdf.setFont('times',shaded?'bold':'normal');
      pdf.text(cell,align==='left'?left+padding:left+cellWidth/2,y+padding+font*.84,{align,lineHeightFactor:1.14});
      left+=cellWidth;
    }
    y+=height;
  }
  return y;
}
function drawReportPdfSubjects(pdf,table,x,y,width,bottom){
  const {headers,rows,modules}=table;
  const available=bottom-y;
  const moduleGroups=IncoFormats.reportModuleGroups(modules);
  const gap=12,columnWidth=(width-gap)/2;
  const groups=rows.length?[rows]:modules.length?[]:[[{cells:['Sin asignaturas autorizadas',...Array(headers.length-1).fill('')]}]];
  let layout=fitReportPdfTables(pdf,headers,groups,width,available,moduleGroups,width);
  if(layout.font<9&&rows.length>=12){
    let middle=Math.ceil(rows.length/2);
    while(rows[middle-1]?.category||rows[middle]?.criterion)middle--;
    const first=rows.slice(0,middle),second=rows.slice(middle);
    const category=first.findLast(row=>row.category);
    if(category&&!second[0].category)second.unshift(category);
    const columns=fitReportPdfTables(pdf,headers,[first,second],columnWidth,available,moduleGroups,width);
    if(columns.font>=layout.font+.25)layout=columns;
  }
  y=Math.max(y,...layout.tables.map((part,index)=>drawReportPdfTable(pdf,part,x+index*(columnWidth+gap),y)));
  if(layout.modules.length){
    pdf.setFont('times','bold').setFontSize(layout.font);
    pdf.text('Área Técnica',x+width/2,y+layout.font*1.75,{align:'center'});
    y+=layout.font*2.5;
    for(const part of layout.modules)y=drawReportPdfTable(pdf,part,x,y);
  }
  return y;
}
async function createReportPdf(report,{logo,lion,director,registrar,format}){
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation:'portrait',unit:'pt',format:'letter',compress:true});
  pdf.setProperties({title:'GENESIS · Boleta de calificaciones'});
  const [crest,emblem]=await Promise.all([reportImage(logo),reportImage(lion,true)]);
  const margin=34,width=pdf.internal.pageSize.getWidth()-2*margin,center=margin+width/2;
  const bottom=pdf.internal.pageSize.getHeight()-margin;
  for(const [i,student] of report.students.entries()){
    const table=IncoFormats.reportTable(report,student,format);
    if(i)pdf.addPage();
    drawReportImage(pdf,crest,margin,margin,56,58);
    drawReportImage(pdf,emblem,margin+width-56,margin,56,58);
    pdf.setFont('times','bold').setFontSize(20).setTextColor('#176B45');
    pdf.text('Instituto Nacional de Comercio',center,margin+23,{align:'center'});
    pdf.setFont('times','normal').setFontSize(9).setTextColor('#34443D');
    pdf.text(['Final Calle Campos y Avenida Barberena, San Jacinto, San Salvador','Tel. 2270-2852'],center,margin+39,{align:'center'});
    pdf.setFont('times','bold').setFontSize(17).setTextColor('#176B45');
    pdf.text('Boleta de Calificaciones',center,margin+71,{align:'center'});
    pdf.setFontSize(11);
    pdf.text(IncoFormats.reportYear(report),center,margin+87,{align:'center'});
    pdf.setFont('times','normal').setFontSize(10).setTextColor('#222222');
    let y=margin+103;
    const identity=pdf.splitTextToSize('Estudiante: '+IncoFormats.names(student).full,width-137);
    pdf.text(identity,margin,y);
    pdf.text('NIE: '+student.nie,margin+width,y,{align:'right'});
    y+=identity.length*12;
    const specialty=pdf.splitTextToSize(table.specialty,width-137);
    const section=pdf.splitTextToSize('Sección: '+IncoFormats.groupLabel(report.section),132);
    pdf.text(specialty,margin,y);
    pdf.text(section,margin+width,y,{align:'right'});
    y+=Math.max(1,specialty.length,section.length)*12;
    if(report.scope==='PARTIAL'){pdf.setFontSize(9).text('Consulta parcial · Asignaturas autorizadas al docente',margin,y);y+=12;}
    pdf.setFontSize(9);
    const signatures=[director||'',registrar||''].map(name=>pdf.splitTextToSize(name,width/2-25));
    const signatureRows=Math.max(1,...signatures.map(lines=>lines.length));
    const quote=pdf.splitTextToSize(IncoFormats.reportQuote,width-16);
    const legendHeight=52;
    const footerHeight=67+signatureRows*10+quote.length*11+legendHeight;
    const end=drawReportPdfSubjects(pdf,table,margin,y+6,width,bottom-footerHeight);
    pdf.setFont('times','normal').setFontSize(8);
    const legend=IncoFormats.reportLegend,cellWidth=width/3;
    pdf.setFont('times','bold').text(legend.title,center,end+11,{align:'center'});
    legend.levels.forEach(([level,meaning],i)=>{
      const left=margin+i*cellWidth,mid=left+cellWidth/2;
      pdf.setDrawColor('#A8C9B1').rect(left,end+15,cellWidth,23);
      pdf.setFont('times','bold').text(level,mid,end+24,{align:'center'});
      pdf.setFont('times','normal').text(meaning,mid,end+34,{align:'center'});
    });
    pdf.text(legend.minimum+' · '+legend.pending,center,end+49,{align:'center'});
    const signatureY=end+21+legendHeight,signatureWidth=width/2-20;
    pdf.setFont('times','normal').setFontSize(9);
    for(const [j,label] of ['Director','Responsable de Registro Académico'].entries()){
      const left=margin+j*(width/2+20);
      pdf.line(left,signatureY,left+signatureWidth,signatureY);
      pdf.text(signatures[j],left+signatureWidth/2,signatureY+10,{align:'center'});
      pdf.text(label,left+signatureWidth/2,signatureY+10+signatureRows*10,{align:'center'});
    }
    const quoteY=signatureY+24+signatureRows*10;
    pdf.setFont('times','italic').text(quote,center,quoteY,{align:'center'});
    pdf.setFont('times','bold').setFontSize(12).setTextColor('#176B45');
    pdf.text('Dinastía de Campeones!!!',center,quoteY+quote.length*11+4,{align:'center'});
    pdf.setFont('times','normal').setFontSize(8).setTextColor('#34443D');
    pdf.text(IncoFormats.reportCredits,center,quoteY+quote.length*11+17,{align:'center'});
  }
  return pdf.output('blob');
}
