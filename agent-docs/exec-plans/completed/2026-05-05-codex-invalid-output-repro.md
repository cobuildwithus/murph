# Codex Invalid Output Reproducer

## Goal

Get to the bottom of the hosted assistant bug where resumed Codex sessions fail with provider validation errors like `input.N.output: Invalid input`, reproduce it locally, and add production-safe diagnostics for the exact resume/fallback path.

Success criteria:

- Identify whether the failure is tied to native Codex session resume after prior tool output.
- Add a local, production-shaped reproducer that exercises hosted assistant reply flow through the Codex app-server path or the closest deterministic local seam.
- Capture redacted evidence about the provider request/state shape without writing raw user messages, secrets, local account identifiers, or home paths.
- Emit verbose production diagnostics for invalid-output resume failures and fallback outcomes, using shape/count/fingerprint metadata rather than raw prompts, chat text, tool output, request bodies, or paths.
- Run focused verification for the reproducer.

## Scope

- `scripts/reproduce-codex-invalid-output-resume.mjs`
- `packages/assistant-engine/test/**` only if a lower-level deterministic seam is required.
- `packages/assistant-engine/src/**` only if root-cause inspection proves a minimal fix is required.
- `packages/assistant-runtime/src/hosted-runtime/**` only for persisting the new redacted diagnostic trace.

## Constraints

- Preserve unrelated dirty work and overlapping hosted-local rows.
- Do not expose raw chat contents or personal identifiers in artifacts, logs, docs, or commits.
- Prefer adding a deterministic reproducer before changing production behavior.
- Do not weaken hosted runtime auth, env, or resume invariants to make tests pass.

## Verification

- `node --check scripts/reproduce-codex-invalid-output-resume.mjs`
- `node scripts/reproduce-codex-invalid-output-resume.mjs`
- `pnpm exec tsx` one-off byte-preservation probe against the actual hosted
  bundle snapshot/restore functions for `.codex-hosted` JSONL continuity.
- `pnpm typecheck`
- Touched-artifact privacy scan and `git diff --check`.

## State

- Done: production database inspection found three failed hosted resumed Codex attempts:
  `2026-05-05T02:56:52Z` with `input.29.output: Invalid input` after 10
  provider actions, `2026-05-05T02:58:12Z` with `input.13.output: Invalid
  input` after 5 provider actions, and `2026-05-05T02:59:56Z` with
  `input.23.output: Invalid input` after 8 provider actions. Nearby resumed
  turns succeeded, so this is not a global hosted runtime outage.
- Done: code inspection tied the failed path to Codex native resume with
  `excludeResumeTurns: true`, provider-state optimization, and fresh-thread
  fallback only when the invalid-output resume failure happens before provider
  actions.
- Done: added a local reproducer that starts a real `codex app-server`, injects
  a persisted `function_call_output` with structured array output, restarts the
  app-server, resumes the thread with `excludeTurns: true`, and proves the next
  Responses request can contain `function_call_output.output` as an array. The
  local provider stub rejects that request with `input.3.output: Invalid input`.
- Done: checked the hosted snapshot/restore path. `restoreHostedBundleRoots`
  decodes bundle bytes and writes them back directly, and the one-off probe
  proved a structured `.codex-hosted` JSONL `function_call_output` survives
  snapshot/restore byte-for-byte with `output` still an array. Murph restore is
  not stringifying the Codex tool output.
- Done: added targeted production diagnostics for the invalid-output native
  resume path. The provider now emits redacted trace events for the resume
  failure and the fresh-thread fallback result, including failing input index,
  provider action counts, recent Codex event shapes, output shapes, resume
  session presence/match booleans, fallback success/failure, and fallback error
  preview when available.
- Done: hosted runtime now recognizes the diagnostic trace schema and persists
  the allowlisted scalar/short-array fields into `assistant.automation_detail`
  logs without raw provider session ids, prompts, request bodies, or tool output.
- Done: focused assistant-engine and hosted-runtime event tests passed, and both
  touched packages typechecked successfully.
- Done: simplify audit found duplicate item-type diagnostics and redundant
  hosted parser overwrites; both were removed.
- Done: security/privacy audit found unsafe arbitrary error previews and raw
  provider string trust in shape metadata; previews were replaced with
  message-length/presence metadata, and shape strings now use closed/coarse
  categories on both the engine and hosted-runtime sides.
- Done: final completion audit found hosted key-cap truncation risk and forged
  diagnostic string acceptance; diagnostics are now sanitized separately from
  contextual details, and hosted parser validation mirrors the closed schema.
- Now: implementation, audits, and focused verification complete.
- Next: land the scoped commit, then watch production
  `assistant.automation_detail` rows with
  `providerTraceKind=codex.invalid_output_resume_failure` and
  `providerTraceKind=codex.invalid_output_resume_fallback`.

## Completion Audit

- Required: get to the bottom of the three reported production failures.
  Evidence: production database rows show the same provider validation error class on resumed
  hosted Codex attempts, with provider actions already emitted before failure
  and successful nearby resumed turns proving the runtime was not globally down.
- Required: reproduce locally. Evidence:
  `scripts/reproduce-codex-invalid-output-resume.mjs` runs the real Codex
  app-server through start, persisted item injection, process restart, resume,
  and turn start, then prints metadata-only proof of the invalid output item.
- Required: keep artifacts redacted. Evidence: the reproducer summarizes item
  types and output kind only, sanitizes repo/home paths in error text, and does
  not print request bodies, raw chat, secrets, or local identifiers.
- Required: evaluate the hosted restore/stringify hypothesis. Evidence: the
  actual hosted bundle snapshot/restore functions preserve `.codex-hosted`
  file bytes and restore the structured output as an array.
- Unconfirmed: production did not capture the raw provider request body, so the
  exact production item at `input.29`, `input.13`, or `input.23` is not proven.
  The local repro proves a concrete resumed-session failure class matching the
  provider error shape and state path.
- Required: add production diagnostics for the next occurrence. Evidence:
  invalid-output resume failures now emit a redacted provider trace before
  fallback and a second trace after fallback succeeds or fails; hosted runtime
  allowlists the diagnostic schema and stores scalar/short-array fields in
  automation-detail logs.
- Required: verify diagnostics are redacted. Evidence: focused tests assert raw
  mocked tool text, URLs, and spoofed raw provider session ids do not appear in
  the emitted/persisted diagnostic JSON.
- Verification note: repo-wide `pnpm typecheck` is blocked before completion by
  a pre-existing generated Cloudflare deploy-bundle guard failure. A focused
  `hosted-runtime-workspace-assistant-phase` test file also has a pre-existing
  Vercel Gateway Stripe customer-id expectation failure unrelated to the
  diagnostic logging path.
- Verification note: scoped `workspace-verify test:diff` passed dependency,
  workspace-boundary, hosted stale-name, raw-health-log, package typecheck,
  assistant-cli test, and assistant-engine test steps, then failed in
  `packages/assistant-runtime test` on pre-existing expectations for hosted
  Codex `wire_api`, device-sync optional config fields, and Vercel Gateway
  Stripe customer id propagation. The touched focused hosted-runtime events
  test still passes.
- Audit note: required simplify, security/privacy, and final completion audit
  subagents completed. All medium findings were fixed and focused package tests
  plus typechecks were rerun afterward.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
