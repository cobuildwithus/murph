# PR 528 final review remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Preserve foreground reply delivery while guaranteeing that every background pass repairs complete direct-Linq transition proof before cron, and remove the proofless flag-off admission path.

## Success criteria

- Foreground passes defer cron without awaiting route repair before durable reply handoff and delivery.
- Raw pending proof survives foreground terminal evidence until a background repair succeeds; repair failure retains the existing wake/retry path and prevents cron.
- Background repair covers the complete raw pending set plus refresh-added proof before cron.
- Every admitted direct-home transition binds the current home and persists the exact former/current proof on its mailbox input.
- Focused owner tests, typechecks, required audits, exact-head CI, one fresh exact-head ReviewGPT audit, and review threads are clean.

## Scope

- In scope: hosted pending-input wake/repair ordering, the engine pre-cron hook condition, admitted Linq transition production, rollout docs, and focused tests.
- Out of scope: new schedulers, queues, lifecycle managers, persisted route history, or unrelated webhook behavior.

## Decisions

- Accepted the foreground critical-path finding after tracing reply-intent terminal evidence through the pre-checkpoint repair failure and pending-index compaction path.
- Accepted the proofless-admission finding after confirming duplicate handling precedes route resolution and the flag-off success path writes neither binding nor transition proof.
- Reuse the existing raw pending-input index as the retry source; do not introduce another durable obligation owner.
- Delete the unsafe feature gate instead of adding state or a rollout manager. The protocol field is additive and legacy parsers ignore unknown message fields; deployment still requires consumer-first rollout plus the existing retained-input migration.

## Verification

- `pnpm --filter @murphai/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts test/managed-automations-core.test.ts --maxWorkers=1 --no-file-parallelism` — 168 passed.
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-maintenance.test.ts test/hosted-runtime-turn-input.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-pending-assistant-input.test.ts --maxWorkers=1 --no-file-parallelism` — 294 passed after the final retained-progress correction.
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --maxWorkers=1 --no-file-parallelism -t "late foreground input during vault-share delivery runs before the delivery completes"` — 1 passed, directly proving late foreground completion plus the retained background wake/compaction path.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/test/hosted-onboarding-csrf.test.ts --maxWorkers=1 --no-file-parallelism` — 146 passed.
- `pnpm --filter @murphai/assistant-engine typecheck` — passed.
- `pnpm --filter @murphai/assistant-runtime typecheck` — passed.
- `pnpm --filter @murphai/hosted-web typecheck:prepared` — blocked by three unrelated phone-call fixtures because this worktree shares another checkout's newer generated Prisma client (`briefEncrypted` optionality); none of the failing files or schema surface is in this diff. Exact-head CI is the clean-environment authority.
- Serial `pnpm test:diff` with workspace and Vitest concurrency forced to one — dependency, workspace-boundary, hosted-runtime, crypto, and log guards passed; every affected package typecheck passed; assistant CLI 131, assistant engine 2,069, assistant runtime 1,545, and assistantd 40 tests passed. The reverse-dependent CLI lane then failed 119 unrelated command tests because the shared local CLI runtime-artifact repair lock never cleared; 957 CLI tests passed. The owned command exited naturally and no process was signaled.
- Parent final review: no new persisted state, scheduler, queue, manager, or broad history scan; raw pending-input state remains the one durable retry owner. Foreground reply handling does not await repair; background repair runs before selection/compaction and again for refresh-added proof before cron. Missing/incomplete rollout indexes retain their exact backfill behavior, while existing raw terminal proof stays wakeable until background compaction. Every admitted web transition now binds current home and carries exact former/current proof; quota rejection remains ahead of binding and append.
- Privacy/security review: the change adds no credential, auth, or sensitive logging surface; route proof remains bounded to exact direct-Linq input IDs and existing redacted runtime counts. Rollout remains consumer-first with an immediate runner fingerprint check, exact retained-input migration, then web deployment and a hard runner rollback floor.
Completed: 2026-07-13
