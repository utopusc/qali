import {spawnSync} from 'node:child_process';
import {readFileSync,statSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertCleanReport,assertCounterDefect} from './report-check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const spec=path.join(root,'tests/robotics.spec.ts');
const hash=()=>createHash('sha256').update(readFileSync(spec)).digest('hex');
const before=hash();
// Never certify a previous attempt's report or keep an old success proof after failure.
for(const name of ['defect','fixed','defect-proof.json'])rmSync(path.join(root,'artifacts',name),{recursive:true,force:true});
function run(name,fault){
  const result=spawnSync(process.execPath,['node_modules/playwright/cli.js','test','--grep','TC-02'],{cwd:root,env:{...process.env,QALI_RUN:name,QALI_FAULT:fault},stdio:'inherit'});
  if(result.error)throw result.error;
  return {exitCode:result.status,report:JSON.parse(readFileSync(path.join(root,`artifacts/${name}/results.json`),'utf8'))};
}
console.log('RED: deliberately enable the documented cycle-counter defect. One failure is required.');
const red=run('defect','counter');assert.equal(red.exitCode,1,'Expected one failing test, not a runner crash');
const failed=assertCounterDefect(red.report);
const evidence=[];
for(const item of failed.results[0].attachments.filter(a=>a.path)){
  const actual=path.resolve(root,item.path);
  assert.ok(actual.startsWith(path.join(root,'artifacts','defect')+path.sep),'Evidence must belong to this defect run');
  const bytes=statSync(actual).size;assert.ok(bytes>0,`Empty artifact ${item.name}`);
  evidence.push({name:item.name,path:path.relative(root,actual).split(path.sep).join('/'),bytes});
}
console.log('GREEN: remove the fault flag and run the exact same unchanged test.');
const green=run('fixed','');assert.equal(green.exitCode,0,'Fixed rerun must pass');assertCleanReport(green.report,1);
assert.equal(hash(),before,'The test must not be weakened or changed between runs');
const proof={simulationOnly:true,controlledDefect:'Final cycle is omitted from completed count',test:failed.title,testSourceSha256:before,expectedCycles:3,defectiveCycles:2,fixedCycles:3,red:{exitCode:red.exitCode,stats:red.report.stats},green:{exitCode:green.exitCode,stats:green.report.stats},evidence};
writeFileSync(path.join(root,'artifacts/defect-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log('QaLi defect proof verified: intended assertion failed, screenshot/video/trace exist, unchanged test passed after correction.');
