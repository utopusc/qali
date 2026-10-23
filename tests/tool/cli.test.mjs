import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initProject,loadConfig,resolveProjectPath} from '../../lib/config.mjs';
import {installSkills} from '../../lib/skills.mjs';

const cli=fileURLToPath(new URL('../../bin/qali.mjs',import.meta.url));
async function folder(t){const dir=await mkdtemp(path.join(tmpdir(),'qali-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('init creates a portable project and honest starter checks for a separate application',async t=>{
  const projectDir=await folder(t);
  await initProject({projectDir,name:'My shop',url:'http://localhost:3030/store',goal:'Customers can find products.'});
  const config=await loadConfig(projectDir);
  assert.equal(config.baseURL,'http://localhost:3030/store');
  const plan=JSON.parse(await readFile(path.join(projectDir,config.plan),'utf8'));
  assert.equal(plan.tests.length,2);
  assert.equal(plan.tests[0].steps[0].path,'http://localhost:3030/store');
  assert.match(await readFile(path.join(projectDir,'qali.goal.md'),'utf8'),/Customers can find products/);
});

test('init refuses existing files without overwriting or partially adding project files',async t=>{
  const projectDir=await folder(t);
  await writeFile(path.join(projectDir,'qali.plan.json'),'my existing plan');
  await assert.rejects(initProject({projectDir,name:'Test',url:'http://localhost:3030',goal:'Load page'}),/already exists/);
  assert.equal(await readFile(path.join(projectDir,'qali.plan.json'),'utf8'),'my existing plan');
  await assert.rejects(readFile(path.join(projectDir,'qali.config.json')),/ENOENT/);
});

test('config rejects invalid URLs, path traversal and symlink escapes',async t=>{
  const projectDir=await folder(t),other=await folder(t);
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:secret@example.com']){
    await assert.rejects(initProject({projectDir,name:'Test',url,goal:'Load page'}));
  }
  await assert.rejects(resolveProjectPath(projectDir,'../outside'));
  await symlink(other,path.join(projectDir,'linked'));
  await assert.rejects(resolveProjectPath(projectDir,'linked/report.json'),/inside|symlink/);
  await initProject({projectDir,name:'Test',url:'http://localhost:3030',goal:'Load page'});
  const config=JSON.parse(await readFile(path.join(projectDir,'qali.config.json'),'utf8'));config.timeoutMs='forever';
  await writeFile(path.join(projectDir,'qali.config.json'),JSON.stringify(config));
  await assert.rejects(loadConfig(projectDir),/timeoutMs/);
});

test('CLI help and missing config explain the next action without a stack trace',async t=>{
  const projectDir=await folder(t);
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8',cwd:projectDir});
  assert.equal(help.status,0);assert.match(help.stdout,/init/);assert.match(help.stdout,/skills/);
  const missing=spawnSync(process.execPath,[cli,'run'],{encoding:'utf8',cwd:projectDir});
  assert.equal(missing.status,2);assert.match(missing.stderr,/init/);assert.doesNotMatch(missing.stderr,/at .+\.mjs:/);
});

test('noninteractive CLI init works and a second invocation exits without clobbering',async t=>{
  const projectDir=await folder(t);
  const args=[cli,'init','--project',projectDir,'--url','http://localhost:3030','--name','Independent app','--goal','Check search'];
  const first=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const before=await readFile(path.join(projectDir,'qali.config.json'),'utf8');
  const again=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(again.status,2);
  assert.equal(await readFile(path.join(projectDir,'qali.config.json'),'utf8'),before);
});

test('skill install uses host discovery paths and refuses to replace existing skills',async t=>{
  const projectDir=await folder(t),toolkitDir=await folder(t);
  const source=path.join(toolkitDir,'skills','qali-plan');await mkdir(source,{recursive:true});
  await writeFile(path.join(source,'SKILL.md'),'---\nname: qali-plan\ndescription: Plan QA checks.\n---\nRun the CLI.\n');
  await installSkills({projectDir,agent:'codex',toolkitDir});
  const dest=path.join(projectDir,'.agents/skills/qali-plan');
  assert.match(await readFile(path.join(dest,'CONTEXT.md'),'utf8'),/bin.*qali\.mjs/);
  await writeFile(path.join(dest,'SKILL.md'),'custom skill');
  await assert.rejects(installSkills({projectDir,agent:'codex',toolkitDir}),/already exists/);
  assert.equal(await readFile(path.join(dest,'SKILL.md'),'utf8'),'custom skill');
  await installSkills({projectDir,agent:'claude',toolkitDir});
  assert.match(await readFile(path.join(projectDir,'.claude/skills/qali-plan/SKILL.md'),'utf8'),/Plan QA checks/);
});
