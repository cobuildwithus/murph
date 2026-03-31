# Assistant-Core Hard-Cut Finalize

Status: completed
Created: 2026-03-31
Completed: 2026-03-31

## Goal

- Finish the assistant-side hard cut so `@murph/assistant-core` owns the full local-only assistant, inbox, vault, and operator-config implementation closure instead of re-exporting implementation from `murph/...`.

## Success criteria

- `packages/assistant-core/src/**` contains the local-only implementation closure needed by hosted runtimes and local daemons.
- `packages/assistant-core` no longer depends on `murph`.
- The assistant-core owner package does not consult assistantd-client fallbacks for service/store/status/outbox/cron/automation runtime behavior.
- `packages/assistant-runtime`, `packages/assistantd`, and `apps/cloudflare` no longer rely on a direct `murph` package dependency for this boundary.
- Boundary tests and docs validate `@murph/assistant-core` as the owner package.

## Scope

- In scope:
  - `packages/assistant-core/**`
  - `packages/assistant-runtime/package.json`
  - `packages/assistant-runtime/test/assistant-core-boundary.test.ts`
  - `packages/assistantd/package.json`
  - `packages/assistantd/test/assistant-core-boundary.test.ts`
  - `apps/cloudflare/package.json`
  - boundary docs that describe or verify the assistant-core owner package
- Out of scope:
  - lockfile refresh
  - gateway-core follow-up work
  - unrelated hosted-runner or gateway-serving changes already active in the tree

## Constraints

- Technical constraints:
  - Keep ownership one-way and acyclic; the owning package must not depend on `murph` for the same surface.
  - Preserve CLI-only routing, UI, and assistantd-client helpers in `packages/cli`.
- Product/process constraints:
  - Port the uploaded finalize patch intent onto the current split state rather than overwriting newer assistant/gateway work.

## Risks and mitigations

1. Risk: the patch spans a very large source-tree ownership move and can drift from the current CLI state.
   Mitigation: copy same-path sources from `packages/cli/src/**` into `packages/assistant-core/src/**`, then patch only the local-only deltas and boundary cutover changes.
2. Risk: stripping daemon fallbacks in the owner package could accidentally remove them from the CLI compatibility surface too.
   Mitigation: only rewrite the copied owner-package files and leave `packages/cli/src/**` behavior intact.
3. Risk: overlapping dirty work in assistant/gateway/Cloudflare files could be overwritten.
   Mitigation: stay within the patch scope and integrate on top of current modified files without reverting unrelated edits.

## Tasks

1. Copy the assistant-core implementation closure into `packages/assistant-core/src/**`.
2. Strip assistantd-client fallbacks from the copied owner-package service/store/status/outbox/cron/automation files.
3. Update assistant-core package metadata, downstream manifests, boundary tests, and docs for the dedicated owner package.
4. Run focused verification, workspace typecheck/tests, and fix any integration fallout.

## Decisions

- Recreate the owner-package source tree from the current CLI same-path files, then apply the finalize patch semantics on top, rather than reconstructing hundreds of files directly from patch hunks.
- Add the missing local `assistant/openai-compatible-provider-presets.ts` helper to the owner package so the copied setup/provider sources typecheck without routing back through CLI.
- Strengthen `VaultCliError` with explicit `code` and `message` fields so downstream source-mode consumers typecheck the copied assistant-core sources consistently.

## Verification

- `pnpm --dir packages/assistant-core exec tsc -p tsconfig.json --noEmit --pretty false`
- `pnpm --dir packages/assistant-runtime exec vitest run test/assistant-core-boundary.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/assistantd exec vitest run test/assistant-core-boundary.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`

## Outcome

- `@murph/assistant-core` now owns the copied local-only implementation closure and root exports directly from `packages/assistant-core/src/**`.
- The owner package no longer depends on `murph`, and downstream assistant-runtime / assistantd / Cloudflare manifests no longer declare that direct dependency for this boundary.
- Boundary tests now prove the owner package is self-contained, does not import `murph/*`, and does not consult assistantd-client fallbacks.
