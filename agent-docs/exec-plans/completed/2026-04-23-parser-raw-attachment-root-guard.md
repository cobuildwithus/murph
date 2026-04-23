Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fail closed when parser runtime rows reference attachment paths outside the raw inbox attachment root, so parser jobs only read canonical raw inbox evidence.

## Success criteria

- `resolveAttachmentArtifact()` normalizes `attachment.storedPath` before resolving it on disk.
- The normalized path must live under `raw/inbox/` or the parser job fails closed.
- Rejected out-of-root attachment paths still surface through the existing worker path as missing attachments without widening into the already-claimed `worker.ts` seam.
- Focused parser regressions cover the accepted raw path and rejected derived or sibling in-vault paths.

## Scope

- In scope:
- `packages/parsers/src/pipelines/resolve-attachment-artifact.ts`
- `packages/parsers/test/resolve-attachment-artifact.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-parser-raw-attachment-root-guard.md,COORDINATION_LEDGER.md}`
- Out of scope:
- `packages/parsers/src/pipelines/worker.ts`
- inbox capture persistence or runtime schema redesign
- parser artifact publish-path changes under `derived/inbox/**`
- broader parser runtime/store cleanup unrelated to this trust-boundary guard

## Constraints

- Preserve unrelated dirty-tree work and the existing active parser rows.
- Avoid editing `packages/parsers/src/pipelines/worker.ts` because an active ledger row already owns that seam.
- Keep the fix additive on the current raw inbox layout and reuse existing vault-path normalization helpers where possible.
- Treat this as a high-risk trust-boundary change: keep verification coverage-bearing, include direct scenario proof, and run the required audit passes before commit.

## Risks and mitigations

1. Risk: path normalization changes the stored path shape and accidentally rejects valid raw inbox attachments.
   Mitigation: normalize first, then accept only the existing `raw/inbox/` root plus descendants, and cover a valid raw attachment case in tests.
2. Risk: out-of-root failures no longer map to the worker's missing-attachment classification.
   Mitigation: keep the thrown error text aligned with the existing missing-attachment matcher instead of editing the already-claimed worker seam.
3. Risk: another active parser task starts touching the same files while this change is in flight.
   Mitigation: register the exact seam in the coordination ledger and keep the row narrow to these files and symbols only.

## Tasks

1. Add a raw inbox root guard to `resolveAttachmentArtifact()` using normalized stored paths.
2. Keep the rejection error compatible with the existing worker missing-attachment classification.
3. Add focused parser regression coverage in a new dedicated test file for accepted raw paths and rejected non-raw in-vault paths.
4. Run scoped verification, required audits, and a scoped commit flow.

## Decisions

- Reuse the parser shared path normalization helper instead of open-coding path cleanup in the worker.
- Reject non-raw stored paths in `resolveAttachmentArtifact()` before any disk resolution so the worker never parses derived or sibling in-vault content.
- Leave the already-claimed worker seam untouched and satisfy classification expectations through the rejection error text.

## Verification

- Required commands:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/parsers/src/pipelines/resolve-attachment-artifact.ts packages/parsers/test/resolve-attachment-artifact.test.ts`
- `pnpm --dir packages/parsers test:coverage`
- `pnpm test:smoke`
- `git diff --check`
- Required audits:
- `coverage-write`
- `task-finish-review`
- Direct scenario proof to capture:
- a normalized `raw/inbox/...` stored path still resolves successfully
- a stored path under `derived/inbox/...` or another in-vault root fails closed before parser execution
- Actual outcomes:
- `pnpm typecheck` failed on unrelated active `packages/inbox-services` typecheck errors; `packages/parsers` itself passed on the final rerun.
- `bash scripts/workspace-verify.sh test:diff packages/parsers/src/pipelines/resolve-attachment-artifact.ts packages/parsers/test/resolve-attachment-artifact.test.ts` failed on the same unrelated `packages/inbox-services` reverse-dependent churn.
- `pnpm --dir packages/parsers test:coverage` passed on the final rerun.
- `pnpm test:smoke` passed.
- `git diff --check -- packages/parsers/src/pipelines/resolve-attachment-artifact.ts packages/parsers/test/resolve-attachment-artifact.test.ts agent-docs/exec-plans/active/2026-04-23-parser-raw-attachment-root-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `coverage-write` found the existing proof sufficient and made no edits.
- `task-finish-review` reported no findings; it suggested one optional traversal-style proof, which was added to `packages/parsers/test/resolve-attachment-artifact.test.ts` and rerun green.
Completed: 2026-04-23
