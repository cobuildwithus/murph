# Harden hosted device-sync runtime mutation fences and wake-hint parsing

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Close the unfenced hosted runtime apply path where a seed-only update can mutate connection, local state, and token-bundle data without the optimistic-concurrency fences required by the other mutation branches.
- Tighten the generic hosted wake-hint parser so schedule timestamps use the same ISO-only expectations as the rest of the package and the generic payload shape does not accept arbitrary provider- or secret-like keys.

## Why

- `seed` is the strongest hosted runtime mutation shape and currently bypasses the `observedUpdatedAt` and `observedTokenVersion` guards when supplied without top-level `connection`, `localState`, or `tokenBundle`.
- The generic hosted wake-hint seam currently accepts loosely typed timestamp strings and arbitrary object payloads, which is broader than the manifest-owned hint shaping used elsewhere in `device-syncd`.

## Scope

- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/test/hosted-runtime.test.ts`
- directly coupled reverse-dependent tests:
  - `packages/hosted-execution/test/{device-sync-wake-parsers,parsers}.test.ts`
  - `apps/web/test/device-sync-hosted-wake-helper.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-device-sync-hosted-runtime-hardening.md,COORDINATION_LEDGER.md}`

## Out of scope

- provider-manifest redesign or attaching provider context to hosted wake hints
- broader hosted device-sync runtime behavior changes outside the parse/validation seam
- unrelated WHOOP or provider-runtime work already dirty in `packages/device-syncd/test/**`

## Constraints

- Keep the fix additive in the current dirty tree and avoid touching the unrelated WHOOP test edits already present in `packages/device-syncd/test`.
- Preserve the existing signed hosted runtime apply contract shape; this is a fail-closed validation tightening, not a payload redesign.
- Follow the high-risk repo workflow: plan-bearing lane, coverage-bearing verification, required audits, and a scoped commit only if the shared dirty tree permits it cleanly.

## Risks and mitigations

1. Risk: Tightening wake-hint payload validation could reject real callers if the implicit generic shape is wider than current tests show.
   Mitigation: Keep the generic shape intentionally small and provider-agnostic, add direct rejection coverage for malformed timestamps and disallowed keys, and preserve documented fields already exercised by the manifest-owned seam.
2. Risk: Changing seed fence requirements could break create semantics if callers rely on seed-only creates without concurrency fields.
   Mitigation: Apply the same fence rules to seed as the other mutation branches and cover the accepted create shape with both `observedUpdatedAt` and `observedTokenVersion` present, matching the current optimistic-concurrency contract.

## Tasks

1. Register the hosted `device-syncd` lane and inspect the existing parser and regression coverage.
2. Make seed participate in the hosted runtime mutation fence checks and add regression tests for rejected seed-only updates without both fences.
3. Tighten hosted wake-hint parsing to ISO timestamps plus an allowlisted generic payload subshape, with rejection tests for malformed schedule fields and secret-bearing keys.
4. Run truthful `packages/device-syncd` verification and direct scenario proof, then complete the required audit path and scoped commit/handoff flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/hosted-runtime.test.ts`
- Direct proof:
  - seed-only hosted runtime apply updates without `observedUpdatedAt` and `observedTokenVersion` are rejected
  - hosted wake hints reject non-ISO `nextReconcileAt` / `occurredAt` / `jobs[].availableAt`
  - hosted wake-hint payloads reject extra secret-bearing or provider-specific keys outside the allowlist

## Current results

- Implemented:
  - seed-bearing hosted runtime apply updates now require both `observedUpdatedAt` and `observedTokenVersion`
  - hosted wake hints now normalize and validate ISO schedule timestamps at parse time
  - hosted wake-hint job payloads now accept only the current manifest-aligned generic allowlist
  - focused proof now also rejects ISO-shaped but invalid `nextReconcileAt` values that fail `Date.parse`
- Green focused proof:
  - `pnpm --dir packages/device-syncd exec vitest run test/hosted-runtime.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir packages/hosted-execution exec vitest run test/device-sync-wake-parsers.test.ts test/parsers.test.ts test/hosted-execution-parsers-coverage.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-sync-hosted-wake-helper.test.ts --no-coverage`
- Broader required commands currently red for unrelated pre-existing issues:
  - `pnpm typecheck` stops in `packages/vault-usecases` on unresolved `@murphai/core` imports
  - `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/hosted-runtime.test.ts` stops in unrelated `packages/assistantd` typecheck errors around stale `executionDriver` / `resumeKind` literals
  - `pnpm --dir packages/device-syncd test:coverage` stops in pre-existing `packages/device-syncd/test/service.test.ts` with `Identifier 'store' has already been declared`, then reports existing threshold debt in `src/service.ts`, `src/store.ts`, and `src/store/webhook-traces.ts`
