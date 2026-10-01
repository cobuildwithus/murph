# Admit manual sync during retained device retries

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Run an accepted manual device refresh while older same-connection history jobs wait for their scheduled retry. Preserve those jobs and foreground priority.

## Success criteria

- Synthetic reproduction fails before the fix and passes afterward through queue admission, real device service, checkpoint and cold restore.
- Focused regressions, relevant typecheck, complexity check and parent review pass.

## Scope

- In scope: existing retained-device admission, one-shot manual job creation, recovery, owner docs and release note.
- Out of scope: production mutations, provider retry policy changes, assistant prompts and new scheduling owners.

## Constraints

- Retain exact connection epoch, job identity, remaining attempts and future availability. One continuation owner per connection remains authoritative.
- Product UX Patch: Outcome: requested refresh executes promptly; Reaches: existing personal device refresh; Proof: synthetic manual request alongside delayed history, foreground preemption and cold restore. Existing conversation and unrelated-connection priority remain intact.

## Risks and mitigations

1. Absorbing the manual request without creating its work: carry explicit pending manual intent in the existing wake hint until the provider-owned service creates jobs; recovery then carries exact jobs.
2. Resetting history or duplicating manual roots: hydrate exact old jobs first, create manual jobs once, and normalize the recovered hint after creation.
3. Mixed runtime versions: new pending-manual hint semantics require the corrected runner after first admission; document the rollback floor. No Web schema or provider API change.

## Tasks

1. Reproduce blocked admission and composed execution using synthetic fixtures.
2. Extend existing admission and device-service hydration, preserving retry ownership.
3. Prove failure, preemption, cold restore, scoped admission, and authority boundaries.
4. Update owners and changelog; verify, review and commit.

## Decisions

- Reuse the connection-work admission already on main. Manual provider jobs must still be created by queueManualReconcile, not duplicated by mailbox policy.
- No model behavior changes; deterministic runtime/service proof is the relevant boundary.

## Verification

- Reproduction: restored the two original production modules temporarily and ran the synthetic manual queue and workspace replay cases. Both failed; restored the authored fix before further verification.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-device-hint-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-state.test.ts packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts --no-coverage`: 461 passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; recovery complexity decreased, no new complexity debt. Existing unrelated hotspots retained.
- `bash scripts/check-agent-docs-drift.sh` and `git diff --check`: passed.
- `pnpm --dir apps/web changelog:generate`, then `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`: 10 passed.
- Reused known Frog entry `20260912202546-changelog-focused-test` for the documented command's incorrect working directory. Generated the normal changelog input before the corrected command; no new friction entry.
- Product UX: Ready for the tested runtime boundary. Manual work is durably transferred before the input retires, survives foreground preemption and cold restore, executes current provider requests, preserves future jobs and drains them only when due. Provider-root creation failure retains intent, and recovered jobs do not recreate roots.
- Parent review: checked queue authority, scope filters, exact job preservation, one-shot root creation, legacy manual-job recovery, source diffs, privacy and rollout constraints. No new external calls on the foreground reply path, database changes, model input changes, dependencies or second queue.
- Local fix only: no PR, deployment or production mutation. PR CI and final pushed-head ReviewGPT apply when entering the PR lane. The changelog source PR list is empty until a PR is assigned.
- Deployment limitation: old snapshots restore on the new runtime, but pending-manual intent is a new existing-hint meaning. Corrected consumers must own future restores before transfer admission; an older runtime must not restore a snapshot carrying that pending reason. Production recovery remains unverified until deployment.
Completed: 2026-09-13
