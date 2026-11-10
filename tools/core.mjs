import fs from 'node:fs';
import vm from 'node:vm';
const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../src/subject-names.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../src/core.js',import.meta.url),'utf8'),sandbox);
export default sandbox.Genesis;
