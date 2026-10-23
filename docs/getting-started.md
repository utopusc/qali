# Getting started with QaLi

A test plan describes what to do and what should be true. An assertion is a check of that expected result. QaLi opens a real browser, follows the plan, and records each assertion's outcome.

## 1. Prepare the toolkit and your app

Install Node.js 22 or later. Download and extract the QaLi repository ZIP, then open a terminal in its folder:

```bash
npm ci
npx playwright install chromium
```

The first installation needs internet access. On Linux, missing browser system libraries may require `npx playwright install --with-deps chromium` in an environment where you can install those libraries.

Start your app with its normal development command and check that its URL opens in your browser. QaLi does not start or deploy your app. Localhost URLs are supported.

Examples below run from the QaLi folder and store test files in `../my-app`. Replace that path, app name, goal, and URL with your own. Quote paths containing spaces.

## 2. Create a QA project

```bash
npm run qali -- init --project ../my-app --url http://localhost:3000 --name "My app" --goal "Visitors can search the product catalog"
npm run qali -- doctor --project ../my-app
```

`init` creates:

| File | Purpose |
| --- | --- |
| `qali.config.json` | App URL, active plan path, output directory, and timeout |
| `qali.goal.md` | Your description of what should work |
| `qali.plan.json` | A starter smoke plan to review |

Existing files are preserved. The goal guides later planning; the starter does not establish that the goal works. Edit the goal as you learn more. With no arguments, `npm run qali` offers a guided menu. Outside the QaLi folder, use the locally linked `qali` command or the absolute CLI path supplied to installed skills.

## 3. Inspect and plan

```bash
npm run qali -- inspect --project ../my-app
npm run qali -- prompt --project ../my-app
```

Inspection records bounded page information in `.qali/inspection.json`. It shows the page that actually loaded, not an invented interface. A landing page cannot reveal all routes or business rules: tell your assistant which routes, inputs, and outcomes matter.

Give the printed task to your assistant, or install the [QaLi skills](ai-assistants.md). Ask for a few focused checks in `qali.plan.draft.json`. For example: “Search for a known product; expect its name in the results. Search for a nonsense phrase; expect the empty-state message.” Supply the real product and exact message from your app's requirements.

Review the draft before making it active:

1. Confirm the URL, routes, and controls belong to the intended app.
2. Confirm expected text and behavior match your requirements.
3. Read each click, fill, keypress, selection, and checkbox change.
4. Use disposable test data; remove purchases, deletion, messages, and account changes.
5. Preserve your previous plan, then copy the approved draft into `qali.plan.json`.

You may also write a plan yourself using the [plan format](plan-format.md). Generated plans are proposals, not evidence that a test passed.

## 4. Run the reviewed checks

For passive navigation, visibility, text, title, URL, page-error, and GET response checks:

```bash
npm run qali -- run --project ../my-app
```

For a reviewed plan that also interacts with the app:

```bash
npm run qali -- run --project ../my-app --allow-actions
```

Add `--headed` to see the browser. To run a reviewed alternative without changing the active plan, use `--plan qali.plan.draft.json`; the path is relative to your project.

QaLi validates the whole plan before browser actions. Each test starts with a fresh browser context, so tests must establish their own starting state. A `goto` step must precede browser assertions and interactions; tests containing only `request` checks do not need one. A failed step stops that test; remaining tests still run unless a runtime error prevents execution. QaLi does not retry failures or change expectations to obtain a pass.

## 5. Read the result

```bash
npm run qali -- summary --project ../my-app
```

Each run has its own directory under `.qali/runs/`. The command prints that directory; open its `report.html`, `report.md`, or `report.json`. JSON supports tooling; Markdown and HTML explain results for people. Failed tests include error details and, when capture succeeds, a screenshot and browser trace. Reports can contain application text and screenshots: review them before sharing.

To inspect a saved trace locally, run this from the QaLi folder, replacing the path with the `.zip` trace listed in the report:

```bash
npx playwright show-trace "path/to/TEST-ID.zip"
```

The trace viewer lets you examine recorded actions and page snapshots around the failure.

A failed assertion means an expected result was not observed. It may indicate an app defect, an incorrect expectation, or a setup problem. Ask `qali-triage` to compare the expectation with the recorded evidence before changing anything. Keep the original failure report when fixing the cause and rerunning.

An **INCOMPLETE** result means setup or execution could not finish normally. The summary shows completed tests versus planned tests and retains any results already recorded. Fix the reported problem before rerunning the unchanged checks. An earlier passing report remains available but is not presented as the result of this attempt. An error before execution may have no full report yet.

The `run` command exits with `0` for a passing run, `1` for a completed run with failed tests, and `2` for invalid configuration or setup/runtime errors. `summary` exits with `2` for an incomplete attempt; reading a completed report succeeds even if that report contains failed assertions. A pass applies only to executed checks. It does not prove the app is ready for every user or environment.

## Common setup problems

| Problem | Next step |
| --- | --- |
| `npm` or `node` is unavailable or too old | Install Node.js 22 or later, reopen the terminal, then retry |
| Dependency cannot be found | Run `npm ci` in the QaLi folder |
| Chromium is missing | Run `npx playwright install chromium` in the QaLi folder |
| App cannot be reached | Start it, open the configured URL yourself, and check its port |
| Invalid URL | Use an `http://` or `https://` URL without embedded credentials |
| Invalid JSON or unsupported plan field | Correct the reported field using the plan-format reference |
| Interaction is blocked | Review the interaction, then use `--allow-actions` if intended |
| A locator matches nothing or several elements | Inspect the page and use a unique label, role/name, or test ID |
| A sign-in page appears | Use a suitable test environment; QaLi does not import your browser's signed-in session |
| A redirect leaves the configured origin | Use the app's final intended URL as `baseURL`; cross-origin navigation is blocked |

Run `doctor` again after fixing setup. Do not weaken an assertion simply to turn a failed result green.
