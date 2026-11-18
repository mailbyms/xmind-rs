// Dump a slice of the official marker registry so we can see the real field names.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('research/asar-src/renderer/2907.js', 'utf8');
const m = src.match(/const hA=JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
if (!m) throw new Error('registry literal not found');
const reg = JSON.parse(vm.runInNewContext(`'${m[1]}'`));
const keys = Object.keys(reg);
console.log('groups:', keys.length, keys.join(','));
for (const k of keys.slice(0, 3)) {
  console.log('---', k);
  console.log(JSON.stringify(reg[k], null, 1).slice(0, 900));
}
