# DeepSec runner, assistant state, and scheduled-log fixes

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Resolve the five DeepSec `HIGH_BUG` findings called out by the operator with the smallest durable fixes.
- Preserve simple ownership boundaries: hosted runner deletion owns runner lease/container cleanup, assistant runtime state uses its existing runtime write lock, and scheduled logs reuse the cron-compatible schedule contract.

## Success criteria

- Account deletion invalidates any persisted active hosted runner invocation and stops the runner before R2 user-data cleanup.
- Assistant session and turn-receipt reads that can quarantine files are serialized with the assistant runtime write lock.
- Quarantine filenames are collision-safe.
- Scheduled-log create/import paths reject sub-minute `every` schedules before persistence.
- Focused tests cover each fixed behavior, with scoped verification run or explicitly blocked by unrelated dirty work.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `packages/assistant-engine/src/assistant/quarantine.ts`
- `packages/assistant-engine/src/assistant/store.ts`
- `packages/assistant-engine/src/assistant/turns.ts`
- focused assistant-engine tests
- `packages/contracts/src/schedule-intent.ts`
- `packages/contracts/generated/frontmatter-scheduled-log.schema.json`
- `packages/cli/src/commands/scheduled-log.ts`
- focused scheduled-log contract/core/CLI tests

## Constraints

- Preserve unrelated active work in the current checkout.
- Do not introduce a new runner control plane, new assistant state abstraction, or broad scheduling model.
- Keep logs metadata-only and avoid raw user data, paths, secrets, or local identifiers.

## Risks and mitigations

1. Risk: clearing a genuinely active hosted runner too early could duplicate work.
   Mitigation: deletion is an account-destruction path; clear the persisted lease and destroy the runner before any R2 sweep so late writes fail closed.
2. Risk: adding locks around read paths could deadlock if called from already locked code.
   Mitigation: lock only public read/list entrypoints that were previously unlocked; keep internal helpers usable inside existing write-lock scopes.
3. Risk: changing the executable schedule minimum could affect non-cron consumers.
   Mitigation: only executable schedules use the stricter minimum; generic schedule intents remain positive-only.

## Verification

- Run focused Cloudflare runner deletion tests.
- Run focused assistant-engine session/receipt/quarantine tests.
- Run focused contracts/core/CLI scheduled-log tests.
- Run scoped workspace verification; if blocked, record unrelated failing targets.

## Current verification

- Focused Cloudflare, assistant-engine, contracts, core, and CLI tests passed.
- Package typechecks passed for Cloudflare, assistant-engine, contracts, core, and CLI.
- Contracts artifact verification passed.
- `scripts/workspace-verify.sh test:diff ...` was attempted and reached package test execution, then failed in unrelated `packages/cli` release workflow guard expectations against the already-dirty `.github/workflows/release.yml`; the isolated timed-out CLI schema test passed when rerun directly.
- Scoped commit is blocked by overlapping unrelated dirty work in hosted runner and assistant persistence files.
Completed: 2026-05-09
