# Land Junction production hardening patch

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied final Junction production hardening intent against the current checkout.
- Success means Junction webhooks consistently preserve upstream source-provider slugs across documented payload shapes, and floating-time Libre/Abbott records do not emit fake canonical timestamps from import windows.

## Success criteria

- Junction webhook job creation extracts `sourceProviderSlug` from `data.source.slug`, `data.source.provider`, top-level provider fields, and nested provider objects without changing account lookup or webhook acceptance semantics.
- Junction importer marks Abbott/Libre slug variants as floating-time sources and omits queryable canonical `occurredAt`/`recordedAt` for floating records while preserving raw provenance.
- Existing non-floating provider records still emit queryable timestamps through the current safe timestamp and window fallback path.
- Focused tests cover the two production-hardening behaviors.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/junction.ts`
  - `packages/device-syncd/test/*junction*`
  - `packages/importers/src/device-providers/junction.ts`
  - `packages/importers/test/*junction*`
- Out of scope:
  - New Junction provider surfaces, new webhook event types, source-aware query policy, SDK-only sources, glucose/CGM expansion, or hosted UI changes.
  - Broad refactors of the Junction greenfield primitive plans.

## Constraints

- Technical constraints:
  - The supplied patch file is malformed/truncated, so port only the bounded behavioral intent by reading current source and tests.
  - Preserve unrelated dirty work in the checkout.
  - Do not add dependencies or lockfile churn.
  - Keep source-provider extraction permissive for known Junction payload shapes but deterministic and string-normalized.
- Product/process constraints:
  - Do not write personal identifiers, secrets, raw credentials, raw provider payloads, or unredacted local paths into files, logs, docs, or commits.
  - Treat webhook ingress and health timestamps as high-sensitivity/high-risk surfaces and run the required completion reviews.

## Risks and mitigations

1. Risk: A permissive provider extractor could persist noisy object-shaped metadata.
   Mitigation: Normalize only scalar/string slug candidates and keep extraction read-only relative to the payload.
2. Risk: Omitting canonical timestamps for floating records could accidentally drop normal provider observations.
   Mitigation: Gate the omission behind explicit floating source slug variants and add regression tests for both floating and normal records.

## Tasks

1. Inspect current Junction provider/importer source and tests.
2. Port the webhook source-provider fallback and floating timestamp changes.
3. Add focused regression coverage for documented payload shapes and floating-time records.
4. Run focused package verification, required reviews, typecheck, and acceptance where feasible.
5. Finish the plan and create a scoped commit if safe.

## Decisions

- Treat the supplied patch as behavioral intent because `git apply` reports a malformed patch.
- Do not broaden the importer to synthesize alternate canonical timestamps for floating-time records; raw/provenance fields remain the durable evidence.
- Filter aggregator-only `junction` slug candidates from the webhook fallback so top-level provider identity does not masquerade as an upstream source provider.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --dir packages/device-syncd test`
  - `pnpm --dir packages/importers test`
  - `pnpm verify:acceptance`
  - Focused Vitest commands for added/changed Junction tests as needed during iteration.
- Expected outcomes:
  - Focused Junction tests pass.
  - Typecheck and acceptance pass, or unrelated active-work blockers are named with evidence.
- Outcomes:
  - `git diff --check` on scoped touched paths: passed.
  - Focused `packages/device-syncd` Junction provider test: passed, 29 tests.
  - Focused `packages/importers` Junction provider test: passed, 21 tests.
  - `pnpm --dir packages/device-syncd test`: passed, 33 files / 411 tests.
  - `pnpm --dir packages/importers test`: passed, 14 files / 159 tests.
  - `pnpm --dir packages/device-syncd test:coverage`: passed; final rerun after review fix reported all files 91.10% statements and `junction.ts` 88.88% statements.
  - `pnpm --dir packages/importers test:coverage`: passed; all files 93.47% statements and `junction.ts` 92.94% statements.
  - `pnpm typecheck`: passed before the later unrelated hosted-domain-crypto dirty edit appeared.
  - Later `pnpm --dir packages/device-syncd typecheck` rerun was blocked by unrelated dirty `packages/runtime-state/src/hosted-domain-crypto.ts` missing helper identifiers.
  - `pnpm test:smoke`: passed, scenario-manifest integrity for 184 scenarios, 6 sample inputs, and 24 golden-output directories.
  - `pnpm verify:acceptance`: failed in unrelated active-work lanes. The touched `packages/device-syncd` and `packages/importers` coverage lanes passed inside acceptance; failures were hosted-local command-surface expectations, core audit fixture missing `audit/2026/2026-04.jsonl`, and a CLI assistant self-target timeout.
  - Security/privacy review: no findings.
  - Coverage-write review: added the `provider.provider` webhook shape test; no importer coverage gap found.
  - Final completion review: one low-severity `provider: "junction"` fallback invariant finding; fixed with aggregator-slug filtering and regression coverage.
Completed: 2026-05-01
