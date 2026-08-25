# Vault CLI nutrition cancellation recovery

Status: active
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Keep an aborted hosted label request terminal while preserving retryable
  recovery for actual timeouts and transport failures.

## Success criteria

- Request-boundary `AbortError` failures use a stable cancellation code,
  `stage: transport`, and `retryable: false`.
- Hosted-runtime and credential configuration failures explicitly remain
  terminal at `stage: configuration`.
- `TimeoutError`, ordinary network failures, and response-body acquisition
  failures retain their existing recovery behavior.
- Focused source and prepared-artifact tests, CLI typecheck, and runner bundle
  proof pass.

## Scope

- In scope: the shared hosted food/supplement label request classifier, focused
  regression coverage, exact-head PR evidence, and review preparation.
- Out of scope: an internal retry loop, new error abstractions, or other CLI
  families.

## Risks and mitigations

1. Risk: treating cancellation as transient could prompt a pointless unchanged
   retry. Mitigation: classify only request-boundary `AbortError` as terminal.
2. Risk: collapsing body-read aborts could lose the branch's proven transient
   recovery. Mitigation: leave response-body acquisition classification intact;
   the shared request creates no caller-controlled signal for that phase.

## Tasks

1. Correct request-boundary cancellation classification without discarding its
   bounded transport name/code, and align configuration-stage metadata.
2. Add focused coverage proving cancellation is terminal and private exception
   text/query input do not enter the model-facing error.
3. Run source, prepared-runtime, typecheck, documentation, and bundle proof.
4. Inspect, commit, push, refresh the Draft PR, and review the exact candidate.

## Decisions

- Keep the existing owner-local classifier and metadata channel; no new state or
  retry machinery is warranted.
- Preserve safe error name/code diagnostics. Only exception messages, query
  values, provider bodies, and concrete credentials stay outside the envelope.
- Integrate the final shared foundation by retaining one typed request owner and
  deleting the downstream raw-response parser. Provider-schema failures remain
  fieldless because they are not model-correctable inputs; the nutrition branch
  continues to add only bounded transport name/code diagnostics.

## Verification

- `pnpm exec vitest run packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts`
  passed: 2 files, 42 tests.
- `pnpm --filter @murphai/murph typecheck` passed.
- `pnpm --dir packages/cli verify:prepared-runtime` and
  `pnpm --dir packages/cli verify:package-shape` passed.
- A direct import of the prepared `dist` food and supplement clients passed
  terminal cancellation and configuration-stage classification: 4/4.
- `pnpm docs:drift && pnpm docs:gardening` passed.
- `pnpm --dir apps/cloudflare runner:bundle` passed all eight unbundled/bundled
  parity probes. Vault CLI: 9,465,853 / 9,477,676 bytes total, 805 / 20,000
  bytes entry, 25,155 / 33,200 bytes static closure. Runner: 11,277,964 /
  11,393,617 bytes total, 1,740,666 bytes entry, 8,598,164 bytes static closure.
- Final-foundation integration focused proof passed 73 source tests across the
  food, supplement, and shared provider-recovery suites (29 prepared-runtime
  cases skipped); CLI typecheck passed.
- Prepared-runtime construction and the same three compiled suites passed all
  102 cases. CLI package shape, docs, workspace boundaries, and package-cycle
  checks passed.
- Production bundle assembly and all eight parity probes passed after the
  integration. Vault CLI is 9,467,768 of 9,477,676 bytes; the runner is
  11,277,949 of 11,393,617 bytes.
