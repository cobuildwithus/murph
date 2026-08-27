# Vault CLI nutrition review remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make nutrition-provider and private-protocol failures carry enough bounded,
  secret-safe structure for the model to choose the correct retry or repair.

## Success criteria

- Response-body transport failures are retryable and distinct from terminal
  response syntax/schema failures for both single and batch label searches.
- Protocol validation distinguishes submitted candidates from corrupt or stale
  stored vault state without parsing error messages.
- Validation repair expands safe unrecognized keys and never echoes unsafe keys
  or submitted values.
- Focused provider, core, use-case, CLI, and type checks pass.

## Scope

- In scope: shared hosted label response parsing, protocol validation metadata,
  explicit health-family error projection, and focused regression coverage.
- Out of scope: retry loops, provider response-body logging, unrelated CLI
  families, PR updates, pushes, and additional ReviewGPT runs.

## Constraints

- Technical constraints: use explicit allowlisted metadata only; keep recovery
  deterministic and bounded; preserve package ownership and dependency direction.
- Product/process constraints: remediate only the four accepted preliminary
  findings on the exact owned PR head and preserve unrelated work.

## Risks and mitigations

1. Risk: Retry guidance could loop on malformed provider data.
   Mitigation: only transport acquisition failures are retryable; syntax and
   schema failures remain terminal.
2. Risk: Validation diagnostics could expose submitted keys or values.
   Mitigation: allowlist safe path segments, use static messages, and fall back
   to the parent path for unsafe unrecognized keys.
3. Risk: Stored corruption could be misdiagnosed as a candidate input problem.
   Mitigation: core attaches an explicit validation source that the adapter
   branches on without inspecting messages.

## Tasks

1. Split response acquisition from response contract validation in the shared
   hosted label parser and add safe transport metadata.
2. Add bounded core protocol validation fields and source provenance, then map
   candidate and stored-state failures separately.
3. Expand safe unrecognized-key repair paths with a truthful unsafe fallback.
4. Add provider taxonomy and protocol recovery regression tests.
5. Run focused verification, inspect the full diff, and commit through
   `scripts/finish-task`.

## Decisions

- No retry loop is added; the error envelope tells the caller whether a retry is
  appropriate.
- `submitted_candidate` and `stored_vault_state` are the stable protocol
  validation sources.
- Provider response bodies, query values, raw exception messages, and unsafe
  validation keys remain outside model-facing metadata.

## Verification

- `pnpm exec vitest run packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts packages/cli/test/food-save-typed-parity.test.ts packages/core/test/protocols.test.ts packages/vault-usecases/test/health-registry-seams.test.ts packages/vault-usecases/test/record-service-coverage.test.ts packages/cli/test/protocol-save-typed-parity.test.ts`
  passed: 7 files, 93 tests.
- `pnpm --filter @murphai/core typecheck` passed.
- `pnpm --filter @murphai/vault-usecases typecheck` passed.
- `pnpm --filter @murphai/murph typecheck` passed.
- `git diff --check` and the added-line identifier/secret-pattern scan passed.
Completed: 2026-08-24
