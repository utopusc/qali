import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulator } from '../../demo/simulator.mjs';

const operation = s => { const { events, ...state } = s; return state; };
const start = (s, cycles=3) => s.command({type:'start', cycles, speed:0.5});

test('finishes exactly the requested cycles and rejects extra advancement', () => {
  const s=createSimulator(); start(s);
  assert.equal(s.snapshot().state,'running');
  s.command({type:'step'}); s.command({type:'step'}); s.command({type:'step'});
  assert.equal(s.snapshot().completedCycles,3);
  assert.equal(s.snapshot().state,'completed');
  assert.throws(()=>s.command({type:'step'}), {code:'NOT_RUNNING'});
  assert.equal(s.snapshot().completedCycles,3);
});

test('emergency stop remains latched across guard changes and repeated stop', () => {
  const s=createSimulator(); start(s); s.command({type:'step'});
  s.command({type:'estop'}); s.command({type:'guard',closed:false});
  s.command({type:'guard',closed:true}); s.command({type:'estop'});
  assert.equal(s.snapshot().state,'emergency_stopped');
  assert.throws(()=>start(s), {code:'RESET_REQUIRED'});
  assert.throws(()=>s.command({type:'step'}), {code:'NOT_RUNNING'});
  assert.equal(s.snapshot().completedCycles,1);
  s.command({type:'reset'});
  assert.equal(s.snapshot().state,'idle');
  assert.equal(s.snapshot().completedCycles,0);
});

test('an opened guard faults active work and closing it does not resume', () => {
  const s=createSimulator(); start(s); s.command({type:'guard',closed:false});
  assert.equal(s.snapshot().state,'fault');
  assert.throws(()=>s.command({type:'reset'}), {code:'GUARD_OPEN'});
  assert.throws(()=>s.command({type:'step'}), {code:'NOT_RUNNING'});
  s.command({type:'guard',closed:true});
  assert.equal(s.snapshot().state,'fault');
  assert.throws(()=>start(s), {code:'RESET_REQUIRED'});
  s.command({type:'reset'});
  assert.equal(s.snapshot().state,'idle');
});

test('start is rejected when guard is open', () => {
  const s=createSimulator(); s.command({type:'guard',closed:false});
  assert.throws(()=>start(s), {code:'GUARD_OPEN'});
  assert.equal(s.snapshot().state,'idle');
});

for (const [label, value] of [['zero',0],['negative',-1],['too many',11],['fraction',1.5],['string','3'],['missing',undefined],['infinite',Infinity]]) {
  test(`invalid cycles (${label}) preserve operation state`,()=>{
    const s=createSimulator(); const before=operation(s.snapshot());
    assert.throws(()=>s.command({type:'start',cycles:value,speed:0.5}),{code:'INVALID_CYCLES'});
    assert.deepEqual(operation(s.snapshot()),before);
  });
}
for (const [label,value] of [['zero',0],['too fast',1.1],['negative',-1],['string','0.5'],['NaN',NaN],['missing',undefined]]) {
  test(`invalid speed (${label}) preserves operation state`,()=>{
    const s=createSimulator(); const before=operation(s.snapshot());
    assert.throws(()=>s.command({type:'start',cycles:3,speed:value}),{code:'INVALID_SPEED'});
    assert.deepEqual(operation(s.snapshot()),before);
  });
}

test('rejected start and reset cannot overwrite active operation',()=>{
  const s=createSimulator(); start(s); s.command({type:'step'});
  const before=operation(s.snapshot());
  assert.throws(()=>start(s,7),{code:'BUSY'});
  assert.throws(()=>s.command({type:'reset'}),{code:'BUSY'});
  assert.deepEqual(operation(s.snapshot()),before);
});

test('invalid command shapes and guard types do not corrupt a session',()=>{
  const s=createSimulator(); const before=operation(s.snapshot());
  for(const input of [null,[],3,'start',{}, {type:'unknown'}, {type:'guard',closed:'false'}]) {
    assert.throws(()=>s.command(input));
    assert.deepEqual(operation(s.snapshot()),before);
  }
  start(s); assert.equal(s.snapshot().state,'running');
});

test('ten repeated tasks and separate sessions remain independent',()=>{
  const s=createSimulator(), other=createSimulator();
  for(let task=0;task<10;task++){
    start(s,2); s.command({type:'step'}); s.command({type:'step'});
    assert.equal(s.snapshot().completedCycles,2); s.command({type:'reset'});
  }
  assert.equal(other.snapshot().state,'idle'); assert.equal(other.snapshot().events.length,0);
  const events=s.snapshot().events;
  assert.equal(events.length,40);
  assert.deepEqual(events.map(e=>e.seq),Array.from({length:40},(_,i)=>i+1));
});

test('audit captures accepted and rejected actions without exposing mutable state',()=>{
  const s=createSimulator(); start(s); assert.throws(()=>start(s));
  const view=s.snapshot();
  assert.deepEqual(view.events.map(e=>[e.seq,e.type,e.accepted]),[[1,'start',true],[2,'start',false]]);
  assert.equal(view.events[1].code,'BUSY');
  view.events[0].type='tampered'; view.completedCycles=999;
  assert.equal(s.snapshot().events[0].type,'start'); assert.equal(s.snapshot().completedCycles,0);
});

test('documented simulation boundaries are accepted',()=>{
  for(const [cycles,speed] of [[1,0.1],[10,1]]) {
    const s=createSimulator(); s.command({type:'start',cycles,speed});
    assert.equal(s.snapshot().targetCycles,cycles);
    assert.equal(s.snapshot().speed,speed);
  }
});
