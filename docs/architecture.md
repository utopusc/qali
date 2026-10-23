# How QaLi works

QaLi turns a reviewed JSON test plan into recorded browser checks. AI can propose plans and help interpret failures, but the runner's assertions determine test outcomes.

## From goal to report

1. `init` creates project configuration, a written goal, and a basic starter plan.
2. `inspect` reads bounded page text and control information from the real app. An existing assistant can use this information and the bundled skills to write a draft. The optional `plan --ai` command requests a draft from a configured model endpoint.
3. The user reviews expected results and interactions before adopting or selecting a draft.
4. `run` validates the whole plan, checks interaction authorization, and runs each test in a new Chromium context.
5. JSON, Markdown, and HTML reports preserve the outcomes and available failure evidence. `summary` describes the latest attempt, including incomplete attempts.

## Source layout

| Files | Responsibility |
| --- | --- |
| `bin/qali.mjs`, `lib/cli.mjs` | Command entry point, guided menu, project workflow, and exit codes |
| `lib/config.mjs` | Configuration validation, project-contained paths, and safe initialization |
| `lib/plan.mjs` | Declarative plan validation, supported fields, and step ordering |
| `lib/runner.mjs`, `lib/navigation.mjs` | Browser execution, origin boundaries, isolated tests, and evidence capture |
| `lib/summary.mjs` | Human-readable summaries and escaped, portable reports |
| `lib/inspect.mjs`, `lib/ai.mjs` | Bounded page observation and optional model requests |
| `lib/skills.mjs`, `skills/` | Canonical assistant instructions and project installation |
| `tests/tool/` | Toolkit regression tests using disposable apps and provider fixtures |

The `demo/` app and its separate tests are optional examples. Testing another app does not depend on running the demo.

## Data and trust boundaries

Project files are stored in the selected `--project` directory. Configured input and output paths stay inside it. Initialization and skill installation preserve existing files. Model-generated plans are saved as drafts without replacing the active plan.

Plans contain a fixed set of [supported actions](plan-format.md), not executable JavaScript or shell code. Browser steps require a preceding `goto`; request-only tests can run without navigation. Cross-origin navigation is blocked, while ordinary page subresources may use their normal origins. Interactions require `--allow-actions`; default plans can use passive checks.

The existing-assistant workflow uses that assistant's own access and permissions. A direct model request occurs only through `plan --ai`, which sends the goal and bounded app observation to the configured endpoint. Page content and returned plans are untrusted data. Credentials belong in environment variables, not project JSON.

## Result integrity

Completed runs are `passed` or `failed`. A runtime interruption is `error`, shown as **INCOMPLETE**, with completed results retained and no invented outcomes for unrun tests. Planned totals can therefore exceed completed counts. The latest-attempt record prevents an earlier passing report from being presented as the current outcome.

Failed assertions retain their expected behavior. A failed step stops its test; later tests continue unless a runtime failure prevents execution. Reports and failure evidence are written to a new run directory. A later rerun creates new evidence rather than erasing the failure. See [verification](verification.md) for checks and known limits.
