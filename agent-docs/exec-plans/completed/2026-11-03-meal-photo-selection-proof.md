# Verify immediate manual meal selection across import and restore

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Goal

- Verify that a due manual meal photo reaches its existing notification handler
  in the importing or restoring default invocation before idle shutdown.

## Success criteria

- Reproduce the pre-fix selection failure with synthetic state and prove the
  existing correction on the task base. Cover both real import and restore.
- Preserve conversation priority, automatic capture silence, retries and idle
  shutdown. Commit locally without pushing or creating a PR.

## Scope

- In scope: read-only diagnosis, mailbox/assistant selection proof, focused checks.
- Out of scope: production mutations, simulator use, broad suites, model policy.

## Constraints

- Keep production identities and evidence out of tracked artifacts. Use only
  synthetic fixtures. Avoid new state, scheduler or protocol fields.
- Outcome: manual uploads receive their estimation opportunity promptly.
- Reaches: fresh uploads and restored pending captures alongside device work.
- Proof: real runtime/importer/selector with the existing model-effect stub;
  verify exactly one handler call before checkpoint, then no replay.

## Risks and mitigations

1. Mistaking an already-fixed deployed regression for a new main-branch bug.
   Compare the affected release with the task base and report the distinction.
2. Hiding a priority regression behind a mocked selector.
   Exercise the production selector, importer and invocation lifecycle.

## Tasks

1. Inspect runtime evidence and the existing meal contract.
2. Compare the deployed selector with correction c33e5e47a4 already on the base.
3. Extend focused coverage for fresh import and snapshot restoration.
4. Prove failure with the old selector, restore the base, and run focused checks.
5. Review privacy, deployment compatibility and scope; close and commit.

## Decisions

- The base already contains c33e5e47a4. Add production code only if a remaining
  failure is reproduced. A passing test on the base must not be called a failing
  origin/main regression.
- Enqueue initializes nextAttemptAt to null; due work projects the current clock.
  There is no manual meal grouping timer at this owner.
- The corrected base already gives manual meal handling precedence over a
  model-free handoff and cron preflight, after existing conversation admission.
  No additional production change is justified by the reproduced failure.
- Changelog: not applicable; this commit extends synthetic scheduling coverage
  and the verification map, without changing shipped behavior.
- Deploy: the existing correction ships in the Cloudflare runner bundle. It
  changes no Web request, response, state schema or snapshot format; either
  deployment order remains compatible, while older runners retain the defect.
  This test-only follow-up has no deployment requirement.
- Delete instead of add: retain the existing selector correction and remove
  the fixture's throwing importer in favor of the production importer. No new
  timer, warm-window exception, persisted state, dependency or scheduler.

## Verification

- Focused manual meal starvation/import, foreground and scheduling suites;
  assistant-runtime typecheck; complexity and documentation checks.
- No new model instructions or tools: deterministic scheduling proof is the
  relevant boundary; live model and heavy CI suites remain outside this task.
- Installed dependencies with `pnpm install --frozen-lockfile`.
- Red proof: substituted only workspace-assistant-phase.ts from d43214266d;
  that file is identical to the pre-c33e5e47a4 parent. Eight of twelve cases
  failed, including both fresh and restored retained-due cases with handler
  call counts [0, 0, 1]. Restored the current source in a finally block.
- Green proof: current base source with the expanded suite, meal-photo-import,
  workspace-assistant-phase-foreground and workspace-assistant-phase-scheduling:
  4 files, 176 tests passed. Ran package Vitest with isolate, no coverage and one
  worker; no vault-share worker port is configured by these fixtures.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed (test-only TypeScript is excluded from source
  complexity). `pnpm docs:drift` and `git diff --check`: passed. Added-content
  privacy scan passed; the production selector is byte-identical to the base.
- Parent review found no additional scheduling owner or protocol change. Broad
  suites and hosted CI were not run under the local-only, focused-check boundary.
- Product UX replay: Ready at the tested scheduling boundary. Fresh and restored
  uploads receive one notification opportunity before idle shutdown; photo
  staging cleanup happens once, device acknowledgement still happens once, and
  future device and meal-closeout wakes remain intact. The model-effect stub
  does not prove reply prose or production rollout.
- The requested red result on origin/main does not exist: the task base already
  includes the correction. The red/green comparison proves the historical
  selector regression and the existing correction without manufacturing a
  second production patch.
Completed: 2026-11-03
