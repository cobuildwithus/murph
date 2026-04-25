# Add hosted runner-output validation regressions

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Add regression coverage for hosted runner-output bundle validation and hosted execution log diagnostics so malformed runner output fails predictably in the Worker runtime and remains debuggable through hosted-local status/log surfaces.

## Success criteria

- A Workers-runtime Vitest test exercises `assertHostedAssistantRuntimeJobResultAsync` with valid gzip/base64, malformed archive, and malformed base64 runner-output payloads.
- A hosted-local E2E or closest existing local harness assertion proves invalid runner output does not commit a snapshot and exposes `bundle_archive_validation_error` diagnostics with useful redacted details.
- A centralized hosted execution log serializer test proves error logs preserve schema/phase/component/errorCode/errorMessage, reject ISO-timestamp-only messages, keep useful safe details, and redact sensitive fields.
- Focused Cloudflare/hosted-execution checks and typecheck pass or any unrelated blocker is documented.

## Scope

- In scope:
  - `apps/cloudflare/test/workers/**` Worker-runtime validation regression coverage.
  - Existing hosted-local E2E/test harnesses that already model runner-output validation, retry, and quarantine behavior.
  - Centralized hosted execution log serializer tests and minimal serializer changes if coverage exposes a real gap.
- Out of scope:
  - New product surfaces, live Cloudflare deploy behavior, broad logging redesign, and unrelated hosted assistant notification or typing work.

## Constraints

- Technical constraints:
  - Keep `apps/cloudflare` execution-plane-only; `apps/web` remains the hosted control-plane/product-state owner.
  - Preserve retry/quarantine semantics and avoid weakening malformed output validation.
  - Do not add dependencies.
- Product/process constraints:
  - Preserve unrelated dirty work and active hosted/research ledger rows.
  - Do not expose local paths, contact identifiers, credentials, or raw hosted payloads in committed fixtures/log expectations.

## Risks and mitigations

1. Risk: Worker-runtime and Node-runtime APIs diverge around gzip/base64 validation.
   Mitigation: Put the validator proof under `apps/cloudflare/test/workers/**` so it runs in the Cloudflare Vitest pool.
2. Risk: E2E assertions become brittle if they depend on incidental log wording.
   Mitigation: Assert durable codes, safe detail keys, non-timestamp message shape, and snapshot/retry/quarantine outcomes.
3. Risk: Observability tests accidentally bless sensitive detail leakage.
   Mitigation: Assert useful allowlisted diagnostic fields and explicit redaction of sensitive-ish fields.

## Tasks

1. Inspect current validator, Worker test config, hosted-local runner-output tests, and hosted execution log serializer.
2. Add the Worker-runtime validator regression test.
3. Add or strengthen hosted-local E2E assertions for invalid runner-output diagnostics, snapshot commit prevention, and retry/quarantine behavior.
4. Add or strengthen centralized log serializer guardrail coverage.
5. Run focused verification, required audits, and close/commit the scoped plan if safe.

## Decisions

- Use existing harnesses before adding new helpers.
- Prefer assertions on stable diagnostic codes and structured details over full message snapshots.
- Preserve hosted-local retry semantics by carrying retry attempt counts in the local hosted-run control ledger; without that, the local quarantine path could not reach the production max-attempt branch.
- Normalize local runner-output bundle validation errors that cross the runner invocation boundary without operation details, but only when no authoritative current bundle ref exists so authoritative-bundle quarantine behavior remains intact.

## Verification

- Passed:
  - `pnpm --dir apps/cloudflare test:workers`
  - `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-execution-observability-side-effects.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-run-processor.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm typecheck`
Completed: 2026-04-25
