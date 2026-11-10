// Restricted arithmetic parser for academic validation. Never evaluates arbitrary code or cached student values.
export function parseFormula(expression){
  const source=expression.replace(/^=/,'').replace(/\s/g,'').toUpperCase(),tokens=source.match(/\$?[A-Z]{1,3}\$?\d+|\d*\.\d+|\d+|[A-Z_]+|[()+\-*/,:;%]/g)||[];
  if(tokens.join('')!==source)throw Error('Fórmula no cubierta');let position=0;
  const take=()=>tokens[position++],peek=()=>tokens[position];
  function primary(){
    const token=take();let node;
    if(token==='('){node=add();if(take()!==')')throw Error('Paréntesis inválidos');}
    else if(token==='-')node={op:'*',left:{value:-1},right:primary()};
    else if(/^\d*\.?\d+$/.test(token))node={value:Number(token)};
    else if(/^\$?[A-Z]{1,3}\$?\d+$/.test(token)){node={ref:token.replace(/\$/g,'')};if(peek()===':'){take();const end=take();if(!/^\$?[A-Z]{1,3}\$?\d+$/.test(end))throw Error('Rango inválido');node={range:[node.ref,end.replace(/\$/g,'')]};}}
    else if(['AVERAGE','SUM','ROUND'].includes(token)&&take()==='('){const args=[];while(peek()!==')'){args.push(add());if(peek()===','||peek()===';')take();else if(peek()!==')')throw Error('Argumentos inválidos');}take();node={call:token,args};}
    else throw Error('Expresión no cubierta');
    if(peek()==='%'){take();node={op:'/',left:node,right:{value:100}};}return node;
  }
  function multiply(){let node=primary();while(['*','/'].includes(peek())){const op=take();node={op,left:node,right:primary()};}return node;}
  function add(){let node=multiply();while(['+','-'].includes(peek())){const op=take();node={op,left:node,right:multiply()};}return node;}
  const result=add();if(position!==tokens.length)throw Error('Expresión incompleta');return result;
}
import {colNumber,colLetters} from './xlsx.mjs';
export function rangeCells([from,to]){const a=from.match(/([A-Z]+)(\d+)/),b=to.match(/([A-Z]+)(\d+)/),out=[];for(let r=Number(a[2]);r<=Number(b[2]);r++)for(let c=colNumber(a[1]);c<=colNumber(b[1]);c++)out.push(colLetters(c)+r);if(out.length>500)throw Error('Rango demasiado grande');return out;}
export function evaluate(node,resolve){
  if('value'in node)return node.value;
  if(node.ref)return resolve(node.ref);
  if(node.range)return rangeCells(node.range).map(resolve);
  if(node.call){const args=node.args.map(n=>evaluate(n,resolve)),values=args.flat();if(node.call==='AVERAGE')return values.reduce((a,b)=>a+b,0)/values.length;if(node.call==='SUM')return values.reduce((a,b)=>a+b,0);if(node.call==='ROUND'){const factor=10**args[1];return Math.round(args[0]*factor)/factor;}}
  const a=evaluate(node.left,resolve),b=evaluate(node.right,resolve);return node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:a/b;
}
export const sumTerms=node=>node.op==='+'?[...sumTerms(node.left),...sumTerms(node.right)]:node.call==='SUM'?node.args.flatMap(sumTerms):[node];
