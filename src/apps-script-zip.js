/* Embedded inside GoogleXlsx by build.mjs; guard expansion before calling Utilities.unzip. */
function unzip(bytes){
 const byte=index=>(bytes[index]+256)%256;
 const u16=index=>{if(index<0||index+2>bytes.length)throw Error('ZIP truncado');return byte(index)+byte(index+1)*256;};
 const u32=index=>u16(index)+u16(index+2)*65536;
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('ZIP inválido');
 const count=u16(end+10);if(count>5000)throw Error('Demasiadas entradas ZIP');
 let offset=u32(end+16),expanded=0;
 for(let i=0;i<count;i++){
  if(u32(offset)!==0x02014b50||u16(offset+8)&1||![0,8].includes(u16(offset+10)))throw Error('ZIP no admitido');
  expanded+=u32(offset+24);if(expanded>20000000)throw Error('Excel expandido demasiado grande');
  offset+=46+u16(offset+28)+u16(offset+30)+u16(offset+32);
 }
 const result=new Map();let actual=0;
 for(const blob of Utilities.unzip(Utilities.newBlob(bytes,'application/zip'))){
  actual+=blob.getBytes().length;if(actual>20000000||result.has(blob.getName()))throw Error('ZIP inconsistente');
  result.set(blob.getName(),blob.getDataAsString('UTF-8'));
 }
 return result;
}
