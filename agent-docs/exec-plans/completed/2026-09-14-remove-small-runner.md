# Remove the member-specific small runner experiment

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal and scope

Remove the temporary member-specific one-vCPU allocation path, container class,
selector, namespace routing, deployment bootstrap and rollout branch, local
harness support, and matching private workflow/diagnostic wiring. Preserve the
regular fleet's allocation, fences, retention, checkpoint and recovery behavior.
Completed experiment records and unrelated sizing benchmarks remain historical.

## Success criteria

- No active experiment source, selector or special allocation/deploy path.
- Focused regular allocation, retention, deployment and local-harness tests pass.
- Both affected public typechecks and private verification pass.
- Review the full diff and commit each repository's scoped changes.

## Decisions and deployment boundary

- Delete experiment-only tests and retain composed regular-path proof.
- Keep immutable migration history and append the native namespace deletion.
- No new runtime compatibility layer or cleanup service. The old compatible
  release must disable selection, checkpoint and retire all stored targets
  before protected application/namespace deletion. The deploy owner documents
  the exact prerequisites and forward-only boundary.
- Source cleanup is authorized; production mutation, PR publication and live
  retirement are outside this task's current execution scope.
- No changelog: internal experiment retirement has no new member-facing feature.
- No assistant/provider input changes or new foreground awaited work; fresh
  allocation removes the selector's SHA-256 calculation.

## Verification

- Passed: 431 focused Cloudflare tests across allocation, retained sessions,
  binding lifecycle, deployment rendering/staging/admission and installed CLI.
  The final harness edit also passed its two focused allocation/retention tests.
- Passed: 120 local-harness tests and both affected public typechecks.
- Passed: 62 private environment-contract tests, 38 diagnostic tests, and actual
  public/private forwarding validation (88 variables, 36 secrets). The initial
  bare-Node forwarding check lacked built workspace package outputs; the source
  check passed with the repository's configured tsx resolver.
- Passed: complexity diff (no increased hotspot debt), diff whitespace check,
  parent source/test/deployment review, and authored-content privacy scan.
- Documentation drift and gardening passed after correcting the plan link.
- Private `pnpm verify` passed: typecheck, main 779-test suite, 131 deployment
  controller cases, build, 10 built-worker tests and all script/extension gates.
- Installed Wrangler against a synthetic API checks migration metadata and
  preservation of unrelated native applications; this does not prove live drain.

## Outcome

Source cleanup is complete in both repositories. The parent reviewed all changed
owners and retained regular allocation, standby fallback, warm binding, release
admission and provider isolation proof. Existing complexity hotspots are
unchanged; no new runtime state, service, dependency or foreground I/O was added.
No new repository friction entry was needed.

No PR, CI, ReviewGPT, deployment or production mutation was performed. Publishing
these deploy-boundary changes requires the repository's applicable PR review and
exact-head CI gates. Live retirement remains gated by the deploy owner's drain
and protected namespace-deletion procedure.
Completed: 2026-09-14
