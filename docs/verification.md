# Verification and limits

Run `npm run verify` from the QaLi folder to check TypeScript, unit tests, toolkit tests, and the optional example's browser scenarios. Dependencies and Chromium must be installed first. The suite checks behavior using disposable local applications rather than relying only on the bundled example.

On October 23, 2026, the complete `npm test` command, which runs the same verification entry point, passed TypeScript checking and **89 tests**: 36 optional-example unit tests, 45 toolkit tests, and 8 optional-example Playwright scenarios. There were zero failures or skipped tests. Guided terminal setup was also completed manually. This is a recorded verification snapshot, not a guarantee that every future environment or change will pass.

Meaningful toolkit coverage includes:

- Fresh-project setup, command errors, preservation of existing files, and installation for both supported assistant hosts.
- Plan schema and ordering, real passing and failing assertions, interaction opt-in, isolated browser contexts, and navigation boundaries.
- Escaped reports, failure screenshots and traces, runtime interruption reporting, and protection against stale passing summaries.
- Real DOM inspection and local HTTP provider fixtures for request shape, response validation, rejection paths, and timeouts.

## Installed-skill exercise

On October 23, 2026, an independent assistant used installed QaLi skills against a separate disposable catalog app. It inspected the interface, drafted checks, ran the reviewed draft with authorized search and cart interactions, and explained the recorded failure. The active starter plan remained unchanged.

The completed run reported **2 passed, 1 failed, 3 total**, with exit code `1`. The catalog and Camera-search checks passed. The cart check expected one item after one Add Camera click, but the deliberately faulty app displayed two. The original assertion remained intact, and a screenshot and browser trace recorded the mismatch. This demonstrates detection and triage of that controlled defect, not discovery of an unknown production bug.

The exercise used Chromium on Linux with Node.js 24.19.0 and Playwright 1.64.1. An initial local connection problem was resolved before the completed catalog run; its earlier failed evidence was retained separately.

## What this establishes

The exercise demonstrates the installed-skill workflow and actual browser execution for those three checks. The search check established that the expected product remained available after searching; it did not prove filtering excluded every unrelated result. Other search cases, checkout, persistence, other browsers, accessibility, security, and load were not tested in that exercise.

The direct AI adapter has been exercised with local HTTP protocol fixtures. **No real external model-provider call was performed.** Protocol tests establish request and response handling, not the quality of a live model's proposed plan. A passing QaLi run covers only its recorded checks and environment.
