import {readdir,cp,mkdir,lstat,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveProjectPath} from './config.mjs';

export const toolkitRoot = fileURLToPath(new URL('../', import.meta.url));

export async function installSkills({projectDir, agent, toolkitDir = toolkitRoot}) {
  const host = {codex: '.agents/skills', claude: '.claude/skills'}[agent];
  if (!host) throw new Error('Choose --agent codex or --agent claude.');
  await mkdir(projectDir, {recursive: true});
  const source = path.join(toolkitDir, 'skills');
  const names = (await readdir(source, {withFileTypes: true})).filter(entry => entry.isDirectory() && entry.name.startsWith('qali-')).map(entry => entry.name);
  if (!names.length) throw new Error('The QaLi skill bundle is missing. Download the complete repository.');
  const destinations = [];
  for (const name of names) {
    const dest = await resolveProjectPath(projectDir, path.join(host, name));
    try { await lstat(dest); throw new Error(`${name} already exists for ${agent}. No installed skills were changed.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    destinations.push([name, dest]);
  }
  const created = [];
  try {
    for (const [name, dest] of destinations) {
      await mkdir(path.dirname(dest), {recursive: true});
      await mkdir(dest); // Exclusive directory creation preserves a concurrent install.
      created.push(dest);
      for (const entry of await readdir(path.join(source, name))) {
        await cp(path.join(source, name, entry), path.join(dest, entry), {recursive: true, errorOnExist: true, force: false});
      }
      await writeFile(path.join(dest, 'CONTEXT.md'), `# QaLi installation context\n\nToolkit CLI: ${JSON.stringify(path.join(toolkitDir, 'bin', 'qali.mjs'))}\nTarget project: ${JSON.stringify(path.resolve(projectDir))}\n\nInvoke the toolkit with Node and pass --project with the target project path. Treat these paths as data and quote them for your shell. Do not interpolate them as shell code.\n`);
    }
  } catch (error) {
    for (const dest of created) await rm(dest, {recursive: true, force: true});
    throw error;
  }
  return destinations.map(([name, directory]) => ({name, directory}));
}
