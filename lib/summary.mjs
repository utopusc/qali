import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const COVERAGE_LIMITS = [
  'Only the recorded test steps were attempted. Unlisted checks were not run. Passing checks do not establish that the whole application is correct.',
  'This run uses Chromium in isolated browser contexts. Other browsers, devices, accessibility audits, security audits, and load testing are outside this run.',
  'An expectNoPageErrors check covers uncaught page errors observed before that step. Console messages are evidence, not automatic failures.',
  'Screenshots and traces may contain application data. Review them before sharing.',
];

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/[\n\r]/g, ' ').replace(/[|`*_[\]<>]/g, '\\$&');
}

function limits(report) {
  return Array.isArray(report.coverageLimits) ? report.coverageLimits : COVERAGE_LIMITS;
}

function evidencePath(runDir, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null;
  const absolutePath = path.resolve(runDir, relativePath);
  const relative = path.relative(path.resolve(runDir), absolutePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' ? absolutePath : null;
}

function headline(report) {
  const { passed, failed, total } = report.counts;
  if (report.status === 'error') {
    return `INCOMPLETE: ${passed + failed} of ${total} tests completed; ${passed} passed, ${failed} failed — ${report.project}`;
  }
  return `${report.status.toUpperCase()}: ${passed} passed, ${failed} failed, ${total} total — ${report.project}`;
}

function conciseFailure(error) {
  const lines = String(error ?? 'The check did not meet its expected result.').split('\n')
    .map((line) => line.trim()).filter(Boolean);
  const expectedAndReceived = lines.filter((line) => /^(Expected|Received)[ :]/.test(line));
  return (expectedAndReceived.length ? expectedAndReceived.join('; ') : lines[0] ?? 'The runtime did not complete.').slice(0, 400);
}

/** A concise summary derived only from executed test results. */
export function formatSummary(report) {
  const lines = [headline(report)];
  if (report.status === 'error') {
    lines.push(`Runtime error: ${conciseFailure(report.error)}`);
    for (const test of report.tests.filter((item) => item.status === 'error')) {
      lines.push(`Incomplete: ${test.title} — ${conciseFailure(test.runtimeError)}`);
    }
  }
  for (const test of report.tests.filter((item) => item.status === 'failed')) {
    const failedStep = test.steps.find((step) => step.status === 'failed');
    lines.push(`Failed: ${test.title}${failedStep ? ` (${failedStep.action})` : ''} — ${conciseFailure(test.error ?? failedStep?.error)}`);
  }
  if (report.status === 'error') {
    lines.push('Next: Run "npm run qali -- doctor" to diagnose setup, review report.html, fix the runtime error, and rerun the unchanged checks.');
  } else if (report.counts.failed) {
    lines.push('Next: Open report.html to review failure details, screenshots, and traces. Confirm the expected behavior before changing the app or plan.');
  }
  lines.push('Coverage: only the recorded test steps were attempted.');
  return lines.join('\n');
}

/** Write portable reports. The HTML needs no scripts, stylesheets, or image files. */
export async function writeReports(report, runDir) {
  await mkdir(runDir, { recursive: true });
  const coverageLimits = limits(report);
  const markdown = [
    `# QaLi report: ${escapeMarkdown(report.project)}`,
    '',
    escapeMarkdown(headline(report)),
    '',
    ...(report.status === 'error' ? [`Runtime error: ${escapeMarkdown(report.error)}`, '', 'This run did not complete. Run `npm run qali -- doctor` to diagnose setup, then review this report before rerunning the unchanged checks.', ''] : []),
    `Run: ${escapeMarkdown(report.runId)}`,
    `Target: ${escapeMarkdown(report.baseURL)}`,
    `Started: ${escapeMarkdown(report.startedAt)}`,
    `Finished: ${escapeMarkdown(report.finishedAt)}`,
    '',
    '| Test | Result | Executed steps |',
    '| --- | --- | --- |',
    ...report.tests.map((test) => `| ${escapeMarkdown(test.title)} | ${test.status} | ${test.steps.length} |`),
    '',
  ];
  const sections = [];
  for (const test of report.tests) {
    markdown.push(`## ${escapeMarkdown(test.title)} (${test.status})`, '');
    for (const step of test.steps) {
      markdown.push(`- ${escapeMarkdown(step.action)}: ${step.status}${step.error ? ` — ${escapeMarkdown(step.error)}` : ''}`);
    }
    if (test.error) markdown.push('', `Failure: ${escapeMarkdown(test.error)}`);
    if (test.runtimeError) markdown.push('', `Runtime error: ${escapeMarkdown(test.runtimeError)}`);
    if (test.screenshot) markdown.push('', `Screenshot: [${escapeMarkdown(test.screenshot)}](${encodeURI(test.screenshot)})`);
    if (test.trace) markdown.push('', `Trace: [${escapeMarkdown(test.trace)}](${encodeURI(test.trace)})`);
    if (test.console?.length) {
      markdown.push('', 'Console:', ...test.console.map((entry) => `- ${escapeMarkdown(typeof entry === 'string' ? entry : `${entry.type}: ${entry.text}`)}`));
    }
    markdown.push('');

    let screenshot = '';
    const screenshotPath = evidencePath(runDir, test.screenshot);
    if (screenshotPath) {
      try {
        const data = await readFile(screenshotPath);
        screenshot = `<figure><img src="data:image/png;base64,${data.toString('base64')}" alt="Failure screenshot for ${escapeHTML(test.title)}"><figcaption>Failure screenshot</figcaption></figure>`;
      } catch {
        screenshot = '<p>Screenshot evidence is unavailable.</p>';
      }
    }
    let trace = '';
    const tracePath = evidencePath(runDir, test.trace);
    if (tracePath) {
      try {
        const data = await readFile(tracePath);
        trace = `<p><a download="${escapeHTML(path.basename(test.trace))}" href="data:application/zip;base64,${data.toString('base64')}">Download failure trace</a></p>`;
      } catch {
        trace = '<p>Trace evidence is unavailable.</p>';
      }
    }
    sections.push(`<section><h2>${escapeHTML(test.title)} <span class="${test.status === 'passed' ? 'passed' : 'failed'}">${escapeHTML(test.status)}</span></h2>
      <ol>${test.steps.map((step) => `<li><strong>${escapeHTML(step.action)}</strong>: ${escapeHTML(step.status)}${step.error ? `<pre>${escapeHTML(step.error)}</pre>` : ''}</li>`).join('')}</ol>
      ${test.error ? `<p class="failed">Failure</p><pre>${escapeHTML(test.error)}</pre>` : ''}
      ${test.runtimeError ? `<p class="failed">Runtime error</p><pre>${escapeHTML(test.runtimeError)}</pre>` : ''}
      ${screenshot}${trace}
      ${test.console?.length ? `<details><summary>Console evidence (${test.console.length})</summary><pre>${escapeHTML(test.console.map((entry) => typeof entry === 'string' ? entry : `${entry.type}: ${entry.text}`).join('\n'))}</pre></details>` : ''}
    </section>`);
  }
  markdown.push('## Coverage limits', '', ...coverageLimits.map((limit) => `- ${escapeMarkdown(limit)}`), '');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>QaLi report — ${escapeHTML(report.project)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#18212b;background:#f7f9fb}h1,h2{line-height:1.2}header,section{background:white;padding:24px;border:1px solid #dce3e9;border-radius:10px;margin:20px 0}h2 span{font-size:14px;margin-left:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:14px;border-radius:6px}img{max-width:100%;border:1px solid #dce3e9}figure{margin:20px 0}figcaption{font-size:14px;color:#536476}.passed{color:#136138}.failed{color:#a32921}li{margin:8px 0}a{color:#1755a0}</style></head>
<body><header><h1>QaLi report: ${escapeHTML(report.project)}</h1><p><strong>${escapeHTML(headline(report))}</strong></p><p>Target: ${escapeHTML(report.baseURL)}<br>Run: ${escapeHTML(report.runId)}<br>Started: ${escapeHTML(report.startedAt)}<br>Finished: ${escapeHTML(report.finishedAt)}</p></header>
${report.status === 'error' ? `<section><h2>Run incomplete</h2><p class="failed">Runtime error</p><pre>${escapeHTML(report.error)}</pre><p>Run <code>npm run qali -- doctor</code> to diagnose setup. Review this report, fix the runtime error, and rerun the unchanged checks.</p></section>` : ''}
${sections.join('\n')}<section><h2>Coverage limits</h2><ul>${coverageLimits.map((limit) => `<li>${escapeHTML(limit)}</li>`).join('')}</ul></section></body></html>\n`;

  await Promise.all([
    writeFile(path.join(runDir, 'report.json'), `${JSON.stringify({ ...report, coverageLimits }, null, 2)}\n`, 'utf8'),
    writeFile(path.join(runDir, 'report.md'), `${markdown.join('\n')}\n`, 'utf8'),
    writeFile(path.join(runDir, 'report.html'), html, 'utf8'),
  ]);
}
