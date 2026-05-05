# Hosted Snapshot Repro E2E

## Goal

Reproduce or bound the production hosted import/outbox snapshot latency or failure mode in the local hosted E2E/test harness, with deterministic evidence around restored snapshot import, full snapshot completion, and outbox delivery drain behavior.

## Success Criteria

- Local test or e2e command creates an oversized hosted runtime snapshot state shaped like a grown local Codex home, using synthetic `.codex-hosted/sessions/**` continuity plus vault/runtime files.
- The repro captures whether restored import and `outbox_sending` produce full `checkpoint.snapshot_finished` metrics and whether Linq delivery drains.
- The command fails or reports clear diagnostics when the `outbox_sending` full fallback does not complete.
- The implementation uses synthetic data only and does not fixture real identifiers, secrets, message bodies, or production payloads.

## Scope

- Likely files: `apps/cloudflare/test/**`, hosted-local E2E helpers, and the minimal package/test scripts needed to run the repro.
- Avoid broad runtime refactors; this is a proof harness before a production fix.

## Verification

- Run the narrowest truthful Cloudflare/hosted-local test command covering the new repro.
- Run typecheck or targeted app verification if production code changes become necessary.

## Notes

- Hot-path `.codex-hosted` storage was removed; this plan now focuses on restored snapshot size/shape rather than asserting hot-state reuse or fallback.
- Local Codex-home metadata only, not contents, showed realistic growth is mostly `sessions/**/*.jsonl` with dated hierarchy and individual large JSONL sessions. The fixture follows that shape with deterministic synthetic data.
- Current focused run passed with restored snapshot import, welcome create-chat, direct Linq reply, full `outbox_sending` checkpoint, and drained mailbox.
- Verification: `pnpm --dir apps/cloudflare typecheck` passed; `pnpm hosted-local e2e snapshot-stress --profile e2e:stub --no-bundle` passed twice.
- Fresh `pnpm hosted-local e2e snapshot-stress --profile e2e:stub` rebuilt the runner bundle but failed before this scenario ran because Vite/Rolldown reported a duplicated `readHostedMailboxItemByDedupeKey` export while transforming the hosted web mailbox store. The checked source file is clean against `HEAD` and has one such export, so treat that as a separate clean-bundle/source-resolution blocker.
- Existing worktree has unrelated hosted-runtime edits; preserve them.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
