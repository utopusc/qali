import assert from 'node:assert/strict';
export function entries(report){
  const found=[];
  function visit(suites){for(const suite of suites||[]){for(const spec of suite.specs||[])for(const test of spec.tests||[])found.push({title:spec.title,...test});visit(suite.suites);}}
  visit(report.suites);return found;
}
export function assertCleanReport(report,expectedCount=8){
  assert.equal((report.errors||[]).length,0,'Global test-runner errors');
  const tests=entries(report);assert.equal(tests.length,expectedCount,'Unexpected number of executed tests');
  assert.deepEqual([report.stats.expected,report.stats.unexpected,report.stats.skipped,report.stats.flaky],[expectedCount,0,0,0],'Non-clean report totals');
  for(const t of tests){
    assert.equal(t.expectedStatus,'passed',`Expected failure is not a pass: ${t.title}`);
    assert.equal(t.status,'expected',`Non-passing test: ${t.title}`);
    assert.equal(t.results.length,1,`Retries are not a clean pass: ${t.title}`);
    assert.equal(t.results[0].status,'passed',`Non-passing result: ${t.title}`);
    assert.equal((t.results[0].errors||[]).length,0,`Result errors: ${t.title}`);
  }
  return tests;
}
export function assertCounterDefect(report){
  assert.equal((report.errors||[]).length,0,'Global runner error is not the counter defect');
  const tests=entries(report);assert.equal(tests.length,1,'Defect run must execute exactly TC-02');
  const t=tests[0];assert.match(t.title,/^TC-02\b/);assert.equal(t.expectedStatus,'passed');
  assert.deepEqual([report.stats.expected,report.stats.unexpected,report.stats.skipped,report.stats.flaky],[0,1,0,0]);
  assert.equal(t.results.length,1);const result=t.results[0];assert.equal(result.status,'failed');
  assert.equal(result.errors.length,1,'Only the intended counter assertion may fail');
  assert.ok(result.errors[0].message?.includes('QaLi cycle count matches requested cycles'),'Wrong failure reason');
  const audit=result.attachments.find(a=>a.name==='simulation-audit');assert.ok(audit?.body,'Audit attachment missing');
  const observed=JSON.parse(Buffer.from(audit.body,'base64').toString());
  assert.deepEqual([observed.state,observed.targetCycles,observed.completedCycles],['completed',3,2],'Wrong observed defect');
  for(const name of ['screenshot','video','trace'])assert.ok(result.attachments.some(a=>a.name===name&&a.path),`Missing ${name}`);
  return t;
}
