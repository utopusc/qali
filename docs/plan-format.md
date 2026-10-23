# QaLi plan format

A plan is a JSON object with `version`, `name`, and `tests`. It contains 1–30 tests; each has 1–30 steps and at least one assertion. Unknown fields, unknown actions, malformed targets, and invalid values are rejected before browser actions.

## A first passive check

Replace the heading below with one your app is expected to show:

```json
{
  "version": 1,
  "name": "Home page checks",
  "tests": [
    {
      "id": "home_heading",
      "title": "The home page shows its main heading",
      "steps": [
        { "action": "goto", "path": "/" },
        {
          "action": "expectVisible",
          "target": { "role": "heading", "name": "Welcome", "exact": true }
        },
        { "action": "expectNoPageErrors" }
      ]
    }
  ]
}
```

`name` and each test's `title` describe the purpose in plain English. Test `id` values must be unique and contain only letters, digits, underscores, or hyphens. JSON does not allow comments or trailing commas.

Each test gets a new browser context. A `goto` must precede every browser assertion or interaction in that test; validation rejects a browser step without one. Tests containing only `request` checks are valid without `goto`. Do not depend on another test's cookies, login, or page state. A failed step stops its test, while other tests continue unless a runtime error prevents execution.

## Choose a target

A target identifies a page element. Use exactly one of these shapes; do not combine locator types. Prefer accessible roles and labels when they identify one element clearly.

| Shape | Example | Meaning |
| --- | --- | --- |
| `role`, optional `name`, optional `exact` | `{ "role": "button", "name": "Search", "exact": true }` | Match an accessible role and optional accessible name |
| `label` | `{ "label": "Search products" }` | Match a form control's label |
| `text` | `{ "text": "No products found" }` | Match visible text |
| `testId` | `{ "testId": "search-results" }` | Match a `data-testid` attribute |
| `css` | `{ "css": "main h1" }` | Match a CSS selector |

`exact` is a boolean supported only on a role target. If omitted, role-name matching uses Playwright's default behavior. A locator matching multiple elements can fail; make it specific rather than choosing an arbitrary first match. Targets do not execute JavaScript.

## Supported steps

Each step includes `action` plus only the fields listed below.

| Action | Fields | What it does |
| --- | --- | --- |
| `goto` | `path` | Navigate to a relative path or same-origin absolute URL |
| `click` | `target` | Click an element; requires `--allow-actions` |
| `fill` | `target`, `value` | Fill a field with a string; requires `--allow-actions` |
| `press` | `target`, `key` | Press a key such as `Enter`; requires `--allow-actions` |
| `select` | `target`, `value` | Select an option by its string value; requires `--allow-actions` |
| `check` | `target`, `checked` | Set a checkbox or radio state using a boolean; requires `--allow-actions` |
| `expectVisible` | `target` | Assert the element is visible |
| `expectText` | `target`, `value` | Assert element text contains the given string |
| `expectTitle` | `value` | Assert the page title contains the given string |
| `expectURL` | `path` | Assert the current URL exactly equals the resolved URL |
| `expectNoPageErrors` | None | Assert no uncaught page errors were observed in this test before this step |
| `request` | `path`, `expectedStatus`, optional `bodyContains` | Make a GET request and assert final status and optional response substring |

`request` counts as an assertion. `expectedStatus` is an integer from 100 to 599; `bodyContains` is a string. A request follows same-origin redirects before checking the final response. `goto` treats HTTP 400 and higher as navigation failures; use `request` to check an expected error status.

Paths resolve against the configured `baseURL`. Navigation and redirects outside that origin are blocked; ordinary page subresources can use their normal origins. There is no arbitrary script execution, shell execution, POST request, file upload, or custom step type.

## A reviewed interaction

This example searches a test catalog. Replace labels, product text, and test IDs with values from your own app. Review it before running with `--allow-actions`:

```json
{
  "version": 1,
  "name": "Catalog search",
  "tests": [
    {
      "id": "known_product",
      "title": "Searching a known product shows that product",
      "steps": [
        { "action": "goto", "path": "/products" },
        { "action": "fill", "target": { "label": "Search products" }, "value": "Blue mug" },
        { "action": "click", "target": { "role": "button", "name": "Search", "exact": true } },
        { "action": "expectText", "target": { "testId": "search-results" }, "value": "Blue mug" }
      ]
    }
  ]
}
```

Assertions must express the intended behavior, not just whatever the page currently happens to display. Do not remove a failed assertion or change its expected value solely to get a pass.

## Configuration and outputs

`qali.config.json` uses these fields:

```json
{
  "version": 1,
  "name": "My app",
  "baseURL": "http://localhost:3000",
  "plan": "qali.plan.json",
  "outputDir": ".qali/runs",
  "timeoutMs": 10000
}
```

The plan and output paths resolve inside the project directory. The displayed plan path, output path, and timeout are defaults. `baseURL` must use HTTP or HTTPS and cannot contain embedded credentials. Keep keys, passwords, and other secrets out of both config and plans.

Every run writes a new report. The JSON report has this shape; optional fields appear only when available:

```text
version: 1
runId, project, baseURL, startedAt, finishedAt
status: "passed" | "failed" | "error"
error?: string
counts: { passed, failed, total }
coverageLimits: [string]
tests: [
  {
    id, title, status,
    steps: [{ action, status, error? }],
    error?, runtimeError?, screenshot?, trace?, evidenceErrors?, console: []
  }
]
```

`counts.total` is the number of planned tests. `counts.passed + counts.failed` is the number with completed outcomes. A runtime error sets the report's `status` to `error` and records `error`; summaries display **INCOMPLETE**. An attempted but unfinished test can have `status: "error"` and `runtimeError`. Tests never reached may be absent from `tests`; they are not counted as passes or failures. Completed test outcomes remain recorded even if later setup or cleanup fails.

`screenshot` and `trace` are evidence paths relative to the run directory. `evidenceErrors` records capture problems when present. Console entries contain `type` and `text`; they are evidence, not automatic failures. The runner also produces Markdown and self-contained HTML reports. `.qali/latest-attempt.json` tracks the current attempt so an error cannot make an earlier passing report appear current. Errors before a run directory is created may have no full report.

Reports record step actions and errors rather than an immutable copy of the full plan. Keep the exact reviewed plan if you need to reproduce an older run; a newer active plan may no longer describe it. Recorded checks determine the result; AI interpretation does not change it. No plan can establish coverage of behavior it never checks.
