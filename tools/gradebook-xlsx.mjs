import fs from 'node:fs';
import vm from 'node:vm';
const context={TextEncoder,TextDecoder,Blob,DecompressionStream,Uint8Array,DataView};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../src/gradebook-xlsx.js',import.meta.url),'utf8'),context);
export default context.GenesisXlsx;
