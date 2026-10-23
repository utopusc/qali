# QaLi

QaLi helps you test your own web app with an AI assistant and real browser checks. Describe what should work, review a small test plan, run it, and read a plain-English result with failure evidence. You do not need prior QA experience.

AI helps write plans and explain failures. Explicit checks in the plan determine pass or fail. QaLi runs locally with Node.js and Playwright; it is not a hosted service.

## Your first run

Install **Node.js 22 or later**, download this repository as a ZIP, extract it, and open a terminal in the extracted `qali` folder. Install the dependencies and browser:

```bash
npm ci
npx playwright install chromium
```

Start your own app using its usual command. The next example assumes it is available at `http://localhost:3000`; replace that URL and `../my-app` with your app's URL and project folder. Run these commands from the QaLi folder:

```bash
npm run qali -- init --project ../my-app --url http://localhost:3000 --name "My app" --goal "Visitors can find and use product search"
npm run qali -- doctor --project ../my-app
npm run qali -- inspect --project ../my-app
```

Open `../my-app/qali.plan.json` and read its starter checks. This starter is a small smoke test, meaning a basic check that the app responds; it does **not** test your stated goal yet. Run it after review:

```bash
npm run qali -- run --project ../my-app
npm run qali -- summary --project ../my-app
```

The run prints the result and paths to JSON, Markdown, and HTML reports under your project's `.qali/runs/` folder. Open the HTML report in a browser. A failure remains a failure, with evidence to help you investigate. If setup or execution cannot finish, QaLi reports **INCOMPLETE** rather than presenting an earlier passing run as current.

Running `npm run qali` opens a guided menu. Commands use the current directory as the target project unless you provide `--project`.

## Add checks with your AI assistant

Use Codex or Claude Code you already have access to. No separate QaLi API key is needed for this route. Install the bundled skills into your app project:

```bash
npm run qali -- skills install --agent codex --project ../my-app
# For Claude Code, use --agent claude instead.
```

Open your app project in that assistant and ask:

> Use qali-plan to inspect my app and draft checks for product search. Explain what each check proves and what it leaves untested.

Review the proposed `qali.plan.draft.json`: check the expected results, target URL, and every interaction. When satisfied, copy its contents into `qali.plan.json`, keeping any existing plan you want to retain. Ask the assistant to use `qali-run`, or run the CLI yourself. Plans containing clicks, typing, or other interactions also require `run --allow-actions`.

If your assistant does not support skills, `npm run qali -- prompt --project ../my-app` prints a task you can paste into it. See [AI assistants](docs/ai-assistants.md) for exact skill invocations and the optional direct model connection.

## Commands

Use `npm run qali -- <command>` from this source checkout. Every command accepts `--project PATH`.

| Command | What it does |
| --- | --- |
| `init` | Create config, goal, and starter plan without replacing existing project files |
| `doctor` | Check setup and explain what needs attention |
| `inspect` | Capture the real page's title, text, and controls for planning |
| `prompt` | Print a task for an existing AI assistant |
| `plan --ai` | Ask an optional configured model endpoint for a validated draft |
| `run` | Execute the reviewed active plan; add `--allow-actions` for reviewed interactions |
| `summary` | Explain the latest run attempt, including incomplete attempts |
| `skills install --agent codex\|claude` | Install planning, running, and triage skills into a project |

After `npm link` in the QaLi folder, you may use `qali` instead of `npm run qali --`. This is a local installation from source; no npm registry package is required.

## Learn more

- [Getting started](docs/getting-started.md): setup, review, reports, and troubleshooting.
- [AI assistants](docs/ai-assistants.md): skills, prompts, and optional model endpoints.
- [Plan format](docs/plan-format.md): supported checks, locators, and examples.
- [Architecture](docs/architecture.md): how the CLI, skills, runner, and reports fit together.
- [Verification](docs/verification.md): tested behavior, the installed-skill exercise, and limits.

Use an app and test data you are authorized to test. Default runs allow passive checks only. Do not put passwords, tokens, or personal records in plans. Prefer a development or staging app for interaction tests. QaLi does not manage sign-in sessions or start your app for you; every test gets a fresh browser context. A passing plan covers only the checks it ran, not all behavior, security, accessibility, or physical systems.

For contributors, `npm run verify` runs the project's checks. The local workcell simulator started by `npm run demo` is an optional example and regression fixture; it is not required to test your app. Read [AGENTS.md](AGENTS.md) before changing the toolkit.

QaLi uses Microsoft's [Playwright](https://github.com/microsoft/playwright) and adapts the [create-playwright](https://github.com/microsoft/create-playwright) starter. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
