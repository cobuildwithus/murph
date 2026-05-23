# Hosted compaction trigger

Status: blocked
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Add a narrow operator command to manually trigger
  `legacy-wearable-receipt-compaction-v1` for active hosted members and report
  before/after workspace snapshot sizes.

## Success Criteria

- The command reuses existing hosted workspace wake fields and Temporal runtime
  signaling.
- The command supports a dry run, bounded target selection, and optional polling
  for after-state measurement.
- Output stays metadata-only and does not expose member identifiers, raw health
  payloads, object keys, hashes, secrets, prompts, transcripts, or local paths.
- Focused tests cover option parsing and redacted report construction.
- Production execution, when explicitly requested by the operator, uses Vercel
  production env injection and runs dry-run, canary, then full execution only
  after local checks and the hosted Cloudflare deploy are green.

## Scope

- In scope:
  - One-off hosted web operator script.
  - Focused script tests.
  - Operator-requested production dry-run, canary, and full trigger execution.
- Out of scope:
  - New product APIs, durable maintenance queues, new DB fields, or generic
    compaction framework.

## Constraints

- Keep the implementation simple and aligned with the existing hosted runtime
  wake primitive.
- Preserve unrelated active work and ledger rows.
- Do not expose direct user/member identifiers in code comments, generated
  reports, logs, examples, or handoff notes.

## State

- `legacy-wearable-receipt-compaction-v1` already runs from hosted runtime
  housekeeping when a workspace wake with that reason is due.
- Workspace snapshot v2 refs already carry encrypted/plain byte totals and file
  counts.
- The hosted Cloudflare deploy workflow is green on a commit after the
  compaction cap-removal change.
- Production Vercel env injection currently provides Temporal variables but an
  empty `DATABASE_URL`; the only available production DB inspection path is the
  read-only DBHub connection. Do not execute the mutating trigger until a
  writable production `DATABASE_URL` is explicitly supplied.
- Read-only production inspection shows 10 active hosted members with 10
  workspace rows. Known v2 snapshot totals are 69,213,906 encrypted bytes and
  1,530,938,205 plain bytes; the largest known workspace is about 1.1 GB plain.

## Tasks

1. Confirm the existing wake/signaling path can be reused safely.
2. Add the operator script and focused tests.
3. Run scoped verification and required reviews.
4. Resolve the writable production database URL source.
5. Run the requested production dry-run, canary, and full execution sequence.
6. Close the plan with a scoped commit if the worktree allows it.
