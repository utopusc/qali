import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSimulator, CommandError } from './simulator.mjs';

function readBody(req) {
  return new Promise((resolve,reject)=>{
    let size=0; const chunks=[];
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>8192) { reject(new CommandError('BODY_TOO_LARGE','Request exceeds 8 KiB.',413)); return; }
      chunks.push(chunk);
    });
    req.on('error',reject);
    req.on('end',()=>{
      if(size>8192) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}')); }
      catch { reject(new CommandError('INVALID_JSON','Request body must be valid JSON.',400)); }
    });
  });
}

export function createAppServer({faultMode=false,maxSessions=128}={}) {
  const sessions=new Map();
  return http.createServer(async(req,res)=>{
    const json=(status,data)=>{
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(JSON.stringify(data));
    };
    try {
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (req.headers.origin && req.headers.origin!==`http://${host}`)) {
        throw new CommandError('LOCAL_ONLY','Only the local fixture origin is allowed.',403);
      }
      const url=new URL(req.url,`http://${host}`);
      if(req.method==='GET' && url.pathname==='/health') return json(200,{name:'QaLi',mode:'simulation',status:'ok'});
      if(req.method==='GET' && url.pathname==='/') {
        const html=await readFile(new URL('./index.html',import.meta.url));
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"});
        return res.end(html);
      }
      let body;
      if(req.method==='POST') {
        if(!req.headers['content-type']?.startsWith('application/json')) throw new CommandError('JSON_REQUIRED','Use application/json.',415);
        body=await readBody(req);
      }
      if(req.method==='POST' && url.pathname==='/api/sessions') {
        if(sessions.size>=maxSessions) throw new CommandError('SESSION_LIMIT','Delete an old session or restart the local fixture.',429);
        const id=randomUUID(); const sim=createSimulator({faultMode}); sessions.set(id,sim);
        return json(201,{id,...sim.snapshot()});
      }
      const match=url.pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)(\/commands)?$/);
      if(!match || !sessions.has(match[1])) throw new CommandError('NOT_FOUND','No matching route or session.',404);
      const sim=sessions.get(match[1]);
      if(req.method==='GET' && !match[2]) return json(200,sim.snapshot());
      if(req.method==='DELETE' && !match[2]) {sessions.delete(match[1]);return json(200,{deleted:true});}
      if(req.method==='POST' && match[2]) return json(200,sim.command(body));
      throw new CommandError('METHOD_NOT_ALLOWED','Unsupported method for this route.',405);
    } catch(error) {
      json(error instanceof CommandError ? error.status : 500,{error:{code:error.code||'INTERNAL_ERROR',message:error instanceof CommandError?error.message:'Local fixture error.'}});
    }
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.QALI_PORT||4173);
  if(!Number.isInteger(port)||port<1024||port>65535) {console.error('QALI_PORT must be an integer from 1024 to 65535.');process.exit(1);}
  const server=createAppServer({faultMode:process.env.QALI_FAULT==='counter'});
  server.on('error',err=>{console.error(`QaLi fixture failed: ${err.code}. Choose an unused QALI_PORT.`);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`QaLi simulation at http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
