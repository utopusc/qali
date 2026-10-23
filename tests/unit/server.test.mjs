import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { createAppServer } from '../../demo/server.mjs';

async function setup(t,options={}) {
  const server=createAppServer(options); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=async(path,method='GET',body,headers={})=>{
    const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,data:await res.json()};
  };
  return {base,request};
}

test('real HTTP session workflow returns state, records commands, and isolates sessions',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/health')).data.name,'QaLi');
  const a=await request('/api/sessions','POST',{}), b=await request('/api/sessions','POST',{});
  assert.equal(a.status,201); assert.notEqual(a.data.id,b.data.id);
  const cmd=await request(`/api/sessions/${a.data.id}/commands`,'POST',{type:'start',cycles:2,speed:0.5});
  assert.equal(cmd.status,200); assert.equal(cmd.data.state,'running');
  assert.equal((await request(`/api/sessions/${b.data.id}`)).data.state,'idle');
  assert.equal((await request(`/api/sessions/${a.data.id}`)).data.events[0].type,'start');
  assert.equal((await request(`/api/sessions/${a.data.id}`,'DELETE')).status,200);
  assert.equal((await request(`/api/sessions/${a.data.id}`)).status,404);
});

test('malformed JSON, invalid input and unknown sessions fail without breaking healthy state',async t=>{
  const {base,request}=await setup(t); const {data:{id}}=await request('/api/sessions','POST',{});
  const path=`/api/sessions/${id}/commands`;
  const bad=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:'{bad'});
  assert.equal(bad.status,400); assert.equal((await bad.json()).error.code,'INVALID_JSON');
  const invalid=await request(path,'POST',{type:'start',cycles:'3',speed:0.5});
  assert.equal(invalid.status,422); assert.equal(invalid.data.error.code,'INVALID_CYCLES');
  assert.equal((await request('/api/sessions/not-found')).status,404);
  assert.equal((await request(path,'POST',{type:'start',cycles:3,speed:0.5})).data.state,'running');
});

test('oversized bodies and foreign origins are rejected by the local fixture',async t=>{
  const {base,request}=await setup(t);
  assert.equal((await request('/api/sessions','POST',{extra:'x'.repeat(9000)})).status,413);
  assert.equal((await request('/api/sessions','POST',{}, {origin:'https://example.org'})).status,403);
  // Node fetch rewrites Host; use a real raw HTTP request for this boundary.
  const status=await new Promise((resolve,reject)=>{
    http.get(base+'/health',{headers:{host:'example.org'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
  });
  assert.equal(status,403);
  assert.equal((await request('/api/sessions','POST',{}, {'content-type':'text/plain'})).status,415);
  assert.equal((await request('/api/sessions','POST',{})).status,201);
});

test('bounded sessions can be deleted to make room for another session',async t=>{
  const {request}=await setup(t,{maxSessions:2});
  const first=await request('/api/sessions','POST',{});
  await request('/api/sessions','POST',{});
  assert.equal((await request('/api/sessions','POST',{})).status,429);
  await request(`/api/sessions/${first.data.id}`,'DELETE');
  assert.equal((await request('/api/sessions','POST',{})).status,201);
});
test('CLI fails on an occupied port without reusing the existing application',async t=>{
  const {base,request}=await setup(t);
  const result=spawnSync(process.execPath,['demo/server.mjs'],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),
    env:{...process.env,QALI_PORT:new URL(base).port},encoding:'utf8',timeout:5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status,1);
  assert.match(result.stderr,/EADDRINUSE/);
  assert.equal((await request('/health')).data.status,'ok');
});
