import path from 'node:path';
import {readFile,writeFile,mkdir,realpath,lstat,stat,unlink} from 'node:fs/promises';

export function validateURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a full app URL, such as http://localhost:3000.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The app URL must use http or https and must not contain credentials.');
  }
  return url.href;
}

export async function resolveProjectPath(projectDir, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Project file paths must be relative paths inside the project.');
  }
  const root = await realpath(projectDir);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Files must stay inside the selected project.');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Project output and input paths must not use symlinks.');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export async function readJSON(file, {maxBytes = 256 * 1024} = {}) {
  const tooLarge = () => new Error(`The JSON file is too large (maximum ${maxBytes / 1024} KiB).`);
  if ((await stat(file)).size > maxBytes) throw tooLarge();
  const content = await readFile(file, 'utf8');
  if (Buffer.byteLength(content) > maxBytes) throw tooLarge();
  try { return JSON.parse(content); } catch { throw new Error(`Invalid JSON in ${path.basename(file)}. Check commas, quotes, and brackets.`); }
}

export async function loadConfig(projectDir) {
  let config;
  try { config = await readJSON(await resolveProjectPath(projectDir, 'qali.config.json')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('No QaLi project found. Run qali init --url http://localhost:3000 first.');
    throw error;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1) throw new Error('qali.config.json must have version: 1.');
  const allowed = new Set(['version', 'name', 'baseURL', 'plan', 'outputDir', 'timeoutMs']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`Unknown config field: ${key}.`);
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 120) throw new Error('Project name must contain 1–120 characters.');
  config.baseURL = validateURL(config.baseURL);
  config.plan ??= 'qali.plan.json';
  config.outputDir ??= '.qali/runs';
  config.timeoutMs ??= 10_000;
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 60_000) throw new Error('timeoutMs must be an integer from 100 to 60000.');
  await resolveProjectPath(projectDir, config.plan);
  await resolveProjectPath(projectDir, config.outputDir);
  return config;
}

export async function initProject({projectDir, name = 'My app', url, goal = 'Check that the main page loads.'}) {
  const baseURL = validateURL(url);
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Error('Use a project name with 1–120 characters.');
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000) throw new Error('Describe what should work in 1–8000 characters.');
  await mkdir(projectDir, {recursive: true});
  const config = {version: 1, name: name.trim(), baseURL, plan: 'qali.plan.json', outputDir: '.qali/runs', timeoutMs: 10_000};
  const plan = {
    version: 1, name: `${name.trim()} — starter smoke checks`, tests: [
      {id: 'SMOKE-01', title: 'Main page is reachable and renders', steps: [
        {action: 'goto', path: baseURL},
        {action: 'request', path: baseURL, expectedStatus: 200},
        {action: 'expectVisible', target: {css: 'body'}},
      ]},
      {id: 'SMOKE-02', title: 'Main page has no uncaught JavaScript errors during loading', steps: [
        {action: 'goto', path: baseURL}, {action: 'expectNoPageErrors'},
      ]},
    ],
  };
  const files = new Map([
    ['qali.config.json', JSON.stringify(config, null, 2) + '\n'],
    ['qali.plan.json', JSON.stringify(plan, null, 2) + '\n'],
    ['qali.goal.md', `# What should work\n\n${goal.trim()}\n\nThe starter plan checks page loading only. Ask your AI assistant to turn this goal into specific checks.\n`],
  ]);
  const targets = [];
  for (const [name, contents] of files) {
    const target = await resolveProjectPath(projectDir, name);
    try { await lstat(target); throw new Error(`${name} already exists. QaLi will not replace your files. Choose another project directory.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    targets.push([target, contents]);
  }
  const created = [];
  try {
    for (const [target, contents] of targets) { await writeFile(target, contents, {flag: 'wx'}); created.push(target); }
  } catch (error) {
    for (const target of created) await unlink(target);
    throw error;
  }
  return config;
}
