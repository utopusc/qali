import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('an early runner failure cannot certify stale reports or leave a stale proof',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'qali-proof-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of ['scripts','tests','node_modules/playwright','artifacts/defect','artifacts/fixed'])mkdirSync(path.join(root,dir),{recursive:true});
  for(const file of ['demo-defect.mjs','report-check.mjs'])copyFileSync(new URL(`../../scripts/${file}`,import.meta.url),path.join(root,'scripts',file));
  writeFileSync(path.join(root,'tests/robotics.spec.ts'),'unchanged assertion');
  const attachments=['screenshot','video','trace'].map(name=>{
    const file=path.join(root,'artifacts/defect',name);writeFileSync(file,'old evidence');return {name,path:file};
  });
  attachments.push({name:'simulation-audit',body:Buffer.from(JSON.stringify({state:'completed',targetCycles:3,completedCycles:2})).toString('base64')});
  const red={errors:[],stats:{expected:0,unexpected:1,skipped:0,flaky:0},suites:[{specs:[{title:'TC-02 cycles',tests:[{expectedStatus:'passed',status:'unexpected',results:[{status:'failed',errors:[{message:'QaLi cycle count matches requested cycles'}],attachments}]}]}]}]};
  const green=structuredClone(red);green.stats={expected:1,unexpected:0,skipped:0,flaky:0};const test=green.suites[0].specs[0].tests[0];test.status='expected';test.results=[{status:'passed',errors:[],attachments:[]}];
  writeFileSync(path.join(root,'artifacts/defect/results.json'),JSON.stringify(red));
  writeFileSync(path.join(root,'artifacts/defect-proof.json'),'old proof');
  // Simulate a runner that exits before writing a red report, then could pass a green run.
  writeFileSync(path.join(root,'node_modules/playwright/cli.js'),`if(process.env.QALI_RUN==='defect')process.exit(1);require('node:fs').writeFileSync('artifacts/fixed/results.json',${JSON.stringify(JSON.stringify(green))});`);
  const result=spawnSync(process.execPath,['scripts/demo-defect.mjs'],{cwd:root,encoding:'utf8',timeout:10_000});
  assert.ifError(result.error);
  assert.notEqual(result.status,0,'Old red evidence must not certify a fresh run');
  assert.equal(existsSync(path.join(root,'artifacts/defect-proof.json')),false,'A failed attempt must not leave a stale success proof');
  assert.equal(existsSync(path.join(root,'artifacts/defect/screenshot')),false,'Old evidence must be removed before execution');
});
