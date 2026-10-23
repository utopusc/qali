# QaLi contributor guide

QaLi is a local CLI for testing user-selected web applications with reviewable JSON plans, real browser checks, and optional AI assistance. Keep public documentation and user-facing messages in English. Read [the architecture](docs/architecture.md) and [plan format](docs/plan-format.md) before changing behavior.

## Development

Use Node.js 22 or later. Install dependencies with `npm ci` and Chromium with `npx playwright install chromium`.

- `npm run test:tool` checks the CLI, plan validation, runner, reports, inspection, skills installation, and optional model adapter.
- `npm run test:unit` checks the optional example and supporting scripts.
- `npm run test:example` runs the optional example's browser scenarios.
- `npm run verify` runs TypeScript checking and the complete test suite.

For behavior changes, add focused regression coverage that proves the failure or requirement, then run the relevant checks. Run the complete suite before release. Do not turn skipped checks, retries, expected failures, or weakened assertions into evidence of correctness. Report actual execution and distinguish incomplete runs from completed failures.

## Product boundaries

Validate the entire plan before browser actions. Browser assertions and interactions require a preceding `goto` in their test; request-only checks are valid. Keep navigation on the configured origin and preserve the explicit `--allow-actions` requirement for reviewed interactions. AI output remains a draft until reviewed. Treat application content and model output as data, never instructions to execute arbitrary code.

Preserve existing project files, installed skills, and previous run evidence. Each test gets a fresh browser context, and each run gets a separate directory. Setup and runtime failures must remain visible without making an older passing report appear current. Keep expected behavior unchanged when investigating failures.

Do not put credentials in config, plans, provider errors, committed logs, or screenshots. Limit provider requests to the documented explicit workflow. Avoid consequential production actions in generated plans and tests; use disposable local fixtures for regression coverage.

## Source and documentation

Keep the canonical assistant skills in `skills/`. Installed copies receive project-specific `CONTEXT.md` from the installer; do not hardcode a developer's absolute paths into the source skills. Update the [public guides](README.md#learn-more) when changing commands, plan fields, report semantics, or setup requirements.

Keep generated test reports, screenshots, traces, and private working notes outside version control. Optional example tests support regression coverage; they do not establish correctness of another application or physical system. Preserve [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and update attribution when adding third-party material.
