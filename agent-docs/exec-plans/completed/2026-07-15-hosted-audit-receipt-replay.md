# Hosted audit receipt replay recovery

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Recover a hosted member runtime whose committed preference writes cannot be
  restored because an append-only audit shard advanced beyond the byte-prefix
  recorded by two durable canonical-write receipts.

## Success criteria

- Replaying a valid single-record audit append succeeds when that audit ID is
  already present with identical content or is absent from an otherwise valid
  audit shard.
- An existing audit ID with different content still fails closed, and no
  conflicting bytes are written.
- Invalid, multi-record, malformed-existing-file, and non-audit JSONL replay
  retain the existing byte-prefix guard.
- Reconciliation is unavailable unless the recorded base prefix is still
  present byte-for-byte and only later audit appends caused the drift.
- The affected hosted runtime restores, processes its pending mailbox, and the
  post-deploy hosted contract migration completes.

## Scope

- In scope: hosted canonical receipt replay for append-only audit shards,
  focused core tests, Cloudflare runner deployment, runtime recovery proof, and
  rerunning the blocked hosted contract migration.
- Out of scope: arbitrary JSONL conflict resolution, direct production database
  mutation, mailbox deletion, or weakening canonical-write guards generally.

## Constraints

- Reconcile only one schema-valid audit record at a time, using its immutable
  audit ID as the identity boundary.
- Append only when every existing non-empty audit line is schema-valid and the
  current file has a valid JSONL boundary.
- Preserve fail-closed behavior for duplicate IDs with different record content
  and every non-audit append target.
- Do not expose the affected member identifier or production payload contents in
  code, tests, commits, logs, or review artifacts.

## Root-cause evidence

- Production diagnostics repeatedly report
  `HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH` during cold restore.
- The affected runtime has two durable canonical-write receipts and two legacy
  preference mailbox events; its workspace checkpoint and consumed sequence do
  not advance.
- Preference mutation writes commit their text targets before appending an audit
  record. Replaying the older receipt after a later committed audit append makes
  the earlier byte-prefix guard permanently unsatisfiable even though audit
  records have immutable IDs and readers order by `occurredAt`.
- The operations page can only wake the runtime, and container SSH is not
  authenticated, so recovery must occur in the supported restore path.

## Tasks

1. Add the smallest audit-only reconciliation path at hosted receipt replay.
2. Prove identical replay, missing-record recovery, conflict rejection, and
   unchanged non-audit guarding with focused tests.
3. Run core owner verification, required coverage audit, and parent final review.
4. Commit through `scripts/finish-task`, push a PR, and run CI plus ReviewGPT on
   the exact pushed head.
5. Merge, deploy Cloudflare with immediate container rollout, prove the runtime
   drains safely, and rerun the blocked hosted contract migration.

## Verification

- Focused Vitest coverage for hosted canonical JSONL receipt replay.
- `pnpm --filter @murphai/core typecheck`.
- Truthful owner coverage through `pnpm test:diff` or the core coverage command
  selected by the verification map.
- `git diff --check`, required `coverage-write`, parent final review, exact-head
  ReviewGPT `PASS`, green PR CI, production runtime progress, and green hosted
  contract migration.

## Audit outcomes

- `coverage-write` found that the first implementation detected duplicate IDs
  only when they matched the incoming record. Accepted and fixed by validating
  uniqueness across the current audit shard before extending it.
- The audit added direct strict-guard proofs for unrelated duplicate IDs, an
  invalid single-record payload, and a current audit file shorter than the
  recorded base. No unresolved actionable findings remain.
- Parent final review narrowed reconciliation to the proven advanced-file case:
  base hash drift remains fail-closed even when the current file happens to
  contain schema-valid audit records.

## Verification outcomes

- Focused core operation suite: 43/43 passed.
- Core package typecheck: passed.
- Core package coverage: 705/705 passed; repository coverage thresholds passed.
- `git diff --check`: passed.
- Diff-aware reverse-dependent verification passed global guards and all 18
  affected package typechecks. Its parallel test phase hit one unrelated
  clinical-record preemption assertion (`AbortError` instead of the expected
  custom code); the exact test passed 1/1 when rerun alone. PR CI remains the
  clean full-graph proof.

## Deployment concerns

- The repair is runner-bundle behavior. Deploy Cloudflare with immediate
  container rollout so a retry does not land on an old warm runner lacking the
  recovery path.
- Web is backward compatible and does not need a tandem code change. After the
  runner converges, watch the anonymized runtime for checkpoint/mailbox progress
  before rerunning the post-deploy migration.
Completed: 2026-07-15
