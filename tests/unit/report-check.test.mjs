import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertCleanReport,assertCounterDefect} from '../../scripts/report-check.mjs';
function clean(){return {errors:[],stats:{expected:1,unexpected:0,skipped:0,flaky:0},suites:[{specs:[{title:'TC-02 cycles',tests:[{expectedStatus:'passed',status:'expected',results:[{status:'passed',errors:[],attachments:[]}]}]}]}]};}
test('clean report accepts a real single passing result',()=>assert.equal(assertCleanReport(clean(),1).length,1));
for(const status of ['skipped','failed','timedOut','interrupted'])test(`verification rejects ${status} results even with misleading green statistics`,()=>{
 const report=clean();report.suites[0].specs[0].tests[0].results[0].status=status;assert.throws(()=>assertCleanReport(report,1));
});
test('verification rejects expected failures, retries, empty suites and global failures',()=>{
 const expected=clean();expected.suites[0].specs[0].tests[0].expectedStatus='failed';assert.throws(()=>assertCleanReport(expected,1));
 const retry=clean();retry.suites[0].specs[0].tests[0].results.push({status:'passed'});assert.throws(()=>assertCleanReport(retry,1));
 assert.throws(()=>assertCleanReport({stats:{expected:8},suites:[]},8));
 const global=clean();global.errors=[{message:'server failed'}];assert.throws(()=>assertCleanReport(global,1));
});
function defect(){const r=clean();r.stats={expected:0,unexpected:1,skipped:0,flaky:0};const t=r.suites[0].specs[0].tests[0];t.status='unexpected';t.results=[{status:'failed',errors:[{message:'QaLi cycle count matches requested cycles'}],attachments:[{name:'simulation-audit',body:Buffer.from(JSON.stringify({state:'completed',completedCycles:2,targetCycles:3})).toString('base64')},...['screenshot','video','trace'].map(name=>({name,path:`${name}.file`}))]}];return r;}
test('counter defect proof requires the intended assertion, actual audit and three evidence types',()=>{
 assert.equal(assertCounterDefect(defect()).title,'TC-02 cycles');
 for(const corrupt of [r=>r.suites[0].specs[0].tests[0].results[0].errors=[{message:'browser missing'}],r=>r.suites[0].specs[0].tests[0].results[0].attachments.pop(),r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].body='e30=']){const r=defect();corrupt(r);assert.throws(()=>assertCounterDefect(r));}
});
test('counter defect proof rejects an intended assertion mixed with a cleanup failure',()=>{
 const report=defect();report.suites[0].specs[0].tests[0].results[0].errors.push({message:'Fixture cleanup failed: socket hang up'});
 assert.throws(()=>assertCounterDefect(report),/Only the intended counter assertion/);
});
