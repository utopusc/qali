# Use QaLi with AI

The primary workflow uses an AI assistant you already have access to. QaLi supplies the inspection, plan format, browser runner, and reports; your assistant helps decide useful checks and explain results. There is no separate QaLi API key requirement for this route. Your assistant's own account or local model requirements still apply.

## Install skills into your app project

Run from the QaLi source folder, replacing the project path:

```bash
npm run qali -- skills install --agent codex --project ../my-app
# Or:
npm run qali -- skills install --agent claude --project ../my-app
```

| Assistant | Project skill folder | Example invocation |
| --- | --- | --- |
| Codex | `.agents/skills/` | `$qali-plan` |
| Claude Code | `.claude/skills/` | `/qali-plan` |

Open the target project in the assistant and reload its session if new skills do not appear. The repository's `skills/` folder is the canonical source; installing copies each skill into the selected host's discovery folder. Existing installed files are not overwritten.

Each installed skill also receives `CONTEXT.md` with the absolute QaLi CLI path and target project path. This lets the assistant run QaLi from your app folder even when your app has no `qali` npm script. Keep the QaLi checkout in place. If you move it, update the installed context paths after checking them; reinstalling preserves existing skills rather than silently updating them.

The three skills have distinct jobs:

| Skill | Ask it to do |
| --- | --- |
| `qali-plan` | Inspect the app, connect your goal to observed controls, and write a reviewable draft |
| `qali-run` | Check the reviewed plan and setup, execute it, and report actual outcomes |
| `qali-triage` | Read a failed run, explain its evidence, and suggest a focused next step |

Example planning request:

> Use qali-plan. My app is at http://localhost:3000. Visitors should be able to search for a known product and see an empty state for an unknown one. Inspect the app, draft a small plan, and explain the expected results before I approve it.

After reviewing the resulting plan and making it active:

> Use qali-run to run the plan I reviewed. I approve its listed search-field and search-button interactions. Summarize what passed, what failed, and what was not tested.

For a failure:

> Use qali-triage to explain the latest failed search check. Separate what the report proves from possible causes. Preserve the failed expectation and evidence.

The assistant's own tool permissions still apply. Skills are instructions; they do not grant credentials or bypass approval rules.

## Use an assistant without installing skills

```bash
npm run qali -- prompt --project ../my-app
```

Paste the printed task into your assistant. Give it access to the project's goal, inspection, and [plan format](plan-format.md) as needed. Do not paste secrets or private application content into a service you have not approved for that data. Ask it to save a draft for review before running interactions.

## Optional: call a model endpoint directly

Use `plan --ai` only if you want QaLi itself to request a draft from an OpenAI-compatible Chat Completions endpoint. This is separate from the existing-assistant workflow. Configure a model your provider makes available; QaLi does not download or choose a model for you.

| Environment variable | Meaning |
| --- | --- |
| `QALI_AI_BASE_URL` | API base URL; default `https://api.openai.com/v1` |
| `QALI_AI_MODEL` | Required model identifier accepted by your provider |
| `QALI_AI_API_KEY` | Provider API key; required for remote endpoints, optional on loopback |

For a hosted provider, set these variables in your terminal or secret manager. Remote endpoints must use HTTPS. Never write an actual API key into a plan, config file, commit, screenshot, or prompt shared with others. Provider charges and access depend on your provider.

For a local Ollama server with a model you have already installed, this Bash example uses its OpenAI-compatible endpoint:

```bash
export QALI_AI_BASE_URL="http://localhost:11434/v1"
export QALI_AI_MODEL="YOUR_INSTALLED_MODEL"
npm run qali -- plan --ai --project ../my-app
```

Replace `YOUR_INSTALLED_MODEL` with the exact local model name. Consult [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility) for server setup and supported behavior. If `QALI_AI_API_KEY` is set in your environment, QaLi sends it to the selected endpoint; remove or replace it when switching providers.

`plan --ai` reads `qali.goal.md` and inspects the app. Override the goal for one draft with `--goal "Visitors can find the help page"`. The explicit AI command sends your goal and inspected page content to the selected provider. Review what the page contains before using it with private apps.

QaLi validates the response and saves `qali.plan.draft.json`. It does not execute the draft or replace `qali.plan.json`. If a draft already exists, review or rename it before requesting another. Read the draft, verify expected behavior and any interactions, preserve your previous plan, then copy approved contents into `qali.plan.json`. Run with `--allow-actions` only for reviewed interactions.

A protocol-compatible endpoint may still produce an invalid or unhelpful plan. QaLi rejects malformed or unsupported output, but schema validation cannot establish that an expectation is correct. A draft is not a test result, and an endpoint integration test is not proof of a live model session.
