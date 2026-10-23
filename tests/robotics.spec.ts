import {test} from './fixtures.js';
import {expect,type Page} from '@playwright/test';
type Snapshot={state:string;completedCycles:number;targetCycles:number;speed:number;guardClosed:boolean;events:Array<{seq:number;type:string;accepted:boolean;code?:string}>};
const command=(page:Page,id:string,data:object)=>page.request.post(`/api/sessions/${id}/commands`,{data});
const status=(page:Page)=>page.getByTestId('state');
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});

test('TC-02 @smoke requested cycles match completed cycles',async({page,session})=>{
  await page.getByLabel('Cycles',{exact:true}).fill('3');
  await button(page,'Start task').click();await expect(status(page)).toHaveText('running');
  for(let i=0;i<3;i++) await button(page,'Advance one cycle').click();
  await expect(status(page)).toHaveText('completed');
  await expect(page.getByTestId('completed-cycles'),'QaLi cycle count matches requested cycles').toHaveText('3');
  expect((await command(page,session,{type:'step'})).status()).toBe(409);
});

test('TC-03 invalid input and duplicate starts preserve operation state',async({page,session})=>{
  await page.getByLabel('Speed fraction').fill('1.1');await button(page,'Start task').click();
  await expect(page.getByRole('alert')).toContainText('INVALID_SPEED');await expect(status(page)).toHaveText('idle');
  await page.getByLabel('Speed fraction').fill('0.5');await button(page,'Start task').click();
  await expect(status(page)).toHaveText('running');
  const before:Snapshot=await(await page.request.get(`/api/sessions/${session}`)).json();
  expect((await command(page,session,{type:'start',cycles:7,speed:0.9})).status()).toBe(409);
  const after:Snapshot=await(await page.request.get(`/api/sessions/${session}`)).json();
  expect([after.state,after.targetCycles,after.completedCycles,after.speed]).toEqual([before.state,before.targetCycles,before.completedCycles,before.speed]);
});

test('TC-04 @smoke emergency stop latches across guard changes',async({page,session})=>{
  await button(page,'Start task').click();await button(page,'Advance one cycle').click();await button(page,'Emergency stop').click();
  await expect(status(page)).toHaveText('emergency_stopped');
  await page.getByRole('checkbox',{name:'Guard closed'}).uncheck();await page.getByRole('checkbox',{name:'Guard closed'}).check();
  expect((await command(page,session,{type:'start',cycles:3,speed:0.5})).status()).toBe(409);
  expect((await command(page,session,{type:'step'})).status()).toBe(409);
  await button(page,'Refresh state').click();await expect(status(page)).toHaveText('emergency_stopped');
  await expect(page.getByTestId('completed-cycles')).toHaveText('1');
});

test('TC-05 guard opening faults active work and blocks reset until closed',async({page,session})=>{
  await button(page,'Start task').click();await page.getByRole('checkbox',{name:'Guard closed'}).uncheck();
  await expect(status(page)).toHaveText('fault');await button(page,'Reset simulation').click();
  await expect(page.getByRole('alert')).toContainText('GUARD_OPEN');
  expect((await command(page,session,{type:'step'})).status()).toBe(409);
  await page.getByRole('checkbox',{name:'Guard closed'}).check();await expect(status(page)).toHaveText('fault');
});

test('TC-06 explicit reset returns idle without automatically restarting',async({page,session})=>{
  await button(page,'Start task').click();await button(page,'Emergency stop').click();await button(page,'Reset simulation').click();
  await expect(status(page)).toHaveText('idle');await expect(page.getByTestId('completed-cycles')).toHaveText('0');
  const snapshot:Snapshot=await(await page.request.get(`/api/sessions/${session}`)).json();
  expect(snapshot.targetCycles).toBe(0);expect(snapshot.events.map(e=>e.type)).toEqual(['start','estop','reset']);
  expect((await command(page,session,{type:'step'})).status()).toBe(409);
});

test('TC-07 ten repeated tasks remain consistent and sessions are isolated',async({page,session})=>{
  const other=await(await page.request.post('/api/sessions',{data:{}})).json();
  try{
    for(let n=0;n<10;n++){
      expect((await command(page,session,{type:'start',cycles:2,speed:0.5})).ok()).toBeTruthy();
      await command(page,session,{type:'step'});
      const result:Snapshot=await(await command(page,session,{type:'step'})).json();
      expect([result.state,result.completedCycles]).toEqual(['completed',2]);await command(page,session,{type:'reset'});
    }
    const untouched:Snapshot=await(await page.request.get(`/api/sessions/${other.id}`)).json();
    expect([untouched.state,untouched.completedCycles,untouched.events.length]).toEqual(['idle',0,0]);
  }finally{await page.request.delete(`/api/sessions/${other.id}`);}
});

test('TC-08 accepted and rejected commands produce ordered audit evidence',async({page,session},testInfo)=>{
  await button(page,'Start task').click();await command(page,session,{type:'start',cycles:3,speed:0.5});await button(page,'Emergency stop').click();
  const snapshot:Snapshot=await(await page.request.get(`/api/sessions/${session}`)).json();
  expect(snapshot.events.map(e=>[e.seq,e.type,e.accepted])).toEqual([[1,'start',true],[2,'start',false],[3,'estop',true]]);
  expect(snapshot.events[1].code).toBe('BUSY');await expect(page.getByTestId('audit')).toContainText('BUSY');
  await testInfo.attach('operator-evidence',{body:await page.screenshot(),contentType:'image/png'});
});
