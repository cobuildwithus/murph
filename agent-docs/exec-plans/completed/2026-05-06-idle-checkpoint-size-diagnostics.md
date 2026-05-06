Goal (incl. success criteria):
- Add metadata-only diagnostics for hosted full checkpoint snapshots, especially idle shutdown checkpoints.
- Success means runtime logs can show which checkpoint classes contribute files, inline bytes, and external artifact bytes without exposing raw paths, contents, identifiers, or secrets.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and avoid overlapping `apps/cloudflare/src/user-runner.ts` changes.
- Logs must stay redacted and shallow enough for hosted runtime log storage.
- Treat this as Cloudflare/runtime observability and reliability work.

Key decisions:
- Instrument the full snapshot builder, not the runner shutdown path, so idle shutdown and other full checkpoint reasons share one diagnostic surface.
- Emit class summaries only, with counts and byte totals. Do not log raw paths or file contents.

State:
- Handoff. Implementation and focused verification are complete; scoped commit is blocked by unrelated dirty ledger rows and active Cloudflare runner work.

Done:
- Read required workflow, architecture, security, reliability, and verification docs.
- Traced idle shutdown checkpoints to full hosted execution snapshots.
- Added pre-serialize and finished-checkpoint logs with class totals, inline/external byte totals, largest-file descriptors, and keyed relative-hash fingerprints.
- Added focused idle-shutdown checkpoint log coverage.
- Verified with focused Cloudflare bridge test/typecheck and runtime-state typecheck.

Now:
- Await commit/deploy coordination because the worktree has unrelated active Cloudflare runner changes.

Next:
- Deploy Cloudflare after the active runner lane is reconciled, then inspect `checkpoint.snapshot_size_progress` and `checkpoint.snapshot_finished` logs for the new workspace snapshot fields.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether production has `HOSTED_LOG_FINGERPRINT_SECRET`; this change does not require it because it emits class-only metrics.

Working set (files/ids/commands):
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
