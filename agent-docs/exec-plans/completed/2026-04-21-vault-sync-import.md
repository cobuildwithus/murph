# Land hosted vault sync import patch

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the supplied hosted vault sync import patch without widening its architecture beyond the first-slice design: local CLI builds an import pack, hosted web stores/enqueues it, Cloudflare hydrates the side input, and assistant-runtime merges canonical-only vault content additively into the hosted snapshot.

## Success criteria

- The patch applies or is manually reconciled without overwriting unrelated dirty-tree work.
- Hosted sync import has focused tests for pack filtering/restoration and non-clobbering merge behavior.
- Typecheck/tests required by the repo workflow are run, or any unrelated blocker is named precisely.
- Required completion audit passes for a high-risk cross-surface repo change are completed before handoff.
- A scoped commit includes only this task's files plus the plan/ledger closeout.

## Scope

- In scope: core vault-sync import primitive, hosted execution contract, hosted web sync session/payload handoff, Cloudflare side-input hydration, assistant-runtime merge event, Settings sync card, CLI `sync push`, and directly coupled tests/docs required to keep the repo coherent.
- Out of scope: new sync daemon/service/queue, direct R2 upload plumbing, unrelated hosted-run wake refactors, unrelated Health Commons/UI changes, and unrelated active assistant-runtime or Cloudflare cleanup lanes.

## Constraints

- Technical constraints: preserve canonical vault ownership through `packages/core`; sync must be additive, non-deleting, and non-clobbering; hosted payloads stay encrypted/short-lived through the existing hosted control plane; Cloudflare must remain an execution plane, not a new product control plane.
- Product/process constraints: preserve unrelated dirty-tree edits; do not leak direct personal identifiers in generated files or commit content; update durable architecture/testing docs if the patch introduces lasting runtime contracts not already documented.

## Risks and mitigations

1. Risk: The patch overlaps active hosted/runtime lanes in the dirty worktree.
   Mitigation: apply with `git apply --check` first, inspect rejects/conflicts, and reconcile only the sync-specific files.
2. Risk: New persisted web state and runtime entrypoints drift from documented ownership.
   Mitigation: classify the state in architecture docs if needed and keep web as control-plane owner while Cloudflare only fetches side input for execution.
3. Risk: Local vault import pack leaks runtime files, secrets, or identifiers.
   Mitigation: inspect filtering tests and run identifier/diff scans before commit.

## Tasks

1. Inspect patch metadata, active ledger overlap, and application conflicts.
2. Apply or manually reconcile the patch.
3. Review diff for identifiers, secrets, broad casts, lazy assertions, and ownership-boundary issues.
4. Run focused verification for core/hosted-execution/assistant-runtime/CLI/web/Cloudflare slices, escalating to full acceptance if feasible.
5. Run required coverage, frontend, and final review audit passes.
6. Close the plan and create a scoped commit.

## Decisions

- Treat this as a high-risk cross-surface supplied patch landing, but skip the simplify audit because the large diff arrived as an external bounded patch rather than an organically developed local refactor.

## Verification

- Passed: `git diff --check`.
- Passed: `pnpm typecheck`.
- Passed: final scoped `bash scripts/workspace-verify.sh test:diff <vault-sync touched paths>`.
- Passed focused follow-ups while repairing generated/audit findings:
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core test:coverage -- vault-sync.test.ts`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/hosted-execution test:coverage`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-vault-sync-event.test.ts hosted-runtime-run-drain-coverage.test.ts`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli gen:config-schema`
  - `pnpm --dir packages/cli verify:package-shape`
  - `pnpm --dir packages/cli test`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/cloudflare test -- user-runner-resume-finalize.test.ts`
  - `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-sync-settings apps/web/test/settings-page.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-core apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/vault-sync-session-service.test.ts apps/web/test/vault-sync-payload-route.test.ts --no-coverage`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web test`
- Audit passes completed: coverage-write, frontend-review, task-finish-review. Findings were addressed with fail-closed side-input metadata checks, multi-session redacted sync summaries, refresh error handling, wrapping Settings footer actions, and extra web/Cloudflare/runtime tests.
Completed: 2026-04-21
