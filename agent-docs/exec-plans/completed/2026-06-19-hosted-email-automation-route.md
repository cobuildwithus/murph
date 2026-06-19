Goal (incl. success criteria):
- Reproduce the hosted email reminder bug with an E2E-style automation test before changing production code.
- Prevent email automations from being saved or run with only a blinded `threadId` and no deliverable `deliveryTarget`.
- Success means the bad route shape is rejected at automation write boundaries, existing bad canonical jobs fail before model/delivery side effects instead of advancing as succeeded, and generated email thread subjects do not block valid thread replies.

Constraints/Assumptions:
- Web remains the owner of hosted product/control facts; Cloudflare and assistant runtime only execute restored local runtime work.
- Hosted email delivery uses `deliveryTarget` as the deliverable target; `threadId` is a continuity locator and is not enough to send.
- Keep the fix small and route-owned. Do not add a scheduler, queue, migration, or broad runtime abstraction unless a failing proof requires it.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Start with a failing CLI automation regression that encodes the observed bad route shape.
- Prefer a shared route-validation primitive over duplicated CLI/runtime rules if the existing package boundaries support it cleanly.

State:
- Complete; final scoped commit remains.

Done:
- Production logs and saved automation metadata identified the route shape: `channel=email`, `threadId` present, no `identityId`, no `deliveryTarget`.
- Repo workflow, hosted runtime, security, and reliability docs reviewed.
- Added CLI regression proving `automation save` and `automation import-json` previously accepted email routes with only a thread locator.
- Added shared automation-route deliverability validation in `operator-config`.
- Wired CLI save/import, cron authoring diagnostics, and cron execution preflight through the shared validator.
- Added runtime regression proving an existing bad canonical email automation fails before the assistant turn.
- Dropped generated email subjects for thread replies while continuing to reject manually configured subject overrides.
- Focused tests pass for operator-config route validation, CLI automation, and assistant cron/email subject coverage.
- Accepted deep-review finding: private/redacted placeholders could still pass as email explicit targets or Linq participant materialization targets. Fixed in shared validation and added shared/runtime proof.
- Coverage-write added a positive runtime proof for the intentional non-private email identity+thread compatibility path.
- Final `pnpm test:diff <changed files>` passed, including affected package tests and `apps/cloudflare verify`.
- Final `pnpm typecheck` passed.
- Security/privacy and deep-review reruns found no remaining actionable issues.

Now:
- Commit the scoped fix with `scripts/finish-task`.

Next:
- Handoff with verification, audit, root cause, and deployment concerns.

Open questions (UNCONFIRMED if needed):
- Exact command used by the in-container assistant is UNCONFIRMED, but the persisted route shape is enough to reproduce the bug.

Working set (files/ids/commands):
- packages/cli/src/commands/automation.ts
- packages/cli/test/automation*.test.ts
- packages/assistant-engine/src/assistant/cron.ts
- packages/assistant-engine/src/assistant/cron/targets.ts
- packages/assistant-engine/src/assistant/notification-turn.ts
- packages/assistant-engine/test/assistant-*.test.ts
- packages/operator-config/src/assistant/*
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
