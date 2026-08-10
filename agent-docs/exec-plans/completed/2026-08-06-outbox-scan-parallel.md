# Bound hosted outbox inventory scan latency

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Cut upper-tail hosted outbox inventory latency by reading independent intent
  files with small bounded concurrency.
- Add metadata-only file and byte counts so future incidents can distinguish
  filesystem latency from unusually large persisted intents.

## Root-cause evidence

- The affected cold attempt spent 1,026 ms in the pre-provider outbox scan.
- The current inventory reader awaits every JSON file serially even though the
  files are independent and the result is sorted only after all reads finish.
- Long-idle attempts for the affected runtime had materially higher scan tails
  than closely spaced attempts, consistent with serialized cold-file reads.
- Parsing and schema-validating 100 representative intents took roughly 11 ms,
  leaving filesystem work as the dominant measured boundary for ordinary-sized
  records.
- The user-provided canonical vault export contains no assistant runtime or
  outbox records, and current telemetry does not report outbox files or bytes.

## Success criteria

- Outbox inventory reads use a fixed, small concurrency bound with no new
  dependency, service, persisted index, or state owner.
- Existing schema validation, invalid-file quarantine, disappearing-file race
  handling, and deterministic delivery ordering remain unchanged.
- Scan metrics report elapsed milliseconds, JSON files read, and UTF-8 bytes
  read without paths, message content, or identifiers.
- Focused tests prove the concurrency bound is greater than one, never exceeds
  the configured limit, preserves ordering, and retains corrupt-file behavior.

## Scope

- Assistant-engine outbox inventory store.
- Auto-reply history scan telemetry.
- Hosted-execution latency contract and parser for two additive numeric leaves.
- Focused assistant-engine tests and directly affected hosted-runtime fixtures.

## Constraints

- Do not lower retention or delete terminal delivery history.
- Do not add a sidecar index, schema migration, queue, dependency, or runtime
  owner.
- Keep observability metadata-only and preserve foreground reply priority.
- Keep the change compatible with existing workspace snapshots and retained
  outbox records.

## Tasks

1. [x] Add bounded parallel inventory reads and byte/file scan metrics.
2. [x] Add focused concurrency, ordering, quarantine, and telemetry coverage.
3. [x] Run focused tests, package typecheck, and direct diff/privacy review.
4. [x] Push the exact candidate and run required ReviewGPT gates with CI.
5. [x] Resolve findings, close this plan through the scoped final commit, and
   hand off deployment verification.

## Verification log

- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-outbox-thresholds.test.ts
  test/assistant-automation-reply-event-path.test.ts` from
  `packages/assistant-engine`: 65 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-outbox-runtime.test.ts --reporter=verbose` from
  `packages/assistant-engine`: 89 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/hosted-runtime-control.test.ts` from `packages/hosted-execution`: 32
  tests passed.
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage
  test/hosted-runtime-maintenance.test.ts` from `packages/assistant-runtime`: 76
  tests passed.
- `pnpm typecheck` passed independently in `packages/assistant-engine`,
  `packages/hosted-execution`, and `packages/assistant-runtime`.
- `git diff --check` and the scoped identifier/secret-pattern scan passed.
- Representative shared-reader caller coverage passed: 43 newsletter,
  vault-file, and store tests; 210 hosted callback tests; 7 CLI service-seam
  tests; and 5 daemon status tests.
- Preliminary specialists found no correctness or coverage defect. The request
  for an exact cold-Cloudflare base/head latency comparison remains a declared
  post-deploy measurement because the supplied export has no runtime outbox and
  a mocked or page-cached local result would not prove production cold storage.
- Final ReviewGPT round 1 found that the PR description understated the shared
  reader's production reach. The implementation already kept the correct single
  owner; the PR contract now names creation/dedupe, delivery/wake, newsletter,
  vault-file, status, daemon, and CLI consumers and their representative proof.
- Final ReviewGPT round 2 passed with no findings after the scope correction.
- A later main merge exposed unrelated upstream expectation drift: hosted
  conversation identities now include `sessionId: null`, and exact-session CLI
  input preserves the saved participant binding. After merging current `main`,
  both affected assistant-runtime test files passed (286 tests), the focused
  CLI state test passed (34 tests), and the `packages/assistant-runtime`
  typecheck passed.
Completed: 2026-08-06
