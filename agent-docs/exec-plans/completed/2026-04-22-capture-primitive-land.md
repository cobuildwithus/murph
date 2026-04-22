# Land the supplied generic capture primitive patch in the narrow capture/raw/CLI/usecase/assistant/doc slice

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

Land the supplied generic capture primitive patch as a narrow cross-owner feature addition over the existing canonical event, raw-attachment, CLI, usecase, and assistant-tool seams.

## Success criteria

- `capture` remains a generic durable model built from tagged canonical note events plus immutable `raw/captures/**` artifacts.
- CLI and assistant write surfaces can add, list, show, and inspect manifests for single or batch captures.
- Stable-label lookup works for capture reads without changing the canonical event id contract.
- Required verification and completion-workflow audits pass, or any unrelated blockers are documented precisely.

## Scope

- In scope:
- `packages/core/src/{constants.ts,domains/events.ts,event-attachments.ts,index.ts,public-mutations.ts,raw.ts}`
- `packages/contracts/src/{constants.ts,vault-families.ts}`
- directly coupled `packages/contracts/test/vault-layout-validation.test.ts`
- `packages/vault-usecases/package.json`
- `packages/vault-usecases/src/{captures.ts,index.ts,usecases/{capture.ts,integrated-services.ts,types.ts,vault-usecase-helpers.ts}}`
- directly coupled `packages/vault-usecases/test/{capture.test.ts,public-entrypoints.test.ts}`
- `packages/cli/src/{commands/capture.ts,vault-cli-command-manifest.ts,incur.generated.ts}`
- directly coupled `packages/cli/test/incur-smoke.test.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/vault-write.ts`
- directly coupled `packages/assistant-engine/test/assistant-cli-tools-capabilities.test.ts`
- `packages/operator-config/src/{vault-cli-contracts.ts,operator-config/cli-vault-defaults.ts}`
- `agent-docs/product-specs/{index.md,captures.md}`
- `agent-docs/index.md`
- `ARCHITECTURE.md`
- Out of scope:
- dermatology-specific schemas, diagnosis logic, or anatomical ontologies
- unrelated assistant-engine channel-runtime edits already present in the tree
- unrelated active Health Commons, hosted, or app work

## Constraints

- Technical constraints:
- Treat the supplied patch as bounded intent; reconcile drift against the live tree without widening into unrelated vault, gateway, or hosted work.
- Preserve unrelated dirty-tree edits already present elsewhere in the repository.
- Do not touch the pre-existing unrelated assistant-engine channel runtime/test edits already present in this checkout.
- Keep the durable model generic: tagged note events plus immutable `raw/captures/**`, not a dermatology-specific schema.
- Product/process constraints:
- Update the durable product and architecture docs in the same change because this introduces a new persisted-state seam.
- Run the repo-required owner verification lane plus the required `coverage-write` and `task-finish-review` audit passes before commit.

## Tasks

1. Apply the supplied patch intent across the core, contracts, usecase, CLI, assistant, operator-config, and docs seams without widening scope.
2. Add or adjust focused proof so the new capture owner, read model, and CLI surfaces are exercised directly.
3. Run the required verification lane plus completion-workflow audits, fix any findings, and rerun the affected checks.
4. Finish with a scoped commit through `scripts/finish-task`.

## Decisions

- Keep the canonical durable event as a `note` plus the `capture` tag instead of introducing a specialized event kind.
- Store raw media under `raw/captures/YYYY/MM/<event-id>/**` and keep manifests owned by the same capture id.
- Resolve stable labels in the usecase/query layer while preserving the event id as the canonical lookup id returned by the read model.
- Enforce the mandatory `capture` tag inside `core.addCapture()` so non-CLI callers cannot create raw capture notes that disappear from capture read paths.

## Verification

- Commands run:
- `pnpm typecheck`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/core test:coverage`
- `pnpm --dir packages/operator-config test:coverage`
- `pnpm --dir packages/vault-usecases test:coverage`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/cli exec vitest run test/incur-smoke.test.ts --config vitest.config.ts --no-coverage -t "capture descriptor exposes the add, show, list, and manifest leaves"`
- `pnpm test:smoke`
- direct built-CLI proof for `capture add`, `capture list`, `capture show`, and `capture manifest`
- Expected outcomes:
- The capture primitive lands as a generic note-plus-raw owner seam with working CLI, assistant, and query/read behavior.
- Actual outcomes:
- The required `coverage-write` audit added focused proof for vault-usecases, CLI manifest exposure, and assistant tool capabilities.
- The required `task-finish-review` audit found one real core invariant gap and one test-modeling gap; both were fixed locally.
- `pnpm typecheck` passed.
- The scoped owner coverage commands for contracts, core, operator-config, vault-usecases, and assistant-engine passed.
- The focused CLI smoke assertion for the new `capture` descriptors passed.
- `pnpm test:smoke` passed.
- The built CLI proof passed: batch `capture add` created `raw/captures/**`, `capture list` returned both records, and label-based `capture show` and `capture manifest` resolved to the latest canonical event id and manifest.
Completed: 2026-04-22
Completed: 2026-04-22
