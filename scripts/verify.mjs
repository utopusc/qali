import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertCleanReport} from './report-check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,QALI_FAULT:'',QALI_RUN:'regression'};
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run(['node_modules/typescript/bin/tsc','--noEmit']);
run(['--test',...readdirSync(new URL('../tests/unit/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).map(name=>`tests/unit/${name}`)]);
run(['--test',...readdirSync(new URL('../tests/tool/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).map(name=>`tests/tool/${name}`)]);
run(['node_modules/playwright/cli.js','test']);
assertCleanReport(JSON.parse(readFileSync(new URL('../artifacts/regression/results.json',import.meta.url),'utf8')),8);
console.log('QaLi verified: toolkit tests and 8 optional-example browser/API scenarios passed.');
