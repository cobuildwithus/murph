# Device sync security worker batch

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Launch an overlap-aware `codex-workers` batch for the user's five concrete device-sync/runtime trust-boundary prompts in the shared current worktree.
- Merge the webhook-idempotency and hosted-signal minimization prompts into one lane because both change the webhook parsing/ingress/control-plane contract.

## Success criteria

- Active ownership for the parent orchestration lane and each worker lane is registered in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before launch.
- One raw prompt file exists per final worker lane under `agent-docs/exec-plans/active/worker-prompts/2026-03-27-device-sync-security-batch/`.
- The batch is launched through `../workspace-docs/bin/codex-workers` against the shared current worktree.
- Each prompt explicitly calls out overlapping active lanes and any dirty-file risks so workers preserve unrelated edits.
- Run artifacts land under `.codex-runs/` for collection and later integration.

## Scope

- In scope:
  - prompt shaping for the requested security/reliability fixes
  - overlap-aware lane design for the shared current worktree
  - worker launch orchestration, result collection, integration, and final verification
- Out of scope:
  - broad reprioritization of unrelated active lanes

## Constraints

- Technical constraints:
  - keep the batch in the shared current worktree unless a concrete same-file conflict forces isolation; this batch stays shared
  - worker prompts must preserve overlapping active work in `apps/web` hosted device-sync files and `apps/cloudflare/src/node-runner.ts`
  - do not revert or discard unrelated dirty work already present in the tree
- Product/process constraints:
  - follow `AGENTS.md`, the installed `codex-workers` skill, and the coordination-ledger hard gate
- workers should not create commits
- the parent lane owns the required repo-level simplify, coverage, and final-review audit passes after implementation is collected

## Risks and mitigations

1. Risk: prompts 4 and 5 overlap the same webhook contract and provider payload surface.
   Mitigation: merge them into one worker lane with one owner.
2. Risk: prompt 1 touches `apps/cloudflare/src/node-runner.ts`, which overlaps an active hosted-runtime lane.
   Mitigation: keep that lane narrowly focused on hosted bundle contents and call out the overlap explicitly in the worker prompt.
3. Risk: multiple device-sync lanes touch neighboring hosted/local trust-boundary code.
   Mitigation: keep ownership disjoint, point each worker at exact files/tests, and require them to read current file state first.

## Tasks

1. Register the parent lane and worker lanes in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
2. Write one prompt file per final worker lane with explicit ownership, overlap notes, and verification/reporting expectations.
3. Launch the batch through `../workspace-docs/bin/codex-workers --raw-prompts --sandbox workspace-write --full-auto`.
4. Collect worker diffs, reconcile overlap, and run the required completion-workflow audits.
5. Re-run scoped verification, then the required repo checks, and commit the exact touched files.

## Decisions

- Keep the batch in the shared current worktree. The requested fixes are mostly disjoint, and the only concrete contract overlap worth merging is prompts 4 and 5.
- Use the workspace-local `../workspace-docs/bin/codex-workers` wrapper because the repo already documents it and it satisfies the installed `codex-workers` skill.
- Use `--raw-prompts` because the prompt files already include explicit worker instructions and lane boundaries.
- Use the same `codex-workers` wrapper as the fallback completion-workflow audit runner when the native spawned-agent tool is unavailable in the resumed parent context.
- Strengthen the merged webhook lane beyond the original sequential retry fix by introducing explicit webhook-trace processing state plus expiry-based reclaims so duplicate concurrent deliveries do not replay side effects or permanently burn retries after a failed hook.

## Verification

- Launch-time checks:
  - `../workspace-docs/bin/codex-workers --help`
  - targeted overlap scan against the current dirty worktree
- Worker expectations:
  - run the narrowest truthful verification for the owned surface
  - report exact commands and results
  - report any direct scenario proof or remaining gap
- Parent verification:
  - `pnpm exec tsc --noEmit -p packages/device-syncd/tsconfig.json`
  - `pnpm exec vitest run --coverage=false packages/device-syncd/test/public-ingress.test.ts packages/device-syncd/test/service.test.ts packages/device-syncd/test/http.test.ts packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/whoop-provider.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-http.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/agent-route.test.ts apps/web/test/prisma-store-device-sync-signal.test.ts`
  - repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`

## Worker lanes

1. `codex-worker-hosted-bundle-boundary`
   - user prompt 1
2. `codex-worker-device-sync-public-errors`
   - user prompt 2
3. `codex-worker-device-sync-disconnect-fence`
   - user prompt 3
4. `codex-worker-device-sync-webhook-boundary`
   - merged from user prompts 4 and 5

## Progress

- Done:
  - loaded the installed `codex-workers` skill instructions
  - read the repo routing, verification, package, security, reliability, and completion-workflow docs
  - mapped the requested prompts against active ledger rows and current dirty files
  - merged prompts 4 and 5 into one lane because both change the webhook parsing/ingress/control-plane contract
  - registered the parent lane and worker lanes in the coordination ledger
  - wrote the raw worker prompts under `agent-docs/exec-plans/active/worker-prompts/2026-03-27-device-sync-security-batch/`
  - launched the implementation worker batch and integrated the resulting diffs
  - tightened the merged webhook lane further during audit collection by replacing the racy duplicate precheck with explicit webhook-trace processing state plus expiry-based claim/release/complete transitions in SQLite and Prisma
  - ran focused runtime-state, device-syncd, and hosted web verification after the audit-driven webhook update
- Now:
  - close the active plan row, run repo-required checks, and commit the scoped files
- Next:
  - none
Completed: 2026-03-27
